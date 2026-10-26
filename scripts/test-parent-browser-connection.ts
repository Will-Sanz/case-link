/** Actual isolated Auth, RLS and private HTTP checks; optional public COMPASS navigation sends no applicant data. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser, type BrowserContext } from "@playwright/test";
import { createBrowserAuthorizer } from "../src/lib/parent/browser-authority";
import {
  browserResponseSchema,
  compassResourceAllowed,
  type ApplicationBrowserSession,
  type BrowserControl,
} from "../src/lib/parent/browser-policy";
import { createApplicationBrowser } from "../src/lib/parent/browser-runner";
import { createApplicationBrowserServer } from "../src/lib/parent/browser-server";

import { withParentBrowserFixtures } from "./parent-browser-test-fixture";

let stage = "checking isolated local configuration";
let checks = 0;
function check(condition: unknown, label: string): asserts condition {
  assert.ok(condition, label);
  checks++;
}

const diagnosticOrigins = new Set([
  "https://www.compass.dhs.pa.gov",
  "https://www.google.com",
  "https://www.gstatic.com",
  "https://www.recaptcha.net",
  "https://recaptcha.google.com",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
]);
const diagnosticPaths = new Set([
  "/intake/",
  "/home/",
  "/mca/",
  "/recaptcha/api.js",
  "/recaptcha/enterprise.js",
  ...["anchor", "bframe", "reload", "userverify", "clr", "pat"].flatMap(
    (path) => [`/recaptcha/api2/${path}`, `/recaptcha/enterprise/${path}`],
  ),
]);
const diagnosticRoutes = new Set(
  [
    "getstarted",
    "applynow/gettingstarted",
    ...[
      "tutorial",
      "importantinformation",
      "submitreferral",
      "WICpreapplication",
      "gatepost",
      "existingaccount",
      "familysafety",
      "captcha",
      "gettingstartedending",
    ].map((path) => `applynow/gettingstarted/${path}`),
    "applynow/household",
    "applynow/household/householdDetails",
  ].map((path) => `https://www.compass.dhs.pa.gov/intake/#/${path}`),
);
const diagnosticSummaries = new Set([
  "COMPASS blocked this browser connection. No household information was entered or submitted. CaseLink must resolve the connection before this application can continue here.",
  "The official household form was reached in this same browser session. No household information was entered and no application was submitted.",
  "The provider page changed to an unsupported screen. CaseLink stopped without entering information or submitting an application.",
  "The website check stopped because the provider page or permission changed. No application was submitted.",
  "The website check stopped because the provider page, permission, or connection changed. No application was submitted.",
  "The website check stopped because the provider page, connection, or permission changed. No application was submitted.",
  "COMPASS has not provided a supported parent verification control. CaseLink stopped without entering information or submitting an application.",
  "Website access stopped because this permission or session ended. No application was submitted.",
  "You control the supported COMPASS verification area below. CaseLink will confirm the next screen in this same session; no household information is being entered.",
]);

function diagnosticLocation(value: string) {
  try {
    const url = new URL(value);
    if (url.username || url.password || !diagnosticOrigins.has(url.origin))
      return { origin: "[unrecognized-origin]", path: "[redacted-path]" };
    const extension = /\.(js|css|png|jpg|jpeg|svg|gif|webp|ico|woff2?|ttf)$/i
      .exec(url.pathname)?.[1]
      ?.toLowerCase();
    return {
      origin: url.origin,
      path: diagnosticPaths.has(url.pathname)
        ? url.pathname
        : extension
          ? `/[public-asset].${extension}`
          : "[redacted-path]",
    };
  } catch {
    return { origin: "[unrecognized-origin]", path: "[redacted-path]" };
  }
}

function createPublicDiagnostic() {
  type Row = ReturnType<typeof diagnosticLocation> & {
    policy: "allow" | "deny" | "unconfirmed";
    requests: number;
    failures: number;
    statuses: Record<string, number>;
  };
  const rows = new Map<string, Row>();
  let events = 0;
  let truncated = false;
  let lastPublicRoute: string | null = null;
  let terminal: { status: string; summary: string } | null = null;
  return {
    network(
      kind: "request" | "response" | "failure",
      value: string,
      main: boolean | null,
      status?: number,
    ) {
      if (events >= 2000) {
        truncated = true;
        return;
      }
      events++;
      const location = diagnosticLocation(value);
      const policy =
        main === null
          ? "unconfirmed"
          : compassResourceAllowed(value, main)
            ? "allow"
            : "deny";
      const key = `${location.origin}${location.path}:${policy}`;
      if (!rows.has(key)) {
        if (rows.size >= 40) {
          truncated = true;
          return;
        }
        rows.set(key, {
          ...location,
          policy,
          requests: 0,
          failures: 0,
          statuses: {},
        });
      }
      const row = rows.get(key)!;
      if (kind === "request") row.requests++;
      else if (kind === "failure") row.failures++;
      else if (Number.isInteger(status) && status! >= 100 && status! <= 599)
        row.statuses[String(status)] = (row.statuses[String(status)] ?? 0) + 1;
    },
    navigation(value: string) {
      if (diagnosticRoutes.has(value)) lastPublicRoute = value;
    },
    state(state: ApplicationBrowserSession) {
      if (
        ["blocked", "closed", "failed", "completed"].includes(state.status) ||
        state.handoff?.kind === "challenge"
      )
        terminal = {
          status: state.status,
          summary: diagnosticSummaries.has(state.summary)
            ? state.summary
            : "Unrecognized website-check result.",
        };
    },
    snapshot() {
      return {
        events,
        truncated,
        lastPublicRoute,
        terminal,
        resources: [...rows.values()],
      };
    },
  };
}

function diagnosticSelfCheck() {
  const secret = "sensitive-value-never-record";
  assert.deepEqual(
    diagnosticLocation(
      `https://www.google.com/recaptcha/api2/anchor?token=${secret}#${secret}`,
    ),
    {
      origin: "https://www.google.com",
      path: "/recaptcha/api2/anchor",
    },
  );
  for (const value of [
    `https://${secret}.example/${secret}`,
    `https://${secret}@www.google.com/recaptcha/api2/anchor`,
    "not a URL",
  ])
    assert.equal(diagnosticLocation(value).origin, "[unrecognized-origin]");
  assert.equal(
    diagnosticLocation(`https://www.compass.dhs.pa.gov/${secret}.js`).path,
    "/[public-asset].js",
  );
  const diagnostic = createPublicDiagnostic();
  diagnostic.network(
    "request",
    "https://www.google.com/recaptcha/api2/anchor",
    false,
  );
  diagnostic.network(
    "response",
    "https://www.google.com/recaptcha/api2/anchor",
    false,
    200,
  );
  diagnostic.network(
    "failure",
    "https://www.google.com/recaptcha/api2/anchor",
    false,
  );
  diagnostic.network(
    "request",
    "https://www.recaptcha.net/recaptcha/api2/anchor",
    false,
  );
  diagnostic.navigation(
    "https://www.compass.dhs.pa.gov/intake/#/applynow/gettingstarted/captcha",
  );
  diagnostic.navigation(`https://www.compass.dhs.pa.gov/intake/#/${secret}`);
  diagnostic.state({
    status: "blocked",
    summary: secret,
  } as ApplicationBrowserSession);
  const snapshot = diagnostic.snapshot();
  assert.deepEqual(snapshot.resources[0], {
    origin: "https://www.google.com",
    path: "/recaptcha/api2/anchor",
    policy: "allow",
    requests: 1,
    failures: 1,
    statuses: { "200": 1 },
  });
  assert.equal(snapshot.resources[1].policy, "deny");
  assert.equal(
    snapshot.terminal?.summary,
    "Unrecognized website-check result.",
  );
  assert.ok(snapshot.lastPublicRoute?.endsWith("/captcha"));
  for (let index = 0; index < 3000; index++)
    diagnostic.network(
      "request",
      `https://www.compass.dhs.pa.gov/${secret}/${index}?${secret}`,
      false,
    );
  const bounded = diagnostic.snapshot();
  assert.equal(bounded.events, 2000);
  assert.equal(bounded.truncated, true);
  assert.ok(bounded.resources.length <= 40);
  assert.ok(!JSON.stringify(bounded).includes(secret));
  const rowBound = createPublicDiagnostic();
  for (const origin of diagnosticOrigins)
    for (const path of diagnosticPaths)
      rowBound.network("request", `${origin}${path}`, false);
  assert.equal(rowBound.snapshot().resources.length, 40);
  assert.equal(rowBound.snapshot().truncated, true);
  const trustedSummary = [...diagnosticSummaries][0];
  rowBound.state({
    status: "blocked",
    summary: trustedSummary,
  } as ApplicationBrowserSession);
  assert.equal(rowBound.snapshot().terminal?.summary, trustedSummary);
  const unknown = createPublicDiagnostic();
  unknown.network(
    "request",
    "https://www.google.com/recaptcha/api2/anchor",
    null,
  );
  assert.equal(unknown.snapshot().resources[0].policy, "unconfirmed");
}

async function main() {
  let liveOutcome = "not requested";
  const diagnostic =
    process.env.CASELINK_SNAP_CONNECTION_DIAGNOSTICS === "1" &&
    process.env.CASELINK_SNAP_READINESS_APPROVED === "1"
      ? createPublicDiagnostic()
      : null;
  await withParentBrowserFixtures(
    check,
    (value) => {
      stage = value;
    },
    async ({ local, db, fixtures, approvedUntil }) => {
      let browser: Browser | undefined;
      let runner: ReturnType<typeof createApplicationBrowser> | undefined;
      let server: ReturnType<typeof createApplicationBrowserServer> | undefined;
      const contexts: BrowserContext[] = [];
      let closedContexts = 0;
      const live = process.env.CASELINK_SNAP_READINESS_APPROVED === "1";
      try {
        stage = "authorizing real RLS ownership with minimal request context";
        const authorize = createBrowserAuthorizer(
          local.API_URL,
          local.ANON_KEY,
          approvedUntil,
        );
        const grant = await authorize(fixtures[0].token, fixtures[0].requestId);
        check(
          grant.ownerId === fixtures[0].id &&
            grant.authority.id === fixtures[0].requestId,
          "A verified real session receives only its own request authority.",
        );
        check(
          JSON.stringify(grant.authority.intake) ===
            JSON.stringify({ needs: ["snap_new"] }),
          "Browser authority excludes ZIP, income and other household facts.",
        );
        check(
          grant.expiresAt > Date.now() &&
            grant.expiresAt <= Date.now() + 10 * 60 * 1000,
          "Browser authority has the bounded ten-minute ceiling.",
        );
        const foreign = await fixtures[1].client
          .from("parent_requests")
          .select("id")
          .eq("id", fixtures[0].requestId);
        check(
          !foreign.error && foreign.data?.length === 0,
          "Actual Data API RLS hides the other parent's request.",
        );

        runner = createApplicationBrowser({
          authorize,
          context: async () => {
            check(live, "Auth-only verification must not launch a browser.");
            browser ??= await chromium.launch({
              headless: true,
              chromiumSandbox: true,
              env: {},
            });
            const context = await browser.newContext({
              viewport: { width: 1100, height: 720 },
              locale: "en-US",
              acceptDownloads: false,
              serviceWorkers: "block",
            });
            contexts.push(context);
            context.on("close", () => {
              closedContexts++;
            });
            if (diagnostic) {
              const main = (request: import("@playwright/test").Request) => {
                try {
                  return (
                    request.isNavigationRequest() &&
                    !request.frame().parentFrame()
                  );
                } catch {
                  return null;
                }
              };
              context.on("request", (request) =>
                diagnostic.network("request", request.url(), main(request)),
              );
              context.on("response", (response) =>
                diagnostic.network(
                  "response",
                  response.url(),
                  main(response.request()),
                  response.status(),
                ),
              );
              context.on("requestfailed", (request) =>
                diagnostic.network("failure", request.url(), main(request)),
              );
              context.on("page", (page) =>
                page.on("framenavigated", (frame) => {
                  if (!frame.parentFrame()) diagnostic.navigation(frame.url());
                }),
              );
            }
            return context;
          },
        });
        server = createApplicationBrowserServer(runner);
        await new Promise<void>((resolve, reject) => {
          server!.once("error", reject);
          server!.listen(0, "127.0.0.1", resolve);
        });
        const address = server.address();
        check(
          address && typeof address !== "string",
          "The actual HTTP service binds an isolated loopback port.",
        );
        const port = address.port;
        async function send(
          path: string,
          token = fixtures[0].token,
          method = "GET",
          headers: Record<string, string> = {},
          body?: string,
        ) {
          return new Promise<{
            status: number;
            headers: import("node:http").IncomingHttpHeaders;
            body: Buffer;
          }>((resolve, reject) => {
            const request = httpRequest(
              {
                hostname: "127.0.0.1",
                port,
                path,
                method,
                headers: { authorization: `Bearer ${token}`, ...headers },
                timeout: 20000,
              },
              (response) => {
                const chunks: Buffer[] = [];
                response.on("data", (chunk: Buffer) => chunks.push(chunk));
                response.on("error", reject);
                response.on("end", () =>
                  resolve({
                    status: response.statusCode ?? 0,
                    headers: response.headers,
                    body: Buffer.concat(chunks),
                  }),
                );
              },
            );
            request.on("timeout", () =>
              request.destroy(new Error("browser_test_timeout")),
            );
            request.on("error", reject);
            request.end(body);
          });
        }
        const path = `/requests/${fixtures[0].requestId}`;
        function control(value: unknown, token = fixtures[0].token) {
          const body = JSON.stringify(value);
          return send(
            `${path}/control`,
            token,
            "POST",
            {
              "content-type": "application/json",
              "content-length": String(Buffer.byteLength(body)),
            },
            body,
          );
        }
        stage = "testing the actual HTTP trust boundary";
        const initial = await send(path);
        const metadata = browserResponseSchema.parse(
          JSON.parse(initial.body.toString()),
        );
        check(
          initial.status === 200 &&
            metadata.available &&
            metadata.session === null,
          "Owned metadata is available before any browser is started.",
        );
        check(
          initial.headers["cache-control"] === "private, no-store",
          "Private request metadata cannot be cached.",
        );
        check(
          (await send(path, fixtures[1].token)).status === 403,
          "A foreign real session cannot read request metadata.",
        );
        check(
          (await send(path, "invalid-token")).status === 403,
          "Invalid authentication is denied.",
        );
        check(
          (await send(path, "")).status === 403,
          "Missing authentication is denied.",
        );
        check(
          (await send(path, undefined, "GET", { host: `localhost:${port}` }))
            .status === 403,
          "An unapproved Host is denied.",
        );
        check(
          (
            await send(path, undefined, "GET", {
              origin: "http://127.0.0.1:3200",
            })
          ).status === 403,
          "Browser-origin access is denied even from the parent web origin.",
        );
        check(
          (await send(`${path}?unexpected=1`)).status === 404,
          "Unexpected query paths are denied.",
        );
        check(
          (await send(path, undefined, "PATCH")).status === 404,
          "Unsupported methods are denied.",
        );
        check(
          (await send(`${path}/frame`, undefined, "POST")).status === 404,
          "Frames cannot start browser work.",
        );
        check(
          (await send(path, undefined, "POST", { "content-length": "1" }, "x"))
            .status === 400,
          "Applicant or other request body input is denied.",
        );
        check(
          (
            await send(
              path,
              undefined,
              "POST",
              { "transfer-encoding": "chunked" },
              "x",
            )
          ).status === 400,
          "Chunked input cannot reach browser work.",
        );
        check(
          (await send(`${path}/frame`)).status === 404,
          "No frame is invented before a real browser is started.",
        );
        const absentCommand: BrowserControl = {
          sessionId: randomUUID(),
          frameId: randomUUID(),
          action: { type: "continue" },
        };
        check(
          (await control(absentCommand)).status === 403,
          "An owned request without a browser session cannot accept a control command.",
        );
        check(
          (await control(absentCommand, fixtures[1].token)).status === 403,
          "A foreign real session cannot control the request.",
        );
        check(
          (await control(absentCommand, "invalid-token")).status === 403,
          "Control commands require a valid Auth session.",
        );
        check(
          (await send(`${path}/control`)).status === 404,
          "A read cannot issue browser controls.",
        );
        check(
          (await send(`${path}/control?unexpected=1`, undefined, "POST"))
            .status === 404,
          "Unexpected control query arguments are denied.",
        );
        check(
          (
            await send(`${path}/control`, undefined, "POST", {
              "content-type": "application/json",
            })
          ).status === 400,
          "Empty control requests without a usable fixed-length JSON body are denied.",
        );
        const absentBody = JSON.stringify(absentCommand);
        check(
          (
            await send(
              `${path}/control`,
              undefined,
              "POST",
              {
                "content-length": String(Buffer.byteLength(absentBody)),
                "content-type": "text/plain",
              },
              absentBody,
            )
          ).status === 400,
          "Control bodies require the exact reviewed JSON content type.",
        );
        check(
          (
            await send(
              `${path}/control`,
              undefined,
              "POST",
              {
                "transfer-encoding": "chunked",
                "content-type": "application/json",
              },
              absentBody,
            )
          ).status === 400,
          "Chunked control input is denied.",
        );
        check(
          (
            await send(
              `${path}/control`,
              undefined,
              "POST",
              { "content-length": "1", "content-type": "application/json" },
              "{",
            )
          ).status === 400,
          "Malformed control JSON is denied.",
        );
        check(
          (await control({ ...absentCommand, extra: true })).status === 400,
          "Unrecognized control fields are denied.",
        );
        check(
          (
            await control({
              ...absentCommand,
              action: { type: "type", text: "not permitted" },
            })
          ).status === 400,
          "Free text cannot become browser input.",
        );
        check(
          (await control({ ...absentCommand, padding: "x".repeat(2048) }))
            .status === 400,
          "Control requests exceeding the fixed byte limit are denied.",
        );
        check(
          (await send(`${path}/frame?frameId=${randomUUID()}`)).status === 404,
          "A syntactically valid frame nonce cannot invent an image.",
        );
        for (const query of [
          "frameId=invalid",
          `frameId=${randomUUID()}&extra=1`,
          `frameId=${randomUUID()}&frameId=${randomUUID()}`,
        ])
          check(
            (await send(`${path}/frame?${query}`)).status === 404,
            "Malformed, extra or duplicate frame query arguments are denied.",
          );
        check(
          contexts.length === 0,
          "Metadata and denied requests never launch Chromium.",
        );

        if (live) {
          stage =
            "one actual public COMPASS navigation without applicant input";
          const started = await send(path, undefined, "POST");
          const session = browserResponseSchema.parse(
            JSON.parse(started.body.toString()),
          );
          check(
            started.status === 200 && session.session,
            "The real website-check session starts without applicant input.",
          );
          let sawFrame = false;
          let sawHandoff = false;
          let continuationSent = false;
          let terminal = false;
          const deadline = Date.now() + 120000;
          while (Date.now() < deadline) {
            const response = await send(path);
            check(
              response.status === 200,
              "Owned session metadata remains authorized during the real check.",
            );
            const state = browserResponseSchema.parse(
              JSON.parse(response.body.toString()),
            ).session;
            check(
              state,
              "Owned browser metadata identifies the current website-check session.",
            );
            diagnostic?.state(state);
            let handoffFrameServed = false;
            if (state.frameUrl) {
              const frame = await send(
                `${path}/frame${state.handoff ? `?frameId=${state.handoff.frameId}` : ""}`,
              );
              if (frame.status === 200) {
                check(
                  frame.headers["content-type"] === "image/jpeg" &&
                    frame.headers["cache-control"] === "private, no-store" &&
                    frame.headers["x-content-type-options"] === "nosniff",
                  "Actual frame delivery is a private non-sniffable JPEG.",
                );
                check(
                  frame.body[0] === 0xff &&
                    frame.body[1] === 0xd8 &&
                    frame.body.length > 1000,
                  "The actual Chromium session produces rendered image bytes.",
                );
                sawFrame = true;
                handoffFrameServed = Boolean(state.handoff);
              } else
                check(
                  frame.status === 404 || frame.status === 409,
                  "A frame closed during the read is unavailable rather than stale.",
                );
            }
            if (state.status === "needs_parent" && state.canControl) {
              check(
                state.handoff &&
                  state.frameUrl &&
                  Date.parse(state.handoff.expiresAt) > Date.now(),
                "Parent control is bound to a real current frame and unexpired handoff.",
              );
              check(
                handoffFrameServed,
                "The exact handoff image is served before any ordinary continuation is attempted.",
              );
              sawHandoff = true;
              if (!continuationSent) {
                check(
                  (await send(`${path}/frame`)).status === 409,
                  "An interactive frame cannot be read without its nonce.",
                );
                check(
                  (await send(`${path}/frame?frameId=${randomUUID()}`))
                    .status === 409,
                  "A stale image nonce is denied on the actual active session.",
                );
                check(
                  (
                    await send(
                      `${path}/frame?frameId=${state.handoff.frameId}`,
                      fixtures[1].token,
                    )
                  ).status === 403,
                  "A foreign real session cannot read the active browser image.",
                );
                const command: BrowserControl = {
                  sessionId: state.id,
                  frameId: state.handoff.frameId,
                  action: { type: "continue" },
                };
                check(
                  (await control({ ...command, frameId: randomUUID() }))
                    .status === 409,
                  "A stale control frame cannot change the actual owned browser.",
                );
                check(
                  (await control({ ...command, sessionId: randomUUID() }))
                    .status === 409,
                  "A command from another browser session is denied.",
                );
                check(
                  (await control(command, fixtures[1].token)).status === 403,
                  "A foreign owner cannot issue the live continuation.",
                );
                if (state.handoff.kind === "continue") {
                  const continued = await control(command);
                  check(
                    continued.status === 200,
                    "One automated synthetic Continue reaches the real same-session control handler without solving a challenge.",
                  );
                  browserResponseSchema.parse(
                    JSON.parse(continued.body.toString()),
                  );
                  continuationSent = true;
                  check(
                    (await control(command)).status === 409,
                    "The same accepted control command cannot execute twice.",
                  );
                  continue;
                }
              }
              check(
                state.handoff.kind === "challenge",
                "A second active parent step is an actual supported challenge surface.",
              );
              liveOutcome =
                "visible provider challenge awaiting genuine parent interaction; no challenge solved";
              terminal = true;
              break;
            }
            if (
              ["blocked", "closed", "failed", "completed"].includes(
                state.status,
              )
            ) {
              check(
                ["blocked", "completed"].includes(state.status) &&
                  state.frameUrl === null &&
                  !state.canControl &&
                  !state.handoff,
                "The website check stops with no retained input surface or protected image.",
              );
              check(
                state.summary.includes("No application was submitted") ||
                  state.summary.includes("no application was submitted") ||
                  state.summary.includes(
                    "No household information was entered or submitted",
                  ),
                "The website-check result does not claim a filing or identity-verification result.",
              );
              liveOutcome =
                state.status === "completed"
                  ? "same session reached the blank household form; no applicant entry or filing"
                  : "provider connection stopped safely; no applicant entry or filing";
              terminal = true;
              break;
            }
            await delay(300);
          }
          check(
            terminal && sawFrame && sawHandoff,
            "One public run shows an actual nonce-bound handoff and records its honest continuation result.",
          );
          const stopped = await send(path, undefined, "DELETE");
          check(
            stopped.status === 200,
            "The live website-check session can be explicitly stopped without another provider action.",
          );
          check(
            Number(contexts.length) === 1 && closedContexts === 1,
            "The one ephemeral browser context is destroyed at the boundary.",
          );
          check(
            (await send(`${path}/frame`)).status === 404,
            "A completed public check does not retain viewable frame bytes.",
          );
        }

        stage = "testing actual request controls and processing closure";
        const paused = await fixtures[0].client.rpc("parent_control_request", {
          p_request_id: fixtures[0].requestId,
          p_action: "pause",
        });
        check(
          !paused.error && (await send(path)).status === 403,
          "Pausing the actual request immediately denies browser access.",
        );
        await runner.sweep();
        const resumed = await fixtures[0].client.rpc("parent_control_request", {
          p_request_id: fixtures[0].requestId,
          p_action: "resume",
        });
        check(
          !resumed.error && (await send(path)).status === 200,
          "A real resumed request is reauthorized under its current version.",
        );
        await db.query(
          "update parent_private.processing_controls set enabled=false where singleton",
        );
        check(
          (await send(path)).status === 403,
          "Database processing closure immediately blocks retained-token reads.",
        );
        await runner.sweep();
        await db.query(
          "update parent_private.processing_controls set enabled=true where singleton",
        );
        const cancelled = await fixtures[0].client.rpc(
          "parent_control_request",
          {
            p_request_id: fixtures[0].requestId,
            p_action: "cancel",
          },
        );
        check(
          !cancelled.error && (await send(path)).status === 403,
          "Cancelling the actual mandate immediately denies browser access.",
        );
        await runner.sweep();
        const operations = await db.query(
          "select count(*)::int as count from public.parent_operations where request_id=any($1::uuid[])",
          [fixtures.map((fixture) => fixture.requestId)],
        );
        check(
          operations.rows[0].count === 0,
          "Public connection checks create no application or transmission operations.",
        );
        check(
          contexts.length === closedContexts,
          "No browser context remains open after permission controls.",
        );
        const signedOut = await fixtures[1].client.auth.signOut({
          scope: "local",
        });
        check(
          !signedOut.error &&
            (
              await send(
                `/requests/${fixtures[1].requestId}`,
                fixtures[1].token,
              )
            ).status === 403,
          "A retained token from a revoked real Auth session cannot read browser metadata.",
        );
      } finally {
        try {
          await runner?.close();
        } finally {
          try {
            await browser?.close();
          } finally {
            if (server?.listening)
              await new Promise<void>((resolve, reject) =>
                server!.close((error) => (error ? reject(error) : resolve())),
              );
          }
        }
      }
    },
  );
  if (diagnostic) {
    const path = `tmp/parent-verification/snap-connection-diagnostic-${randomUUID()}.json`;
    const result = diagnostic.snapshot();
    mkdirSync("tmp/parent-verification", { recursive: true, mode: 0o700 });
    writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    const count = (policy: "allow" | "deny", field: "requests" | "failures") =>
      result.resources
        .filter((row) => row.policy === policy)
        .reduce((sum, row) => sum + row[field], 0);
    process.stdout.write(
      `Public connection diagnostic: ${JSON.stringify({ ...result, resources: undefined, deniedRequests: count("deny", "requests"), allowedFailures: count("allow", "failures") })}; resource counts saved to ${path}. Exact local fixture cleanup passed.\n`,
    );
  }
  process.stdout.write(
    `Parent browser connection: ${checks} assertions passed; actual COMPASS: ${liveOutcome}. No applicant data was entered or submitted.\n`,
  );
}

if (process.env.CASELINK_SNAP_DIAGNOSTIC_SELF_CHECK === "1") {
  diagnosticSelfCheck();
  process.stdout.write(
    "Public connection diagnostic redaction and bounds self-check passed; no service or browser used.\n",
  );
} else
  void main().catch(() => {
    process.stderr.write(
      `Parent browser connection verification failed during ${stage}. Credentials and household information are not logged.\n`,
    );
    process.exitCode = 1;
  });
