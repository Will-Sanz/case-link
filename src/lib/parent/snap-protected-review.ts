import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { isIP } from "node:net";
import { createServerClient, parseCookieHeader, serializeCookieHeader } from "@supabase/ssr";
import { z } from "zod";
import { publicKeyIsSafe } from "./configuration";
import { canonicalProjectOrigin, isLoopbackHost } from "./project-origin";
import { verifyParentSession } from "./parent-session";
import { fetchWithTimeout } from "@/lib/supabase/fetch-with-timeout";
import { MAX_SNAP_PACKET_BYTES, snapFinalPacketBindingSchema, snapPacketAuthorizationResultSchema } from "./snap-packet-contract";
import { finalizeSnapDirectCompletion, openSnapFinalPacketForIsolatedReview, reconcileSnapDirectCompletion, reconcileSnapFinalPacket, stageSnapFinalPacket, validateSnapFinalizerConnection, type SnapFinalizerResult } from "./snap-finalizer-client";
import { inspectSnapFinalPdf } from "./snap-final-pdf";

const configFields = {
  publicOrigin: z.string().max(100),
  supabasePublicKey: z.string().min(1).max(4096).regex(/^[A-Za-z0-9._-]+$/).refine(publicKeyIsSafe),
  finalizerDatabaseUrl: z.string().min(1).max(2048),
  controlledTest: z.object({ requestId: z.uuid(), snapshotHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional(),
};
const configSchema = z.discriminatedUnion("mode", [
  z.object({ ...configFields, mode: z.literal("local").optional(), supabaseOrigin: z.literal("http://127.0.0.1:55321") }).strict(),
  z.object({ ...configFields, mode: z.literal("hosted"), supabaseOrigin: z.string().regex(/^https:\/\/[a-z0-9]+\.supabase\.co$/) }).strict(),
]);
export type SnapProtectedReviewConfig = z.infer<typeof configSchema>;
const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}";
const routePattern = new RegExp(`^/protected/snap/requests/(${uuid})/packets/(${uuid})(/direct-completion)?\\?expectedVersion=([1-9][0-9]{0,9})$`);
const maxCompletionBytes = 256 * 1024;
const unavailable = "The protected application could not be saved or opened. Check the saved application and try again.";
const responseHeaders = {
  "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "SAMEORIGIN", "Referrer-Policy": "no-referrer",
};
function route(raw: string) {
  const match = routePattern.exec(raw);
  return match && Number(match[4]) <= 2147483647 ? { requestId: match[1], packetId: match[2], direct: !!match[3], expectedVersion: Number(match[4]) } : null;
}
function configuration(input: unknown) {
  try {
    const config = configSchema.parse(input), origin = new URL(config.publicOrigin), database = new URL(config.finalizerDatabaseUrl);
    const target = validateSnapFinalizerConnection(config.finalizerDatabaseUrl);
    if (canonicalProjectOrigin(config.publicOrigin) !== config.publicOrigin || !/^caselink_[a-z0-9_]{1,54}$/.test(target.login)) throw new Error();
    if (config.mode === "hosted") {
      const project = new URL(config.supabaseOrigin);
      if (origin.protocol !== "https:" || isLoopbackHost(origin.hostname) || isIP(origin.hostname.replace(/^\[|\]$/g, ""))
        || !origin.hostname.includes(".") || origin.hostname.endsWith(".localhost")
        || target.local || database.hostname !== `db.${project.hostname}`) throw new Error();
    } else if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || Number(origin.port) < 1024
      || database.hostname !== "127.0.0.1") throw new Error();
    return config;
  } catch { throw new Error("The protected review service is not configured."); }
}

async function readProtectedBody(request: Request, size: number, signal: AbortSignal): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error();
  const bytes = new Uint8Array(size);
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  let offset = 0;
  try {
    signal.throwIfAborted();
    for (;;) {
      const { done, value } = await reader.read();
      try {
        signal.throwIfAborted();
        if (done) break;
        if (offset + value.byteLength > size) { cancel(); throw new Error(); }
        bytes.set(value, offset); offset += value.byteLength;
      } finally { value?.fill(0); }
    }
    if (offset !== size) throw new Error();
    return bytes;
  } catch { bytes.fill(0); throw new Error(); }
  finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
}

