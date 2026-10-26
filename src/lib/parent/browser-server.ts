import { createServer } from "node:http";
import type { createApplicationBrowser } from "./browser-runner";

/** Shared by the private launcher and actual local Auth/COMPASS connection tests. */
export function createApplicationBrowserServer(
  runner: ReturnType<typeof createApplicationBrowser>,
) {
  const server = createServer(async (incoming, outgoing) => {
    try {
      if (
        incoming.headers.host !== `127.0.0.1:${incoming.socket.localPort}` ||
        incoming.headers.origin ||
        !["127.0.0.1", "::ffff:127.0.0.1"].includes(
          incoming.socket.remoteAddress ?? "",
        )
      )
        throw new Error("browser_not_authorized");
      const path =
        /^\/requests\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(\/frame)?$/.exec(
          incoming.url ?? "",
        );
      if (
        !path ||
        !["GET", "POST", "DELETE"].includes(incoming.method ?? "") ||
        (path[2] && incoming.method !== "GET")
      ) {
        outgoing.writeHead(404, { "Cache-Control": "private, no-store" });
        outgoing.end();
        return;
      }
      if (
        incoming.headers["transfer-encoding"] ||
        (incoming.headers["content-length"] &&
          incoming.headers["content-length"] !== "0")
      )
        throw new Error("browser_invalid_input");
      const token =
        /^Bearer ([A-Za-z0-9._-]+)$/.exec(
          incoming.headers.authorization ?? "",
        )?.[1] ?? "";
      const response = await runner.read(
        token,
        path[1],
        incoming.method as "GET" | "POST" | "DELETE",
        Boolean(path[2]),
      );
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.writeHead(403, {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      });
      outgoing.end();
    }
  });
  server.requestTimeout = 20000;
  server.headersTimeout = 5000;
  server.maxRequestsPerSocket = 20;
  return server;
}
