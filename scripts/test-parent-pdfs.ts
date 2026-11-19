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
import { parentExportText } from "../src/lib/parent/export-copy";
import { NEEDS, NEED_LABELS } from "../src/lib/parent/domain";
import { bindFoodAccessReport, buildFoodAccessPlanBody, foodAccessReportSchema, SHARE_FOOD_ACCESS_PROGRAM } from "../src/lib/parent/food-access";
import { buildFoodAccessAlternatives } from "../src/lib/parent/food-access-alternatives";

async function main() {
  const directory = resolve("tmp/parent-verification/pdfs");
  mkdirSync(directory, { recursive: true });
  const cases: { name: string; required: string[]; minimumPages: number; locale?: "en" | "es"; samePageText?: string[][] }[] =
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
  writeFileSync(resolve(directory, "combined-summary-es.pdf"), await renderParentSummary(request, "es"));
  cases.push({ name: "combined-summary-es", locale: "es", minimumPages: 2, required: ["Su apoyo, en un solo lugar.", ...NEEDS.map(need => parentExportText("es", NEED_LABELS[need])),
    "Solo preparación", "Orientación preparada", "no es una solicitud oficial", "Resultado informado por la persona solicitante:", "SYNTHETIC-OUTCOME-456", "últimas 200 actualizaciones", "idioma original", "traducción oficial"] });
  writeFileSync(resolve(directory, "waiting-summary-es.pdf"), await renderParentSummary(fixtureRequest({ plan: null }), "es"));
  cases.push({ name: "waiting-summary-es", locale: "es", minimumPages: 1, required: ["esperando preparación", "no es una solicitud oficial", "Puede pausar o cancelar"] });
  const foodAt = "2026-11-18T12:00:00Z";
  const foodBody = buildFoodAccessPlanBody({ requestId: request.id, requestVersion: 2, generatedAt: foodAt, sourceReviewCurrent: true,
    cityObservation: { recordId: 122, checkedAt: foodAt, state: "listed_unconfirmed" } });
  const food = { ...foodBody, planHash: createHash("sha256").update(JSON.stringify(foodBody)).digest("hex") };
  const foodRequest = fixtureRequest({ version: 2, created_at: foodAt, updated_at: foodAt,
    intake: fixtureIntake({ needs: ["food_now"], zip: "19129", householdSize: null, incomeAmount: null }),
    mandate: fixtureMandate({ mode: "prepare_only", recipientIds: [SHARE_FOOD_ACCESS_PROGRAM], allowedActions: ["research", "prepare"],
      allowedData: ["household"], expiresAt: "2026-11-25T12:00:00Z" }),
    plan: { version: 1, generatedAt: foodAt, model: null, summary: "Dated public food access instructions.", routes: [{
      need: "food_now", programId: SHARE_FOOD_ACCESS_PROGRAM, title: food.site.name, summary: "Public walk-up instructions are prepared. Food depends on donations; stock is unknown and nothing is reserved.",
      state: "prepared", nextActor: "parent", officialUrl: food.source.operatorUrl, sourceUrl: food.source.operatorUrl,
      steps: [], limitation: "No food is reserved, no delivery is arranged, and no household information has been sent to Share.", foodAccess: food,
    }] }, events: [] });
  writeFileSync(resolve(directory, "food-access-prepared.pdf"), await renderParentSummary(foodRequest));
  cases.push({ name: "food-access-prepared", minimumPages: 1, required: [food.site.name, "2901 W Hunting Park Ave", "Stock unknown",
    "Nothing is reserved", "Share guidance reviewed 2026-11-17", "City directory checked 2026-11-18"] });
  writeFileSync(resolve(directory, "food-access-prepared-es.pdf"), await renderParentSummary(foodRequest, "es"));
  cases.push({ name: "food-access-prepared-es", locale: "es", minimumPages: 1, required: [food.site.name, "2901 W Hunting Park Ave", "Se desconoce la disponibilidad de alimentos", "No hay ninguna reserva", "Guía de Share revisada el 2026-11-17", "Directorio de la Ciudad consultado el 2026-11-18", "instrucciones públicas de acceso sin cita", "https://www.sharefoodprogram.org/community-fridges/"] });
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
    writeFileSync(resolve(directory, `${name}-es.pdf`), await renderParentSummary(value, "es"));
    cases.push({ name: `${name}-es`, locale: "es", minimumPages: 1, required: [food.site.name, "Resultado informado por la persona solicitante:", "Share no ha confirmado este informe.", "2026-11-18T12:05:00Z",
      ...(result === "no_food" ? ["No había alimentos disponibles", "Su necesidad de alimentos sigue sin resolverse"] : ["Recogió suficientes alimentos para esta necesidad inmediata", "Apoyo recibido"]) ] });
    if (result === "received_enough_food") {
      const correction=foodAccessReportSchema.parse({ ...report,expectedVersion:3,reportKey:"55555555-5555-4555-8555-555555555555",eventId:"66666666-6666-4666-8666-666666666666",reportedAt:"2026-11-18T12:10:00Z",result:"no_food",outcome:"unresolved" });
      const corrected={ ...value,version:3,status:"closed" as const,closed_reason:"completed",
        plan:{ ...value.plan,routes:value.plan.routes.map(route=>({ ...route,state:correction.outcome,foodAccessReport:correction,
          summary:"You corrected your food report. This request remains closed; no future work has restarted." })) },
        events:[...value.events,{ id:correction.eventId,request_id:foodRequest.id,kind:"parent.outcome_reported",actor:"parent",created_at:correction.reportedAt,
          summary:"You corrected your factual food report.",evidence:{ need:"food_now",outcome:correction.outcome,attribution:"parent_reported",foodAccessReport:correction } }] };
      writeFileSync(resolve(directory,"food-access-corrected-closed.pdf"),await renderParentSummary(corrected));
      cases.push({ name:"food-access-corrected-closed",minimumPages:1,required:["This request remains closed","no future work has restarted","No food was available","Your food need remains open","Collected enough food for this immediate need"] });
      writeFileSync(resolve(directory,"food-access-corrected-closed-es.pdf"),await renderParentSummary(corrected,"es"));
      cases.push({ name:"food-access-corrected-closed-es",locale:"es",minimumPages:1,samePageText:[["2026-11-18T12:10:00Z","Este es un resumen actual del apoyo"]],required:["Vencimiento registrado", "Esta solicitud está cerrada", "Esta solicitud sigue cerrada","no se ha reanudado ningún trabajo futuro","No había alimentos disponibles","Recogió suficientes alimentos para esta necesidad inmediata","2026-11-18T12:05:00Z","2026-11-18T12:10:00Z"] });
    }
  }
  for (const [result, expected] of [
    ["some_food_still_needed", "Recogió algunos alimentos y todavía necesita ayuda"],
    ["could_not_access", "No pudo acceder a este lugar"],
    ["need_another_way", "Necesita otra forma de conseguir alimentos"],
  ] as const) {
    const report = bindFoodAccessReport(food, { expectedVersion: 2, siteId: food.site.id, planHash: food.planHash,
      reportKey: "33333333-3333-4333-8333-333333333333", result }, { eventId: "44444444-4444-4444-8444-444444444444", reportedAt: "2026-11-18T12:05:00Z" });
    const name = `food-access-${result}-es`;
    writeFileSync(resolve(directory, `${name}.pdf`), await renderParentSummary({ ...foodRequest, plan: { ...foodRequest.plan!, routes: foodRequest.plan!.routes.map(route => ({ ...route, state: report.outcome, foodAccessReport: report })) } }, "es"));
    cases.push({ name, locale: "es", minimumPages: 1, required: [expected, "Su necesidad de alimentos sigue sin resolverse", "No hay ninguna reserva"] });
  }
  // Current saved directory observations are separate from the immutable original site/report.
  const directoryNow = new Date(), directoryAt = directoryNow.toISOString();
  const directoryRequest = { ...foodRequest, intake_confirmed_at: { zip: directoryAt },
    mandate: { ...foodRequest.mandate, expiresAt: new Date(directoryNow.getTime() + 86400000).toISOString() } };
  const directoryReport = bindFoodAccessReport(food, { expectedVersion: 2, siteId: food.site.id, planHash: food.planHash,
    reportKey: "33333333-3333-4333-8333-333333333333", result: "need_another_way" }, { eventId: "44444444-4444-4444-8444-444444444444", reportedAt: foodAt });
  const directoryObservation = buildFoodAccessAlternatives({ request: directoryRequest, report: directoryReport, zip: "19129", now: directoryNow, result: {
    sites: [148, 149, 150].map(id => ({ id, name: `Original City listing ${id}: María, niña y pingüino`, address: `${id} Original City address`, zip: "19129", category: "Food Site",
      phoneNumber: "+1 (215) 555-0101", website: "https://example.invalid/source-food",
      hours: (["mon", "tues", "wed", "thurs", "fri", "sat", "sun"] as const).map(day => ({ day, windows: ["9am–2pm"], notes: "Original City hours; stock unknown." })),
      serviceAreaNotes: "Original City service note. No delivery or physical-access confirmation." })),
    sourceUrl: "https://www.phila.gov/food/", checkedAt: directoryAt, availability: "city_listed_unconfirmed", moreSitesAvailable: true } });
  for (const locale of ["en", "es"] as const) {
    const name = `food-directory-observations-${locale}`;
    writeFileSync(resolve(directory, `${name}.pdf`), await renderParentSummary({ ...directoryRequest, plan: { ...foodRequest.plan!, routes: foodRequest.plan!.routes.map(route => ({
      ...route, state: directoryReport.outcome, summary: "CaseLink checked other public City listings. These directory entries do not confirm usable food.",
      foodAccessReport: directoryReport, foodAccessAlternatives: directoryObservation,
    })) } }, locale));
    cases.push({ name, locale, minimumPages: 2, required: ["Original City listing 148: María, niña y pingüino", "Original City listing 150: María, niña y pingüino", "9am–2pm", directoryAt, "https://www.phila.gov/food/",
      locale === "es" ? "Otros lugares consultados para esta solicitud" : "Other City listings checked for this request",
      locale === "es" ? "no alimentos confirmados ni una reserva" : "not confirmed food or a reservation",
      locale === "es" ? "no verifica entregas" : "do not verify delivery"] });
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
  for (const locale of ["en", "es"] as const) {
    const name = `literal-packet-fields-${locale}`;
    const literalPacket: RecordedPacket = { ...operation, action: "constructor", state: "toString",
      packet: JSON.parse('{"constructor":"RAW_CONSTRUCTOR","__proto__":"RAW_PROTO","toString":"RAW_TO_STRING"}') as Record<string, unknown> };
    writeFileSync(resolve(directory, `${name}.pdf`), await renderParentPacket(literalPacket, locale));
    cases.push({ name, locale, minimumPages: 1, required: ["constructor RAW_CONSTRUCTOR", "__proto__ RAW_PROTO", "toString RAW_TO_STRING",
      `${locale === "es" ? "Estado registrado" : "Recorded state"}: toString`, `${locale === "es" ? "Acción" : "Action"}: constructor`, operation.packet_hash] });
  }
  const spanishPacket: RecordedPacket = { ...operation, packet: { ...operation.packet, familyNote: "María pidió apoyo: ¿cómo sigue? Niña, pingüino, acción.", originalItems: [{ note: "Original English agency text" }, { amount: 123.45 }] },
    evidence: { ...operation.evidence, reference: "RECIBO-Ñ-123", reason: "Original agency wording - do not translate." } };
  writeFileSync(resolve(directory,"exact-packet-es.pdf"),await renderParentPacket(spanishPacket,"es"));
  cases.push({ name:"exact-packet-es",locale:"es",minimumPages:1,required:["Su paquete de apoyo registrado","Solicitud presentada","Evidencia atribuida","123.45","678.9","2026-11-01","RECIBO-Ñ-123","authenticated_partner","Original agency wording - do not translate.","María pidió apoyo: ¿cómo sigue? Niña, pingüino, acción.",'[{"note":"Original English agency text"},{"amount":123.45}]',operation.packet_hash,"Versión de la información del hogar: 3","no es un formulario oficial ni una traducción oficial"] });
  writeFileSync(resolve(directory,"no-receipt-es.pdf"),await renderParentPacket({ ...operation,evidence:{},executed_at:null },"es"));
  cases.push({ name:"no-receipt-es",locale:"es",minimumPages:1,required:["No se ha registrado ningún comprobante de un programa", "No se ha registrado ningún intento de envío"] });
  const longRequest = { ...request, events: [], plan: { ...request.plan!, routes: [ { ...request.plan!.routes[0], summary: "Original recorded narrative. ".repeat(28), steps: Array.from({length:8},(_,i)=>`Original step ${i + 1}: ${"Keep the original source wording without dropping any facts. ".repeat(18)}`) } ] } };
  writeFileSync(resolve(directory,"long-summary-es.pdf"),await renderParentSummary(longRequest,"es"));
  cases.push({ name:"long-summary-es",locale:"es",minimumPages:2,required:["Original step 1:","Original step 8:","Keep the original source wording without dropping any facts.","Su permiso","no es una solicitud oficial"] });
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
