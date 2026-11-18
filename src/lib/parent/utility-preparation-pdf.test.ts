import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import sharp from "sharp";
import { utilityProtectedBindingSchema, utilityProtectedInputReferenceSchema, UTILITY_PROTECTED_INPUT_FORMAT } from "./utility-protected-input-contract";
import type { UtilityProtectedApplicationContext } from "./utility-protected-client";
import { UTILITY_INCOME_PROOF_VERSION } from "./utility-income-proof";
const privateClient = vi.hoisted(() => ({ withInput: vi.fn(), readValidation: vi.fn(), validate: vi.fn() }));
vi.mock("./utility-protected-client", () => ({ withUtilityProtectedInput: privateClient.withInput, readUtilityProtectedIncomeValidation: privateClient.readValidation }));
vi.mock("./utility-protected-preparation", () => ({ validateStoredUtilityIncomeProof: privateClient.validate }));
import { appendUtilityPreparationProofs } from "./utility-preparation-pdf";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = "2026-11-13T22:31:00Z", consentedAt = "2026-11-13T22:30:00Z", expiry = "2026-11-13T22:35:00Z";
const options = () => ({ connectionString: "unused-unit-reader", deadline: new Date("2026-11-13T22:31:20Z") });
let original: Uint8Array, base: Uint8Array;
async function pdf(text: string) { const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica); pdf.addPage([612, 792]).drawText(text, { x: 36, y: 740, font, size: 12 }); return pdf.save(); }
function fixture() {
  const reference = utilityProtectedInputReferenceSchema.parse({ inputId: id(1), authorizationId: id(2), ownerId: id(3), requestId: id(4), requestVersion: 2, programId: "peco-cap", snapshotId: id(5), snapshotRevision: 1, snapshotHash: "a".repeat(64),
    purpose: "income_proof", targets: [{ subjectId: id(6), sourceId: id(7), field: "income" }], state: "stored", consentedAt, expiresAt: expiry, accountReference: null,
    validation: { id: id(8), validatorVersion: UTILITY_INCOME_PROOF_VERSION, validatedAt: now, expiresAt: expiry } });
  const binding = utilityProtectedBindingSchema.parse({ ...Object.fromEntries(Object.entries(reference).filter(([key]) => !["state", "validation"].includes(key))),
    format: UTILITY_PROTECTED_INPUT_FORMAT, need: "electricity", policyVersion: "test-1", retentionPolicyVersion: "test-1", mediaType: "application/pdf", byteLength: original.length, contentDigest: "b".repeat(64) });
  const context = { ownerId: id(3), householdId: id(9), accountAuthority: "self", grantExpiresAt: expiry, need: "electricity", mandate: {}, sourceExpiresAt: expiry, approvalExpiresAt: expiry, requestId: id(4), requestVersion: 2, programId: "peco-cap", snapshot: { id: id(5), request_id: id(4), details: {}, source: {}, revision: 1, consent_evidence: { detailsSha256: "a".repeat(64) } } } as UtilityProtectedApplicationContext;
  return { reference, binding, context };
}
beforeEach(async () => {
  vi.clearAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(now));
  original = await pdf("SYNTHETIC ORIGINAL - PRIVATE CANARY 123-45-6789"); base = await pdf("UNSIGNED PREPARATION - NOT SENT");
  privateClient.withInput.mockImplementation(async (_id, _options, action) => { const { binding, context } = fixture(), copy = Uint8Array.from(original);
    try { return await action({ binding, snapshot: context.snapshot, bytes: copy }); } finally { copy.fill(0); } });
  privateClient.readValidation.mockImplementation(async () => ({ validationId: id(8), expiresAt: expiry, projection: { originalSha256: createHash("sha256").update(original).digest("hex"), grossCents: 150000, periodStart: "2026-11-01", periodEnd: "2026-11-07", issuedOn: "2026-11-08" } }));
});
afterEach(() => vi.useRealTimers());
describe("isolated unsigned utility supporting copies", () => {
  it("appends a safely flattened exact original with a truthful source-only cover and immutable input binding", async () => {
    const { reference, context } = fixture();
    const result = await appendUtilityPreparationProofs(base, context, [reference], options());
    expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(3);
    expect(result.inputs).toEqual([{ inputId: id(1), authorizationId: id(2), validationId: id(8) }]); expect(result.expiresAt).toBe("2026-11-13T22:35:00.000Z");
    expect(privateClient.validate).not.toHaveBeenCalled(); expect(original.some(value => value !== 0)).toBe(true);
  });
  it("checks a newly stored source automatically without a family validation click", async () => {
    const { reference, context } = fixture(); privateClient.validate.mockResolvedValue(reference);
    await appendUtilityPreparationProofs(base, context, [{ ...reference, validation: null }], options());
    expect(privateClient.validate).toHaveBeenCalledOnce(); expect(privateClient.validate.mock.calls[0][0]).toBe(reference.inputId);
  });
  it.each(["owner", "request", "version", "program", "snapshot", "revision", "hash", "expired", "superseded"])("rejects an altered %s reference before decryption", async problem => {
    const { reference, context } = fixture();
    if (problem === "owner") reference.ownerId = id(99); if (problem === "request") reference.requestId = id(99);
    if (problem === "version") reference.requestVersion++; if (problem === "program") reference.programId = "pgw-crp";
    if (problem === "snapshot") reference.snapshotId = id(99); if (problem === "revision") reference.snapshotRevision++;
    if (problem === "hash") reference.snapshotHash = "f".repeat(64); if (problem === "expired") reference.expiresAt = now;
    if (problem === "superseded") reference.state = "superseded";
    await expect(appendUtilityPreparationProofs(base, context, [reference], options())).rejects.toThrow(); expect(privateClient.withInput).not.toHaveBeenCalled();
  });
  it("does not attach an original whose bytes differ from the source checked by the trusted validator", async () => {
    const { reference, context } = fixture(); privateClient.readValidation.mockResolvedValue({ validationId: id(8), expiresAt: expiry, projection: { originalSha256: "f".repeat(64) } });
    await expect(appendUtilityPreparationProofs(base, context, [reference], options())).rejects.toThrow();
  });
  it("does not accept a substituted private authorization or validation", async () => {
    const { reference, context, binding } = fixture();
    privateClient.withInput.mockImplementation(async (_id, _options, action) => action({ binding: { ...binding, authorizationId: id(99) }, bytes: original }));
    await expect(appendUtilityPreparationProofs(base, context, [reference], options())).rejects.toThrow();
    privateClient.readValidation.mockResolvedValue({ validationId: id(99), expiresAt: expiry, projection: {} });
    await expect(appendUtilityPreparationProofs(base, context, [reference], options())).rejects.toThrow();
  });
  it("rejects active/rotated proof pages rather than silently attaching altered content", async () => {
    const { reference, context } = fixture(), changed = await PDFDocument.load(original); changed.getPage(0).setRotation(degrees(90)); original = await changed.save();
    await expect(appendUtilityPreparationProofs(base, context, [reference], options())).rejects.toThrow();
  });
  it("supports a protected residency image without calling it verified or exposing its bytes in metadata", async () => {
    original = await sharp({ create: { width: 30, height: 20, channels: 3, background: "white" } }).png().toBuffer();
    const { reference, context, binding } = fixture(); reference.purpose = "residency_proof"; reference.validation = null; reference.programId = "pwd-tap"; reference.targets = [{ subjectId: id(6), sourceId: null, field: "residency" }];
    context.programId = "pwd-tap";
    privateClient.withInput.mockImplementation(async (_id, _options, action) => action({ binding: { ...binding, purpose: reference.purpose, programId: reference.programId, targets: reference.targets, mediaType: "image/png" }, bytes: original }));
    const result = await appendUtilityPreparationProofs(base, context, [reference], options()); expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(3);
    expect(result.inputs[0].validationId).toBeNull(); expect(privateClient.readValidation).not.toHaveBeenCalled(); expect(JSON.stringify(result.inputs)).not.toContain("PRIVATE");
  });
  it("does not retain a scalar as a supporting document and stops before work after cancellation", async () => {
    const { reference, context } = fixture(); reference.purpose = "required_identifier";
    expect((await appendUtilityPreparationProofs(base, context, [reference], options())).inputs).toEqual([]); expect(privateClient.withInput).not.toHaveBeenCalled();
    reference.purpose = "income_proof";
    await expect(appendUtilityPreparationProofs(base, context, [reference], { ...options(), signal: AbortSignal.abort() })).rejects.toThrow();
  });
  it("bounds total private bytes and rejects duplicate input bindings", async () => {
    const { reference, context } = fixture();
    await expect(appendUtilityPreparationProofs(new Uint8Array(10 * 1024 * 1024 + 1), context, [], options())).rejects.toThrow();
    await expect(appendUtilityPreparationProofs(base, context, [reference, reference], options())).rejects.toThrow();
  });
});
