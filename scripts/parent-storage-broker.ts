import { createServer } from "node:http";
import { Readable } from "node:stream";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createStorageBroker } from "../src/lib/parent/storage-broker";
import { createS3Storage, s3StorageCredentialsSchema, storageArtifactGuardReady } from "../src/lib/parent/storage-s3";
import { createParentServiceDatabase, validateParentServiceDatabaseTarget } from "../src/lib/parent/service-database";

export function brokerS3Credentials(env: Record<string, string | undefined>) {
  if ([env.CASELINK_PARENT_STORAGE_BROKER_STORAGE_KEY, env.SUPABASE_SERVICE_ROLE_KEY, env.SUPABASE_SECRET_KEY].some(Boolean))
    throw new Error("Project API credentials do not belong in the Storage-only broker.");
  return s3StorageCredentialsSchema.parse({
    s3AccessKeyId: env.CASELINK_PARENT_STORAGE_BROKER_S3_ACCESS_KEY_ID,
    s3SecretAccessKey: env.CASELINK_PARENT_STORAGE_BROKER_S3_SECRET_ACCESS_KEY,
    s3Region: env.CASELINK_PARENT_STORAGE_BROKER_S3_REGION,
  });
}

export async function startParentStorageBroker(env: Record<string, string | undefined> = process.env) {
  const target = validateParentServiceDatabaseTarget(env, "storage_broker");
  const { projectUrl: canonicalProject, brokerOrigin: origin } = target;
  const secret = env.CASELINK_PARENT_STORAGE_BROKER_SECRET;
  const credentials = brokerS3Credentials(env);
  if (
    !secret ||
    secret.length < 32
  )
    throw new Error(
      "An isolated broker database, Storage-only S3 credentials and separate 32-character secret are required.",
    );
  const service = createParentServiceDatabase(target), db = service.database;
  let storage: ReturnType<typeof createS3Storage> | undefined, server: ReturnType<typeof createServer> | undefined, stopped = false;
  const stop = () => {
    if (stopped) return; stopped = true;
    process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
    service.signal.removeEventListener("abort", stop);
    server?.close(); server?.closeAllConnections();
    storage?.destroy(); service.close();
  };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  service.signal.addEventListener("abort", stop, { once: true });
  try {
    await service.connect();
    const activeStorage = storage = createS3Storage({ projectUrl: canonicalProject, ...credentials });
    const handler = createStorageBroker({
      secret,
      origin,
      supabaseOrigin: canonicalProject,
      ports: {
        async checkHealth() {
          return await storageArtifactGuardReady(db) && await activeStorage.checkHealth();
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
          return activeStorage.signDownload(bucket, path, seconds);
        },
        async upload(bucket, path, bytes, mediaType) {
          if (!await storageArtifactGuardReady(db)) throw new Error("storage_immutability_unavailable");
          await activeStorage.upload(bucket, path, bytes, mediaType);
        },
      },
    });
    const port = Number(new URL(origin).port || (target.local ? 3310 : 8080));
    server = createServer(async (incoming, outgoing) => {
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
    const listener = server;
    await Promise.race([new Promise<void>((resolve, reject) => {
      listener.once("error", reject);
      listener.listen(port, "127.0.0.1", () => { listener.removeListener("error", reject); resolve(); });
    }), service.stopped]);
    server.on("error", stop);
    process.stdout.write(
      "Private parent storage broker is listening on loopback.\n",
    );
    return { stop };
  } catch (error) { stop(); throw error; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void startParentStorageBroker().catch(() => {
  process.stderr.write(
    "The isolated parent storage broker could not start. Check the protected runtime configuration.\n",
  );
  process.exitCode = 1;
});
