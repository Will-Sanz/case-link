/** Opt-in live navigation only: no applicant values, account creation, CAPTCHA solving or submission. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { compassHouseholdEntryObserved } from "../src/lib/parent/compass-household-entry.ts";

assert.equal(
  process.env.CASELINK_SNAP_READINESS_APPROVED,
  "1",
  "This live government-site navigation must be deliberately enabled.",
);
const entry = "https://www.compass.dhs.pa.gov/intake/#/getstarted";
const report = {
  checkedAt: new Date().toISOString(),
  source: entry,
  mode: "live_public_navigation",
  stages: [],
  householdValuesEntered: false,
  accountCreated: false,
  captchaSolvedOrBypassed: false,
  submissionAttempted: false,
  executionReady: false,
  outcome: "incomplete_inspection",
};
const browser = await chromium.launch({ headless: true });
let stage = "public entry";
try {
  const page = await browser.newPage({ locale: "en-US" });
  page.setDefaultTimeout(15000);
  async function at(path, visibleText) {
    stage = path;
    await page.waitForURL(`https://www.compass.dhs.pa.gov/intake/#/${path}`);
    await page.getByText(visibleText, { exact: false }).first().waitFor();
    report.stages.push(path);
  }
  const next = () =>
    page.getByRole("button", { name: "Next Button", exact: true }).click();
  await page.goto(entry, { waitUntil: "domcontentloaded" });
  await at("getstarted", "How would you like to get started?");
  await page
    .getByRole("button", { name: /^apply now$/i })
    .last()
    .click();
  await at("applynow/gettingstarted", "Ready to begin?");
  await page
    .getByRole("button", { name: "Get Started Button", exact: true })
    .click();
  await at("applynow/gettingstarted/tutorial", "Let's review some terms");
  await next();
  await at(
    "applynow/gettingstarted/importantinformation",
    "keep your information private",
  );
  await next();
  await at("applynow/gettingstarted/submitreferral", "Early Intervention");
  await page.locator('label[for="N"]').click();
  await next();
  await at(
    "applynow/gettingstarted/WICpreapplication",
    "Women, Infants, and Children",
  );
  await next();
  await at("applynow/gettingstarted/gatepost", "Who are you applying for?");
  await page.locator('label[for="FamMem"]').click();
  await next();
  await at(
    "applynow/gettingstarted/existingaccount",
    "Do you already have a My COMPASS account?",
  );
  await page.locator('label[for="N"]').click();
  await next();
  await at("applynow/gettingstarted/familysafety", "Family Safety");
  report.noAccountPathConfirmed = true;
  stage = "provider verification boundary";
  await next();
  await page.waitForFunction(
    () =>
      location.hash.includes("/household") ||
      document.body.innerText.includes(
        "We were unable to verify your information",
      ),
  );
  // An automation block does not establish an available personal handoff.
  const verificationError = page.getByText(
    "We were unable to verify your information at this time. You can try again.",
    { exact: true },
  );
  if (await verificationError.isVisible()) {
    report.outcome = "provider_verification_required";
    report.providerVerificationMessage =
      "We were unable to verify your information at this time. You can try again.";
  } else if (await compassHouseholdEntryObserved(page)) {
    report.outcome = "household_entry_reached_no_values_entered";
  } else {
    throw new Error("Provider verification result was not confirmed.");
  }
  report.stoppedAt = new URL(page.url()).hash;
} catch {
  report.outcome = "portal_changed_or_unavailable";
  report.failedStage = stage;
  process.exitCode = 1;
} finally {
  await browser.close();
  mkdirSync("tmp/parent-verification", { recursive: true, mode: 0o700 });
  writeFileSync(
    "tmp/parent-verification/snap-portal-readiness.json",
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}
