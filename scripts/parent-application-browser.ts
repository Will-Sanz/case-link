import { createServer } from "node:http";
import { chromium } from "@playwright/test";
import { createBrowserAuthorizer } from "../src/lib/parent/browser-authority";
import { createApplicationBrowser } from "../src/lib/parent/browser-runner";
import { APPLICATION_BROWSER_ORIGIN } from "../src/lib/parent/browser-policy";
import { canonicalProjectOrigin } from "../src/lib/parent/project-origin";

async function main() {
  const env = process.env;
  const project = canonicalProjectOrigin(
    env.CASELINK_PARENT_BROWSER_SUPABASE_URL,
  );
  const approvedUntil = env.CASELINK_PARENT_BROWSER_APPROVED_UNTIL ?? "";
  if (
    !project ||
    !/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(project) ||
    env.CASELINK_ENVIRONMENT !== "connected" ||
    env.CASELINK_PARENT_CONNECTED_APPROVED !== "1" ||
    env.CASELINK_PARENT_ACCOUNT_MODE !== "existing" ||
    project !== env.CASELINK_PARENT_PRODUCTION_SUPABASE_URL ||
    project !== env.CASELINK_SCHOOL_SUPABASE_URL ||
    env.NEXT_PUBLIC_SITE_URL !== "http://127.0.0.1:3200" ||
    env.VERCEL ||
    ["preview", "production"].includes(env.VERCEL_ENV ?? "") ||
    !Number.isFinite(Date.parse(approvedUntil)) ||
    Date.parse(approvedUntil) <= Date.now() ||
    Date.parse(approvedUntil) > Date.now() + 25 * 60 * 60 * 1000
  )
    throw new Error("browser_pilot_not_approved");
  const authorize = createBrowserAuthorizer(
    project,
    env.CASELINK_PARENT_BROWSER_PUBLIC_KEY ?? "",
    approvedUntil,
  );
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
    env: {},
  });
  const runner = createApplicationBrowser({
    authorize,
    context: () =>
      browser.newContext({
        viewport: { width: 1100, height: 720 },
        locale: "en-US",
        acceptDownloads: false,
        serviceWorkers: "block",
      }),
  });
  const server = createServer(async (incoming, outgoing) => {
    try {
      if (
        incoming.headers.host !== "127.0.0.1:3330" ||
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
  server.listen(3330, "127.0.0.1");
  let sweeping = false;
  const sweep = setInterval(async () => {
    if (sweeping) return;
    sweeping = true;
    try {
      await runner.sweep();
    } finally {
      sweeping = false;
    }
  }, 5000);
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    clearInterval(sweep);
    clearTimeout(deadline);
    server.close();
    await runner.close();
    await browser.close();
  };
  const deadline = setTimeout(
    () => {
      void stop();
    },
    Date.parse(approvedUntil) - Date.now(),
  );
  process.once("SIGINT", () => {
    void stop();
  });
  process.once("SIGTERM", () => {
    void stop();
  });
  process.stdout.write(
    `Private public-page COMPASS viewer is listening on ${APPLICATION_BROWSER_ORIGIN}. It cannot enter or submit household information.\n`,
  );
}
void main().catch(() => {
  process.stderr.write(
    "The private application website viewer could not start. No household information is logged.\n",
  );
  process.exitCode = 1;
});
