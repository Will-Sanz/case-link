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
  plan: buildSupportPlan(intake, mandate, fixtureNow),
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
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const [name, width, height] of [
    ["laptop", 1440, 1000],
    ["phone", 390, 844],
    ["reflow", 320, 820],
    ["wide", 1920, 934],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
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
        : url.pathname.endsWith("/capabilities")
          ? { ok: true, capabilities: [] }
          : url.pathname.endsWith("/operations")
            ? { ok: true, operations: [] }
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
                ? { ok: true, requests: [request] }
                : { ok: true, request };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
    for (const [label, path] of [
      ["home", "/"],
      ["intake", "/get-support?need=food"],
      ["support", "/my-support"],
      ["detail", `/support/${request.id}`],
      ["account", "/account"],
      ["signin", "/sign-in"],
      ["product", "/product"],
      ["help", "/support/help"],
      ["privacy", "/support/privacy"],
      ["terms", "/support/terms"],
    ]) {
      if (name === "wide" && label !== "home") continue;
      await page.goto(origin + path, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
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
        path,
        overflow,
        violations: axe.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.map((n) => n.target),
        })),
      });
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
