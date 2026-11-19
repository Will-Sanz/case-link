import { createServer } from "node:http";
import { z } from "zod";
import { browserControlSchema } from "./browser-policy";
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
        /^\/requests\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(\/frame|\/control)?(?:\?frameId=([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}))?$/.exec(
          incoming.url ?? "",
        );
      if (
        !path ||
        !["GET", "POST", "DELETE"].includes(incoming.method ?? "") ||
        (path[2] === "/frame" && incoming.method !== "GET") ||
        (path[2] === "/control" && incoming.method !== "POST") ||
        (path[3] && path[2] !== "/frame")
      ) {
        outgoing.writeHead(404, { "Cache-Control": "private, no-store" });
        outgoing.end();
        return;
      }
      const token =
        /^Bearer ([A-Za-z0-9._-]+)$/.exec(
          incoming.headers.authorization ?? "",
        )?.[1] ?? "";
      if (incoming.headers["transfer-encoding"])
        throw new Error("browser_invalid_input");
      let response: Response;
      if (path[2] === "/control") {
        const length = incoming.headers["content-length"] ?? "";
        if (
          !/^[1-9]\d{0,3}$/.test(length) ||
          Number(length) > 2048 ||
          incoming.headers["content-type"] !== "application/json"
        )
          throw new Error("browser_invalid_input");
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of incoming) {
          size += chunk.length;
          if (size > 2048) throw new Error("browser_invalid_input");
          chunks.push(Buffer.from(chunk));
        }
        if (size !== Number(length)) throw new Error("browser_invalid_input");
        response = await runner.control(
          token,
          path[1],
          browserControlSchema.parse(
            JSON.parse(Buffer.concat(chunks).toString("utf8")),
          ),
        );
      } else {
        if (
          incoming.headers["content-length"] &&
          incoming.headers["content-length"] !== "0"
        )
          throw new Error("browser_invalid_input");
        response = await runner.read(
          token,
          path[1],
          incoming.method as "GET" | "POST" | "DELETE",
          path[2] === "/frame",
          path[3],
        );
      }
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const status =
        message === "browser_stale_frame"
          ? 409
          : ["browser_control_busy", "browser_control_rate"].includes(message)
            ? 429
            : error instanceof z.ZodError ||
                error instanceof SyntaxError ||
                ["browser_invalid_input", "browser_control_target"].includes(
                  message,
                )
              ? 400
              : 403;
      outgoing.writeHead(status, {
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
