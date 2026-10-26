/** Actual isolated Auth, RLS and private HTTP checks; optional public COMPASS navigation sends no applicant data. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser, type BrowserContext } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { createBrowserAuthorizer } from "../src/lib/parent/browser-authority";
import {
  browserResponseSchema,
  type BrowserControl,
} from "../src/lib/parent/browser-policy";
import { createApplicationBrowser } from "../src/lib/parent/browser-runner";
import { createApplicationBrowserServer } from "../src/lib/parent/browser-server";
import { fixtureIntake, fixtureMandate } from "../src/lib/parent/test-fixtures";
import { fetchWithTimeout } from "../src/lib/supabase/fetch-with-timeout";

let stage = "checking isolated local configuration";
let checks = 0;
function check(condition: unknown, label: string): asserts condition {
  assert.ok(condition, label);
  checks++;
}

async function main() {
  const cli = process.env.CASELINK_SUPABASE_CLI;
  check(cli, "An explicit installed Supabase CLI is required.");
  const local = JSON.parse(
    execFileSync(
      cli,
      [
        "status",
        "--workdir",
        resolve("tmp/parent-runtime"),
        "--output",
        "json",
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 15000,
        env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
      },
    ),
  ) as Record<string, string>;
  for (const [name, port, protocol] of [
    ["API_URL", "55321", "http:"],
    ["DB_URL", "55322", "postgresql:"],
  ]) {
    const url = new URL(local[name]);
    check(
      url.hostname === "127.0.0.1" &&
        url.port === port &&
        url.protocol === protocol,
      `${name} must be the exact isolated local parent service.`,
    );
  }
  check(
    local.ANON_KEY && local.SERVICE_ROLE_KEY,
    "Local fixture credentials are available.",
  );
  const options = {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: fetchWithTimeout },
  };
  const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, options);
  const db = new Client({
    connectionString: local.DB_URL,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
  });
  await db.connect();
  const fixtures: {
    id: string;
    email: string;
    client: SupabaseClient;
    token: string;
    requestId: string;
  }[] = [];
  let original:
    | {
        enabled: boolean;
        approval_reference: string | null;
        approved_until: string | null;
        updated_at: string;
        existing_identity_created_before: string | null;
      }
    | undefined;
  let locked = false;
  let changed = false;
  let browser: Browser | undefined;
  let runner: ReturnType<typeof createApplicationBrowser> | undefined;
  let server: ReturnType<typeof createApplicationBrowserServer> | undefined;
  const contexts: BrowserContext[] = [];
  let closedContexts = 0;
  const live = process.env.CASELINK_SNAP_READINESS_APPROVED === "1";
  let liveOutcome = "not requested";
  try {
    stage = "locking isolated test controls";
    locked = (
      await db.query("select pg_try_advisory_lock(627281933) as acquired")
    ).rows[0].acquired;
    check(
      locked,
      "Another browser connection test must not share fixture controls.",
    );
    original = (
      await db.query(
        "select enabled,approval_reference,approved_until::text,updated_at::text,existing_identity_created_before::text from parent_private.processing_controls where singleton",
      )
    ).rows[0];
    check(original, "The isolated processing control exists.");
    check(
      original.existing_identity_created_before === null,
      "A configured identity cutoff must not be broadened for tests.",
    );
    const approvedUntil = new Date(Date.now() + 20 * 60 * 1000).toISOString();
    await db.query(
      "update parent_private.processing_controls set enabled=true,approval_reference=$1,approved_until=$2 where singleton",
      [
        "owner-authorized isolated synthetic browser connection test",
        approvedUntil,
      ],
    );
    changed = true;

    stage = "creating two exact isolated synthetic identities and sessions";
    for (let index = 0; index < 2; index++) {
      const email = `parent-browser-${randomUUID()}@example.test`;
      const password = `Browser!${randomUUID()}a9`;
      const created = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      check(
        !created.error && created.data.user?.id,
        "The local Auth service creates the exact synthetic fixture.",
      );
      const client = createClient(local.API_URL, local.ANON_KEY, options);
      const fixture = {
        id: created.data.user.id,
        email,
        client,
        token: "",
        requestId: "",
      };
      fixtures.push(fixture);
      const signedIn = await client.auth.signInWithPassword({
        email,
        password,
      });
      check(
        !signedIn.error && signedIn.data.session?.access_token,
        "Real password authentication returns an active local session.",
      );
      fixture.token = signedIn.data.session.access_token;
      const verified = await client.auth.getUser(fixture.token);
      check(
        !verified.error && verified.data.user?.id === fixture.id,
        "Auth independently verifies the issued access token.",
      );
      const started = await client.rpc("parent_start_request", {
        p_intake: fixtureIntake({ needs: ["snap_new"], utilityProviders: [] }),
        p_mandate: fixtureMandate({
          mode: "prepare_only",
          recipientIds: ["snap-pa"],
          allowedActions: ["research", "prepare"],
          allowedData: ["household"],
          expiresAt: approvedUntil,
          maxAttempts: 1,
          maxRecipients: 1,
          bookingPreference: "ask_me",
        }),
        p_idempotency_key: randomUUID(),
      });
      check(
        !started.error && typeof started.data === "string",
        "The real parent RPC starts an owned SNAP request.",
      );
      fixture.requestId = started.data;
    }

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
      initial.status === 200 && metadata.available && metadata.session === null,
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
      (await send(path, undefined, "GET", { origin: "http://127.0.0.1:3200" }))
        .status === 403,
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
      (await send(`${path}/control?unexpected=1`, undefined, "POST")).status ===
        404,
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
      stage = "one actual public COMPASS navigation without applicant input";
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
              (await send(`${path}/frame?frameId=${randomUUID()}`)).status ===
                409,
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
              (await control({ ...command, frameId: randomUUID() })).status ===
                409,
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
          ["blocked", "closed", "failed", "completed"].includes(state.status)
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
    const cancelled = await fixtures[0].client.rpc("parent_control_request", {
      p_request_id: fixtures[0].requestId,
      p_action: "cancel",
    });
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
    const signedOut = await fixtures[1].client.auth.signOut({ scope: "local" });
    check(
      !signedOut.error &&
        (await send(`/requests/${fixtures[1].requestId}`, fixtures[1].token))
          .status === 403,
      "A retained token from a revoked real Auth session cannot read browser metadata.",
    );
  } finally {
    const testStage = stage;
    stage =
      "restoring exact isolated controls and removing only owned synthetic fixtures";
    let cleanupFailed = false;
    async function cleanup(action: () => Promise<unknown>) {
      try {
        await action();
      } catch {
        cleanupFailed = true;
      }
    }
    await cleanup(async () => runner?.close());
    await cleanup(async () => browser?.close());
    if (server?.listening)
      await cleanup(
        () =>
          new Promise<void>((resolve, reject) =>
            server!.close((error) => (error ? reject(error) : resolve())),
          ),
      );
    for (const fixture of fixtures) {
      await cleanup(async () => {
        check(
          /^parent-browser-[0-9a-f-]+@example\.test$/.test(fixture.email),
          "Cleanup only accepts this test's exact fixture prefix.",
        );
        const row = await db.query("select email from auth.users where id=$1", [
          fixture.id,
        ]);
        check(
          row.rows[0]?.email === fixture.email,
          "Cleanup verifies each exact identity before removal.",
        );
        const signedOut = await fixture.client.auth.signOut({ scope: "local" });
        const removed = await admin.auth.admin.deleteUser(fixture.id);
        check(
          !signedOut.error,
          "The exact fixture's real session is signed out before identity removal.",
        );
        check(
          !removed.error,
          "Only the known synthetic Auth identity is removed.",
        );
        const remaining = await db.query(
          "select (select count(*)::int from auth.users where id=$1) as users,(select count(*)::int from public.parent_accounts where id=$1) as accounts,(select count(*)::int from public.parent_requests where id=$2) as requests",
          [fixture.id, fixture.requestId || null],
        );
        check(
          remaining.rows[0].users === 0 &&
            remaining.rows[0].accounts === 0 &&
            remaining.rows[0].requests === 0,
          "The fixture identity, parent membership and request are fully removed.",
        );
      });
    }
    if (changed && original) {
      const snapshot = original;
      await cleanup(async () => {
        await db.query(
          "update parent_private.processing_controls set enabled=$1,approval_reference=$2,approved_until=$3,updated_at=$4 where singleton",
          [
            snapshot.enabled,
            snapshot.approval_reference,
            snapshot.approved_until,
            snapshot.updated_at,
          ],
        );
        const restored = (
          await db.query(
            "select enabled,approval_reference,approved_until::text,updated_at::text,existing_identity_created_before::text from parent_private.processing_controls where singleton",
          )
        ).rows[0];
        check(
          JSON.stringify(restored) === JSON.stringify(snapshot),
          "The exact original processing controls and identity cutoff are restored.",
        );
      });
    }
    if (locked)
      await cleanup(() => db.query("select pg_advisory_unlock(627281933)"));
    await cleanup(() => db.end());
    if (cleanupFailed) throw new Error("isolated_browser_cleanup_failed");
    stage = testStage;
  }
  process.stdout.write(
    `Parent browser connection: ${checks} assertions passed; actual COMPASS: ${liveOutcome}. No applicant data was entered or submitted.\n`,
  );
}

void main().catch(() => {
  process.stderr.write(
    `Parent browser connection verification failed during ${stage}. Credentials and household information are not logged.\n`,
  );
  process.exitCode = 1;
});
