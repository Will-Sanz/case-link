import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { renderToBuffer } from "@react-pdf/renderer";
import { FamilyTakeawayDocument } from "../src/features/families/family-takeaway-document";
import { buildFamilyTakeaway } from "../src/features/families/family-takeaway-data";
import { formatPlanOwner } from "../src/features/families/plan-pdf-document";
import { finalizePlanPdf } from "../src/lib/domain/plan/finalize-plan-pdf";
import { formatDateOnly } from "../src/lib/dates";
import { familyTakeawayFixture } from "../tests/fixtures/family-takeaway";
import { pdfPlanFixtures } from "../tests/fixtures/pdf-plans";

// Synthetic fixtures only; uses the same content, margin, footer and monochrome checks as the record PDF.
async function main() {
  const directory = resolve(process.env.CASELINK_PDF_EVIDENCE_DIR ?? "tmp/pdfs/family-takeaway");
  mkdirSync(directory, { recursive: true });
  const privateFixture = familyTakeawayFixture();
  const fixtures = [
    { name: "family-selected-private", ...privateFixture, forbiddenText: ["PRIVATE_MARKER", "Started dated action", "Completed intake", "Withdrawn duplicate", "2020"], minimumPages: 1 },
    ...pdfPlanFixtures().filter(fixture => ["many-goals", "maximum-fields"].includes(fixture.name)).map(fixture => ({
      name: `family-${fixture.name}`, plan: fixture.plan,
      selection: { actionIds: fixture.plan.steps.flatMap(step => (step.action_items ?? []).map(action => action.id)), contactKeys: [], nextCheckIn: "", discussedWithFamily: true },
      forbiddenText: ["Narrative", "MaximumNarrative", "MaximumActionDescription", "MaximumProgress", "MaximumOutcome", "DocumentFilename"], minimumPages: fixture.name === "many-goals" ? 3 : 1,
    })),
  ];
  const manifest = [];
  for (const fixture of fixtures) {
    const data = buildFamilyTakeaway(fixture.plan, fixture.selection);
    const file = resolve(directory, `${fixture.name}.pdf`);
    writeFileSync(file, await finalizePlanPdf(await renderToBuffer(FamilyTakeawayDocument({ data, familyName: "Family 014", generatedDate: "Oct 15, 2026" })), "Family takeaway - Your next steps"));
    const requiredText = ["Your next steps", "Family 014", "Oct 15, 2026"];
    const actionHeaders = [];
    for (const goal of data.goals) {
      requiredText.push(goal.title);
      for (const action of goal.actions) {
        requiredText.push(action.title, formatPlanOwner(action.owner), formatDateOnly(action.date)!);
        actionHeaders.push({ title: action.title, date: formatDateOnly(action.date), status: formatPlanOwner(action.owner) });
      }
      for (const contact of goal.contacts) requiredText.push(contact.name, contact.phone, contact.email);
    }
    if (data.nextCheckIn) requiredText.push("Next check-in", formatDateOnly(data.nextCheckIn)!);
    manifest.push({ name: fixture.name, file, minimumPages: fixture.minimumPages, requiredText: requiredText.filter(Boolean), forbiddenText: [...fixture.forbiddenText, "undefined", "null"], actionHeaders, goalStarts: data.goals.map(goal => ({ title: goal.title, followingText: goal.actions[0].title.slice(0, 32) })) });
  }
  const manifestFile = resolve(directory, "manifest.json");
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  execFileSync(process.env.CASELINK_PYTHON_BIN ?? "python3", [resolve("scripts/verify-plan-pdfs.py"), manifestFile], { stdio: "inherit" });
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Family PDF verification failed"); process.exitCode = 1; });
