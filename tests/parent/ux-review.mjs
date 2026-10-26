import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import * as fixtures from "../../src/lib/parent/test-fixtures.ts";
import * as planning from "../../src/lib/parent/planning.ts";
const { fixtureRequest, fixtureIntake, fixtureMandate, fixtureNow } =
  fixtures.default ?? fixtures;
const { buildSupportPlan, requiredActions } = planning.default ?? planning;
const origin = "http://127.0.0.1:3200",
  directory = "tmp/parent-verification/production-ux";
mkdirSync(directory, { recursive: true });
const intake = fixtureIntake({ accountAuthority: "not_sure" }),
  mandate = fixtureMandate();
const request = fixtureRequest({
  intake,
  mandate,
  plan: buildSupportPlan(intake, mandate, fixtureNow),
  required_actions: requiredActions(intake, mandate),
  events: [],
  documents: [],
});
const browser = await chromium.launch({ headless: true }),
  results = [];
try {
  for (const [name, width, height] of [
    ["laptop", 1440, 1000],
    ["phone", 390, 844],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    let rejectAnswer = false,
      activeRequest = request;
    await page.route("**/api/parent/**", async (route) => {
      const url = new URL(route.request().url()),
        method = route.request().method();
      let status = 200,
        body = { ok: true, request: activeRequest };
      if (url.pathname.endsWith("/account"))
        body = {
          ok: true,
          account: {
            email: "family@example.test",
            preferences: {
              contactPreference: "in_app",
              language: "en",
              quietHoursStart: 19,
              quietHoursEnd: 9,
            },
          },
        };
      else if (url.pathname.endsWith("/authorization-window"))
        body = {
          ok: true,
          authorization: {
            issuedAt: "2026-10-26T12:00:00.000Z",
            expiresAt: "2026-11-25T12:00:00.000Z",
          },
        };
      else if (url.pathname.endsWith("/capabilities"))
        body = {
          ok: true,
          capabilities: [
            { programId: "philly-food", enabled: true, actions: ["share"] },
            { programId: "peco-cap", enabled: true, actions: ["submit"] },
          ],
        };
      else if (url.pathname.endsWith("/operations"))
        body = { ok: true, operations: [] };
      else if (url.pathname.endsWith("/requests") && method === "GET")
        body = { ok: true, requests: [activeRequest] };
      else if (url.pathname.endsWith("/auth")) {
        body = { ok: true };
        if (
          ["verify_code", "sign_in"].includes(
            route.request().postDataJSON().action,
          )
        ) {
          status = 400;
          body = {
            ok: false,
            error:
              route.request().postDataJSON().action === "verify_code"
                ? "That code expired. Request a new one."
                : "Check your email and password, then try again.",
          };
        }
      } else if (method === "POST" && rejectAnswer) {
        status = 409;
        body = {
          ok: false,
          error: "This request changed. Refresh it before saving your answer.",
        };
      }
      await route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
    async function snapshot(label, target) {
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement)
          document.activeElement.blur();
        window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      });
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => resolve())),
      );
      const file = `${directory}/${name}-${label}.png`;
      // Chromium can stitch the offscreen fixed skip link into tall captures.
      const captureStyle =
        'a[href="#main-content"]:not(:focus) { visibility: hidden !important; }';
      if (target) await target.screenshot({ path: file, style: captureStyle });
      else
        await page.screenshot({
          path: file,
          fullPage: true,
          style: captureStyle,
        });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      const axe = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      results.push({
        viewport: name,
        state: label,
        file,
        overflow,
        violations: axe.violations.map((item) => ({
          id: item.id,
          nodes: item.nodes.map((node) => node.target),
        })),
      });
    }
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute("href")),
      "#main-content",
    );
    await page.keyboard.press("Enter");
    assert.equal(
      await page.evaluate(() => document.activeElement?.id),
      "main-content",
    );
    await snapshot("home");
    await page.goto(`${origin}/get-support?need=food`, {
      waitUntil: "networkidle",
    });
    await page.getByLabel("Electric bill", { exact: true }).check();
    await snapshot("needs");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByLabel("Household ZIP code").fill("19104");
    await page.getByLabel(/18 or older/).check();
    await snapshot("details");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await snapshot("permission-review");
    await page.goto(`${origin}/support/${request.id}`, {
      waitUntil: "networkidle",
    });
    await snapshot("support-detail");
    rejectAnswer = true;
    await page
      .getByLabel("How are you connected to the account?")
      .selectOption("self");
    await page
      .getByRole("button", { name: "Save and continue", exact: true })
      .click();
    await page.getByRole("alert").waitFor();
    await snapshot("answer-error");
    rejectAnswer = false;
    activeRequest = { ...request, version: 2 };
    await page.getByRole("button", { name: "Review latest question" }).click();
    await page.getByText(/latest saved information is loaded/).waitFor();
    await snapshot("answer-recovered");
    await page
      .getByRole("button", { name: "Change or renew permission" })
      .click();
    await snapshot(
      "permission-editor",
      page
        .getByRole("heading", { name: "Your permission", exact: true })
        .locator(".."),
    );
    await page
      .getByText("Add a document or take a photo", { exact: true })
      .click();
    await snapshot(
      "document-consent",
      page.getByRole("heading", { name: "Bills & documents" }).locator(".."),
    );
    const combinedIntake = fixtureIntake({
        needs: ["electricity", "gas"],
        accountAuthority: "not_sure",
      }),
      combinedMandate = fixtureMandate({
        recipientIds: ["peco-cap", "pgw-crp"],
      });
    activeRequest = fixtureRequest({
      intake: combinedIntake,
      mandate: combinedMandate,
      plan: buildSupportPlan(combinedIntake, combinedMandate, fixtureNow),
      required_actions: [
        ...combinedIntake.needs.map((need) => ({
          id: `authority-${need}`,
          need,
          reason: "missing_fact",
          resolver: "parent",
          field: "accountAuthority",
          title: "Can you act for this utility account?",
          explanation: "Your answer applies only to this utility account.",
        })),
        ...requiredActions(combinedIntake, combinedMandate).filter(
          (action) => action.resolver === "operator",
        ),
      ],
      documents: [],
      events: [],
    });
    await page.goto(`${origin}/support/${request.id}`, {
      waitUntil: "networkidle",
    });
    assert.equal(
      await page
        .getByRole("region", {
          name: /bill Can you act for this utility account/,
        })
        .count(),
      2,
    );
    await snapshot("combined-accounts");
    activeRequest = {
      ...activeRequest,
      required_actions: [
        {
          id: "missing-scope",
          need: "electricity",
          reason: "expanded_permission",
          resolver: "parent",
          title: "Allow required income information",
          explanation:
            "This named program requires income information. Review your permission before it is used.",
        },
      ],
    };
    await page.reload({ waitUntil: "networkidle" });
    await page
      .getByRole("button", { name: "Review permission", exact: true })
      .click();
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute("type")),
      "checkbox",
    );
    await snapshot(
      "permission-handoff",
      page
        .getByRole("heading", { name: "Your permission", exact: true })
        .locator(".."),
    );
    activeRequest = request;
    await page.goto(`${origin}/account`, { waitUntil: "networkidle" });
    await snapshot("account");
    await page.goto(`${origin}/sign-in`, { waitUntil: "networkidle" });
    await page.getByLabel("Your email address").fill("family@example.test");
    const codeOption = page.getByRole("button", {
      name: "Use an email code instead",
    });
    if (await codeOption.count()) {
      await codeOption.click();
      await page.getByRole("button", { name: "Email me a code" }).click();
      await page.getByLabel("Email code").fill("123456");
    } else {
      await page
        .getByLabel("Password", { exact: true })
        .fill("synthetic-wrong-password");
    }
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("alert").waitFor();
    await snapshot("sign-in-recovery");
    await page.goto(`${origin}/support/help`, { waitUntil: "networkidle" });
    await snapshot("help");
    await context.close();
  }
} finally {
  await browser.close();
}
writeFileSync(
  `${directory}/results.json`,
  JSON.stringify(
    {
      notice:
        "Actual production UI with explicitly synthetic API fixtures. No live Auth, model, partner or family data used.",
      results,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    screens: results.length,
    overflow: results.filter((item) => item.overflow),
    accessibility: results.filter((item) => item.violations.length),
  }),
);
assert.equal(
  results.some((item) => item.overflow || item.violations.length),
  false,
  "Fix production UI accessibility/reflow findings.",
);
