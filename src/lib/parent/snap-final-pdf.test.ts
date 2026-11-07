import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { degrees, PDFDocument, PDFName, PDFString } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SNAP_DRAFT_CONTRACT } from "./snap-draft";
import { inspectSnapFinalPdf } from "./snap-final-pdf";
import { renderSnapSigningCopy } from "./snap-signing-copy";
import { fixtureSnapApplication } from "./test-fixtures";

const sourceBytes = readFileSync("data/verified-forms/snap-pa600fs-2019.pdf"), now = new Date("2026-11-04T17:00:00Z");
const signing = await renderSnapSigningCopy(sourceBytes, fixtureSnapApplication(now), now);
if (!signing.bytes) throw new Error("The actual synthetic official signing-copy fixture must render.");
const positive = signing.bytes, canary = "SYNTHETIC_PRIVATE_PDF_CANARY", numericCanary = "123456789012345678901234567890";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const input = (bytes = positive) => ({ bytes, contentSha256: hash(bytes), byteLength: bytes.length,
  source: { templateId: SNAP_DRAFT_CONTRACT.id, templateVersion: SNAP_DRAFT_CONTRACT.version, templateSha256: SNAP_DRAFT_CONTRACT.sha256 } });
const options = () => ({ deadline: new Date(Date.now() + 15000) });
async function changed(change: (pdf: PDFDocument) => void) {
  const pdf = await PDFDocument.load(positive); change(pdf); return pdf.save({ useObjectStreams: false });
}
function rawPaper(probe: string, extra = "") {
  const objects = ["<< /Type /Catalog /Pages 2 0 R " + probe + " >>", "<< /Type /Pages /Count 12 /Kids [" + Array.from({ length: 12 }, (_, i) => `${i + 3} 0 R`).join(" ") + "] >>",
    ...Array.from({ length: 12 }, () => "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>")];
  let text = "%PDF-1.7\n"; const offsets = [0];
  for (const [i, object] of objects.entries()) { offsets.push(Buffer.byteLength(text)); text += `${i + 1} 0 obj\n${object}\nendobj\n`; }
  text += extra; const start = Buffer.byteLength(text);
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  return new TextEncoder().encode(text + `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${start}\n%%EOF\n`);
}

