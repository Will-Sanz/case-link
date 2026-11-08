/** Real local Auth → Next → private browser engine with an explicit in-memory provider DOM replay. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createBrowserAuthorizer } from "../src/lib/parent/browser-authority";
import {
  browserResponseSchema,
  COMPASS_CAPTCHA,
  type ApplicationBrowserResponse,
  type BrowserControl,
} from "../src/lib/parent/browser-policy";
import { createApplicationBrowser } from "../src/lib/parent/browser-runner";
import { createApplicationBrowserServer } from "../src/lib/parent/browser-server";
import { fixtureIntake, fixtureMandate } from "../src/lib/parent/test-fixtures";
import {
  assertCompassReplay,
  installCompassReplay,
  type CompassReplay,
} from "../tests/parent/compass-replay";
import { withParentBrowserFixtures } from "./parent-browser-test-fixture";

const origin = "http://127.0.0.1:3201";
const output = resolve("tmp/parent-verification/browser-handoff-replay");
let stage = "checking isolated replay approval";
let checks = 0;
function check(condition: unknown, label: string): asserts condition {
  assert.ok(condition, label);
  checks++;
}
async function until(
  condition: () => Promise<boolean>,
  label: string,
  timeout = 15000,
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await delay(100);
  }
  throw new Error(label);
}

async function main() {
  let serviceContextCount = 0;
  const accessibility: {
    state: string;
    violations: {
      id: string;
      impact: string | null | undefined;
      targets: string[];
    }[];
  }[] = [];
  check(
    process.env.CASELINK_PARENT_HANDOFF_REPLAY_APPROVED === "1",
    "The isolated provider replay must be explicitly enabled.",
  );
  check(
    process.env.CASELINK_SNAP_READINESS_APPROVED !== "1",
    "This run must not be confused with a live COMPASS check.",
  );
  check(
    !process.env.CASELINK_PARENT_HANDOFF_TEST_ORIGIN ||
      process.env.CASELINK_PARENT_HANDOFF_TEST_ORIGIN === origin,
    "The candidate must use the exact isolated port 3201.",
  );
  await withParentBrowserFixtures(
    check,
    (value) => {
      stage = value;
    },
    async ({ local, db, fixtures, approvedUntil }) => {
      const browser = await chromium.launch({
        headless: true,
        chromiumSandbox: true,
        env: {},
      });
      const uiContexts: BrowserContext[] = [];
      const serviceContexts: BrowserContext[] = [];
      const servicePages: Page[] = [];
      const replays: CompassReplay[] = [];
      let closedServiceContexts = 0;
      let sweepFailure = false;
      let sweeping = false;
      let forbiddenUiRequests = 0;
      const runner = createApplicationBrowser({
        authorize: createBrowserAuthorizer(
          local.API_URL,
          local.ANON_KEY,
          approvedUntil,
        ),
        context: async () => {
          const context = await browser.newContext({
            viewport: { width: 1100, height: 720 },
            locale: "en-US",
            acceptDownloads: false,
            serviceWorkers: "block",
          });
          serviceContexts.push(context);
          context.on("close", () => {
            closedServiceContexts++;
          });
          const newPage = context.newPage.bind(context);
          context.newPage = async () => {
            const page = await newPage();
            replays.push(
              await installCompassReplay(
                page,
                serviceContexts.length === 1 ? "challenge" : null,
              ),
            );
            servicePages.push(page);
            return page;
          };
          return context;
        },
      });
      const server = createApplicationBrowserServer(runner);
      let sweep: ReturnType<typeof setInterval> | undefined;
      try {
        stage = "binding the isolated private replay service";
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(3331, "127.0.0.1", resolve);
        });
        const bound = server.address();
        check(
          bound &&
            typeof bound !== "string" &&
            bound.address === "127.0.0.1" &&
            bound.port === 3331,
          "The private replay service owns only the isolated loopback port 3331.",
        );
        sweep = setInterval(async () => {
          if (sweeping) return;
          sweeping = true;
          try {
            await runner.sweep();
          } catch {
            sweepFailure = true;
          } finally {
            sweeping = false;
          }
        }, 5000);
        async function session(fixture: (typeof fixtures)[number]) {
          const context = await browser.newContext({
            baseURL: origin,
            viewport: { width: 1280, height: 900 },
            reducedMotion: "reduce",
            serviceWorkers: "block",
          });
          uiContexts.push(context);
          await context.route("**/*", (route) => {
            const url = new URL(route.request().url());
            if ([origin, local.API_URL].includes(url.origin))
              return route.continue();
            forbiddenUiRequests++;
            return route.abort();
          });
          const signedIn = await context.request.post(
            `${origin}/api/parent/auth`,
            {
              headers: { origin },
              data: {
                action: "sign_in",
                email: fixture.email,
                password: fixture.password,
              },
            },
          );
          check(
            signedIn.status() === 200,
            "The actual Next password route authenticates the local synthetic parent.",
          );
          const cookies = (await context.cookies()).filter((cookie) =>
            /^caselink-parent-auth(?:\.\d+)?$/.test(cookie.name),
          );
          check(
            cookies.length > 0 &&
              cookies.every(
                (cookie) =>
                  cookie.httpOnly &&
                  cookie.sameSite === "Lax" &&
                  cookie.path === "/",
              ),
            "Real sign-in produces private parent session cookies without forging them.",
          );
          return context;
        }
        stage = "signing in through real Next and checking owned access";
        const owner = await session(fixtures[0]);
        const foreign = await session(fixtures[1]);
        const anonymous = await browser.newContext({ baseURL: origin });
        uiContexts.push(anonymous);
        const requestPath = (id: string) => `/api/parent/requests/${id}`;
        const browserPath = (id: string) => `${requestPath(id)}/browser`;
        const id = fixtures[0].requestId;
        check(
          (await owner.request.get(browserPath(id))).status() === 200,
          "An actual signed-in parent reaches the native service through the Next ownership proxy.",
        );
        check(
          (await foreign.request.get(browserPath(id))).status() === 403,
          "The Next proxy refuses a different real parent.",
        );
        check(
          (await anonymous.request.get(browserPath(id))).status() === 401,
          "Anonymous browser access cannot reach the owned engine.",
        );
        const page = await owner.newPage();
        page.setDefaultTimeout(15000);
        async function audit(state: string) {
          const result = await new AxeBuilder({ page })
            .include("#application-overview")
            .include('nav[aria-label="Your application checklist"]')
            .include("#application-browser")
            .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
            .analyze();
          accessibility.push({
            state,
            violations: result.violations.map((violation) => ({
              id: violation.id,
              impact: violation.impact,
              targets: violation.nodes.flatMap((node) =>
                node.target.map((target) =>
                  Array.isArray(target) ? target.join(" > ") : target,
                ),
              ),
            })),
          });
          writeFileSync(
            resolve(output, "accessibility.json"),
            JSON.stringify(accessibility, null, 2) + "\n",
          );
          check(
            result.violations.length === 0,
            "The new parent overview, checklist and browser controls have no scoped automated accessibility violations.",
          );
        }
        async function status(id: string): Promise<ApplicationBrowserResponse> {
          const response = await owner.request.get(browserPath(id));
          check(
            response.status() === 200,
            "The actual owned proxy returns current browser metadata.",
          );
          return browserResponseSchema.parse(await response.json());
        }
        async function open(id: string) {
          stage = "loading the actual owned support page";
          await page.goto(`${origin}/support/${id}`, {
            waitUntil: "networkidle",
          });
          const openButton = page.getByRole("button", {
            name: "Open application view",
            exact: true,
          });
          stage = "starting the actual private browser through the UI";
          await openButton.click();
          stage = "waiting for the actual preview handoff metadata";
          await until(async () => {
            const value = await status(id);
            return value.session?.handoff?.kind === "continue";
          }, "replay public handoff not ready");
          stage = "waiting for the exact preview JPEG and enabled UI control";
          await page
            .getByRole("button", { name: "Continue with COMPASS", exact: true })
            .waitFor();
          await until(
            async () =>
              page
                .getByRole("button", {
                  name: "Continue with COMPASS",
                  exact: true,
                })
                .isEnabled(),
            "UI must wait for its exact handoff image",
          );
        }
        stage =
          "opening one real UI/Next/native-engine context against provider replay";
        await open(id);
        stage = "checking the initial actual handoff JPEG and isolation";
        check(
          serviceContexts.length === 1,
          "One application view uses one isolated actual Playwright context.",
        );
        const start = (await status(id)).session!;
        check(
          start.handoff && start.frameUrl,
          "The preview handoff identifies its exact current rendered frame.",
        );
        const frame = await owner.request.get(start.frameUrl);
        check(
          frame.status() === 200 &&
            frame.headers()["content-type"] === "image/jpeg" &&
            frame.headers()["cache-control"] === "private, no-store",
          "The Next proxy delivers the exact owned nonce-bound JPEG privately.",
        );
        const bytes = await frame.body();
        check(
          bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.length > 1000,
          "A genuine Chromium render is delivered, rather than a fabricated image.",
        );
        check(
          (
            await owner.request.get(
              `${browserPath(id)}/frame?frameId=${randomUUID()}`,
            )
          ).status() === 409,
          "A stale real proxy frame request is refused.",
        );
        check(
          (await foreign.request.get(start.frameUrl)).status() === 403,
          "A second parent cannot read the exact active image.",
        );
        const original: BrowserControl = {
          sessionId: start.id,
          frameId: start.handoff.frameId,
          action: { type: "continue" },
        };
        check(
          (
            await owner.request.post(`${browserPath(id)}/control`, {
              headers: { origin: "https://unapproved.example.test" },
              data: original,
            })
          ).status() === 403,
          "An unapproved origin cannot control the replay session.",
        );
        check(
          (
            await foreign.request.post(`${browserPath(id)}/control`, {
              headers: { origin },
              data: original,
            })
          ).status() === 403,
          "A foreign real parent cannot control the replay session.",
        );
        mkdirSync(output, { recursive: true });
        await page.screenshot({
          path: resolve(output, "desktop-preview.png"),
          fullPage: true,
        });
        stage = "continuing Family Safety through the actual UI";
        await page
          .getByRole("button", { name: "Continue with COMPASS", exact: true })
          .click();
        stage =
          "confirming a pending provider result preserves the actual owned session";
        await until(async () => {
          const pending = (await status(id)).session;
          return (
            pending?.status === "running" &&
            pending.currentUrl === COMPASS_CAPTCHA
          );
        }, "The delayed provider result must become a visible pending state");
        const pending = (await status(id)).session;
        check(
          pending?.status === "running" &&
            pending.currentUrl === COMPASS_CAPTCHA &&
            !pending.canControl &&
            !pending.frameUrl &&
            !pending.handoff &&
            serviceContexts.length === 1 &&
            Object.is(closedServiceContexts, 0),
          "A delayed provider result remains running in the same actual Auth-owned session without stale input.",
        );
        await until(
          async () => (await status(id)).session?.handoff?.kind === "challenge",
          "replay challenge not exposed",
        );
        stage = "confirming the actual challenge next actor and checklist";
        await page
          .getByText("Next: You — COMPASS verification", { exact: true })
          .waitFor();
        const verificationStep = page
          .getByRole("navigation", { name: "Your application checklist" })
          .getByRole("link", { name: /COMPASS verification\s*Needs you now/ });
        await verificationStep.click();
        check(
          (await verificationStep.getAttribute("aria-current")) === "location",
          "The real challenge becomes the visible next actor and a working checklist destination.",
        );
        check(
          serviceContexts.length === 1,
          "The parent continuation keeps the same browser context and provider session.",
        );
        stage = "denying replay of the accepted ordinary continuation";
        check(
          (
            await owner.request.post(`${browserPath(id)}/control`, {
              headers: { origin },
              data: original,
            })
          ).status() === 409,
          "An accepted UI continuation cannot be replayed through Next.",
        );
        const refreshButton = page.getByRole("button", {
          name: "Refresh application connection",
          exact: true,
        });
        stage = "refreshing the actual challenge image once";
        await until(
          async () => refreshButton.isEnabled(),
          "Challenge controls must wait for the matching image load",
        );
        await refreshButton.click();
        await until(
          async () => refreshButton.isEnabled(),
          "The optional refresh returns a fresh challenge image",
        );
        await page.getByText("Use keyboard controls", { exact: true }).click();
        stage = "entering the actual challenge frame with native Tab";
        const nextControl = page.getByRole("button", {
          name: "Next control",
          exact: true,
        });
        await until(
          async () => nextControl.isEnabled(),
          "Keyboard controls must wait for a usable frame",
        );
        await nextControl.click();
        await until(
          async () => refreshButton.isEnabled(),
          "Keyboard entry returns a fresh image",
        );
        const replayPage = servicePages[0];
        stage = "locating the actual replay challenge pointer target";
        const challengeFrame = replayPage
          .frames()
          .find((frame) =>
            frame
              .url()
              .startsWith("https://www.google.com/recaptcha/api2/bframe"),
          );
        check(
          challengeFrame,
          "The replay uses an actual cross-origin child frame with real DOM controls.",
        );
        const target = await challengeFrame
          .locator("#replay-button")
          .boundingBox();
        check(
          target,
          "The real replay button is visible inside the challenge iframe.",
        );
        const imageControl = page.getByRole("button", {
          name: "Interact with COMPASS verification image",
          exact: true,
        });
        await until(
          async () => imageControl.isEnabled(),
          "Pointer input must wait for the exact current frame",
        );
        const imageBox = await imageControl.boundingBox();
        check(
          imageBox,
          "The branded browser image has a measurable responsive viewport.",
        );
        stage = "forwarding the actual image pointer into the replay frame";
        await imageControl.click({
          position: {
            x: ((target.x + target.width / 2) / 1100) * imageBox.width,
            y: ((target.y + target.height / 2) / 720) * imageBox.height,
          },
        });
        await until(
          async () => refreshButton.isEnabled(),
          "Pointer input returns a fresh usable frame",
        );
        check(
          replays[0].challengeClicks === 1 && replays[0].challengeKeys > 0,
          "Real UI pointer and native keyboard controls reach the same actual replay iframe.",
        );
        check(
          Object.is(replays[0].captchaNext, 0),
          "The normal CAPTCHA Next remains unused before the fixture's synthetic result enables it.",
        );
        async function captureChallenge(label: string) {
          async function loaded() {
            await page.waitForFunction(() => {
              const image = document.querySelector(
                'button[aria-label="Interact with COMPASS verification image"] img',
              );
              return (
                image instanceof HTMLImageElement &&
                image.complete &&
                image.naturalWidth > 0 &&
                !image.closest("button")?.disabled
              );
            });
          }
          await loaded();
          await page.screenshot({
            path: resolve(output, `${label}.png`),
            fullPage: true,
          });
          await page
            .locator("#application-browser")
            .evaluate((section) => section.scrollIntoView({ block: "start" }));
          await loaded();
          if (label === "mobile-challenge") {
            const viewport = page.viewportSize()!;
            const image = await imageControl.locator("img").boundingBox();
            const secondary = await page
              .getByText(/^Last recorded browser update:/)
              .boundingBox();
            const enlarge = page.getByRole("button", {
              name: "Enlarge website view",
              exact: true,
            });
            const enlargeBox = await enlarge.boundingBox();
            check(
              image &&
                image.x >= 0 &&
                image.y >= 0 &&
                image.x + image.width <= viewport.width &&
                image.y + image.height <= viewport.height,
              "The complete fitted verification image is visible in the mobile viewport at the start of its browser section.",
            );
            check(
              secondary && image.y + image.height <= secondary.y,
              "The live verification image precedes secondary browser notices.",
            );
            check(
              enlargeBox &&
                enlargeBox.y >= 0 &&
                enlargeBox.y + enlargeBox.height <= viewport.height &&
                (await enlarge.isEnabled()),
              "The mobile parent can reach Enlarge without scrolling past secondary notices.",
            );
            await enlarge.click();
            const fit = page.getByRole("button", {
              name: "Fit website to window",
              exact: true,
            });
            check(
              (await fit.getAttribute("aria-pressed")) === "true",
              "Enlarge changes the actual website presentation.",
            );
            await fit.click();
            await loaded();
            check(
              (await enlarge.getAttribute("aria-pressed")) === "false",
              "The parent can restore the fitted mobile website view.",
            );
            await until(async () => {
              const fitted = await imageControl.locator("img").boundingBox();
              return Boolean(
                fitted &&
                Math.abs(fitted.width - image.width) <= 1 &&
                Math.abs(fitted.height - image.height) <= 1,
              );
            }, "The actual image must return to its fitted dimensions after Fit.");
            await page
              .locator("#application-browser")
              .evaluate((section) =>
                section.scrollIntoView({ block: "start" }),
              );
            const restored = await imageControl.locator("img").boundingBox();
            check(
              restored &&
                restored.y >= 0 &&
                restored.y + restored.height <= viewport.height,
              "The actual restored fitted image remains fully visible in the mobile viewport.",
            );
          }
          const skip = await page
            .locator('a[href="#main-content"]')
            .boundingBox();
          check(
            !skip || skip.y + skip.height <= 0,
            "The unfocused skip link stays outside the actual browser viewport.",
          );
          await page.screenshot({
            path: resolve(output, `${label}-viewport.png`),
          });
        }
        stage = "checking desktop challenge accessibility and layout";
        await audit("desktop-challenge");
        await captureChallenge("desktop-challenge");
        await page.setViewportSize({ width: 390, height: 844 });
        stage = "checking mobile challenge accessibility and layout";
        await audit("mobile-challenge");
        await captureChallenge("mobile-challenge");
        check(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          "The parent challenge screen stays within a narrow mobile viewport.",
        );
        const right = page.getByRole("button", { name: "Right", exact: true });
        await until(
          async () => right.isEnabled(),
          "The final replay keyboard action waits for the exact image",
        );
        await right.click();
        await until(
          async () => (await status(id)).session?.status === "completed",
          "same-session replay did not automatically reach the recognized blank household form",
        );
        check(
          serviceContexts.length === 1 && closedServiceContexts === 1,
          "Verified replay completion closes the original isolated context.",
        );
        check(
          replays[0].captchaNext === 1,
          "The same-page synthetic result only enables the provider's normal Next, which CaseLink advances exactly once automatically.",
        );
        check(
          replays[0].protectedScreenshots === 0 &&
            replays[0].householdInputs === 0,
          "No ending/divider draft reference or household field is captured or entered.",
        );
        await page
          .getByRole("heading", {
            name: "Connection check complete",
            exact: true,
          })
          .waitFor();
        stage = "checking mobile completed connection accessibility";
        await audit("mobile-completed");
        check(
          (await page
            .getByText("Next: You — COMPASS verification", { exact: true })
            .count()) === 0,
          "Automatic connection completion removes the temporary personal-verification instruction.",
        );
        await page.screenshot({
          path: resolve(output, "mobile-completed.png"),
          fullPage: true,
        });

        async function newRequest(expiresAt = approvedUntil) {
          const response = await owner.request.post("/api/parent/requests", {
            headers: { origin, "idempotency-key": randomUUID() },
            data: {
              intake: fixtureIntake({
                needs: ["snap_new"],
                utilityProviders: [],
              }),
              mandate: fixtureMandate({
                mode: "prepare_only",
                recipientIds: ["snap-pa"],
                allowedActions: ["research", "prepare"],
                allowedData: ["household"],
                expiresAt,
                maxAttempts: 1,
                maxRecipients: 1,
                bookingPreference: "ask_me",
              }),
            },
          });
          check(
            response.status() === 201,
            "The actual Next intake route creates the additional synthetic request.",
          );
          const value = (await response.json()) as { request: { id: string } };
          return value.request.id;
        }
        stage =
          "cancelling a real request while its replay challenge remains active";
        const cancelId = await newRequest();
        await open(cancelId);
        await page
          .getByRole("button", { name: "Continue with COMPASS", exact: true })
          .click();
        await until(
          async () =>
            (await status(cancelId)).session?.handoff?.kind === "challenge",
          "cancellation challenge not ready",
        );
        const cancelFrame = (await status(cancelId)).session!.frameUrl!;
        const cancelled = await owner.request.post(requestPath(cancelId), {
          headers: { origin },
          data: { action: "cancel" },
        });
        check(
          cancelled.status() === 200,
          "The real parent control route cancels the active synthetic mandate.",
        );
        check(
          (await owner.request.get(cancelFrame)).status() === 403,
          "Cancellation immediately denies retained image URLs at the actual proxy.",
        );
        await until(
          async () => closedServiceContexts >= 2,
          "The normal sweep must destroy the cancelled browser context",
          7000,
        );

        stage = "expiring an actual short-lived synthetic mandate";
        const expireId = await newRequest(
          new Date(Date.now() + 15000).toISOString(),
        );
        await open(expireId);
        const expiring = (await status(expireId)).session!;
        check(
          expiring.handoff,
          "The expiring request has a real bounded handoff.",
        );
        await until(
          async () => Date.now() >= Date.parse(expiring.handoff!.expiresAt),
          "The actual mandate deadline did not arrive",
          18000,
        );
        check(
          (await owner.request.get(expiring.frameUrl!)).status() === 403,
          "The real mandate deadline invalidates the exact image URL.",
        );
        await until(
          async () => closedServiceContexts >= 3,
          "The normal sweep must destroy the expired browser context",
          7000,
        );
        check(
          !sweepFailure,
          "The private engine's normal expiry and revocation sweep succeeds.",
        );
        check(
          forbiddenUiRequests === 0,
          "The CaseLink test browser sends no request outside the isolated web/Auth services.",
        );
        for (const replay of replays) assertCompassReplay(replay);
        check(
          replays.length === 3,
          "Completion, active cancellation and actual expiry each use their own isolated replay context.",
        );
        check(
          replays.slice(1).every((replay) => replay.captchaNext === 0),
          "Cancelled and expired replays never advance the normal CAPTCHA Next.",
        );
        const operations = await db.query(
          "select count(*)::int as count from public.parent_operations o join public.parent_requests r on r.id=o.request_id join public.parent_households h on h.id=r.household_id where h.owner_id=any($1::uuid[])",
          [fixtures.map((fixture) => fixture.id)],
        );
        check(
          operations.rows[0].count === 0,
          "The rehearsal creates no application, transmission or filing operations.",
        );
        serviceContextCount = serviceContexts.length;
      } finally {
        if (sweep) clearInterval(sweep);
        try {
          await runner.close();
        } finally {
          try {
            if (server.listening)
              await new Promise<void>((resolve, reject) =>
                server.close((error) => (error ? reject(error) : resolve())),
              );
          } finally {
            try {
              let signOutFailed = false;
              for (const context of uiContexts) {
                try {
                  const signedOut = await context.request.post(
                    `${origin}/api/parent/auth`,
                    {
                      headers: { origin },
                      data: { action: "sign_out" },
                    },
                  );
                  check(
                    signedOut.status() === 200,
                    "Each exact test browser signs out through the real Next route before its fixture identity is removed.",
                  );
                } catch {
                  signOutFailed = true;
                } finally {
                  await context.close().catch(() => {
                    signOutFailed = true;
                  });
                }
              }
              if (signOutFailed) throw new Error("replay_signout_failed");
            } finally {
              await browser.close();
            }
          }
        }
      }
    },
  );
  writeFileSync(
    resolve(output, "results.json"),
    JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        syntheticOnly: true,
        providerReplay: true,
        liveCompass: false,
        checks,
        cleanupPassed: true,
        serviceContexts: serviceContextCount,
        completedChecks: 1,
        cancelledContexts: 1,
        expiredContexts: 1,
        initialProviderDelayMilliseconds: 6000,
        protectedScreenshots: 0,
        householdInputs: 0,
        modelCalls: 0,
        accessibility,
      },
      null,
      2,
    ) + "\n",
  );
  process.stdout.write(
    `Parent browser handoff replay: ${checks} assertions passed with real local Auth, Next and native browser service. Provider pages were explicit local replays; no DHS/Google traffic, CAPTCHA solving, applicant entry, model calls or filing.\n`,
  );
}

void main().catch(() => {
  process.stderr.write(
    `Parent browser handoff replay failed during ${stage}. Credentials, cookies and household information are not logged.\n`,
  );
  process.exitCode = 1;
});
