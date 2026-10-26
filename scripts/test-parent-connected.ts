/** Opt-in actual UI smoke. The operator creates/erases the exact disposable fixture separately. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { readConnectedProbeFixture } from "./parent-connected-probe-fixture";

let stage = "private disposable fixture validation";
const checks: string[] = [];
function check(value: unknown, label: string): asserts value {
  assert.ok(value, label);
  checks.push(label);
}
async function main() {
  check(
    process.env.CASELINK_PARENT_CONNECTED_PROBE_APPROVED === "1",
    "The actual connected smoke is deliberately authorized.",
  );
  const fixture = readConnectedProbeFixture(
    process.env.CASELINK_PARENT_CONNECTED_FIXTURE_FILE ?? "",
  );
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ reducedMotion: "reduce" });
    const origin = fixture.origin;
    stage = "existing synthetic identity sign-in";
    const entry = await page.goto(`${origin}/sign-in`, {
      waitUntil: "networkidle",
    });
    check(
      entry?.headers()["content-security-policy"]?.includes(fixture.projectUrl),
      "The connected build names the exact existing provider in its browser policy.",
    );
    check(
      (await page
        .getByRole("button", { name: "Use an email code instead" })
        .count()) === 0,
      "Unsupported email-code signup is absent from the existing-account UI.",
    );
    await page.getByLabel("Your email address").fill(fixture.email);
    await page.getByLabel("Password", { exact: true }).fill(fixture.password);
    const login = page.waitForResponse(
      (response) =>
        response.url() === `${origin}/api/parent/auth` &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    check(
      (await login).status() === 200,
      "The disposable preexisting identity signs in through the actual connected UI.",
    );
    await page.waitForURL(`${origin}/my-support`);
    const accountResponse = await page.request.get(
      `${origin}/api/parent/account`,
    );
    const account = await accountResponse.json();
    check(
      accountResponse.status() === 200 &&
        account.account.email === fixture.email,
      "The actual connected account belongs to the exact disposable Auth identity.",
    );
    const cookies = (await page.context().cookies()).filter((cookie) =>
      /^caselink-parent-auth(?:\.\d+)?$/.test(cookie.name),
    );
    check(
      cookies.length > 0 &&
        cookies.every((cookie) => cookie.httpOnly && cookie.sameSite === "Lax"),
      "Connected parent cookies remain HttpOnly and SameSite=Lax.",
    );
    const stored = cookies
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true }),
      )
      .map((cookie) => cookie.value)
      .join("");
    const retainedCookie = cookies
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
    const session = JSON.parse(
      stored.startsWith("base64-")
        ? Buffer.from(stored.slice(7), "base64url").toString()
        : stored,
    );
    check(
      JSON.parse(
        Buffer.from(session.access_token.split(".")[1], "base64url").toString(),
      ).sub === fixture.authUserId,
      "The actual connected session belongs to the exact disposable Auth identifier.",
    );
    check(
      accountResponse.headers()["cache-control"] === "private, no-store",
      "Actual connected household information is private and uncached.",
    );
    stage = "preparation-only food intake";
    await page.goto(`${origin}/get-support?need=food`, {
      waitUntil: "networkidle",
    });
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByLabel("Household ZIP code").fill("19104");
    await page.getByRole("checkbox", { name: /I’m 18 or older/ }).check();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    check(
      await page
        .getByText(
          "Preparation is available; external actions are not connected yet.",
          { exact: true },
        )
        .isVisible(),
      "The smoke cannot authorize a partner submission or external action.",
    );
    await page
      .getByRole("checkbox", {
        name: /I authorize research and preparation only/,
      })
      .check();
    const starting = page.waitForResponse(
      (response) =>
        response.url() === `${origin}/api/parent/requests` &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Start getting support" }).click();
    const started = await starting;
    check(
      started.status() === 201,
      "The real connected three-step intake saves preparation-only support.",
    );
    const request = (await started.json()).request;
    check(
      request.mandate.mode === "prepare_only" &&
        request.mandate.allowedActions.every((action: string) =>
          ["research", "prepare"].includes(action),
        ),
      "The actual recorded mandate excludes external execution.",
    );
    await page.waitForURL(`${origin}/support/${request.id}`);
    stage = "private document consent and actual Storage upload";
    await page
      .getByText("Add a document or take a photo", { exact: true })
      .click();
    check(
      (await page.getByLabel("Choose a bill or notice").count()) === 0,
      "The real file input remains unavailable before document consent.",
    );
    await page
      .getByRole("checkbox", {
        name: /I agree to private storage and AI processing/,
      })
      .check();
    const pdf = await PDFDocument.create();
    pdf
      .addPage()
      .drawText(
        "Synthetic connected parent probe. No real household information.",
      );
    await page.getByLabel("Choose a bill or notice").setInputFiles({
      name: "synthetic-connected-notice.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(await pdf.save()),
    });
    const upload = page.waitForResponse(
      (response) =>
        response.url() ===
          `${origin}/api/parent/requests/${request.id}/documents` &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Upload privately" }).click();
    check(
      (await upload).status() === 201,
      "The actual connected private PDF upload and confirmation succeed.",
    );
    stage = "pause, resume and explicit cancellation";
    for (const [button, expectedStatus] of [
      ["Pause future work", "paused"],
      ["Resume support", "active"],
    ]) {
      const changed = page.waitForResponse(
        (response) =>
          response.url() === `${origin}/api/parent/requests/${request.id}` &&
          response.request().method() === "POST",
      );
      await page.getByRole("button", { name: button, exact: true }).click();
      check(
        (await changed).status() === 200,
        `The actual connected ${button.toLowerCase()} control succeeds.`,
      );
      const saved = await page.request.get(
        `${origin}/api/parent/requests/${request.id}`,
      );
      check(
        saved.status() === 200 &&
          (await saved.json()).request.status === expectedStatus,
        `The actual connected request saves its ${expectedStatus} status.`,
      );
    }
    await page
      .getByRole("button", { name: "Cancel request & withdraw permission" })
      .click();
    const cancel = page.waitForResponse(
      (response) =>
        response.url() === `${origin}/api/parent/requests/${request.id}` &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Yes, cancel this request" })
      .click();
    check(
      (await cancel).status() === 200,
      "The actual connected cancellation withdraws future permission.",
    );
    const cancelled = await page.request.get(
      `${origin}/api/parent/requests/${request.id}`,
    );
    const cancelledRequest = (await cancelled.json()).request;
    check(
      cancelled.status() === 200 && cancelledRequest.status === "cancelled",
      "The actual connected request records its cancelled status; the operator verifies database revocation separately.",
    );
    stage = "sign-out";
    await page.goto(`${origin}/account`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.waitForURL(`${origin}/sign-in`);
    check(
      (
        await page.request.get(`${origin}/api/parent/account`, {
          headers: { Cookie: retainedCookie },
        })
      ).status() === 401,
      "A retained old parent cookie cannot restore actual connected access after sign-out.",
    );
    check(
      (await page.request.get(`${origin}/api/parent/account`)).status() === 401,
      "The actual connected sign-out removes interactive parent access.",
    );
  } finally {
    await browser.close();
  }
  mkdirSync("tmp/parent-verification/connected", { recursive: true });
  writeFileSync(
    "tmp/parent-verification/connected/ui-smoke.json",
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        apiInterception: false,
        projectUrl: fixture.projectUrl,
        origin: fixture.origin,
        assertions: checks,
        cleanup:
          "Required separately by the operator; this smoke does not erase Auth identities or assert original-account preservation.",
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  process.stdout.write(
    `Actual connected UI smoke passed (${checks.length} assertions); operator fixture cleanup/preservation checks remain required.\n`,
  );
}
void main().catch((error) => {
  process.stderr.write(
    `Connected UI smoke failed during ${stage}.${error instanceof assert.AssertionError ? ` ${error.message}` : ""} No credentials were logged.\n`,
  );
  process.exitCode = 1;
});
