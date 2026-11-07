import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { publicKeyIsSafe } from "../src/lib/parent/configuration";
import { createLocalParentProtectedFrontdoor } from "../src/lib/parent/protected-frontdoor";
import { createSnapProtectedReviewServer } from "../src/lib/parent/snap-protected-review";
import { createSinchSnapFaxCarrier, snapSenderCarrierConfigSchema } from "../src/lib/parent/snap-sender-carrier";
import { createSnapProtectedDelivery, createSnapProtectedSenderHandler } from "../src/lib/parent/snap-sender-service";
import { createSnapSenderStore } from "../src/lib/parent/snap-sender-store";

const unavailable = "The isolated SNAP services could not run. No credentials or household information are logged.";
function localOrigin(value: string) {
  try {
    const url = new URL(value);
    return url.origin === value && url.protocol === "http:" && url.hostname === "127.0.0.1" && Number(url.port) >= 1024
      && Number(url.port) <= 65535 && url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}
function privateDatabase(value: string) {
  try {
    const url = new URL(value);
    return ["postgres:", "postgresql:"].includes(url.protocol) && url.hostname === "127.0.0.1" && url.port === "55322"
      && url.pathname === "/postgres" && /^caselink_[a-z0-9_]{1,54}$/.test(decodeURIComponent(url.username)) && !!url.password
      && !url.hash && ["", "?sslmode=disable"].includes(url.search);
  } catch { return false; }
}
const origin = z.string().max(100).refine(localOrigin), database = z.string().max(2048).refine(privateDatabase);
const approvedUntil = z.iso.datetime({ offset: true });
const secret = z.string().regex(/^[\x21-\x7e]{32,256}$/);
export const snapPrivateServicesSchema = z.object({
  approvalReference: z.string().trim().min(1).max(1000), approvedUntil,
  publicOrigin: z.literal("http://127.0.0.1:3200"), appOrigin: origin, reviewOrigin: origin, senderOrigin: origin,
  supabaseOrigin: z.literal("http://127.0.0.1:55321"), supabasePublicKey: z.string().min(1).max(4096).regex(/^[A-Za-z0-9._-]+$/).refine(publicKeyIsSafe),
  finalizerDatabaseUrl: database, senderDatabaseUrl: database, senderSecret: secret, carrier: snapSenderCarrierConfigSchema,
}).strict().refine(value => new Set([value.publicOrigin, value.appOrigin, value.reviewOrigin, value.senderOrigin, value.supabaseOrigin]).size === 5
  && decodeURIComponent(new URL(value.finalizerDatabaseUrl).username) !== decodeURIComponent(new URL(value.senderDatabaseUrl).username));
export type SnapPrivateServicesConfig = z.infer<typeof snapPrivateServicesSchema>;
export type SnapPrivateService = "snap-sender" | "snap-review" | "snap-frontdoor";

function current(value: string, now = Date.now()) {
  const remaining = Date.parse(value) - now;
  if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 25 * 60 * 60 * 1000) throw new Error(unavailable);
  return remaining;
}
export function parseSnapPrivateServices(value: unknown, now = Date.now()) {
  try { const config = snapPrivateServicesSchema.parse(value); current(config.approvedUntil, now); return config; }
  catch { throw new Error(unavailable); }
}

/** Explicit owner-only file, outside automatic Next .env loading. This never creates credentials or changes approval. */
export function readSnapPrivateServices(path: string) {
  let fd: number | undefined;
  try {
    const target = resolve(path), parent = dirname(target), directory = lstatSync(parent);
    if (path !== target || !directory.isDirectory() || directory.isSymbolicLink() || realpathSync(parent) !== parent
      || directory.uid !== process.getuid?.() || (directory.mode & 0o777) !== 0o700) throw new Error();
    fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const file = fstatSync(fd);
    if (!file.isFile() || file.uid !== process.getuid?.() || file.nlink !== 1 || (file.mode & 0o777) !== 0o600 || file.size <= 0 || file.size > 65536) throw new Error();
    return parseSnapPrivateServices(JSON.parse(readFileSync(fd, "utf8")));
  } catch { throw new Error(unavailable); }
  finally { if (fd !== undefined) closeSync(fd); }
}

