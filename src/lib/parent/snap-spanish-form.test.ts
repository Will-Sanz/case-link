import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { renderSnapApplicationPreview, renderSnapPreparationDraft } from "./snap-draft";
import { renderSnapSigningCopy } from "./snap-signing-copy";
import { renderSnapDirectCompletion, type SnapDirectCompletion, type SnapDirectCompletionContext } from "./snap-direct-completion";
import { completeSnapDirectCompletionCopy } from "./snap-direct-completion-core";
import { SNAP_PARENT_CERTIFICATION_ACTS } from "./snap-protected-operation";
import { assessSnapApplicationSnapshot, snapApplicationSnapshotSchema } from "./snap-application-snapshot";
import { snapCaptureContextSchema } from "./snap-capture-context";
import { snapFinalPacketBindingSchema, snapFinalizerIntentSchema } from "./snap-packet-contract";
import { inspectSnapFinalPdf } from "./snap-final-pdf";
import { snapPersonalPageMap } from "./snap-personal-pages";
import { fixtureSnapApplication, fixtureSnapCaptureIntent, fixtureSnapSnapshot } from "./test-fixtures";
import { SNAP_APPLICATION_SOURCE, SNAP_SPANISH_APPLICATION_SOURCE, SNAP_EN_TEMPLATE_ID, SNAP_ES_TEMPLATE_ID, snapApplicationSourceSchema, snapFormSource } from "./snap-form-source";
import geometry from "../../../data/verified-forms/snap-pa600fs-es-2019.fields.json";

