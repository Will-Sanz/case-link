import { createServer } from "node:http";
import { Readable } from "node:stream";
import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";
import { createStorageBroker } from "../src/lib/parent/storage-broker";
import {
  canonicalProjectOrigin,
  parentProjectIsolationIssues,
} from "../src/lib/parent/project-origin";
import { fetchWithTimeout } from "../src/lib/supabase/fetch-with-timeout";

async function main() {
  const env = process.env;
  const databaseUrl = env.CASELINK_PARENT_STORAGE_BROKER_DATABASE_URL,
    projectUrl = env.CASELINK_PARENT_STORAGE_BROKER_SUPABASE_URL,
    storageKey = env.CASELINK_PARENT_STORAGE_BROKER_STORAGE_KEY,
    secret = env.CASELINK_PARENT_STORAGE_BROKER_SECRET;
  if (
    !databaseUrl ||
    !projectUrl ||
    !storageKey ||
    !secret ||
    secret.length < 32
  )
    throw new Error(
      "An isolated broker database, parent storage credential and separate 32-character secret are required.",
    );
  const canonicalProject = canonicalProjectOrigin(projectUrl);
  if (
    !canonicalProject ||
    parentProjectIsolationIssues({
      projectUrl,
      schoolUrl: env.CASELINK_SCHOOL_SUPABASE_URL,
      parentProductionUrl: env.CASELINK_PARENT_PRODUCTION_SUPABASE_URL,
      environment: env.CASELINK_ENVIRONMENT ?? "production",
    }).length
  )
    throw new Error("The broker requires verified isolated project origins.");
  const database = new URL(databaseUrl),
    project = new URL(canonicalProject),
    origin =
      env.CASELINK_PARENT_STORAGE_BROKER_ORIGIN ?? "http://127.0.0.1:3310";
  const loopback = (host: string) =>
    ["localhost", "127.0.0.1", "[::1]"].includes(host);
  const local =
    loopback(database.hostname) &&
    loopback(project.hostname) &&
    loopback(new URL(origin).hostname);
  if (local && (database.port !== "55322" || project.port !== "55321"))
    throw new Error("The local broker requires isolated parent project ports.");
  if (
    !local &&
    (env.CASELINK_PARENT_STORAGE_BROKER_APPROVED !== "1" ||
      project.protocol !== "https:" ||
      !canonicalProjectOrigin(origin)?.startsWith("https:"))
  )
    throw new Error(
      "The remote broker needs explicit approval and isolated HTTPS origins.",
    );
  const db = new Client({
    connectionString: databaseUrl,
    application_name: "caselink-parent-storage-broker",
    statement_timeout: 15000,
  });
  await db.connect();
  const principal = (
    await db.query(
      `select r.rolname,r.rolinherit,r.rolsuper,r.rolbypassrls,r.rolcreaterole,pg_has_role(session_user,'parent_storage_broker','MEMBER') member,exists(select 1 from pg_auth_members m join pg_roles g on g.oid=m.roleid where m.member=r.oid and g.rolname<>'parent_storage_broker') broader_membership from pg_roles r where r.rolname=session_user`,
    )
  ).rows[0];
  if (
    !principal ||
    !principal.member ||
    principal.rolinherit ||
    principal.rolsuper ||
    principal.rolbypassrls ||
    principal.rolcreaterole ||
    principal.broader_membership
  ) {
    await db.end();
    throw new Error(
      "Use a dedicated NOINHERIT login granted only the parent_storage_broker role.",
    );
  }
  await db.query("set role parent_storage_broker");
  const supabase = createClient(canonicalProject, storageKey, {
    global: { fetch: fetchWithTimeout },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const handler = createStorageBroker({
    secret,
    origin,
    supabaseOrigin: canonicalProject,
    ports: {
      async authorize(purpose) {
        const result = await db.query(
          "select parent_private.parent_authorize_storage($1,$2,$3,$4,$5) permission",
          [
            purpose.jobId,
            purpose.leaseToken,
            purpose.bucket,
            purpose.objectPath,
            purpose.mode,
          ],
        );
        return result.rows[0].permission;
      },
      async signDownload(bucket, path, seconds) {
        const { data, error } = await supabase.storage
          .from(bucket)
          .createSignedUrl(path, seconds);
        if (error || !data) throw new Error("download_unavailable");
        return data.signedUrl;
      },
      async upload(bucket, path, bytes, mediaType) {
        const { error } = await supabase.storage
          .from(bucket)
          .upload(path, bytes, { upsert: false, contentType: mediaType });
        if (error) throw new Error("upload_unconfirmed");
      },
    },
  });
  const port = Number(new URL(origin).port || (local ? 3310 : 8080));
  const server = createServer(async (incoming, outgoing) => {
    try {
      const headers = new Headers();
      for (let i = 0; i < incoming.rawHeaders.length; i += 2)
        headers.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1]);
      const method = incoming.method ?? "GET";
      const init: RequestInit & { duplex?: "half" } = {
        method,
        headers,
        ...(method === "POST" || method === "PUT"
          ? {
              body: Readable.toWeb(incoming) as ReadableStream<Uint8Array>,
              duplex: "half" as const,
            }
          : {}),
      };
      const response = await handler(
        new Request(new URL(incoming.url ?? "/", origin), init),
      );
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.writeHead(503, { "Cache-Control": "no-store" });
      outgoing.end("Private storage service unavailable.");
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.maxRequestsPerSocket = 20;
  server.listen(port, "127.0.0.1");
  const stop = () =>
    server.close(() => {
      void db.end();
    });
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.stdout.write(
    "Private parent storage broker is listening on loopback.\n",
  );
}
void main().catch(() => {
  process.stderr.write(
    "The isolated parent storage broker could not start. Check the protected runtime configuration.\n",
  );
  process.exitCode = 1;
});
