import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import {
  renderParentPacket,
  renderParentSummary,
  type RecordedPacket,
} from "../src/lib/parent/export";
import { fillVerifiedForm } from "../src/lib/parent/forms";
import {
  fixtureIntake,
  fixtureMandate,
  fixtureNow,
  fixtureRequest,
} from "../src/lib/parent/test-fixtures";
import { buildSupportPlan } from "../src/lib/parent/planning";
import { NEEDS, NEED_LABELS } from "../src/lib/parent/domain";
import { bindFoodAccessReport, buildFoodAccessPlanBody, foodAccessReportSchema, SHARE_FOOD_ACCESS_PROGRAM } from "../src/lib/parent/food-access";

async function main() {
  const directory = resolve("tmp/parent-verification/pdfs");
  mkdirSync(directory, { recursive: true });
  const cases: { name: string; required: string[]; minimumPages: number }[] =
    [];
  const intake = fixtureIntake({ needs: [...NEEDS] }),
    mandate = fixtureMandate({
      mode: "prepare_only",
      allowedActions: ["research", "prepare"],
      recipientIds: [
        "philly-food",
        "snap-pa",
        "wic-pa",
        "peco-cap",
        "pgw-crp",
        "pwd-tap",
      ],
    });
  const request = fixtureRequest({
    intake,
    mandate,
    plan: buildSupportPlan(fixtureRequest({ intake: intake, mandate: mandate }), fixtureNow),
    events: [
      {
        id: "synthetic-parent-outcome",
        request_id: fixtureRequest().id,
        kind: "parent.outcome_reported",
        actor: "parent",
        summary: "Parent reported an update.",
        evidence: {
          outcome: "support_received",
          reference: "SYNTHETIC-OUTCOME-456",
        },
        created_at: fixtureNow.toISOString(),
      },
    ],
    events_truncated: true,
  });
  writeFileSync(
    resolve(directory, "combined-summary.pdf"),
    await renderParentSummary(request),
  );
  cases.push({
    name: "combined-summary",
    required: [
      "Your support, in one place.",
      ...NEEDS.map((need) => NEED_LABELS[need]),
      "Preparation only",
      "Guidance ready",
      "not an agency application",
      "Parent reported outcome:",
      "SYNTHETIC-OUTCOME-456",
      "Showing the latest 200 updates.",
    ],
    minimumPages: 2,
  });
  const foodAt = "2026-11-18T12:00:00Z";
  const foodBody = buildFoodAccessPlanBody({ requestId: request.id, requestVersion: 2, generatedAt: foodAt, sourceReviewCurrent: true,
    cityObservation: { recordId: 122, checkedAt: foodAt, state: "listed_unconfirmed" } });
  const food = { ...foodBody, planHash: createHash("sha256").update(JSON.stringify(foodBody)).digest("hex") };
  const foodRequest = fixtureRequest({ version: 2, created_at: foodAt, updated_at: foodAt,
    intake: fixtureIntake({ needs: ["food_now"], zip: "19129", householdSize: null, incomeAmount: null }),
    mandate: fixtureMandate({ mode: "prepare_only", recipientIds: [SHARE_FOOD_ACCESS_PROGRAM], allowedActions: ["research", "prepare"],
      allowedData: ["household"], expiresAt: "2026-11-25T12:00:00Z" }),
    plan: { version: 1, generatedAt: foodAt, model: null, summary: "Dated public food access instructions.", routes: [{
      need: "food_now", programId: SHARE_FOOD_ACCESS_PROGRAM, title: food.site.name, summary: "Public food access plan; stock is unknown.",
      state: "prepared", nextActor: "parent", officialUrl: food.source.operatorUrl, sourceUrl: food.source.operatorUrl,
      steps: [], limitation: "Nothing has been reserved or sent to the operator.", foodAccess: food,
    }] }, events: [] });
  writeFileSync(resolve(directory, "food-access-prepared.pdf"), await renderParentSummary(foodRequest));
  cases.push({ name: "food-access-prepared", minimumPages: 1, required: [food.site.name, "2901 W Hunting Park Ave", "Stock unknown",
    "Nothing is reserved", "Share guidance reviewed 2026-11-17", "City directory checked 2026-11-18"] });
  for (const result of ["no_food", "received_enough_food"] as const) {
    const report = bindFoodAccessReport(food, { expectedVersion: 2, siteId: food.site.id, planHash: food.planHash,
      reportKey: "33333333-3333-4333-8333-333333333333", result }, { eventId: "44444444-4444-4444-8444-444444444444", reportedAt: "2026-11-18T12:05:00Z" });
    const name = result === "no_food" ? "food-access-unmet" : "food-access-received";
    const value = { ...foodRequest, plan: { ...foodRequest.plan!, routes: foodRequest.plan!.routes.map(route => ({ ...route, state: report.outcome, foodAccessReport: report })) },
      events: [{ id: report.eventId, request_id: foodRequest.id, kind: "parent.outcome_reported", actor: "parent", created_at: report.reportedAt,
        summary: "You reported a food access result.", evidence: { need: "food_now", outcome: report.outcome, attribution: "parent_reported",
          reference: "Share Food Program Community Fridge & Pantry, public guidance reviewed 2026-11-17.", foodAccessReport: report } }] };
    writeFileSync(resolve(directory, `${name}.pdf`), await renderParentSummary(value));
    cases.push({ name, minimumPages: 1, required: [food.site.name, "Parent reported outcome:", "Share has not confirmed this report.",
      ...(result === "no_food" ? ["No food was available", "Your food need remains open"] : ["Collected enough food for this immediate need", "Support received"]) ] });
    if (result === "received_enough_food") {
      const correction=foodAccessReportSchema.parse({ ...report,expectedVersion:3,reportKey:"55555555-5555-4555-8555-555555555555",eventId:"66666666-6666-4666-8666-666666666666",reportedAt:"2026-11-18T12:10:00Z",result:"no_food",outcome:"unresolved" });
      const corrected={ ...value,version:3,status:"closed" as const,closed_reason:"completed",
        plan:{ ...value.plan,routes:value.plan.routes.map(route=>({ ...route,state:correction.outcome,foodAccessReport:correction,
          summary:"You corrected your food report. This request remains closed; no future work has restarted." })) },
        events:[...value.events,{ id:correction.eventId,request_id:foodRequest.id,kind:"parent.outcome_reported",actor:"parent",created_at:correction.reportedAt,
          summary:"You corrected your factual food report.",evidence:{ need:"food_now",outcome:correction.outcome,attribution:"parent_reported",foodAccessReport:correction } }] };
      writeFileSync(resolve(directory,"food-access-corrected-closed.pdf"),await renderParentSummary(corrected));
      cases.push({ name:"food-access-corrected-closed",minimumPages:1,required:["This request remains closed","no future work has restarted","No food was available","Your food need remains open","Collected enough food for this immediate need"] });
    }
  }
  const operation: RecordedPacket = {
    id: "b72df7ef-922d-43ee-9825-55e209e5b47d",
    request_id: request.id,
    request_version: 3,
    program_id: "peco-cap",
    action: "submit",
    packet: {
      zip: "19104",
      householdSize: 3,
      amountDue: 123.45,
      totalBalance: 678.9,
      dueDate: "2026-11-01",
    },
    packet_hash: "a".repeat(64),
    state: "agency_submitted",
    evidence: {
      source: "authenticated_partner",
      reference: "SYNTHETIC-RECEIPT-123",
      recordedAt: fixtureNow.toISOString(),
    },
    created_at: fixtureNow.toISOString(),
    executed_at: fixtureNow.toISOString(),
  };
  writeFileSync(
    resolve(directory, "exact-packet.pdf"),
    await renderParentPacket(operation),
  );
  cases.push({
    name: "exact-packet",
    required: [
      "Your recorded support packet",
      "Application submitted",
      "123.45",
      "678.9",
      "2026-11-01",
      "SYNTHETIC-RECEIPT-123",
      "authenticated_partner",
      "Household information version: 3",
    ],
    minimumPages: 1,
  });
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const form = pdf.getForm();
  form
    .createTextField("amount-due")
    .addToPage(page, { x: 60, y: 650, width: 220, height: 30 });
  form
    .createTextField("parent-signature")
    .addToPage(page, { x: 60, y: 590, width: 300, height: 30 });
  const source = await pdf.save();
  const filled = await fillVerifiedForm(
    {
      programId: "peco-cap",
      templateId: "synthetic",
      version: "v1",
      templateSha256: createHash("sha256").update(source).digest("hex"),
      verifiedUntil: "2026-12-01T00:00:00Z",
      fields: { "amount-due": "amountDue" },
      requiredFields: ["amountDue"],
      personalFields: ["parent-signature"],
    },
    source,
    { amountDue: 123.45 },
    fixtureNow,
  );
  const check = (await PDFDocument.load(filled)).getForm();
  if (
    check.getTextField("amount-due").getText() !== "123.45" ||
    check.getTextField("parent-signature").getText()
  )
    throw new Error("Exact form facts or required personal field changed.");
  writeFileSync(resolve(directory, "known-form.pdf"), filled);
  const visualCopy = await PDFDocument.load(filled);
  visualCopy.getForm().flatten();
  writeFileSync(
    resolve(directory, "known-form-render.pdf"),
    await visualCopy.save(),
  );
  cases.push({
    name: "known-form-render",
    required: ["123.45"],
    minimumPages: 1,
  });
  writeFileSync(
    resolve(directory, "manifest.json"),
    JSON.stringify(cases, null, 2),
  );
  execFileSync(
    process.env.CASELINK_PYTHON_BIN ?? "python3",
    [resolve("scripts/verify-parent-pdfs.py"), directory],
    { stdio: "inherit" },
  );
}
main().catch(() => {
  process.stderr.write("Synthetic parent PDF verification failed.\n");
  process.exitCode = 1;
});
