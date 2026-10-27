import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  renderPecoCapPreparationDraft,
  type PecoCapDraftInput,
} from "../src/lib/parent/peco-cap-draft";

// Offline official-form rehearsal only; never reads runtime secrets or sends a packet.
async function main() {
  const directory = resolve("tmp/parent-verification/peco-cap-drafts");
  mkdirSync(directory, { recursive: true });
  const template = readFileSync("tests/fixtures/parent/peco-cap-2026.pdf");
  const now = new Date("2026-10-26T12:00:00Z");
  const base: PecoCapDraftInput = {
    accountNumber: "9000000001",
    applicant: {
      firstName: "María",
      lastName: "Rivera",
      middleInitial: "L",
      dateOfBirth: "1988-04-15",
      incomeSource: "Employment",
    },
    address: {
      street: "123 Synthetic Way",
      apartment: "2B",
      city: "Philadelphia",
      state: "PA",
      zip: "19104",
    },
    homePhone: "215-555-0101",
    householdMembers: [],
  };
  const member = (index: number) => ({
    firstName: `Demo${index}`,
    lastName: "Rivera",
    dateOfBirth: `${index <= 5 ? 2010 + index : 1980 + index % 10}-06-09`,
    relationship: index <= 5 ? "Child" : index === 6 ? "Sibling" : "Relative",
    incomeSource: index <= 5 ? "None" : index === 6 ? "Employment" : "Self employed",
  });
  const cases = [
    { name: "peco-single", input: base, pages: 2 },
    {
      name: "peco-five",
      input: { ...base, householdMembers: Array.from({ length: 4 }, (_, i) => member(i + 1)) },
      pages: 2,
    },
    {
      name: "peco-overflow",
      input: {
        ...base,
        applicant: {
          ...base.applicant,
          firstName: "María Elena Antonia",
          lastName: "De la Cruz Montenegro",
          incomeSource: "Seasonal employment and pension",
        },
        cellPhone: "215-555-0100",
        smsUpdates: true,
        householdMembers: Array.from({ length: 28 }, (_, i) => member(i + 1)),
      },
      pages: 4,
    },
  ];
  for (const testCase of cases) {
    writeFileSync(
      resolve(directory, `${testCase.name}.pdf`),
      await renderPecoCapPreparationDraft(template, testCase.input, now),
    );
  }
  writeFileSync(resolve(directory, "cases.json"), JSON.stringify(cases, null, 2));
  execFileSync(process.env.CASELINK_PYTHON_BIN ?? "python3", [
    resolve("scripts/verify-peco-cap-pdfs.py"), directory,
  ], { stdio: "inherit" });
}

main().catch(() => {
  process.stderr.write("Offline PECO unsigned preparation verification failed.\n");
  process.exitCode = 1;
});
