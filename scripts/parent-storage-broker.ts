import { createServer } from "node:http";
import { Readable } from "node:stream";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { createStorageBroker } from "../src/lib/parent/storage-broker";
import { createS3Storage, s3StorageCredentialsSchema, storageArtifactGuardReady } from "../src/lib/parent/storage-s3";
import {
  canonicalProjectOrigin,
  parentProjectIsolationIssues,
} from "../src/lib/parent/project-origin";
import { connectedParentServiceAllowed } from "../src/lib/parent/connected-service";
import { hostedParentServiceAllowed } from "../src/lib/parent/hosted-service";

export function brokerS3Credentials(env: Record<string, string | undefined>) {
  if ([env.CASELINK_PARENT_STORAGE_BROKER_STORAGE_KEY, env.SUPABASE_SERVICE_ROLE_KEY, env.SUPABASE_SECRET_KEY].some(Boolean))
    throw new Error("Project API credentials do not belong in the Storage-only broker.");
  return s3StorageCredentialsSchema.parse({
    s3AccessKeyId: env.CASELINK_PARENT_STORAGE_BROKER_S3_ACCESS_KEY_ID,
    s3SecretAccessKey: env.CASELINK_PARENT_STORAGE_BROKER_S3_SECRET_ACCESS_KEY,
    s3Region: env.CASELINK_PARENT_STORAGE_BROKER_S3_REGION,
  });
}

async function main() {
  const env = process.env;
  const databaseUrl = env.CASELINK_PARENT_STORAGE_BROKER_DATABASE_URL,
    projectUrl = env.CASELINK_PARENT_STORAGE_BROKER_SUPABASE_URL,
    secret = env.CASELINK_PARENT_STORAGE_BROKER_SECRET;
  const credentials = brokerS3Credentials(env);
  if (
    !databaseUrl ||
    !projectUrl ||
    !secret ||
    secret.length < 32
  )
    throw new Error(
      "An isolated broker database, Storage-only S3 credentials and separate 32-character secret are required.",
    );
  const canonicalProject = canonicalProjectOrigin(projectUrl);
  if (
    !canonicalProject ||
    parentProjectIsolationIssues({
      projectUrl,
      schoolUrl: env.CASELINK_SCHOOL_SUPABASE_URL,
      parentProductionUrl:
        env.CASELINK_PARENT_PRODUCTION_SUPABASE_URL ??
        env.CASELINK_PRODUCTION_SUPABASE_URL,
      environment: env.CASELINK_ENVIRONMENT ?? "production",
      accountMode: env.CASELINK_PARENT_ACCOUNT_MODE,
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
  const connected = connectedParentServiceAllowed(
    env,
    databaseUrl,
    canonicalProject,
    origin,
  );
  const hosted = hostedParentServiceAllowed(env, databaseUrl, canonicalProject, origin);
  if (
    local &&
    (database.port !== "55322" || project.port !== "55321") &&
    !(
      env.CASELINK_PARENT_ACCOUNT_MODE === "existing" &&
      database.port === "54322" &&
      project.port === "54321"
    )
  )
    throw new Error("The local broker requires isolated parent project ports.");
  if (
    !local &&
    (env.CASELINK_PARENT_STORAGE_BROKER_APPROVED !== "1" ||
      project.protocol !== "https:" ||
      (!connected && !hosted && !canonicalProjectOrigin(origin)?.startsWith("https:")))
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
  const storage = createS3Storage({ projectUrl: canonicalProject, ...credentials });
  const handler = createStorageBroker({
    secret,
    origin,
    supabaseOrigin: canonicalProject,
    ports: {
      async checkHealth() {
        return await storageArtifactGuardReady(db) && await storage.checkHealth();
      },
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
        return storage.signDownload(bucket, path, seconds);
      },
      async upload(bucket, path, bytes, mediaType) {
        if (!await storageArtifactGuardReady(db)) throw new Error("storage_immutability_unavailable");
        await storage.upload(bucket, path, bytes, mediaType);
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
      storage.destroy();
      void db.end();
    });
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.stdout.write(
    "Private parent storage broker is listening on loopback.\n",
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main().catch(() => {
  process.stderr.write(
    "The isolated parent storage broker could not start. Check the protected runtime configuration.\n",
  );
  process.exitCode = 1;
});
