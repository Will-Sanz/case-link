import { createServer, request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { Transform, pipeline } from "node:stream";
import { isIP } from "node:net";
import { canonicalProjectOrigin, isLoopbackHost } from "./project-origin";

const maxPacketBytes = 10 * 1024 * 1024;
const hopHeaders = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);

function localTarget(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !/^\d+$/.test(url.port)
    || Number(url.port) < 1024 || Number(url.port) > 65535 || url.username || url.password
    || url.pathname !== "/" || url.search || url.hash || url.origin !== value) throw new Error("Invalid local parent service.");
  return url;
}

function forwardedHeaders(headers: IncomingHttpHeaders) {
  const connection = new Set((headers.connection ?? "").toLowerCase().split(",").map(value => value.trim()));
  return Object.fromEntries(Object.entries(headers).filter(([key]) => !hopHeaders.has(key) && !connection.has(key)
    && key !== "forwarded" && !key.startsWith("x-forwarded-")));
}

function packetLimit() {
  let size = 0;
  return new Transform({ transform(chunk, encoding, done) {
    size += chunk.length;
    done(size > maxPacketBytes ? new Error("Protected response exceeds its limit.") : null, chunk);
  } });
}

/** Local routing only. The protected service must authenticate and authorize every request itself. */
export function createLocalParentProtectedFrontdoor(appOrigin: string, protectedOrigin: string) {
  return createParentProtectedFrontdoor(appOrigin, protectedOrigin);
}

/** Behind same-host TLS ingress only; listeners and protected upstreams remain loopback-only. */
export function createHostedParentProtectedFrontdoor(publicOrigin: string, appOrigin: string, protectedOrigin: string) {
  const origin = new URL(publicOrigin);
  if (canonicalProjectOrigin(publicOrigin) !== publicOrigin || origin.protocol !== "https:"
    || isLoopbackHost(origin.hostname) || isIP(origin.hostname.replace(/^\[|\]$/g, ""))
    || !origin.hostname.includes(".") || origin.hostname.endsWith(".localhost")) throw new Error("Invalid hosted parent origin.");
  return createParentProtectedFrontdoor(appOrigin, protectedOrigin, publicOrigin);
}

function createParentProtectedFrontdoor(appOrigin: string, protectedOrigin: string, hostedOrigin?: string) {
  const app = localTarget(appOrigin), protectedService = localTarget(protectedOrigin);
  if (app.origin === protectedService.origin) throw new Error("Separate local parent services required.");
  const server = createServer((incoming, outgoing) => {
    const publicOrigin = hostedOrigin ?? `http://127.0.0.1:${incoming.socket.localPort}`, publicHost = new URL(publicOrigin).host;
    const reject = (status: number) => {
      if (outgoing.destroyed || outgoing.writableEnded) return;
      if (outgoing.headersSent) { outgoing.destroy(); return; }
      outgoing.writeHead(status, { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
      outgoing.end("The local support service could not complete this request.");
    };
    let protectedPath: boolean;
    try {
      if (incoming.headers.host !== publicHost || !["127.0.0.1", "::ffff:127.0.0.1"].includes(incoming.socket.remoteAddress ?? "")) return reject(403);
      const raw = incoming.url ?? "", parsed = new URL(raw, publicOrigin), path = raw.split("?")[0];
      if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("#") || parsed.origin !== publicOrigin) return reject(400);
      const decoded = decodeURIComponent(path), normalized = decodeURIComponent(parsed.pathname);
      protectedPath = [path, decoded, parsed.pathname, normalized].some(value => /^\/protected(?:\/|$)/i.test(value));
      if (protectedPath) {
        // Ambiguous protected paths must never fall through to Next or reach a different service route.
        if (path !== decoded || path !== parsed.pathname || !path.startsWith("/protected/snap/")) return reject(400);
        const method = incoming.method ?? "GET", length = incoming.headers["content-length"];
        if (!["GET", "HEAD", "POST", "PUT", "DELETE"].includes(method) || incoming.headers["transfer-encoding"]
          || (length !== undefined && (!/^(0|[1-9]\d{0,8})$/.test(length) || Number(length) > maxPacketBytes))
          || (["GET", "HEAD"].includes(method) && Number(length ?? 0) !== 0)
          || (!["GET", "HEAD"].includes(method) && (length === undefined || incoming.headers.origin !== publicOrigin))
          || (incoming.headers.origin && incoming.headers.origin !== publicOrigin)) return reject(400);
      }
    } catch { return reject(400); }
    const target = protectedPath ? protectedService : app;
    if (target.port === String(incoming.socket.localPort)) return reject(503);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const upstream = httpRequest({ hostname: target.hostname, port: target.port, path: incoming.url, method: incoming.method,
      agent: false, headers: { ...forwardedHeaders(incoming.headers), host: publicHost, connection: "close",
        ...(hostedOrigin && !protectedPath ? { "x-forwarded-proto": "https", "x-forwarded-host": publicHost } : {}) } }, response => {
      const headers = forwardedHeaders(response.headers);
      if (protectedPath) {
        const length = response.headers["content-length"];
        const status = response.statusCode ?? 503;
        if ((status >= 300 && status < 400) || status >= 500 || (length !== undefined && (!/^\d+$/.test(length) || Number(length) > maxPacketBytes))) { response.destroy(); upstream.destroy(); return reject(503); }
        headers["cache-control"] = "private, no-store";
        headers["referrer-policy"] = "no-referrer";
        headers["x-content-type-options"] = "nosniff";
        headers["x-frame-options"] = "SAMEORIGIN";
      }
      outgoing.writeHead(response.statusCode ?? 503, headers);
      const complete = (error: NodeJS.ErrnoException | null) => { clearTimeout(timer); if (error) { response.destroy(); upstream.destroy(); reject(503); } };
      if (protectedPath) pipeline(response, packetLimit(), outgoing, complete);
      else pipeline(response, outgoing, complete);
    });
    if (protectedPath) timer = setTimeout(() => { upstream.destroy(); reject(503); }, 60_000);
    upstream.on("error", () => { clearTimeout(timer); reject(503); });
    incoming.once("aborted", () => upstream.destroy());
    outgoing.once("close", () => { clearTimeout(timer); if (!outgoing.writableFinished) upstream.destroy(); });
    const sent = (error: NodeJS.ErrnoException | null) => { if (error) { upstream.destroy(); reject(503); } };
    if (protectedPath) pipeline(incoming, packetLimit(), upstream, sent);
    else pipeline(incoming, upstream, sent);
  });
  server.headersTimeout = 10_000;
  server.maxRequestsPerSocket = 100;
  server.on("clientError", (_error, socket) => { socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"); });
  return server;
}
