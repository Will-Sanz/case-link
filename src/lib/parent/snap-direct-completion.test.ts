import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PDFDocument, PDFName } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { renderSnapDirectCompletion, SNAP_DIRECT_COMPLETION_VERSION, type SnapDirectCompletion, type SnapDirectCompletionContext } from "./snap-direct-completion";
import { completeSnapDirectCompletionCopy } from "./snap-direct-completion-core";
import { SNAP_PARENT_CERTIFICATION_ACTS } from "./snap-protected-operation";
import { renderSnapSigningCopy } from "./snap-signing-copy";
import { snapApplicationSnapshotSchema } from "./snap-application-snapshot";
import { fixtureSnapApplication, fixtureSnapSnapshot } from "./test-fixtures";

const template = readFileSync("data/verified-forms/snap-pa600fs-2019.pdf"), now = new Date("2026-11-04T22:00:00.000Z"), preparedAt = new Date("2026-11-04T21:59:00.000Z");
const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
async function inputs(people = 1, nonapplicantRow = -1) {
  const fields = fixtureSnapApplication(preparedAt);
  fields.household = Array.from({ length: people }, (_, i) => ({ ...fields.household![0],
    id: `11111111-1111-4111-8111-${String(i + 1).padStart(12, "0")}`, relationship: i ? "OTHER" : "SELF",
    ...(i ? { firstName: `Person ${i}`, lastName: "Synthetic" } : {}), requestingSnap: i !== nonapplicantRow,
  }));
  if (nonapplicantRow >= 0) delete fields.household[nonapplicantRow].citizen;
  fields.householdSize = people;
  const snapshot = snapApplicationSnapshotSchema.parse(fixtureSnapSnapshot(preparedAt, fields)), rendered = people <= 8 ? await renderSnapSigningCopy(template, fields, preparedAt) : null;
  const trusted: SnapDirectCompletionContext = { requestId: snapshot.request_id, snapshot,
    context: { requestVersion: snapshot.request_version, snapshotId: snapshot.id, snapshotHash: "a".repeat(64), source: snapshot.source,
      applyingSubjectIds: fields.household.filter(person => person.requestingSnap).map(person => person.id) },
    preparedAt: preparedAt.toISOString(), unsignedContentSha256: rendered?.bytes ? sha(rendered.bytes) : "b".repeat(64),
  };
  const completion: SnapDirectCompletion = { requestId: trusted.requestId, requestVersion: trusted.context.requestVersion,
    snapshotId: snapshot.id, snapshotHash: trusted.context.snapshotHash, source: snapshot.source,
    unsignedContentSha256: trusted.unsignedContentSha256, signingRoute: "applicant_name_handwriting",
    identifiers: fields.household.filter(person => person.requestingSnap).map((person, i) => ({ personId: person.id, kind: "ssn", value: `90000000${i + 1}` })),
    certifications: SNAP_PARENT_CERTIFICATION_ACTS.map((actId, i) => ({ actId, provenance: "caller_reported_fresh_parent_drawing",
      startedAt: `2026-11-04T21:59:${i ? "30" : "10"}.000Z`, completedAt: `2026-11-04T21:59:${i ? "40" : "20"}.000Z`, date: "2026-11-04",
      // Synthetic geometry only; neither this fixture nor the renderer establishes genuine handwriting.
      strokes: [[{ x: 0.05, y: 0.2 }, { x: 0.35, y: 0.65 }, { x: 0.7, y: 0.35 }, { x: 0.95, y: 0.8 }]],
    })),
  };
  return { trusted, completion, unsigned: rendered?.bytes };
}
type Inputs = Awaited<ReturnType<typeof inputs>>;