/** Closed isolated storage/review only. Stored bytes do not certify answers, signatures or submission readiness. */
export function createSnapProtectedReviewHandler(input: unknown) {
  const config = configuration(input), publicHost = new URL(config.publicOrigin).host, secure = config.mode === "hosted";
  return async function handle(request: Request): Promise<Response> {
    const cookies: string[] = [], deadline = new Date(Date.now() + 25000), deadlineSignal = AbortSignal.timeout(25000), signal = AbortSignal.any([request.signal, deadlineSignal]);
    let bytes: Uint8Array | undefined;
    const reply = (status: number) => {
      const response = new Response(unavailable, { status, headers: { ...responseHeaders, "Content-Type": "text/plain; charset=utf-8" } });
      for (const cookie of cookies) response.headers.append("Set-Cookie", cookie);
      return response;
    };
    try {
      const url = new URL(request.url), scope = route(url.pathname + url.search);
      const upload = request.method === "POST", length = request.headers.get("content-length");
      if (request.method !== "GET" && !upload) return reply(405);
      if (url.origin !== config.publicOrigin || request.headers.get("host") !== publicHost || !scope || url.hash
        || (request.headers.has("origin") && request.headers.get("origin") !== config.publicOrigin)
        || ["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "")
        || request.headers.has("authorization") || request.headers.has("transfer-encoding") || request.headers.has("content-encoding")
        || (secure && [...request.headers.keys()].some(name => name === "forwarded" || name.startsWith("x-forwarded-")))
        || (upload ? request.headers.get("origin") !== config.publicOrigin || !length || !/^[1-9][0-9]{0,7}$/.test(length)
          || Number(length) > (scope.direct ? maxCompletionBytes : MAX_SNAP_PACKET_BYTES)
          || request.headers.get("content-type") !== (scope.direct ? "application/json" : "application/pdf")
          : length !== null && length !== "0")
        || [...request.headers].reduce((size, [name, value]) => size + name.length + value.length + 4, 0) > 16384) return reply(400);
      signal.throwIfAborted();
      const supabase = createServerClient(config.supabaseOrigin, config.supabasePublicKey, {
        cookieOptions: { name: "caselink-parent-auth", httpOnly: true, sameSite: "lax", secure, path: "/" },
        global: { fetch: (resource, init) => fetchWithTimeout(resource, { ...init, redirect: "error", cache: "no-store",
          signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]) }) },
        cookies: {
          getAll: () => parseCookieHeader(request.headers.get("cookie") ?? "").map(value => ({ name: value.name, value: value.value ?? "" })),
          setAll(values) {
            for (const value of values) {
              if (!/^caselink-parent-auth(?:\.[0-9]+)?$/.test(value.name)) throw new Error();
              cookies.push(serializeCookieHeader(value.name, value.value, { ...value.options, domain: undefined, path: "/", httpOnly: true, sameSite: "lax", secure }));
            }
          },
        },
      });
      const session = await verifyParentSession(supabase);
      if (!session) return reply(401);
      const metadata = await session.supabase.rpc(scope.direct ? "parent_get_snap_direct_packet_authorization" : "parent_get_snap_final_packet_authorization", {
        p_request_id: scope.requestId, p_packet_id: scope.packetId, p_expected_version: scope.expectedVersion,
      });
      if (metadata.error) return reply(metadata.error.code === "42501" ? 403 : 503);
      const checked = snapPacketAuthorizationResultSchema.safeParse(metadata.data);
      if (!checked.success) return reply(503);
      const { intent } = checked.data;
      if (config.controlledTest && ((upload && !scope.direct) || scope.requestId !== config.controlledTest.requestId
        || intent.snapshotHash !== config.controlledTest.snapshotHash)) return reply(403);
      if (intent.ownerId !== session.user.id || intent.requestId !== scope.requestId || intent.packetId !== scope.packetId || intent.requestVersion !== scope.expectedVersion
        || Date.parse(checked.data.authorizationExpiresAt) <= Date.now() || Date.parse(checked.data.consentedAt) > Date.now()) return reply(403);
      signal.throwIfAborted();
      if (scope.direct) {
        let result: SnapFinalizerResult, completionSignal = signal;
        if (upload) {
          let completion: unknown;
          try {
            bytes = await readProtectedBody(request, Number(length), signal);
            completion = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
            if (config.controlledTest && !z.object({ requestId: z.literal(config.controlledTest.requestId),
              snapshotHash: z.literal(config.controlledTest.snapshotHash), identifiers: z.array(z.object({
                personId: z.uuid(), kind: z.literal("provide_to_agency_later"),
              }).strict()).min(1).max(30) }).passthrough().safeParse(completion).success) return reply(400);
          } catch { return reply(signal.aborted ? 503 : 400); }
          // A complete authorized upload survives navigation within its original deadline; database permission is rechecked before storage.
          completionSignal = deadlineSignal;
          // Only the isolated renderer gets private input; it obtains all trusted context from the database.
          const template = await readFile(join(process.cwd(), "data/verified-forms/snap-pa600fs-2019.pdf"), { signal: completionSignal });
          try {
            completionSignal.throwIfAborted();
            result = await finalizeSnapDirectCompletion(intent, completion, template, { connectionString: config.finalizerDatabaseUrl, deadline, signal: completionSignal });
          } finally { template.fill(0); completion = undefined; }
        } else {
          // Unknown storage is reconciled read-only; missing evidence never authorizes a new construction attempt.
          result = await reconcileSnapDirectCompletion(intent, { connectionString: config.finalizerDatabaseUrl, deadline, signal });
        }
        completionSignal.throwIfAborted();
        const response = Response.json({ state: result.state === "stored" ? "stored" : "storage_unconfirmed", packetId: intent.packetId }, {
          status: result.state !== "stored" ? 202 : !upload || checked.data.state === "stored" ? 200 : 201, headers: responseHeaders,
        });
        for (const cookie of cookies) response.headers.append("Set-Cookie", cookie);
        return response;
      }
      if (upload) {
        if (Number(length) !== intent.byteLength) return reply(400);
        try { bytes = await readProtectedBody(request, intent.byteLength, signal); }
        catch { return reply(signal.aborted ? 503 : 400); }
        if (createHash("sha256").update(bytes).digest("hex") !== intent.contentSha256) return reply(400);
        // A stored replay is read-only; an uncertain commit never triggers another stage in this request.
        if (checked.data.state !== "stored") {
          const structure = await inspectSnapFinalPdf({ bytes, contentSha256: intent.contentSha256, byteLength: intent.byteLength,
            source: { templateId: intent.templateId, templateVersion: intent.templateVersion, templateSha256: intent.templateSha256 } }, { deadline, signal });
          if (!structure.ok) return reply(409);
        }
        let result: SnapFinalizerResult, recovered = false;
        try {
          result = checked.data.state === "stored"
            ? await reconcileSnapFinalPacket(intent, { connectionString: config.finalizerDatabaseUrl, deadline, signal })
            : await stageSnapFinalPacket(intent, bytes, { connectionString: config.finalizerDatabaseUrl, deadline, signal });
        } catch {
          recovered = true;
          result = await reconcileSnapFinalPacket(intent, { connectionString: config.finalizerDatabaseUrl, deadline, signal });
        }
        signal.throwIfAborted();
        const response = Response.json({ state: result.state === "stored" ? "stored" : "storage_unconfirmed", packetId: intent.packetId }, {
          status: result.state !== "stored" ? 202 : checked.data.state === "stored" || recovered ? 200 : 201, headers: responseHeaders,
        });
        for (const cookie of cookies) response.headers.append("Set-Cookie", cookie);
        return response;
      }
      if (checked.data.state !== "stored") return reply(409);
      const opened = await openSnapFinalPacketForIsolatedReview(intent, { connectionString: config.finalizerDatabaseUrl, deadline, signal });
      bytes = opened.bytes;
      const binding = snapFinalPacketBindingSchema.safeParse(opened.binding);
      if (!binding.success || Object.entries(intent).some(([key, value]) => binding.data[key as keyof typeof intent] !== value)
        || Date.parse(binding.data.expiresAt) <= Date.now() || Date.parse(binding.data.expiresAt) > Date.parse(checked.data.authorizationExpiresAt)
        || !(bytes instanceof Uint8Array) || bytes.length !== intent.byteLength || createHash("sha256").update(bytes).digest("hex") !== intent.contentSha256) return reply(409);
      const structure = await inspectSnapFinalPdf({ bytes, contentSha256: intent.contentSha256, byteLength: intent.byteLength,
        source: { templateId: intent.templateId, templateVersion: intent.templateVersion, templateSha256: intent.templateSha256 } }, { deadline, signal });
      if (!structure.ok) return reply(409);
      signal.throwIfAborted();
      if (Date.now() >= deadline.getTime() || Date.parse(binding.data.expiresAt) <= Date.now()) return reply(409);
      const response = new Response(Uint8Array.from(bytes), { headers: { ...responseHeaders, "Content-Type": "application/pdf", "Content-Length": String(bytes.length),
        "Content-Disposition": config.controlledTest ? 'inline; filename="caselink-fictional-test-application.pdf"' : 'inline; filename="caselink-snap-application.pdf"' } });
      for (const cookie of cookies) response.headers.append("Set-Cookie", cookie);
      return response;
    } catch { return reply(503); }
    finally { if (bytes instanceof Uint8Array) bytes.fill(0); }
  };
}

