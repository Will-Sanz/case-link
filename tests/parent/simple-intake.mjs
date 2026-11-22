import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const origin = process.env.PARENT_TEST_ORIGIN ?? "http://127.0.0.1:3221";
assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: "en-US" });
  const page = await context.newPage();
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const writes = [];
  page.on("request", request => {
    if (request.url().startsWith(origin + "/api/parent/food-description") && request.method() === "POST") writes.push(request.postDataJSON());
  });
  const main = page.locator("main");
  const button = name => main.getByRole("button", { name, exact: true });
  const title = name => main.getByRole("heading", { name, exact: true });
  async function check() {
    const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    assert.deepEqual(scan.violations.map(item => [item.id, item.nodes.map(node => node.target)]), []);
    assert.equal(await page.getByRole("button", { name: /Ask CaseLink|Pedir ayuda a CaseLink/ }).count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  }

  await page.goto(origin + "/get-support");
  await title("Get support").waitFor();
  const entry = main.getByLabel("Tell us what you need (optional)");
  await entry.waitFor();
  assert.equal(await main.getByRole("button", { name: "Find support", exact: true }).count(), 1);
  assert.equal(await main.getByText(/I already know|private description draft|Browse local food/).count(), 0);
  await check();
  await page.screenshot({ path: "/private/tmp/caselink-simple-start-desktop.png" });
  await main.getByRole("radio", { name: "Yes", exact: true }).check();
  await main.getByLabel("ZIP code", { exact: true }).fill("19129");
  await entry.fill("We need help with groceries this week.");
  await button("Find support").click();
  assert.deepEqual(writes, [], "Only an explicitly consented submit can send prose.");
  await main.getByRole("checkbox", { name: /I agree to let CaseLink use OpenAI/ }).check();
  await button("Find support").click();
  await title("Your proposed next steps").waitFor();
  assert.equal(writes.filter(body => body.action === "queue").length, 1);
  assert.deepEqual(writes.find(body => body.action === "queue").input, {
    description: "We need help with groceries this week.", screenLocale: "en",
  });
  await button("Food for now").click();
  assert.equal(await main.getByLabel("Household ZIP code", { exact: true }).inputValue(), "19129");
  assert.equal(await main.getByLabel("Request timing", { exact: true }).count(), 0);
  await main.getByRole("checkbox", { name: /I’m 18 or older/ }).check();
  await button("Continue").click();
  await main.getByRole("checkbox", { name: /^I authorize/ }).check();
  await button("Start getting support").click();
  await page.waitForURL(/\/support\/[a-f0-9-]{36}$/);
  await title("Your food access plan is ready").waitFor();

  await page.setViewportSize({ width: 390, height: 850 });
  await context.addCookies([{ name: "caselink-parent-ui-locale", value: "es", url: origin }]);
  await page.goto(origin + "/get-support");
  await title("Pedir apoyo").waitFor();
  await main.getByRole("radio", { name: "No", exact: true }).check();
  await main.locator("#start-zip").fill("19104");
  await check();
  await page.screenshot({ path: "/private/tmp/caselink-simple-start-mobile.png" });
  await button("Buscar apoyo").click();
  await title("¿Qué tipo de ayuda necesita?").waitFor();
  await main.getByText("Buscar lugares cercanos con alimentos", { exact: true }).click();
  assert.equal(await main.locator("#food-site-zip").inputValue(), "19104");
  assert.equal(writes.filter(body => body.action === "queue").length, 1);
  await check();
  console.log("Compact intake passed in desktop English and mobile Spanish, including consent, recommendation, start, and ZIP reuse.");
} finally {
  await browser.close();
}