describe("isolated SNAP paper PDF structural checks only", () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("checks the actual synthetic official signing copy without promoting its unsigned role", async () => {
    const before = Uint8Array.from(positive), result = await inspectSnapFinalPdf(input(), options());
    expect(result).toEqual({ ok: true, scope: "structure_only", contentSha256: hash(positive), byteLength: positive.length, source: input().source,
      pageCount: 12, pageWidth: 612, pageHeight: 792, rotation: 0, userUnit: 1, staticContentChecked: true });
    expect(positive).toEqual(before);
    expect(signing.readiness).toMatchObject({ protectedIncomplete: true, submissionReady: false, kind: "unsigned_nonprotected_official_signing_copy" });
    expect(JSON.stringify(result)).not.toMatch(/signed|accepted|submitted|certified|PRIVATE|Rivera/);
  });
  it("freezes the exact binding and bytes before asynchronous parsing", async () => {
    const value = input(Uint8Array.from(positive)), expected = hash(positive), pending = inspectSnapFinalPdf(value, options());
    value.bytes.fill(0); value.contentSha256 = "a".repeat(64); value.source.templateId = "changed";
    expect(await pending).toMatchObject({ ok: true, contentSha256: expected });
  });
  it.each(["wrong_hash", "wrong_size", "wrong_source", "unknown_source", "extra_input", "empty", "oversized", "not_bytes"])("denies %s binding before parsing", async kind => {
    const value: Record<string, unknown> = input();
    if (kind === "wrong_hash") value.contentSha256 = "a".repeat(64);
    if (kind === "wrong_size") value.byteLength = positive.length - 1;
    if (kind === "wrong_source") value.source = { ...input().source, templateSha256: "b".repeat(64) };
    if (kind === "unknown_source") value.source = { ...input().source, secret: canary };
    if (kind === "extra_input") value.private = canary;
    if (kind === "empty") value.bytes = new Uint8Array();
    if (kind === "oversized") value.bytes = new Uint8Array(10 * 1024 * 1024 + 1);
    if (kind === "not_bytes") value.bytes = canary;
    expect(await inspectSnapFinalPdf(value, options())).toEqual({ ok: false, reason: "binding_mismatch" });
  });
  it.each(["text", "truncated", "missing_eof"])("rejects %s malformed input without echoing it", async kind => {
    const bytes = kind === "text" ? new TextEncoder().encode(canary) : kind === "truncated" ? positive.subarray(0, 80) : positive.subarray(0, positive.length - 8);
    expect(await inspectSnapFinalPdf(input(bytes), options())).toEqual({ ok: false, reason: "unreadable_pdf" });
  });
  it.each([11, 13])("rejects %s pages under this declared 12-page slice", async count => {
    const bytes = await changed(pdf => count === 11 ? pdf.removePage(11) : pdf.addPage([612, 792]));
    expect(await inspectSnapFinalPdf(input(bytes), options())).toEqual({ ok: false, reason: "unsupported_page_layout" });
  });
  it.each(["media", "crop", "bleed", "trim", "art", "rotation", "unit"])("reports unsupported %s layout as service metadata", async kind => {
    const bytes = await changed(pdf => {
      const page = pdf.getPage(0);
      if (kind === "media") page.setMediaBox(0, 0, 611, 792);
      if (kind === "crop") page.setCropBox(1, 0, 611, 792);
      if (kind === "bleed") page.setBleedBox(0, 0, 612, 791);
      if (kind === "trim") page.setTrimBox(0, 1, 612, 791);
      if (kind === "art") page.setArtBox(0, 0, 610, 790);
      if (kind === "rotation") page.setRotation(degrees(90));
      if (kind === "unit") page.node.set(PDFName.of("UserUnit"), pdf.context.obj(2));
    });
    expect(await inspectSnapFinalPdf(input(bytes), options())).toEqual({ ok: false, reason: "unsupported_page_layout" });
  });
  it.each(["OpenAction", "AA", "JavaScript", "JS", "Launch", "EmbeddedFiles", "EF", "AF", "AcroForm", "XFA", "RichMedia", "ByteRange", "OCProperties", "Collection"])("rejects %s even on an unreferenced dictionary", async key => {
    const bytes = await changed(pdf => { pdf.context.register(pdf.context.obj({ [key]: PDFString.of(canary) })); });
    expect(await inspectSnapFinalPdf(input(bytes), options())).toEqual({ ok: false, reason: "unsupported_content" });
  });
  it.each(["/Java#53cript (SYNTHETIC_PRIVATE_PDF_CANARY)", "/Probe /Launch", "/Probe << /Type /Action /S /GoTo >>", "/Probe << /Subtype /Widget >>", "/Probe << /Type /Filespec /F (private) >>"])("decodes unsafe names and nested action/file objects %#", async probe => {
    expect(await inspectSnapFinalPdf(input(rawPaper(probe)), options())).toEqual({ ok: false, reason: "unsupported_content" });
  });
  it("inspects a direct trailer catalog rather than only indirect objects", async () => {
    const bytes = new TextEncoder().encode(new TextDecoder().decode(rawPaper("")).replace("/Root 1 0 R", `/Root << /Type /Catalog /Pages 2 0 R /OpenAction << /S /JavaScript /JS (${canary}) >> >>`));
    expect(await inspectSnapFinalPdf(input(bytes), options())).toEqual({ ok: false, reason: "unsupported_content" });
  });
  it.each(["Named /N /Print", "GoTo /D [3 0 R /Fit]", "UnrecognizedAction"])("rejects untyped action dictionaries in outlines: %s", async action => {
    const bytes = rawPaper(`/Outlines << /First << /Title (${canary}) /A << /S /${action} >> >> >>`);
    expect(await inspectSnapFinalPdf(input(bytes), options())).toEqual({ ok: false, reason: "unsupported_content" });
  });
  it("rejects nonempty page annotations but permits an empty array and static text mentioning a name", async () => {
    const safe = await changed(pdf => { pdf.setTitle(`${canary} /JavaScript`); pdf.getPage(0).node.set(PDFName.of("Annots"), pdf.context.obj([])); });
    expect(await inspectSnapFinalPdf(input(safe), options())).toMatchObject({ ok: true });
    const annotated = await changed(pdf => { pdf.getPage(0).node.set(PDFName.of("Annots"), pdf.context.obj([pdf.context.obj({ Type: "Annot", Subtype: "Text", Contents: PDFString.of(canary) })])); });
    expect(await inspectSnapFinalPdf(input(annotated), options())).toEqual({ ok: false, reason: "unsupported_content" });
  });
  it("rejects encrypted trailers without returning parser details", async () => {
    const bytes = await changed(pdf => { pdf.context.trailerInfo.Encrypt = pdf.context.register(pdf.context.obj({ Filter: "Standard", V: 1, R: 2, O: PDFString.of(canary), U: PDFString.of(canary), P: -4 })); });
    expect(await inspectSnapFinalPdf(input(bytes), options())).toEqual({ ok: false, reason: "unreadable_pdf" });
  });
  it.each(["objects", "depth"])("bounds %s complexity inside the isolated worker", async kind => {
    const bytes = await changed(pdf => {
      if (kind === "objects") for (let i = 0; i < 20001; i++) pdf.context.register(PDFString.of("synthetic"));
      else { let object = pdf.context.obj({}); for (let i = 0; i < 101; i++) object = pdf.context.obj({ Probe: object }); pdf.context.register(object); }
    });
    expect(await inspectSnapFinalPdf(input(bytes), options())).toEqual({ ok: false, reason: "complexity_limit" });
  });
  it.each(["large_number", "invalid_object", "zero_object"])("contains %s parser diagnostics in the worker", async kind => {
    const bytes = rawPaper(kind === "large_number" ? `/Probe ${numericCanary}` : "", kind === "invalid_object" ? `15 0 obj\n@${canary}\nendobj\n` : kind === "zero_object" ? `0 0 obj\n<< /Probe (${canary}) >>\nendobj\n` : "");
    const warn = vi.spyOn(console, "warn"), log = vi.spyOn(console, "log"), error = vi.spyOn(console, "error");
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true), stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const result = await inspectSnapFinalPdf(input(bytes), options());
    expect(result).toEqual({ ok: false, reason: "unreadable_pdf" });
    expect(warn).not.toHaveBeenCalled(); expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
    expect(JSON.stringify([result, stdout.mock.calls, stderr.mock.calls])).not.toMatch(new RegExp(`${canary}|${numericCanary}`));
  });
  it.each([new Date("bad"), new Date(0)])("rejects an unusable deadline %s", async deadline => {
    expect(await inspectSnapFinalPdf(input(), { deadline })).toEqual({ ok: false, reason: "inspection_interrupted" });
  });
  it("bounds inspection time and supports cancellation without exposing the reason", async () => {
    const controller = new AbortController(); const pending = inspectSnapFinalPdf(input(), { ...options(), signal: controller.signal }); controller.abort(canary);
    expect(await pending).toEqual({ ok: false, reason: "inspection_interrupted" });
    expect(await inspectSnapFinalPdf(input(), { ...options(), signal: controller.signal })).toEqual({ ok: false, reason: "inspection_interrupted" });
    vi.useFakeTimers(); const timed = inspectSnapFinalPdf(input(), options()); vi.advanceTimersByTime(5000);
    expect(await timed).toEqual({ ok: false, reason: "inspection_interrupted" });
    expect(await inspectSnapFinalPdf(input(), { deadline: new Date(Date.now() + 30001) })).toEqual({ ok: false, reason: "inspection_interrupted" });
  });
  it("does not mistake matching paper geometry for official content or a completed application", async () => {
    const result = await inspectSnapFinalPdf(input(rawPaper("")), options());
    expect(result).toMatchObject({ ok: true, scope: "structure_only" });
    for (const claim of ["signed", "answersVerified", "submissionReady", "officialFormVerified"]) expect(result).not.toHaveProperty(claim);
  });
  it.skipIf(!process.env.CASELINK_PYTHON_BIN)("checks actual source geometry and renders every positive-fixture page with native PDFium", async () => {
    const directory = resolve("tmp/parent-verification/snap-final-pdf"); mkdirSync(directory, { recursive: true });
    writeFileSync(`${directory}/source.pdf`, sourceBytes); writeFileSync(`${directory}/synthetic-signing-copy.pdf`, positive);
    const script = String.raw`
import sys,json
from pathlib import Path
from pypdf import PdfReader
import pypdfium2 as pdfium
d=Path(sys.argv[1]);source=PdfReader(d/'source.pdf');candidate=PdfReader(d/'synthetic-signing-copy.pdf')
assert len(source.pages)==len(candidate.pages)==12
for original,page in zip(source.pages,candidate.pages):
 for name in ['mediabox','cropbox','bleedbox','trimbox','artbox']:
  assert list(getattr(original,name))==list(getattr(page,name))==[0,0,612,792]
 assert page.get('/Rotate',0)==0 and page.get('/UserUnit',1)==1
 assert not page.get('/Annots')
assert not candidate.is_encrypted
document=pdfium.PdfDocument(d/'synthetic-signing-copy.pdf');original=pdfium.PdfDocument(d/'source.pdf');rendered=[]
for index in range(len(document)):
 image=document[index].render(scale=1.5).to_pil();assert image.size==(918,1188)
 if original[index].render(scale=1.5).to_pil().convert('L').getextrema()[0]<100:assert image.convert('L').getextrema()[0]<100
 if index in [0,2,6,11]:image.save(d/f'synthetic-page-{index+1}.png')
 rendered.append(index)
print(json.dumps({'sourceGeometryPages':12,'candidateGeometryPages':12,'renderedPages':len(rendered),'width':612,'height':792}))
`;
    const result = JSON.parse(execFileSync(process.env.CASELINK_PYTHON_BIN!, ["-c", script, directory], { encoding: "utf8", timeout: 30000 }));
    expect(result).toEqual({ sourceGeometryPages: 12, candidateGeometryPages: 12, renderedPages: 12, width: 612, height: 792 });
    writeFileSync(`${directory}/verification.json`, JSON.stringify({ passed: true, syntheticOnly: true, structureOnly: true, ...result }, null, 2));
  }, 30000);
});