describe("closed deterministic direct SNAP completion", () => {
  it("binds regenerated trusted preparation and returns only an unconfirmed exact candidate", async () => {
    const { trusted, completion } = await inputs(3, 1), before = structuredClone({ trusted, completion });
    const result = await renderSnapDirectCompletion(template, trusted, completion, now);
    expect(result.bytes).toBeInstanceOf(Uint8Array);
    if (!result.bytes) throw new Error("candidate missing");
    expect(result.contentSha256).toBe(sha(result.bytes)); expect(result.byteLength).toBe(result.bytes.length);
    expect(result.readiness).toEqual({ kind: "closed_direct_completion_candidate", rendererVersion: SNAP_DIRECT_COMPLETION_VERSION,
      submissionReady: false, providerSignatureAcceptance: "unconfirmed", identityOrSignatureVerified: false, personalActAttribution: "caller_reported_only",
      filingReadiness: "applicant_identifiers_provided", outstandingIdentifierSubjectIds: [],
      reason: null, requestId: trusted.requestId, context: trusted.context, unsignedContentSha256: trusted.unsignedContentSha256, renderedPersonalActIds: SNAP_PARENT_CERTIFICATION_ACTS });
    expect({ trusted, completion }).toEqual(before);
    const metadata = JSON.stringify({ ...result, bytes: undefined });
    for (const value of ["900000001", "900000002", "Private Canary", "Person 2", "strokes", "21:59:20", '"date"']) expect(metadata).not.toContain(value);
    Reflect.set(result.readiness.renderedPersonalActIds, 0, "untrusted_consumer_change");
    expect(SNAP_PARENT_CERTIFICATION_ACTS[0]).toBe("applicant_signature_printed_page_1");
    const doc = await PDFDocument.load(result.bytes), unsigned = await PDFDocument.load((await inputs(3, 1)).unsigned!);
    expect(doc.getPageCount()).toBe(12); expect(doc.getKeywords()).toContain(SNAP_DIRECT_COMPLETION_VERSION);
    expect(doc.getTitle()).not.toContain("unsigned"); expect(doc.catalog.has(PDFName.of("AcroForm"))).toBe(false);
    for (const key of ["getTitle", "getSubject", "getKeywords", "getAuthor"] as const) expect(doc[key]() ?? "").not.toMatch(/90000000|Private Canary|Person 2/);
    doc.getPages().forEach((page, index) => {
      expect(page.getRotation()).toEqual(unsigned.getPage(index).getRotation());
      for (const box of ["getMediaBox", "getCropBox", "getBleedBox", "getTrimBox", "getArtBox"] as const) expect(page[box]()).toEqual(unsigned.getPage(index)[box]());
    });
  });

  it.each([1, 3, 8])("handles every selected applicant without truncating %i rows", async count => {
    const value = await inputs(count), result = await renderSnapDirectCompletion(template, value.trusted, value.completion, now);
    expect(result.bytes).not.toBeNull();
    if (result.bytes) expect(result.readiness.context.applyingSubjectIds).toHaveLength(count);
  });

  it("keeps explicitly deferred applicant identifiers blank and distinguishes initial filing from complete identifier information", async () => {
    const value = await inputs(3, 1), deferred = value.completion.identifiers[1].personId;
    value.completion.identifiers[1] = { personId: deferred, kind: "provide_to_agency_later" };
    const result = await renderSnapDirectCompletion(template, value.trusted, value.completion, now);
    const shared = await completeSnapDirectCompletionCopy(value.unsigned!, value.trusted, value.completion, now);
    expect(result.bytes).not.toBeNull(); expect(shared).toEqual(result);
    expect(result.readiness).toMatchObject({ filingReadiness: "initial_filing_identifiers_outstanding", outstandingIdentifierSubjectIds: [deferred],
      submissionReady: false, providerSignatureAcceptance: "unconfirmed" });
    const document = await PDFDocument.load(result.bytes!);
    expect(document.getSubject()).toContain("Initial filing: applicant identifiers remain");
    expect(JSON.stringify({ ...result, bytes: undefined })).not.toContain("90000000");
  });
  it.each(["value", "duplicate", "nonapplicant"])("refuses a deferred identifier with %s rather than silently accepting a broader field", async changed => {
    const value = await inputs(3, 1), personId = value.completion.identifiers[0].personId;
    value.completion.identifiers[0] = { personId, kind: "provide_to_agency_later" };
    if (changed === "value") Reflect.set(value.completion.identifiers[0], "value", "900000001");
    if (changed === "duplicate") value.completion.identifiers[1] = { personId, kind: "provide_to_agency_later" };
    if (changed === "nonapplicant") value.completion.identifiers[0].personId = value.trusted.snapshot.details.household![1].id;
    expect((await renderSnapDirectCompletion(template, value.trusted, value.completion, now)).bytes).toBeNull();
  });
  it("rejects the same supplied number for different applicants without echoing it, while independent deferrals remain valid", async () => {
    const value = await inputs(3), first = value.completion.identifiers[0];
    if (first.kind !== "ssn") throw new Error("Synthetic number missing");
    value.completion.identifiers[1] = { personId: value.completion.identifiers[1].personId, kind: "ssn", value: first.value };
    const result = await renderSnapDirectCompletion(template, value.trusted, value.completion, now);
    expect(result).toMatchObject({ bytes: null, readiness: { reason: "identifier_rule_unresolved" } }); expect(JSON.stringify(result)).not.toContain(first.value);
    value.completion.identifiers = value.completion.identifiers.map(identifier => ({ personId: identifier.personId, kind: "provide_to_agency_later" }));
    const deferred = await renderSnapDirectCompletion(template, value.trusted, value.completion, now);
    expect(deferred.bytes).not.toBeNull(); expect(deferred.readiness).toMatchObject({ filingReadiness: "initial_filing_identifiers_outstanding", outstandingIdentifierSubjectIds: value.trusted.context.applyingSubjectIds });
  });

  // Frozen synthetic vectors from the actual November 5 pre-extraction browser/server parity proof.
  it.each([
    [1, -1, "7d60ed6dd780779a7284f0abe16fffbc13256001be4ea245cede4487c90939c9", 437481],
    [8, -1, "49d19d4fbaa319b17bbb4dbc4419502dcb45218607f7b2b66d931215b90f595c", 438637],
    [3, 1, "c80cd61fde4652b8c6696c2fdcfc979dd8f23774f4ba8556f5df03d0862cb057", 437790],
  ] as const)("keeps the server and shared core byte-identical for %i people, excluded row %i", async (count, excluded, contentSha256, byteLength) => {
    const value = await inputs(count, excluded);
    value.trusted.snapshot.details.household!.forEach((person, index) => {
      if (index) { person.firstName = `Synthetic Person ${index}`; person.lastName = "Fixture"; }
    });
    value.unsigned = (await renderSnapSigningCopy(template, value.trusted.snapshot.details, preparedAt)).bytes!;
    value.trusted.unsignedContentSha256 = value.completion.unsignedContentSha256 = sha(value.unsigned);
    const server = await renderSnapDirectCompletion(template, value.trusted, value.completion, now);
    const shared = await completeSnapDirectCompletionCopy(value.unsigned!, value.trusted, value.completion, now);
    expect(server.bytes).not.toBeNull(); expect(shared).toEqual(server);
    expect(server).toMatchObject({ contentSha256, byteLength });
  });

  it("copies input before awaiting so later changes cannot transplant a drawing onto other facts", async () => {
    const v = await inputs(), baseline = await renderSnapDirectCompletion(template, v.trusted, v.completion, now), sourceCopy = Uint8Array.from(template);
    const clock = new Date(now), pending = renderSnapDirectCompletion(sourceCopy, v.trusted, v.completion, clock);
    sourceCopy[100] ^= 1; v.trusted.snapshot.details.screening!.lowCashAndIncome = true;
    v.completion.unsignedContentSha256 = "f".repeat(64); v.completion.certifications[0].strokes[0][0].x = 0.99;
    clock.setTime(0);
    const result = await pending;
    expect(result.bytes).not.toBeNull(); expect(result).toEqual(baseline);
  });

  it.each([
    ["request", (v: Inputs) => { v.completion.requestId = "ffffffff-ffff-4fff-8fff-ffffffffffff"; }],
    ["version", (v: Inputs) => { v.completion.requestVersion++; }],
    ["snapshot", (v: Inputs) => { v.completion.snapshotId = "ffffffff-ffff-4fff-8fff-ffffffffffff"; }],
    ["snapshot hash", (v: Inputs) => { v.completion.snapshotHash = "f".repeat(64); }],
    ["exact unsigned copy", (v: Inputs) => { v.completion.unsignedContentSha256 = "f".repeat(64); }],
    ["regenerated copy", (v: Inputs) => { v.trusted.unsignedContentSha256 = v.completion.unsignedContentSha256 = "f".repeat(64); }],
    ["wrong subject scope", (v: Inputs) => { v.trusted.context.applyingSubjectIds = ["ffffffff-ffff-4fff-8fff-ffffffffffff"]; }],
    ["changed known answer", (v: Inputs) => { v.trusted.snapshot.details.screening!.lowCashAndIncome = true; }],
    ["snapshot belonging elsewhere", (v: Inputs) => { v.trusted.snapshot.request_id = "ffffffff-ffff-4fff-8fff-ffffffffffff"; }],
    ["future snapshot", (v: Inputs) => { v.trusted.snapshot.request_version++; }],
    ["preparation before snapshot", (v: Inputs) => { v.trusted.preparedAt = "2026-11-04T21:58:59.000Z"; }],
  ])("rejects mismatched %s without rebinding private input", async (_label, mutate) => {
    const value = await inputs(); mutate(value);
    expect(await renderSnapDirectCompletion(template, value.trusted, value.completion, now)).toMatchObject({ bytes: null, readiness: { reason: "scope_changed" } });
  });

  it.each([
    ["missing applicant", (v: Inputs) => { v.completion.identifiers.pop(); }],
    ["duplicate subject", (v: Inputs) => { v.completion.identifiers[1].personId = v.completion.identifiers[0].personId; }],
    ["nonapplicant", (v: Inputs) => { v.completion.identifiers[1].personId = v.trusted.snapshot.details.household![1].id; }],
    ["unrelated subject", (v: Inputs) => { v.completion.identifiers[1].personId = "ffffffff-ffff-4fff-8fff-ffffffffffff"; }],
    ["unused row", (v: Inputs) => { v.completion.identifiers.push({ personId: "ffffffff-ffff-4fff-8fff-ffffffffffff", kind: "ssn", value: "900000009" }); }],
  ])("requires exactly all applicants and excludes %s", async (_label, mutate) => {
    const value = await inputs(3, 1); mutate(value);
    expect(await renderSnapDirectCompletion(template, value.trusted, value.completion, now)).toMatchObject({ bytes: null, readiness: { reason: "scope_changed" } });
  });

  it.each([
    ["past source", new Date("2026-11-02T22:00:00.000Z")], ["expired source", new Date("2026-12-03T05:00:00.000Z")], ["invalid clock", new Date("bad")],
  ])("does not render from %s", async (_label, at) => {
    const v = await inputs(); expect((await renderSnapDirectCompletion(template, v.trusted, v.completion, at)).bytes).toBeNull();
  });

  it("does not renew stale or missing provenance or incomplete known answers", async () => {
    const v = await inputs();
    for (const mode of ["stale", "missing", "answer"] as const) {
      const trusted = structuredClone(v.trusted);
      if (mode === "missing") delete trusted.snapshot.provenance[Object.keys(trusted.snapshot.provenance)[0]];
      if (mode === "stale") for (const evidence of Object.values(trusted.snapshot.provenance)) { evidence.confirmedAt = "2026-09-01T00:00:00.000Z"; evidence.asOf = "2026-09-01"; }
      if (mode === "answer") { delete trusted.snapshot.details.county; delete trusted.snapshot.provenance.county; }
      const result = await renderSnapDirectCompletion(template, trusted, v.completion, now);
      expect(result.bytes).toBeNull();
      expect(JSON.stringify(result)).not.toMatch(/Private Canary|900000001|source.*parent/);
    }
  });

  it("keeps unsupported continuation, identifier exceptions and noncitizen document routes explicit", async () => {
    const continuation = await inputs(9);
    expect(await renderSnapDirectCompletion(template, continuation.trusted, continuation.completion, now)).toMatchObject({ bytes: null, readiness: { reason: "continuation_required" } });
    const v = await inputs(); v.completion.identifiers = [{ personId: v.completion.identifiers[0].personId, kind: "unresolved_exception" }];
    expect(await renderSnapDirectCompletion(template, v.trusted, v.completion, now)).toMatchObject({ bytes: null, readiness: { reason: "identifier_rule_unresolved" } });
    v.trusted.snapshot.details.household![0].citizen = false;
    expect(await renderSnapDirectCompletion(template, v.trusted, v.completion, now)).toMatchObject({ bytes: null, readiness: { reason: "noncitizen_document_route_unresolved" } });
  });

  it("does not truncate a sixth income row or promote the lack of a mapping to ineligibility", async () => {
    const v = await inputs(), details = v.trusted.snapshot.details;
    details.income = { month: "2026-11", hasIncome: true, entries: Array.from({ length: 6 }, (_, i) => ({
      id: `22222222-2222-4222-8222-${String(i + 1).padStart(12, "0")}`, personId: details.household![0].id,
      source: "Employment", amount: 1, frequency: "Daily", status: "received", date: "2026-11-03",
    })) };
    v.trusted.snapshot = snapApplicationSnapshotSchema.parse(fixtureSnapSnapshot(preparedAt, details));
    expect(await renderSnapDirectCompletion(template, v.trusted, v.completion, now)).toMatchObject({ bytes: null, readiness: { reason: "continuation_required" } });
  });

  it("uses the genuine reported completion's Eastern date rather than preparation time or UTC date", async () => {
    const v = await inputs();
    for (const act of v.completion.certifications) { act.startedAt = "2026-11-05T00:01:00.000Z"; act.completedAt = "2026-11-05T00:02:00.000Z"; }
    expect((await renderSnapDirectCompletion(template, v.trusted, v.completion, new Date("2026-11-05T00:03:00.000Z"))).bytes).not.toBeNull();
    v.completion.certifications[0].date = "2026-11-05";
    expect(await renderSnapDirectCompletion(template, v.trusted, v.completion, new Date("2026-11-05T00:03:00.000Z"))).toMatchObject({ bytes: null, readiness: { reason: "invalid_completion" } });
  });

  it.each(["mark_or_witness", "representative"] as const)("does not invent the %s signing route", async route => {
    const v = await inputs(); v.completion.signingRoute = route;
    expect(await renderSnapDirectCompletion(template, v.trusted, v.completion, now)).toMatchObject({ bytes: null, readiness: { reason: "personal_act_route_unresolved" } });
  });
  it("does not treat representative contact details as designation or signing authority", async () => {
    const v = await inputs(), details = v.trusted.snapshot.details;
    details.authorizedRepresentative = { name: "Representative Synthetic", phone: "215-555-0100", address: { street: "2 Synthetic Street", city: "Philadelphia", state: "PA", zip: "19104" } };
    v.trusted.snapshot = snapApplicationSnapshotSchema.parse(fixtureSnapSnapshot(preparedAt, details));
    expect(await renderSnapDirectCompletion(template, v.trusted, v.completion, now)).toMatchObject({ bytes: null, readiness: { reason: "personal_act_route_unresolved" } });
  });

  it.each([
    ["missing act", (v: Inputs) => { v.completion.certifications.pop(); }],
    ["duplicated act", (v: Inputs) => { v.completion.certifications[1].actId = v.completion.certifications[0].actId; }],
    ["drawing before exact copy", (v: Inputs) => { v.completion.certifications[0].startedAt = "2026-11-04T21:58:59.000Z"; }],
    ["reversed times", (v: Inputs) => { v.completion.certifications[0].completedAt = "2026-11-04T21:59:01.000Z"; }],
    ["future act", (v: Inputs) => { v.completion.certifications[0].completedAt = "2026-11-04T22:00:01.000Z"; }],
    ["wrong act date", (v: Inputs) => { v.completion.certifications[0].date = "2026-11-03"; }],
    ["impossible date", (v: Inputs) => { v.completion.certifications[0].date = "2026-02-30"; }],
    ["negative coordinate", (v: Inputs) => { v.completion.certifications[0].strokes[0][0].x = -0.1; }],
    ["outside coordinate", (v: Inputs) => { v.completion.certifications[0].strokes[0][0].y = 1.1; }],
    ["nonfinite coordinate", (v: Inputs) => { v.completion.certifications[0].strokes[0][0].x = Infinity; }],
    ["empty mark", (v: Inputs) => { v.completion.certifications[0].strokes = []; }],
    ["stationary mark", (v: Inputs) => { v.completion.certifications[0].strokes = [[{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }]]; }],
    ["excess points", (v: Inputs) => { v.completion.certifications[0].strokes = [Array.from({ length: 513 }, (_, i) => ({ x: i / 513, y: 0.5 }))]; }],
    ["aggregate points", (v: Inputs) => { v.completion.certifications[0].strokes = Array.from({ length: 5 }, () => Array.from({ length: 512 }, (_, i) => ({ x: i / 512, y: 0.5 }))); }],
    ["excess strokes", (v: Inputs) => { v.completion.certifications[0].strokes = Array.from({ length: 17 }, () => [{ x: 0, y: 0 }, { x: 1, y: 1 }]); }],
    ["unbounded extra private text", (v: Inputs) => { Object.assign(v.completion, { note: "PRIVATE_INPUT_CANARY" }); }],
    ["not a numeric identifier", (v: Inputs) => { v.completion.identifiers[0] = { personId: v.completion.identifiers[0].personId, kind: "ssn", value: "PRIVATE_INPUT_CANARY" }; }],
  ])("rejects %s with a fixed content-free disposition", async (_label, mutate) => {
    const v = await inputs(); mutate(v);
    const result = await renderSnapDirectCompletion(template, v.trusted, v.completion, now);
    expect(result).toMatchObject({ bytes: null, readiness: { reason: "invalid_completion" } });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_INPUT_CANARY|900000001|strokes|21:59/);
  });

  it("rejects wrong source bytes/source metadata without diagnostics", async () => {
    const v = await inputs(), changed = Uint8Array.from(template); changed[100] ^= 1;
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")].map(spy => spy.mockImplementation(() => {}));
    try {
      expect((await renderSnapDirectCompletion(changed, v.trusted, v.completion, now)).bytes).toBeNull();
      expect((await renderSnapDirectCompletion(template.subarray(0, -1), v.trusted, v.completion, now)).bytes).toBeNull();
      expect((await renderSnapDirectCompletion(template, v.trusted, { ...v.completion, source: { ...v.completion.source, inventorySha256: "f".repeat(64) } }, now)).bytes).toBeNull();
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally { for (const spy of spies) spy.mockRestore(); }
  });

  it.skipIf(!process.env.CASELINK_PYTHON_BIN)("proves source/known glyphs, all applicant fields, blank excluded regions and exact outside pixels", async () => {
    const directory = resolve("tmp/parent-verification/snap-direct-completion-initial-filing"); mkdirSync(directory, { recursive: true });
    for (const [name, count, nonapplicant] of [["mixed", 3, 1], ["eight", 8, -1], ["deferred", 3, 1]] as const) {
      const v = await inputs(count, nonapplicant);
      if (name === "deferred") v.completion.identifiers[1] = { personId: v.completion.identifiers[1].personId, kind: "provide_to_agency_later" };
      const result = await renderSnapDirectCompletion(template, v.trusted, v.completion, now);
      expect(result.bytes).not.toBeNull(); writeFileSync(`${directory}/${name}-unsigned.pdf`, v.unsigned!); writeFileSync(`${directory}/${name}.pdf`, result.bytes!);
    }
    const script = String.raw`
import sys,json
from pathlib import Path
from collections import Counter
import pdfplumber
import pypdfium2 as pdfium
from PIL import ImageDraw
d=Path(sys.argv[1]); glyph_pages=0; outside_pages=0; blank_rows=0; field_checks=0
def glyphs(p): return Counter((c['text'],round(c['x0'],3),round(c['top'],3),round(c['x1'],3),round(c['bottom'],3)) for c in p.chars)
def box_pixels(image,box):
 x0,y0,x1,y1=box
 return image.crop((round(x0*2),round((792-y1)*2),round(x1*2),round((792-y0)*2))).tobytes()
ssn=[(444,305-i*23.4,519,320-i*23.4) for i in range(8)]
regions={2:ssn+[(94,55,343,70),(407,55,519,70)],6:[(33,309,259,334),(270,309,341,334)]}
for name,applicants in [('mixed',[0,2]),('eight',list(range(8))),('deferred',[0])]:
 with pdfplumber.open(d/(name+'-unsigned.pdf')) as before,pdfplumber.open(d/(name+'.pdf')) as after:
  assert len(before.pages)==len(after.pages)==12
  for a,b in zip(before.pages,after.pages):
   assert (a.width,a.height)==(b.width,b.height)==(612,792)
   assert not glyphs(a)-glyphs(b),'source or known glyph removed/moved'
   glyph_pages+=1
  for row in range(8):
   x0,y0,x1,y1=ssn[row]
   text=' '.join(w['text'] for w in after.pages[2].crop((x0,792-y1,x1,792-y0)).extract_words())
   assert text==(f'90000000{applicants.index(row)+1}' if row in applicants else ''),'wrong applicant-only identifier field'
   field_checks+=1
  for index,box in [(2,(407,55,519,70)),(6,(270,309,341,334))]:
   x0,y0,x1,y1=box
   assert ' '.join(w['text'] for w in after.pages[index].crop((x0,792-y1,x1,792-y0)).extract_words())=='11/04/2026'
   field_checks+=1
 a=pdfium.PdfDocument(d/(name+'-unsigned.pdf')); b=pdfium.PdfDocument(d/(name+'.pdf'))
 for index in range(12):
  original=a[index].render(scale=2).to_pil().convert('RGB'); output=b[index].render(scale=2).to_pil().convert('RGB')
  if index==2:
   for row in range(8):
    if row not in applicants: assert box_pixels(original,ssn[row])==box_pixels(output,ssn[row]); blank_rows+=1
  if index==6:
   for box in [(351,309,580,334),(31,251,581,292)]: assert box_pixels(original,box)==box_pixels(output,box)
  for box in regions.get(index,[]):
   x0,y0,x1,y1=box; rect=(int(x0*2),int((792-y1)*2),int(x1*2+1),int((792-y0)*2+1))
   ImageDraw.Draw(original).rectangle(rect,fill='white'); ImageDraw.Draw(output).rectangle(rect,fill='white')
  assert original.tobytes()==output.tobytes(),'change outside permitted regions'
  outside_pages+=1
 for index in [2,6]: b[index].render(scale=2).to_pil().save(d/(name+f'-page-{index+1}.png'))
print(json.dumps({'cases':3,'sourceAndKnownGlyphPages':glyph_pages,'outsideRegionPixelPages':outside_pages,'blankDeferredNonapplicantOrUnusedRows':blank_rows,'exactProtectedTextFields':field_checks}))
`;
    const result = JSON.parse(execFileSync(process.env.CASELINK_PYTHON_BIN!, ["-c", script, directory], { encoding: "utf8", timeout: 30000, maxBuffer: 100000 }));
    expect(result).toEqual({ cases: 3, sourceAndKnownGlyphPages: 36, outsideRegionPixelPages: 36, blankDeferredNonapplicantOrUnusedRows: 13, exactProtectedTextFields: 30 });
    writeFileSync(`${directory}/verification.json`, JSON.stringify({ passed: true, ...result }, null, 2));
  }, 30000);
});
