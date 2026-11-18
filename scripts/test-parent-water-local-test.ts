import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { renderWaterLocalTestDraft, WATER_LOCAL_TEST_SOURCE } from "../src/lib/parent/water-local-test-preparation";
import type { WaterApplicationFields } from "../src/lib/parent/water-application-fields";

// Offline layout QA only. All names, addresses, access codes and saved IDs are invented test values.
async function main() {
  const folder = resolve("tmp/parent-verification/water-local-test"), source = readFileSync("tests/fixtures/parent/water-local-test-issued-2026-11-13.pdf");
  mkdirSync(folder, { recursive: true });
  const fields: WaterApplicationFields = { journey: "new_application", existingApplication: "none_known", preferredChannel: "online", householdComplete: true,
    applicant: { id: "11111111-1111-4111-8111-111111111111", name: "FictionalWater Applicant", dateOfBirth: "1990-01-01", grossMonthlyIncome: "0.00", income: { state: "none", sources: [] } },
    propertyAddress: "123 Synthetic Water Lane, Philadelphia PA 19104", phone: "215-555-0101",
    householdMembers: [{ id: "22222222-2222-4222-8222-222222222222", name: "FictionalWater Child", dateOfBirth: "2020-01-01", relationship: "Child" }],
    childSupportReceived: "no", outsideIncomeSupport: "no", livingExpenses: { food: "Prior savings buy groceries", housing: "Prior savings pay rent", utilities: "Prior savings pay utility bills" } };
  const saved = structuredClone(fields); saved.journey = "pending"; saved.existingApplication = "saved";
  saved.applicant!.grossMonthlyIncome = "2500.29"; saved.applicant!.income = { state: "sources", sources: [{ id: "33333333-3333-4333-8333-333333333333", kind: "employment" }] };
  saved.householdMembers![0].grossMonthlyIncome = "7.29"; saved.householdMembers![0].income = { state: "sources", sources: [{ id: "44444444-4444-4444-8444-444444444444", kind: "benefits" }] };
  saved.outsideIncomeSupport = "yes"; saved.outsideSupporters = [{ id: "55555555-5555-4555-8555-555555555555", name: "FictionalWater Supporter", address: "456 Synthetic Way",
    amount: "0.29", frequency: "other", frequencyDescription: "Every three months", relationship: "Friend", stillProviding: "yes" }]; delete saved.livingExpenses;
  const overflow = structuredClone(fields); overflow.householdMembers = Array.from({ length: 28 }, (_, index) => ({ ...fields.householdMembers![0],
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, name: `FictionalWater Overflow ${index + 1}` }));
  const cases = [{ name: "local-water-basic", fields }, { name: "local-water-saved", fields: saved }, { name: "local-water-overflow", fields: overflow }];
  const records = [];
  for (const item of cases) {
    const values = { access: { purpose: "account_access" as const, accessCode: "000123456", zip: "19104" },
      ...(item.fields.existingApplication === "saved" ? { recovery: { purpose: "application_recovery" as const, applicationId: "0000123" } } : {}) };
    const bytes = await renderWaterLocalTestDraft(source, item.fields, values, new Date("2026-11-13T22:20:00.000Z"));
    if (!bytes) throw new Error(); writeFileSync(resolve(folder, `${item.name}.pdf`), bytes);
    records.push({ ...item, values });
  }
  writeFileSync(resolve(folder, "cases.json"), JSON.stringify({ source: WATER_LOCAL_TEST_SOURCE, cases: records }, null, 2));
  execFileSync(process.env.CASELINK_PYTHON_BIN ?? "python3", [resolve("scripts/verify-water-local-test-pdfs.py"), folder], { stdio: "inherit" });
}
main().catch(() => { process.stderr.write("CaseLink LOCAL TEST WATER verification failed.\n"); process.exitCode = 1; });
