/** Actual Chromium DOM with fixed delayed local fixtures; no Auth service or government traffic. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";
import {
  browserAuthoritySchema,
  COMPASS_CAPTCHA,
  COMPASS_FAMILY_SAFETY,
} from "../src/lib/parent/browser-policy";
import { createApplicationBrowser } from "../src/lib/parent/browser-runner";
import {
  fixtureIntake,
  fixtureMandate,
  fixtureRequest,
} from "../src/lib/parent/test-fixtures";
import {
  assertCompassReplay,
  installCompassReplay,
} from "../tests/parent/compass-replay";

let stage = "starting isolated delayed Chromium replay";
async function main() {
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
    env: {},
  });
  const results: {
    outcome: string;
    pendingMilliseconds: number;
    finalStatus: string;
  }[] = [];
  try {
    for (const outcome of ["challenge", "ending", "provider_error"] as const) {
      stage = `checking the fixed delayed ${outcome} local replay`;
      const context = await browser.newContext({
        viewport: { width: 1100, height: 720 },
        locale: "en-US",
        acceptDownloads: false,
        serviceWorkers: "block",
      });
      let contextClosed = false;
      context.on("close", () => {
        contextClosed = true;
      });
      const newPage = context.newPage.bind(context);
      let stats: Awaited<ReturnType<typeof installCompassReplay>> | undefined;
      context.newPage = async () => {
        const page = await newPage();
        stats = await installCompassReplay(page, outcome);
        return page;
      };
      const expiresAt = Date.now() + 600000;
      const authority = browserAuthoritySchema.parse({
        ...fixtureRequest({
          intake: fixtureIntake({ needs: ["snap_new"] }),
          mandate: fixtureMandate({
            recipientIds: ["snap-pa"],
            expiresAt: new Date(expiresAt).toISOString(),
          }),
        }),
        mandate_revoked_at: null,
      });
      const grant = { ownerId: "explicit-local-fixture", authority, expiresAt };
      const token = "synthetic-no-auth-service-session";
      let requestedContexts = 0;
      const runner = createApplicationBrowser({
        authorize: async (suppliedToken, requestId) => {
          assert.equal(suppliedToken, token);
          assert.equal(requestId, authority.id);
          return grant;
        },
        context: async () => {
          assert.equal(++requestedContexts, 1);
          return context;
        },
      });
      try {
        const state = async () =>
          (await runner.read(token, authority.id, "GET")).json();
        await runner.read(token, authority.id, "POST");
        const deadline = Date.now() + 20000;
        let initial = await state();
        while (
          initial.session?.status !== "needs_parent" &&
          Date.now() < deadline
        ) {
          await delay(100);
          initial = await state();
        }
        assert.equal(initial.session?.currentUrl, COMPASS_FAMILY_SAFETY);
        assert.ok(initial.session?.handoff);
        assert.ok(stats);
        const before = stats.publicNext;
        assert.equal(
          (
            await runner.read(
              token,
              authority.id,
              "GET",
              true,
              initial.session.handoff.frameId,
            )
          ).status,
          200,
        );
        const started = Date.now();
        const response = await runner.control(token, authority.id, {
          sessionId: initial.session.id,
          frameId: initial.session.handoff.frameId,
          action: { type: "continue" },
        });
        const pendingMilliseconds = Date.now() - started;
        assert.ok(pendingMilliseconds >= 5000);
        assert.equal(response.status, 200);
        const pending = (await response.json()).session;
        assert.equal(pending.status, "running");
        assert.equal(pending.currentUrl, COMPASS_CAPTCHA);
        assert.equal(pending.frameUrl, null);
        assert.equal(pending.handoff, null);
        assert.equal(pending.canControl, false);
        assert.equal(grant.expiresAt, expiresAt);
        assert.equal(stats.publicNext, before + 1);
        assert.equal(contextClosed, false);
        assert.equal(
          (await runner.read(token, authority.id, "GET", true)).status,
          404,
        );
        const final = (await state()).session;
        assert.equal(
          final.status,
          outcome === "challenge"
            ? "needs_parent"
            : outcome === "ending"
              ? "completed"
              : "blocked",
        );
        if (outcome === "challenge") {
          assert.equal(final.handoff?.kind, "challenge");
          assert.equal(stats.publicNext, before + 1);
          await runner.read(token, authority.id, "DELETE");
        } else if (outcome === "ending")
          assert.equal(stats.publicNext, before + 3);
        else {
          assert.equal(stats.publicNext, before + 1);
          assert.match(final.summary, /CaseLink must resolve the connection/);
        }
        assert.equal(contextClosed, true);
        assert.equal(stats.captchaNext, 0);
        assertCompassReplay(stats);
        results.push({
          outcome,
          pendingMilliseconds,
          finalStatus: final.status,
        });
      } finally {
        await runner.close();
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  mkdirSync("tmp/parent-verification", { recursive: true, mode: 0o700 });
  const path = `tmp/parent-verification/browser-pending-replay-${randomUUID()}.json`;
  writeFileSync(
    path,
    JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        providerReplay: true,
        liveCompass: false,
        authService: false,
        delayMilliseconds: 6000,
        results,
        protectedScreenshots: 0,
        householdInputs: 0,
        providerRequests: 0,
        cleanupPassed: true,
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  process.stdout.write(
    `Delayed browser replay: all three actual Chromium outcomes passed; local fixtures only, no Auth service, DHS traffic, challenge solving, applicant entry or filing. Evidence: ${path}.\n`,
  );
}

void main().catch(() => {
  process.stderr.write(
    `Delayed browser replay failed during ${stage}; no provider content or credentials are logged.\n`,
  );
  process.exitCode = 1;
});