export function snapSenderWorkerEnvironment(config: SnapPrivateServicesConfig): Record<string, string> {
  return { CASELINK_PARENT_SNAP_SENDER_ORIGIN: config.senderOrigin, CASELINK_PARENT_SNAP_SENDER_SECRET: config.senderSecret };
}
export function snapPrivateChildEnvironment(service: SnapPrivateService, value: unknown, system: Record<string, string | undefined> = process.env): NodeJS.ProcessEnv {
  const config = parseSnapPrivateServices(value);
  const env: NodeJS.ProcessEnv = { ...Object.fromEntries(["PATH", "HOME", "TMPDIR"].map(key => [key, system[key]])),
    NODE_ENV: "production", CASELINK_PRODUCT: "parent", CASELINK_ENVIRONMENT: "test" };
  const base = { approvedUntil: config.approvedUntil };
  const child = service === "snap-sender" ? { ...base, origin: config.senderOrigin, secret: config.senderSecret, databaseUrl: config.senderDatabaseUrl, carrier: config.carrier }
    : service === "snap-review" ? { ...base, origin: config.reviewOrigin, publicOrigin: config.publicOrigin,
      supabaseOrigin: config.supabaseOrigin, supabasePublicKey: config.supabasePublicKey, finalizerDatabaseUrl: config.finalizerDatabaseUrl }
      : { ...base, publicOrigin: config.publicOrigin, appOrigin: config.appOrigin, reviewOrigin: config.reviewOrigin };
  env.CASELINK_PARENT_SNAP_PRIVATE_CHILD = JSON.stringify(child);
  return env;
}

export function senderServer(origin: string, secretValue: string, databaseUrl: string, carrier: z.infer<typeof snapSenderCarrierConfigSchema>) {
  const handle = createSnapProtectedSenderHandler({ origin, secret: secretValue,
    delivery: createSnapProtectedDelivery({ store: createSnapSenderStore({ connectionString: databaseUrl }), carrier: createSinchSnapFaxCarrier(carrier) }) });
  const server = createServer({ maxHeaderSize: 16384 }, async (incoming, outgoing) => {
    const stop = new AbortController(), timer = setTimeout(() => { stop.abort(); outgoing.destroy(); }, 55_000);
    const abort = () => stop.abort(); incoming.once("aborted", abort);
    outgoing.once("close", () => { clearTimeout(timer); if (!outgoing.writableFinished) stop.abort(); });
    try {
      if (!["127.0.0.1", "::ffff:127.0.0.1"].includes(incoming.socket.remoteAddress ?? "")) { outgoing.writeHead(403); outgoing.end(); return; }
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      const init: RequestInit & { duplex?: "half" } = { method: incoming.method, headers, signal: stop.signal,
        ...(incoming.method === "POST" ? { body: Readable.toWeb(incoming) as ReadableStream<Uint8Array>, duplex: "half" as const } : {}) };
      const response = await handle(new Request(origin + incoming.url, init));
      if (outgoing.destroyed) return;
      outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(await response.text());
    } catch { if (!outgoing.destroyed && !outgoing.headersSent) { outgoing.writeHead(503, { "Cache-Control": "private, no-store" }); outgoing.end(); } else outgoing.destroy(); }
    finally { clearTimeout(timer); incoming.removeListener("aborted", abort); }
  });
  server.headersTimeout = 10000; server.requestTimeout = 55000;
  server.on("clientError", (_error, socket) => { if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"); });
  return server;
}

async function main() {
  const service = z.enum(["snap-sender", "snap-review", "snap-frontdoor"]).parse(process.argv[2]);
  const value: unknown = JSON.parse(process.env.CASELINK_PARENT_SNAP_PRIVATE_CHILD ?? "");
  let server: ReturnType<typeof createServer>, listenOrigin: string, until: string;
  if (service === "snap-sender") {
    const config = z.object({ approvedUntil, origin, secret, databaseUrl: database, carrier: snapSenderCarrierConfigSchema }).strict().parse(value);
    current(config.approvedUntil); until = config.approvedUntil; listenOrigin = config.origin;
    server = senderServer(config.origin, config.secret, config.databaseUrl, config.carrier);
  } else if (service === "snap-review") {
    const config = z.object({ approvedUntil, origin, publicOrigin: z.literal("http://127.0.0.1:3200"), supabaseOrigin: z.literal("http://127.0.0.1:55321"),
      supabasePublicKey: z.string().refine(publicKeyIsSafe), finalizerDatabaseUrl: database }).strict().parse(value);
    current(config.approvedUntil); until = config.approvedUntil; listenOrigin = config.origin;
    const { approvedUntil: _, origin: __, ...review } = config; void _; void __;
    server = createSnapProtectedReviewServer(review);
  } else {
    const config = z.object({ approvedUntil, publicOrigin: z.literal("http://127.0.0.1:3200"), appOrigin: origin, reviewOrigin: origin }).strict().parse(value);
    current(config.approvedUntil); until = config.approvedUntil; listenOrigin = config.publicOrigin;
    server = createLocalParentProtectedFrontdoor(config.appOrigin, config.reviewOrigin);
  }
  const stop = () => { clearTimeout(timer); server.close(); server.closeAllConnections(); };
  const timer = setTimeout(stop, current(until));
  for (const name of ["SIGINT", "SIGTERM"] as const) process.once(name, stop);
  server.once("error", () => { stop(); process.stderr.write(unavailable + "\n"); process.exitCode = 1; });
  server.listen(Number(new URL(listenOrigin).port), "127.0.0.1", () => { process.send?.({ ready: true, service }); });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main().catch(() => { process.stderr.write(unavailable + "\n"); process.exitCode = 1; });