const now = new Date("2026-11-18T12:01:00.000Z"), preparedAt = new Date("2026-11-18T12:00:00.000Z");
const spanish = readFileSync("data/verified-forms/snap-pa600fs-es-2019.pdf"), english = readFileSync("data/verified-forms/snap-pa600fs-2019.pdf");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function fields(count = 3, income = 0) {
  const value = fixtureSnapApplication(preparedAt);
  value.applicant = { firstName: "José Ángel", lastName: "Muñoz", middleInitial: "Á" };
  value.household = Array.from({ length: count }, (_, row) => ({ ...value.household![0],
    ...value.applicant, id: `11111111-1111-4111-8111-${String(row + 1).padStart(12, "0")}`, relationship: row ? "Hijo" : "SELF",
    ...(row ? { firstName: `Niño ${row}` } : {}), requestingSnap: row !== 1, ...(row === 1 ? { citizen: undefined } : {}),
  }));
  value.householdSize = count;
  if (income) value.income = { month: "2026-11", hasIncome: true, entries: Array.from({ length: income }, (_, row) => ({
    id: `44444444-4444-4444-8444-${String(row + 1).padStart(12, "0")}`, personId: value.household![0].id,
    source: "Empleo", amount: row + 100.25, frequency: "Mensual", status: row === 4 ? "expected" as const : "received" as const, date: `2026-11-${row === 4 ? "20" : String(row + 1).padStart(2, "0")}`,
  })) };
  return value;
}
function fullFields() {
  const value = fields(8, 5);
  value.phone = "215-555-0101"; value.otherPhone = "215-555-0102"; value.bestTimeToCall = "Mañanas";
  value.language = "other"; value.otherLanguage = "Francés"; value.interpreter = true; value.interpreterLanguage = "Francés";
  value.screening = { lowCashAndIncome: true, migrantOrSeasonal: false, belowShelterCosts: true };
  value.history = { fleeingOrProbation: { answer: true, names: "José Muñoz", date: "2020-05-01", state: "PA" }, welfareFraud: { answer: true, names: "José Muñoz", date: "2019-02-01", state: "PA" }, otherStateDisqualification: { answer: true, names: "José Muñoz" } };
  value.expenseClaims = { household: "claim", medical: "claim", housing: ["rent", "condoFees", "mortgage", "propertyFees", "homeownersInsurance"] };
  value.expenses = { childSupport: true, courtOrdered: true, mealsIncludedInRent: false, heat: true, housingAssistance: true, housingAssistanceKind: "Ayuda de alquiler", utilityAllowance: false, outsidePayer: true, outsideExpenses: "Agua", outsideAmount: 20.25, outsideFrequency: "Mensual", outsidePayee: "Agua", airConditioning: true,
    utilities: ["telephone", "water", "garbage", "installation", "electric", "oil", "sewer", "gas", "propane", "other"], otherUtility: "Comunal", care: true, careMonthlyAmount: 120.25, careRecipient: "Niño Muñoz", rent: 850.25, condoFees: 15.25, mortgage: 0, propertyFees: 0, homeownersInsurance: 0,
    medical: ["dental", "doctor", "equipment", "premiums", "hospital", "prescriptions", "homeAide", "supplies", "transport", "other"], otherMedical: "Otro gasto" };
  value.authorizedRepresentative = { name: "Ana Pérez", address: { street: "2 Synthetic Lane", city: "Philadelphia", state: "PA", zip: "19104" }, phone: "215-555-0103" };
  return value;
}
async function protectedInputs(count = 3) {
  const value = fields(count), snapshot = snapApplicationSnapshotSchema.parse({ ...fixtureSnapSnapshot(preparedAt, value), source: SNAP_SPANISH_APPLICATION_SOURCE });
  const unsigned = (await renderSnapSigningCopy(spanish, value, preparedAt, SNAP_ES_TEMPLATE_ID)).bytes!;
  const trusted: SnapDirectCompletionContext = { requestId: snapshot.request_id, snapshot,
    context: { requestVersion: snapshot.request_version, snapshotId: snapshot.id, snapshotHash: "a".repeat(64), source: snapshot.source, applyingSubjectIds: value.household!.filter(person => person.requestingSnap).map(person => person.id) },
    preparedAt: preparedAt.toISOString(), unsignedContentSha256: sha(unsigned) };
  const completion: SnapDirectCompletion = { requestId: trusted.requestId, requestVersion: trusted.context.requestVersion, snapshotId: snapshot.id, snapshotHash: trusted.context.snapshotHash, source: snapshot.source,
    unsignedContentSha256: trusted.unsignedContentSha256, signingRoute: "applicant_name_handwriting",
    identifiers: trusted.context.applyingSubjectIds.map((personId, index) => ({ personId, kind: "ssn", value: `90000000${index + 1}` })),
    certifications: SNAP_PARENT_CERTIFICATION_ACTS.map((actId, index) => ({ actId, provenance: "caller_reported_fresh_parent_drawing", startedAt: `2026-11-18T12:00:${index ? "30" : "10"}.000Z`, completedAt: `2026-11-18T12:00:${index ? "40" : "20"}.000Z`, date: "2026-11-18", strokes: [[{ x: 0.05, y: 0.2 }, { x: 0.35, y: 0.65 }, { x: 0.95, y: 0.8 }]] })),
  };
  return { trusted, completion, unsigned };
}
describe("explicit official Spanish SNAP source", () => {
  it("pins source bytes and geometry independently, without extending the existing source ceiling", async () => {
    const form = snapFormSource(SNAP_ES_TEMPLATE_ID), pdf = await PDFDocument.load(spanish);
    expect(form.contract.sha256).toBe(sha(spanish)); expect(form.contract.byteLength).toBe(spanish.length);
    expect(form.contract.verifiedUntil).toBe(snapFormSource().contract.verifiedUntil);
    expect(sha(readFileSync("data/verified-forms/snap-pa600fs-es-2019.fields.json"))).toBe(form.source.inventorySha256);
    expect(geometry.sourceSha256).toBe(sha(spanish)); expect(pdf.getPageCount()).toBe(12);
    expect(pdf.catalog.get(PDFName.of("Lang"))).toEqual(PDFString.of("en-US"));
    expect(pdf.catalog.has(PDFName.of("AcroForm"))).toBe(false);
    for (const page of pdf.getPages()) { expect(page.getSize()).toEqual({ width: 612, height: 792 }); expect(page.getRotation().angle).toBe(0); }
  });
  it("renders the explicitly selected Spanish source without changing English contact preference", async () => {
    const value = fields(), before = structuredClone(value);
    const rendered = await renderSnapApplicationPreview(spanish, value, now, SNAP_ES_TEMPLATE_ID);
    expect(rendered.bytes).not.toBeNull(); expect(value).toEqual(before);
    expect(rendered.readiness.source).toEqual(SNAP_SPANISH_APPLICATION_SOURCE);
    const pdf = await PDFDocument.load(rendered.bytes!);
    expect(pdf.getTitle()).toContain("SIN ENVIAR"); expect(pdf.catalog.get(PDFName.of("Lang"))).toEqual(PDFString.of("es-ES"));
    expect(rendered.readiness.submissionReady).toBe(false);
  });
  it("keeps the English default even when the parent's program contact language is Spanish", async () => {
    const value = fields(); value.language = "es";
    const legacy = await renderSnapApplicationPreview(english, value, now), selected = await renderSnapApplicationPreview(english, value, now, SNAP_EN_TEMPLATE_ID);
    expect(legacy.bytes).toEqual(selected.bytes); expect(legacy.readiness.source).toEqual(SNAP_APPLICATION_SOURCE);
    expect(await renderSnapApplicationPreview(spanish, value, now).then(() => false, () => true)).toBe(true);
  });
  it.each([[english, SNAP_ES_TEMPLATE_ID], [spanish, SNAP_EN_TEMPLATE_ID], [english, "unreviewed"], [spanish, { templateId: SNAP_ES_TEMPLATE_ID }]])("rejects bytes or an identity outside the exact selection %#", async (bytes, id) => {
    expect(await renderSnapApplicationPreview(bytes, fields(), now, id).then(() => false, () => true)).toBe(true);
  });
  it.each(["templateId", "templateVersion", "templateSha256", "inventoryId", "inventoryVersion", "inventorySha256"] as const)("rejects a cross-language %s in source, snapshot and capture evidence", key => {
    const source = { ...SNAP_SPANISH_APPLICATION_SOURCE, [key]: SNAP_APPLICATION_SOURCE[key] };
    expect(snapApplicationSourceSchema.safeParse(source).success).toBe(false);
    expect(snapApplicationSnapshotSchema.safeParse({ ...fixtureSnapSnapshot(preparedAt), source }).success).toBe(false);
    expect(snapCaptureContextSchema.safeParse({ requestVersion: 2, snapshotId: fixtureSnapSnapshot().id, snapshotHash: "a".repeat(64), source, applyingSubjectIds: [fields().household![0].id] }).success).toBe(false);
  });
  it("keeps original fact dates and source provenance when assessing a Spanish revision", () => {
    const snapshot = { ...fixtureSnapSnapshot(preparedAt, fields()), source: SNAP_SPANISH_APPLICATION_SOURCE }, before = structuredClone(snapshot);
    expect(assessSnapApplicationSnapshot(snapshot, now).readiness.nonProtectedDataReadyForReview).toBe(true);
    expect(snapshot).toEqual(before);
    expect(snapPersonalPageMap(SNAP_ES_TEMPLATE_ID)).toMatchObject({ source: SNAP_SPANISH_APPLICATION_SOURCE, requiredFullPages: [{ pdfPage: 3 }, { pdfPage: 7 }] });
    expect(snapPersonalPageMap().source).toEqual(SNAP_APPLICATION_SOURCE);
  });
  it.each([new Date("2026-11-17T23:59:59Z"), new Date("2026-12-03T05:00:00Z")])("does not render Spanish outside its offline evidence window %s", async at => {
    expect(await renderSnapApplicationPreview(spanish, { zip: "19104" }, at, SNAP_ES_TEMPLATE_ID).then(() => false, () => true)).toBe(true);
  });
  it("renders eight accented household rows and five income rows including explicitly expected income", async () => {
    const value = fullFields(), before = structuredClone(value), copy = await renderSnapSigningCopy(spanish, value, now, SNAP_ES_TEMPLATE_ID);
    expect(copy.bytes).not.toBeNull(); expect(copy.readiness.renderingRequirements).toEqual([]); expect(value).toEqual(before);
    expect(copy.readiness.protectedSteps).toContainEqual({ step: "genuine_representative_designation_and_personal_act" });
    expect(copy.readiness.submissionReady).toBe(false);
  });
  it.each(["people", "income", "long_text", "subcent"])("requires a supported continuation or layout instead of truncating %s", async kind => {
    const value = fields(kind === "people" ? 9 : 3, kind === "income" ? 6 : 1);
    if (kind === "long_text") value.household![2].lastName = "Fernández".repeat(8);
    if (kind === "subcent") value.income!.entries![0].amount = 12.005;
    const original = structuredClone(value), result = await renderSnapSigningCopy(spanish, value, now, SNAP_ES_TEMPLATE_ID);
    expect(result.bytes).toBeNull(); expect(result.readiness.renderingRequirements.length).toBeGreaterThan(0); expect(value).toEqual(original);
  });
  it("supports the existing scoped-facts preparation contract under explicit Spanish source selection", async () => {
    const result = await renderSnapPreparationDraft(spanish, { kind: "current_scoped_facts", zip: "19104", language: "en" }, now, SNAP_ES_TEMPLATE_ID);
    expect(result.readiness).toMatchObject({ templateId: SNAP_ES_TEMPLATE_ID, submissionReady: false });
    expect((await PDFDocument.load(result.bytes)).getTitle()).toContain("SIN ENVIAR");
  });
  it("fits every translated rehearsal income-frequency label without changing the contact-language answer", async () => {
    const value = fields(1), person = value.household![0];
    const householdPerson = Object.fromEntries(Object.entries(person).filter(([field]) => field !== "id"));
    for (const frequency of ["weekly", "biweekly", "twice_monthly", "monthly", "yearly"] as const) {
      const result = await renderSnapPreparationDraft(spanish, { kind: "synthetic_rehearsal", zip: "19104", language: "en", applicant: value.applicant, address: value.address,
        household: [householdPerson], income: { hasIncome: true, entries: [{ personIndex: 0, source: "Empleo", amount: 100.25, frequency, receivedOn: "2026-11-01" }] } }, now, SNAP_ES_TEMPLATE_ID);
      expect(result.bytes.length).toBeGreaterThan(0); expect(result.readiness.submissionReady).toBe(false);
    }
  });
  it("shows a partial Spanish preview without inventing an absent income status", async () => {
    const value = fields(1, 1); delete value.income!.entries![0].status;
    const result = await renderSnapApplicationPreview(spanish, value, now, SNAP_ES_TEMPLATE_ID);
    expect(result.bytes).not.toBeNull(); expect(result.readiness.nonProtectedDataReadyForReview).toBe(false);
    expect(result.readiness.missingFields).toContain(`income.entries.${value.income!.entries![0].id}.status`);
  });
  it.each([3, 8])("binds private Spanish identifier/certification rendering for %i rows without claiming accepted signatures", async count => {
    const value = await protectedInputs(count), original = structuredClone({ trusted: value.trusted, completion: value.completion });
    const result = await renderSnapDirectCompletion(spanish, value.trusted, value.completion, now);
    expect(result.bytes).not.toBeNull(); expect(result).toEqual(await completeSnapDirectCompletionCopy(value.unsigned, value.trusted, value.completion, now));
    expect(result.readiness).toMatchObject({ submissionReady: false, providerSignatureAcceptance: "unconfirmed", personalActAttribution: "caller_reported_only" });
    expect({ trusted: value.trusted, completion: value.completion }).toEqual(original);
    expect(JSON.stringify({ ...result, bytes: undefined })).not.toMatch(/90000000|José|Muñoz|strokes/);
    const pdf = await PDFDocument.load(result.bytes!); expect(pdf.getPageCount()).toBe(12); expect(pdf.catalog.get(PDFName.of("Lang"))).toEqual(PDFString.of("es-ES"));
  });
  it("keeps a deliberately deferred Spanish applicant identifier blank without inventing a substitute", async () => {
    const value = await protectedInputs(), personId = value.completion.identifiers[1].personId;
    value.completion.identifiers[1] = { personId, kind: "provide_to_agency_later" };
    const result = await renderSnapDirectCompletion(spanish, value.trusted, value.completion, now);
    expect(result.bytes).not.toBeNull();
    expect(result.readiness).toMatchObject({ filingReadiness: "initial_filing_identifiers_outstanding", outstandingIdentifierSubjectIds: [personId], submissionReady: false });
    expect((await PDFDocument.load(result.bytes!)).getSubject()).toContain("faltan identificadores");
  });
  it.each(["snapshot", "context", "completion", "bytes", "unsigned"])("rejects mixed English/Spanish protected %s", async kind => {
    const value = await protectedInputs(); let template = spanish;
    if (kind === "snapshot") value.trusted.snapshot.source = SNAP_APPLICATION_SOURCE;
    if (kind === "context") value.trusted.context.source = SNAP_APPLICATION_SOURCE;
    if (kind === "completion") value.completion.source = SNAP_APPLICATION_SOURCE;
    if (kind === "bytes") template = english;
    if (kind === "unsigned") value.trusted.unsignedContentSha256 = value.completion.unsignedContentSha256 = sha((await renderSnapSigningCopy(english, value.trusted.snapshot.details, preparedAt)).bytes!);
    expect((await renderSnapDirectCompletion(template, value.trusted, value.completion, now)).bytes).toBeNull();
  });
  it("binds an exact Spanish packet and final structure while rejecting mixed source tuples", async () => {
    const value = await protectedInputs(), rendered = await renderSnapDirectCompletion(spanish, value.trusted, value.completion, now);
    if (!rendered.bytes) throw new Error("Synthetic candidate missing");
    const form = snapFormSource(SNAP_ES_TEMPLATE_ID), source = { templateId: form.contract.id, templateVersion: form.contract.version, templateSha256: form.contract.sha256 };
    const intent = { ...fixtureSnapCaptureIntent(), ...source, contentSha256: sha(rendered.bytes), byteLength: rendered.bytes.length };
    expect(snapFinalizerIntentSchema.safeParse(intent).success).toBe(true);
    expect(snapFinalPacketBindingSchema.safeParse({ ...intent, expiresAt: "2026-11-19T12:00:00.000Z" }).success).toBe(true);
    for (const key of ["templateId", "templateVersion", "templateSha256"] as const) {
      const mixed = { ...intent, [key]: fixtureSnapCaptureIntent()[key] };
      expect(snapFinalizerIntentSchema.safeParse(mixed).success).toBe(false);
      expect(snapFinalPacketBindingSchema.safeParse({ ...mixed, expiresAt: "2026-11-19T12:00:00.000Z" }).success).toBe(false);
    }
    expect(await inspectSnapFinalPdf({ bytes: rendered.bytes, contentSha256: sha(rendered.bytes), byteLength: rendered.bytes.length, source }, { deadline: new Date(Date.now() + 10000) })).toMatchObject({ ok: true, scope: "structure_only", source });
    expect(await inspectSnapFinalPdf({ bytes: rendered.bytes, contentSha256: sha(rendered.bytes), byteLength: rendered.bytes.length, source: { ...source, templateSha256: SNAP_APPLICATION_SOURCE.templateSha256 } }, { deadline: new Date(Date.now() + 10000) })).toMatchObject({ ok: false, reason: "binding_mismatch" });
  });

  it.skipIf(!process.env.CASELINK_PYTHON_BIN)("renders all source pages and proves exact Spanish answer/protected/excluded regions with independent PDF coordinates", async () => {
    const directory = resolve("tmp/parent-verification/snap-spanish-form"); mkdirSync(directory, { recursive: true });
    const preview = await renderSnapApplicationPreview(spanish, fullFields(), now, SNAP_ES_TEMPLATE_ID), copy = await renderSnapSigningCopy(spanish, fullFields(), now, SNAP_ES_TEMPLATE_ID), value = await protectedInputs(8), completed = await renderSnapDirectCompletion(spanish, value.trusted, value.completion, now);
    if (!preview.bytes || !copy.bytes || !completed.bytes) throw new Error("Synthetic rendering missing");
    for (const [file, bytes] of [["source.pdf", spanish], ["preview.pdf", preview.bytes], ["full-unsigned.pdf", copy.bytes], ["protected-unsigned.pdf", value.unsigned], ["completed.pdf", completed.bytes]] as const) writeFileSync(resolve(directory, file), bytes);
    const script = String.raw`
import sys,json
from pathlib import Path
import pypdfium2 as pdfium
from PIL import Image,ImageChops,ImageDraw
root=Path(sys.argv[1]); docs={name:pdfium.PdfDocument(str(root/(name+'.pdf'))) for name in ['source','preview','full-unsigned','protected-unsigned','completed']}
for doc in docs.values(): assert len(doc)==12

def image(doc,page): return doc[page].render(scale=2).to_pil().convert('RGB')
def crop(im,box):
 x0,y0,x1,y1=box;return im.crop((round(x0*2),round((792-y1)*2),round(x1*2),round((792-y0)*2)))
def same(a,b,box): return ImageChops.difference(crop(a,box),crop(b,box)).getbbox() is None
text='\n'.join(page.get_textpage().get_text_range() for page in docs['full-unsigned'])
assert 'Los datos del representante no son una designación firmada.' in docs['preview'][6].get_textpage().get_text_range()
for glyph in ['José Ángel','Muñoz','Francés','Niño 7','PREVISTO','11/20/2026','850.25','Ana Pérez']: assert glyph in text,glyph
first=image(docs['full-unsigned'],2); original=image(docs['source'],2)
# Independent official Spanish column and signature bounds, not renderer-generated expectations.
for box in [(413,134,480,321),(93,48,520,81)]: assert same(first,original,box),box
for page in [0,1,5,7,8,9,10,11]: assert same(image(docs['full-unsigned'],page),image(docs['source'],page),(0,0,612,792)),page
rights=image(docs['full-unsigned'],6); blank=image(docs['source'],6)
for box in [(31,241,581,310)]: assert same(rights,blank,box),box
completed=image(docs['completed'],2); unsigned=image(docs['protected-unsigned'],2)
assert not same(unsigned,original,(243,667,254,678))
assert same(unsigned,original,(315,667,326,678))
assert same(unsigned,original,(397,667,408,678))
for row in range(8):
 box=(414,299-row*23.4,479,320-row*23.4)
 assert same(completed,unsigned,box)==(row==1),row
assert not same(completed,unsigned,(94,50,344,69));assert not same(completed,unsigned,(407,50,519,69))
completedRights=image(docs['completed'],6); unsignedRights=image(docs['protected-unsigned'],6)
assert not same(completedRights,unsignedRights,(32,281,260,307));assert not same(completedRights,unsignedRights,(269,281,342,307))
for box in [(350,280,581,309),(31,241,581,269)]: assert same(completedRights,unsignedRights,box),box
# Every changed pixel must be within its exact applicant identifier or certification region.
for page in range(12):
 diff=ImageChops.difference(image(docs['completed'],page),image(docs['protected-unsigned'],page))
 allow=[]
 if page==2: allow=[(414,299-row*23.4,479,320-row*23.4) for row in range(8) if row!=1]+[(93,49,345,70),(406,49,521,70)]
 if page==6: allow=[(32,280,261,308),(269,280,343,308)]
 draw=ImageDraw.Draw(diff)
 for x0,y0,x1,y1 in allow: draw.rectangle((int(x0*2),int((792-y1)*2),int(x1*2)+1,int((792-y0)*2)+1),fill='black')
 assert diff.getbbox() is None,page
for name in ['full-unsigned','completed']:
 thumbs=[]
 for page in range(12):
  im=image(docs[name],page); im.save(root/(name+'-page-'+str(page+1)+'.png')); im.thumbnail((306,396));thumbs.append(im)
 sheet=Image.new('RGB',(1224,1188),'white')
 for page,im in enumerate(thumbs):sheet.paste(im,((page%4)*306,(page//4)*396))
 sheet.save(root/(name+'-contact-sheet.png'))
previewThumbs=[]
for page in range(12):
 im=docs['preview'][page].render(scale=0.5).to_pil().convert('RGB');previewThumbs.append(im)
previewSheet=Image.new('RGB',(1224,1188),'white')
for page,im in enumerate(previewThumbs):previewSheet.paste(im,((page%4)*306,(page//4)*396))
previewSheet.save(root/'preview-contact-sheet.png')
for page in [2,6]:image(docs['preview'],page).save(root/('preview-page-'+str(page+1)+'.png'))
print(json.dumps({'pagesPerDocument':12,'applicantRows':7,'blankNonapplicantRows':1,'certificationPages':[3,7],'sourceAndExcludedPixels':'unchanged','outsidePersonalPixels':'unchanged'}))
`;
    const proof = JSON.parse(execFileSync(process.env.CASELINK_PYTHON_BIN!, ["-c", script, directory], { encoding: "utf8", timeout: 30000, maxBuffer: 100000 }));
    expect(proof).toMatchObject({ pagesPerDocument: 12, applicantRows: 7, blankNonapplicantRows: 1, certificationPages: [3, 7], outsidePersonalPixels: "unchanged" });
  });
});
