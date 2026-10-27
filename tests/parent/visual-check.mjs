import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import * as fixtureModule from "../../src/lib/parent/test-fixtures.ts";
import * as planningModule from "../../src/lib/parent/planning.ts";
const { fixtureRequest, fixtureIntake, fixtureMandate, fixtureNow } =
  fixtureModule.default ?? fixtureModule;
const { buildSupportPlan, requiredActions } =
  planningModule.default ?? planningModule;

const origin = process.env.PARENT_TEST_ORIGIN ?? "http://127.0.0.1:3013";
assert.ok(
  ["127.0.0.1", "localhost"].includes(new URL(origin).hostname),
  "Visual verification is local and synthetic only.",
);
mkdirSync("tmp/parent-verification", { recursive: true });
const intake = fixtureIntake({ accountAuthority: "not_sure" }),
  mandate = fixtureMandate();
const request = fixtureRequest({
  intake,
  mandate,
  plan: buildSupportPlan(fixtureRequest({ intake, mandate }), fixtureNow),
  required_actions: requiredActions(intake, mandate),
  events: [
    {
      id: "synthetic-event",
      request_id: fixtureRequest().id,
      kind: "prepared",
      actor: "caselink",
      summary: "Source-based preparation saved. No application has been sent.",
      created_at: fixtureNow.toISOString(),
    },
  ],
  documents: [],
});
const snapIntake = fixtureIntake({ needs: ["snap_new"], urgency: "soon" });
const snapMandate = fixtureMandate({
  recipientIds: ["snap-pa", "uesf-benefits"],
});
const snapRequest = fixtureRequest({
  intake: snapIntake,
  mandate: snapMandate,
  plan: buildSupportPlan(fixtureRequest({ intake: snapIntake, mandate: snapMandate }), fixtureNow),
  required_actions: requiredActions(snapIntake, snapMandate),
  events: [],
  documents: [],
});
const progress = {
  state: "service_offline",
  summary:
    "Your request is saved. Background preparation cannot be confirmed and no application is recorded as sent.",
  updatedAt: fixtureNow.toISOString(),
  nextRunAt: null,
  canContinueAfterClosing: false,
};
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const [name, width, height] of [
    ["laptop", 1440, 1000],
    ["phone", 390, 844],
    ["reflow", 320, 820],
    ["tablet", 768, 1024],
    ["wide", 1920, 934],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    let currentRequest = request;
    await page.route("**/api/parent/**", async (route) => {
      const url = new URL(route.request().url());
      const body = url.pathname.endsWith("/authorization-window")
        ? {
            ok: true,
            authorization: {
              issuedAt: "2026-10-26T12:00:00.000Z",
              expiresAt: "2026-11-25T12:00:00.000Z",
            },
          }
        : url.pathname.endsWith("/food-sites")
          ? {
              ok: true,
              sites: [
                {
                  id: 1,
                  name: "Synthetic City-listed site",
                  address: "100 Example Street",
                  zip: "19104",
                  category: "Senior Meal Site",
                  phoneNumber: "215-555-0123",
                  website: null,
                  hours: [
                    {
                      day: "mon",
                      windows: ["09:00–11:00"],
                      notes: "Call before traveling",
                    },
                  ],
                  serviceAreaNotes: "Confirm eligibility with the location.",
                },
              ],
              checkedAt: fixtureNow.toISOString(),
              sourceUrl: "https://www.phila.gov/food/",
              availability: "city_listed_unconfirmed",
              moreSitesAvailable: false,
            }
          : url.pathname.endsWith("/partners")
            ? {
                ok: true,
                partners: [
                  {
                    legacyResourceId: "11111111-1111-4111-8111-111111111111",
                    name: "PECO assistance programs",
                    officialUrl:
                      "https://www.peco.com/my-account/customer-support/assistance-programs",
                    programIds: ["peco-cap"],
                    directoryUpdatedAt: fixtureNow.toISOString(),
                    sourceCheckedAt: "2026-10-26",
                    relationship: "existing_partner",
                    execution: "not_connected",
                  },
                ],
              }
            : url.pathname.endsWith("/browser")
              ? {
                  ok: true,
                  available: false,
                  reason:
                    "The synthetic browser fixture has no application connection. No application is being filled or submitted.",
                  session: null,
                }
              : url.pathname.endsWith("/assistant")
                ? {
                    ok: true,
                    messages: [],
                    available: false,
                    unavailableReason:
                      "The assistant is not currently connected. Your recorded progress and direct program options remain available.",
                    historyLimited: false,
                  }
                : url.pathname.endsWith("/capabilities")
                  ? { ok: true, capabilities: [] }
                  : url.pathname.endsWith("/operations")
                    ? { ok: true, operations: [], historyLimited: false }
                    : url.pathname.endsWith("/account")
                      ? {
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
                        }
                      : url.pathname.endsWith("/requests")
                        ? {
                            ok: true,
                            requests: [currentRequest],
                            progress: { [request.id]: progress },
                          }
                        : { ok: true, request: currentRequest, progress };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
    for (const [label, path] of [
      ["home", "/"],
      ["intake", "/get-support?need=food"],
      ["permission", "/get-support?need=food"],
      ["support", "/my-support"],
      ["detail", `/support/${request.id}`],
      ["snap-detail", `/support/${request.id}`],
      ["account", "/account"],
      ["signin", "/sign-in"],
      ["product", "/product"],
      ["help", "/support/help"],
      ["privacy", "/support/privacy"],
      ["terms", "/support/terms"],
    ]) {
      if (name === "wide" && label !== "home") continue;
      if (process.argv.includes("--snap-only") && label !== "snap-detail")
        continue;
      currentRequest = label === "snap-detail" ? snapRequest : request;
      await page.goto(origin + path, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      if (label === "permission") {
        await page.getByRole("checkbox", { name: /Food for now/ }).check();
        await page.getByRole("checkbox", { name: /Apply for SNAP/ }).check();
        await page
          .getByRole("button", { name: "Continue", exact: true })
          .click();
        await page.getByLabel("Household ZIP code").fill("19104");
        await page.getByLabel(/18 or older/).check();
        await page
          .getByRole("button", { name: "Continue", exact: true })
          .click();
        assert.ok(
          await page
            .getByText("We can prepare. Applications are not connected yet.")
            .isVisible(),
        );
        const programRows = page
          .getByRole("group", { name: "Named programs for this request" })
          .getByRole("checkbox");
        assert.equal(
          await programRows.count(),
          3,
          "Food and SNAP permission must identify all three exact programs.",
        );
        for (const row of await programRows.all()) {
          const box = await row.locator("..").boundingBox();
          assert.ok(
            box && box.height <= 110,
            "Named program choices must remain compact and readable.",
          );
        }
      }
      if (label === "home") {
        const art = page.getByRole("img", {
          name: /Illustration of a family unpacking groceries/,
        });
        assert.ok(
          await art.evaluate(
            (element) => element.complete && element.naturalWidth > 0,
          ),
          "The approved panorama must load.",
        );
        assert.ok(
          await page
            .getByRole("heading", { level: 1 })
            .evaluate((element) =>
              getComputedStyle(element).fontFamily.includes("Newsreader"),
            ),
          "The original display type must be applied.",
        );
        if (width >= 1440) {
          const heading = await page
            .getByRole("heading", { level: 1 })
            .boundingBox();
          const brand = await page
            .getByRole("banner")
            .getByRole("link", { name: "CaseLink home" })
            .boundingBox();
          const services = await page
            .getByRole("region", { name: "Choose your support" })
            .boundingBox();
          const panorama = await art.boundingBox();
          assert.ok(
            heading &&
              brand &&
              services &&
              Math.abs(heading.x - brand.x) < 2 &&
              Math.abs(heading.x - services.x) < 2,
            "Homepage heading, header and support sheet must share their desktop alignment.",
          );
          assert.ok(
            services.y + services.height <= height,
            "Both support choices must fit in the initial desktop viewport.",
          );
          assert.ok(
            panorama && panorama.height <= 400 && panorama.width <= 1600,
            "The panorama must remain proportionate on wide screens.",
          );
        }
      }
      if (label === "product") {
        const items = page
          .getByRole("heading", {
            name: "We handle the work we’re allowed to handle.",
          })
          .locator("..")
          .getByRole("listitem");
        for (const item of await items.all()) {
          const marker = await item.locator("svg").boundingBox();
          const text = await item.locator("span").boundingBox();
          assert.ok(
            marker &&
              text &&
              text.x > marker.x &&
              Math.abs(text.y - marker.y) < 12,
            "Product checklist text must wrap beside its marker, not below it.",
          );
        }
      }
      await page.screenshot({
        path: `tmp/parent-verification/${name}-${label}.png`,
        fullPage: true,
        style:
          'a[href="#main-content"]:not(:focus) { visibility: hidden !important; }',
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
        path,
        overflow,
        violations: axe.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.map((n) => n.target),
        })),
      });
      if (label === "detail") {
        await page
          .getByRole("button", { name: "Ask CaseLink for assistance" })
          .click();
        const chat = page.getByRole("dialog", {
          name: "Ask CaseLink",
          exact: true,
        });
        await chat
          .getByText(
            "The assistant is not currently connected. Your recorded progress and direct program options remain available.",
            { exact: true },
          )
          .waitFor();
        const bounds = await chat.boundingBox();
        assert.ok(
          bounds &&
            bounds.x >= 0 &&
            bounds.y >= 0 &&
            bounds.x + bounds.width <= width + 1 &&
            bounds.y + bounds.height <= height + 1,
          "Chat must fit the actual viewport at every responsive width.",
        );
        await chat.screenshot({
          path: `tmp/parent-verification/${name}-chat.png`,
        });
        const chatAxe = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze();
        results.push({
          viewport: name,
          state: "chat",
          path,
          overflow: await page.evaluate(
            () => document.documentElement.scrollWidth > window.innerWidth,
          ),
          violations: chatAxe.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            nodes: v.nodes.map((n) => n.target),
          })),
        });
        await chat.getByRole("button", { name: "Minimize chat" }).click();
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
}
writeFileSync(
  "tmp/parent-verification/visual-results.json",
  JSON.stringify(results, null, 2),
);
console.log(
  JSON.stringify({
    screens: results.length,
    overflow: results.filter((r) => r.overflow),
    accessibility: results.filter((r) => r.violations.length),
  }),
);
assert.equal(
  results.some((r) => r.overflow || r.violations.length),
  false,
  "Fix visual accessibility/reflow findings before release.",
);
