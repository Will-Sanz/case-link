import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { renderFictionalPgwCrpDraft, renderOwnedPgwCrpDraft, type PgwProtectedIdentifier } from "../src/lib/parent/pgw-crp-draft";
import { fictionalPgwFields } from "../src/lib/parent/pgw-application-test-fixtures";
import { PGW_APPLICATION_SOURCE, type PgwApplicationFields } from "../src/lib/parent/pgw-application-fields";

// Offline fictional values only, including invented identifier alternatives; no real identity, provider or signature.
async function main() {
  const output = resolve("tmp/parent-verification/pgw-crp-drafts"); mkdirSync(output, { recursive: true });
  const source = readFileSync("tests/fixtures/parent/pgw-crp-2026-11-13.pdf"), now = new Date("2026-11-13T21:50:00Z");
  const overflow = fictionalPgwFields(); overflow.householdMembers = Array.from({ length: 28 }, (_, index) => ({ ...overflow.householdMembers![0],
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, firstName: `Fictional${index + 1}` }));
  const zero = fictionalPgwFields(); zero.customer!.income = { state: "none", sources: [], noIncomeSituation: "Unemployed and not eligible for unemployment" };
  zero.zeroIncomePast30Days = true; zero.livingExpenses = { food: "Using prior savings for groceries", housing: "Using prior savings for rent", utilities: "Using prior savings for utility bills" };
  const outside = fictionalPgwFields(); outside.outsideSupport = { receives: true, supporter: { id: "99999999-9999-4999-8999-999999999999", firstName: "FictionalSupporter", lastName: "Example",
    phone: "215-555-0102", address: { street: "456 Synthetic Lane", city: "Philadelphia", state: "PA", zip: "19147" }, monthlyAmountCents: 12345 } };
  const identifierFields = fictionalPgwFields(); identifierFields.householdMembers = Array.from({ length: 8 }, (_, index) => ({ ...identifierFields.householdMembers![0],
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, firstName: `Fictional${index + 1}` }));
  const identifiers: PgwProtectedIdentifier[] = identifierFields.householdMembers.map((person, index) => ({ subjectId: person.id,
    identifier: { purpose: "required_identifier", type: PGW_APPLICATION_SOURCE.identifierTypes[index % 7] as "ssn" | "drivers_license" | "student_id" | "passport" | "visa" | "itin" | "other",
      value: `FICT-ID-${index + 1}`, ...(index === 6 ? { otherType: "Fictional community program card" } : {}) } }));
  const cases: { name: string; fields: PgwApplicationFields; pages: number; identifiers?: PgwProtectedIdentifier[] }[] = [
    { name: "pgw-basic", fields: fictionalPgwFields(), pages: 4 }, { name: "pgw-overflow", fields: overflow, pages: 6 },
    { name: "pgw-zero-income", fields: zero, pages: 5 }, { name: "pgw-outside-support", fields: outside, pages: 4 },
    { name: "pgw-private-test-identifiers", fields: identifierFields, pages: 6, identifiers },
  ];
  const records = [];
  for (const item of cases) {
    const result = item.identifiers ? await renderOwnedPgwCrpDraft(source, item.fields, item.identifiers, now)
      : await renderFictionalPgwCrpDraft(source, { kind: "fictional_offline_rehearsal", fields: item.fields }, now);
    if (!result.bytes || !result.manifest || result.manifest.pageCount !== item.pages) throw new Error();
    writeFileSync(resolve(output, `${item.name}.pdf`), result.bytes);
    records.push({ ...item, fields: result.fields, manifest: result.manifest, protectedRequirements: result.protectedRequirements, incomeProof: result.incomeProof, financialAssent: result.financialAssent, submissionReady: result.submissionReady });
  }
  writeFileSync(resolve(output, "cases.json"), JSON.stringify({ source: PGW_APPLICATION_SOURCE, cases: records }, null, 2));
  execFileSync(process.env.CASELINK_PYTHON_BIN ?? "python3", [resolve("scripts/verify-pgw-crp-pdfs.py"), output], { stdio: "inherit" });
}
main().catch(() => { process.stderr.write("Offline PGW unsigned preparation verification failed.\n"); process.exitCode = 1; });
