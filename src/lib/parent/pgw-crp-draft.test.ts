import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { renderFictionalPgwCrpDraft } from "./pgw-crp-draft";
import { fictionalPgwFields } from "./pgw-application-test-fixtures";
import { PGW_APPLICATION_SOURCE } from "./pgw-application-fields";
import { PGW_PREPARATION_ERROR } from "./pgw-application-preparation";
const template = readFileSync("tests/fixtures/parent/pgw-crp-2026-11-13.pdf"), now = new Date("2026-11-13T21:50:00Z");
const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const render = (fields: unknown = fictionalPgwFields()) => renderFictionalPgwCrpDraft(template, { kind: "fictional_offline_rehearsal", fields }, now);
describe("PGW official-form unsigned base draft", () => {
  it("pins exact public bytes and preserves all four original pages, including the blank page and published link", async () => {
    const result = await render(), pdf = await PDFDocument.load(result.bytes!);
    expect(hash(template)).toBe(PGW_APPLICATION_SOURCE.sourceSha256); expect(template.length).toBe(PGW_APPLICATION_SOURCE.sourceByteLength);
    expect(pdf.getPageCount()).toBe(4); expect(pdf.catalog.has(PDFName.of("AcroForm"))).toBe(false);
    let links = 0;
    for (const page of pdf.getPages()) {
      expect(page.getSize()).toEqual({ width: 612, height: 792 });
      for (const ref of page.node.lookupMaybe(PDFName.of("Annots"), PDFArray)?.asArray() ?? []) {
        const annotation = pdf.context.lookup(ref, PDFDict); expect(annotation.toString()).toContain("https://www.pgworks.com/customer-care/crp"); links++;
      }
    }
    expect(links).toBe(1); expect(result.manifest).toMatchObject({ requiredIdentifiersInserted: false, signed: false, financialAssentRecorded: false, submissionReady: false,
      subjectIds: [fictionalPgwFields().customer!.id, fictionalPgwFields().householdMembers![0].id], requiredIdentifierSubjects: [fictionalPgwFields().householdMembers![0].id] });
    expect(result.manifest?.artifactSha256).toBe(hash(result.bytes!));
  });
  it("returns grouped missing facts and no bytes for a partial draft", async () => {
    const result = await render({}); expect(result.bytes).toBeNull(); expect(result.manifest).toBeNull(); expect(result.formFieldsReady).toBe(false);
  });
  it("preserves overflow and the distinct protected requirement for every adult and child", async () => {
    const fields = fictionalPgwFields(); fields.householdMembers = Array.from({ length: 28 }, (_, index) => ({ ...fields.householdMembers![0], id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, firstName: `Fictional${index + 1}` }));
    const result = await render(fields); expect(result.manifest?.pageCount).toBe(6); expect(result.manifest?.requiredIdentifierSubjects).toHaveLength(28); expect(result.manifest?.subjectIds).toHaveLength(29);
  });
  it("includes actual adult no-income preparation notes without certifying the statement", async () => {
    const fields = fictionalPgwFields(); fields.customer!.income = { state: "none", sources: [], noIncomeSituation: "Unemployed and not eligible for unemployment" }; fields.zeroIncomePast30Days = true;
    fields.livingExpenses = { food: "Using savings", housing: "Using savings", utilities: "Using savings" };
    const result = await render(fields); expect(result.manifest?.pageCount).toBe(5); expect(result.manifest?.signed).toBe(false);
  });
  it("snapshots input, date and template before the first asynchronous PDF step", async () => {
    const fields = fictionalPgwFields(), source = Uint8Array.from(template), at = new Date(now), input = { kind: "fictional_offline_rehearsal", fields };
    const original = await render(fields), pending = renderFictionalPgwCrpDraft(source, input, at);
    fields.customer!.firstName = "Mutated"; fields.accountNumber = "Changed"; source.fill(0); at.setUTCFullYear(2099);
    const result = await pending; expect(result.manifest).toEqual(original.manifest); expect(hash(result.bytes!)).toBe(hash(original.bytes!));
  });
  it.each(["identifier", "signature", "source", "unrenderable"])("fails closed for %s without returning private content", async change => {
    const fields = fictionalPgwFields(); let input: unknown = { kind: "fictional_offline_rehearsal", fields }, source = template;
    if (change === "identifier") input = { kind: "fictional_offline_rehearsal", fields: { ...fields, householdMembers: [{ ...fields.householdMembers![0], idNumber: "private" }] } };
    if (change === "signature") input = { kind: "fictional_offline_rehearsal", fields: { ...fields, signature: "private" } };
    if (change === "source") source = Buffer.from(template.subarray(1));
    if (change === "unrenderable") fields.customer!.firstName = "🙂";
    await expect(renderFictionalPgwCrpDraft(source, input, now)).rejects.toEqual(new Error(PGW_PREPARATION_ERROR));
  });
});
