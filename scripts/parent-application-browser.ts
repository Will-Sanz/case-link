import { chromium } from "@playwright/test";
import { createBrowserAuthorizer } from "../src/lib/parent/browser-authority";
import { createApplicationBrowser } from "../src/lib/parent/browser-runner";
import { createApplicationBrowserServer } from "../src/lib/parent/browser-server";
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
  const server = createApplicationBrowserServer(runner);
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