/** Same-host ingress forwards the exact public Host; request URLs use configuration, never forwarding headers. */
export function createSnapProtectedReviewServer(input: unknown) {
  const config = configuration(input), handle = createSnapProtectedReviewHandler(config);
  const server = createServer({ maxHeaderSize: 16384 }, async (incoming, outgoing) => {
    const controller = new AbortController(); let body: Uint8Array | undefined;
    const stop = () => { controller.abort(); body?.fill(0); };
    incoming.once("aborted", stop);
    const timer = setTimeout(() => { stop(); outgoing.destroy(); }, 30000);
    outgoing.once("finish", () => { clearTimeout(timer); body?.fill(0); });
    outgoing.once("close", () => { clearTimeout(timer); stop(); });
    try {
      if (!["127.0.0.1", "::ffff:127.0.0.1"].includes(incoming.socket.remoteAddress ?? "") || !route(incoming.url ?? "")) {
        outgoing.writeHead(400, responseHeaders); outgoing.end(unavailable); return;
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      const init: RequestInit & { duplex?: "half" } = { method: incoming.method, headers, signal: controller.signal,
        ...(incoming.method === "POST" ? { body: Readable.toWeb(incoming) as ReadableStream<Uint8Array>, duplex: "half" as const } : {}) };
      const response = await handle(new Request(config.publicOrigin + incoming.url, init));
      if (controller.signal.aborted || outgoing.destroyed) return;
      const outgoingHeaders: Record<string, string | string[]> = Object.fromEntries([...response.headers].filter(([name]) => name !== "set-cookie"));
      const rotated = response.headers.getSetCookie(); if (rotated.length) outgoingHeaders["set-cookie"] = rotated;
      outgoing.writeHead(response.status, outgoingHeaders);
      body = new Uint8Array(await response.arrayBuffer());
      outgoing.end(body, () => { body?.fill(0); });
    } catch { if (!outgoing.destroyed && !outgoing.headersSent) { outgoing.writeHead(503, responseHeaders); outgoing.end(unavailable); } else outgoing.destroy(); }
    finally { incoming.removeListener("aborted", stop); if (outgoing.destroyed) body?.fill(0); }
  });
  server.headersTimeout = 10000; server.requestTimeout = 30000;
  server.on("clientError", (_error, socket) => { if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"); });
  return server;
}
