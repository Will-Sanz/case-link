import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PDFDocument, PDFArray, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWaterLocalTestPreparationRenderer, renderWaterLocalTestDraft, WATER_LOCAL_TEST_SOURCE } from "./water-local-test-preparation";
import { WATER_APPLICATION_REFERENCE, WATER_APPLICATION_NOTICE_VERSION, WATER_SUBJECT_AUTHORITY_STATEMENT, WATER_ACCOUNT_AUTHORITY_STATEMENT, waterApplicationLeaves } from "./water-application-fields";
import { waterApplicationSnapshotSchema } from "./water-application-snapshot";
import { utilityProtectedBindingSchema, utilityProtectedInputReferenceSchema } from "./utility-protected-input-contract";
import { fixtureMandate } from "./test-fixtures";
import type { UtilityPreparedRenderer } from "./utility-prepared-artifact-client";
import type { withUtilityProtectedInput } from "./utility-protected-client";

const ports = vi.hoisted(() => ({ read: vi.fn<typeof withUtilityProtectedInput>(), proofs: vi.fn() }));
vi.mock("./utility-protected-client", async load => ({ ...await load<typeof import("./utility-protected-client")>(), withUtilityProtectedInput: ports.read }));
vi.mock("./utility-preparation-pdf", () => ({ appendUtilityPreparationProofs: ports.proofs }));
const now = new Date("2026-11-13T22:20:00.000Z"), source = readFileSync("tests/fixtures/parent/water-local-test-issued-2026-11-13.pdf");
const owner = "11111111-1111-4111-8111-111111111111", household = "22222222-2222-4222-8222-222222222222", requestId = "33333333-3333-4333-8333-333333333333";
const applicant = "44444444-4444-4444-8444-444444444444", snapshotId = "55555555-5555-4555-8555-555555555555", inputId = "66666666-6666-4666-8666-666666666666";
const authorizationId = "77777777-7777-4777-8777-777777777777", childId = "88888888-8888-4888-8888-888888888888", accountReference = "99999999-9999-4999-8999-999999999999";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function setup() {
  const details = { journey: "new_application", existingApplication: "none_known", preferredChannel: "online", householdComplete: true,
    applicant: { id: applicant, name: "FictionalWater Applicant", dateOfBirth: "1990-01-01", grossMonthlyIncome: "0.00", income: { state: "none", sources: [] } },
    propertyAddress: "123 Synthetic Water Lane, Philadelphia PA 19104", phone: "215-555-0101",
    householdMembers: [{ id: childId, name: "FictionalWater Child", dateOfBirth: "2020-01-01", relationship: "Child" }],
    childSupportReceived: "no", outsideIncomeSupport: "no", livingExpenses: { food: "Prior savings for food", housing: "Prior savings for housing", utilities: "Prior savings for utilities" } };
  const snapshot = waterApplicationSnapshotSchema.parse({ id: snapshotId, request_id: requestId, revision: 1, base_version: 1, request_version: 2, details,
    provenance: Object.fromEntries(Object.keys(waterApplicationLeaves(details)).map(path => [path, { source: "parent", confirmedAt: now.toISOString(), asOf: "2026-11-13" }])),
    source: WATER_APPLICATION_REFERENCE, notice_version: WATER_APPLICATION_NOTICE_VERSION, created_at: now.toISOString(), idempotency_key: owner,
    consent_evidence: { subjectAuthorityDeclared: true, subjectStatement: WATER_SUBJECT_AUTHORITY_STATEMENT, accountAuthorityDeclared: true,
      accountStatement: WATER_ACCOUNT_AUTHORITY_STATEMENT, accountAuthority: "self", actorId: owner, noticeVersion: WATER_APPLICATION_NOTICE_VERSION,
      declaredAt: now.toISOString(), revision: 1, detailsSha256: "a".repeat(64), subjects: [`applicant.${applicant}`, `householdMembers.${childId}`] } });
  const reference = utilityProtectedInputReferenceSchema.parse({ inputId, authorizationId, ownerId: owner, requestId, requestVersion: 2, programId: "pwd-tap", snapshotId, snapshotRevision: 1,
    snapshotHash: snapshot.consent_evidence.detailsSha256, purpose: "account_access", targets: [{ subjectId: applicant, sourceId: null, field: "water_access_code" }],
    state: "stored", consentedAt: now.toISOString(), expiresAt: "2026-11-13T22:21:00.000Z", accountReference, validation: null });
  const input: Parameters<UtilityPreparedRenderer>[0] = { context: { ownerId: owner, householdId: household, accountAuthority: "self", grantExpiresAt: "2026-11-13T22:30:00.000Z",
    requestId, requestVersion: 2, programId: "pwd-tap", need: "water", snapshot,
    mandate: fixtureMandate({ recipientIds: ["pwd-tap"], allowedActions: ["research", "prepare"], allowedData: ["household", "income", "utility", "documents"], mode: "prepare_only", expiresAt: "2026-11-13T22:30:00.000Z" }),
    sourceExpiresAt: WATER_APPLICATION_REFERENCE.verifiedUntil, approvalExpiresAt: "2026-11-13T22:30:00.000Z" }, references: [reference],
    options: { connectionString: "fictional-private-test-port", deadline: new Date(now.getTime() + 30000) } };
  const scalar = { purpose: "account_access" as const, accessCode: "000123456", zip: "19104" };
  const raw = { binding: utilityProtectedBindingSchema.parse({ ...Object.fromEntries(Object.entries(reference).filter(([key]) => !["state", "validation"].includes(key))),
    accountReference: null, format: "caselink-utility-protected-input-v1", need: "water", policyVersion: "test.v1", retentionPolicyVersion: "test.v1",
    mediaType: "application/octet-stream", byteLength: JSON.stringify(scalar).length, contentDigest: "b".repeat(64) }), snapshot: structuredClone(snapshot), bytes: new TextEncoder().encode(JSON.stringify(scalar)) };
  return { input, raw, scalar };
}
let test: ReturnType<typeof setup>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); test = setup(); ports.read.mockReset(); ports.proofs.mockReset();
  ports.read.mockImplementation(async (_id, _options, action) => action(test.raw));
  ports.proofs.mockImplementation(async bytes => ({ bytes: Uint8Array.from(bytes), inputs: [], expiresAt: null }));
});
afterEach(() => vi.useRealTimers());
const render = () => createWaterLocalTestPreparationRenderer(source)(test.input);
describe("CaseLink LOCAL TEST WATER private preparation", () => {
  it("uses only its exact new local template and opaque account binding; never the City SAMPLE hash", async () => {
    expect(hash(source)).toBe(WATER_LOCAL_TEST_SOURCE.sha256); expect(source.length).toBe(WATER_LOCAL_TEST_SOURCE.byteLength);
    expect(hash(source)).not.toBe(WATER_APPLICATION_REFERENCE.sampleSha256);
    const output = await render(); expect(output?.source).toEqual({ kind: "local_test_issued_form", id: "caselink-local-water-issued-form", version: "local-test-v1",
      sha256: WATER_LOCAL_TEST_SOURCE.sha256, rendererVersion: "local-water-test-v1" });
    expect(output?.inputs).toEqual([{ inputId, authorizationId, validationId: null }]); expect(output?.expiresAt).toBe(test.input.references[0].expiresAt);
    expect(JSON.stringify({ ...output, bytes: undefined })).not.toMatch(/000123456|FictionalWater|Synthetic Water Lane/);
    expect(ports.read.mock.calls[0][1]).toBe(test.input.options); expect(ports.read.mock.calls[0][3]).toBeUndefined(); expect(ports.proofs.mock.calls[0][3]).toBe(test.input.options);
  });
  it("retains original lifetimes and accepts unchanged private facts at a newer owned request version without file permission", async () => {
    test.input.context.requestVersion = 3; test.input.references[0].requestVersion = 3; test.raw.binding.requestVersion = 3;
    test.input.context.mandate.allowedData = ["household", "income", "utility"];
    expect((await render())?.expiresAt).toBe("2026-11-13T22:21:00.000Z");
  });
  it("uses an existing-application recovery scalar only for that exact saved journey, preserving leading zeroes and the earlier original deadline", async () => {
    test.input.context.snapshot.details.existingApplication = "saved"; test.raw.snapshot.details.existingApplication = "saved";
    const reference = { ...test.input.references[0], inputId: owner, authorizationId: household, purpose: "application_recovery" as const, accountReference: null,
      targets: [{ subjectId: applicant, sourceId: null, field: "water_application_recovery" as const }], expiresAt: "2026-11-13T22:20:45.000Z" };
    test.input.references.push(reference);
    ports.read.mockImplementation(async (id, _options, action) => action(id === inputId ? test.raw : { ...test.raw,
      binding: { ...test.raw.binding, inputId: reference.inputId, authorizationId: reference.authorizationId, purpose: reference.purpose, targets: reference.targets, expiresAt: reference.expiresAt },
      bytes: new TextEncoder().encode(JSON.stringify({ purpose: "application_recovery", applicationId: "0000123" })) }));
    const output = await render(); expect(output?.inputs).toHaveLength(2); expect(output?.expiresAt).toBe(reference.expiresAt);
    expect(ports.read.mock.calls.every(call => call[1] === test.input.options && call[3] === undefined)).toBe(true);
  });
  it("waits for missing account access, existing-application recovery or reference fields without inventing another application", async () => {
    test.input.references = []; expect(await render()).toBeNull(); expect(ports.read).not.toHaveBeenCalled();
    test = setup(); test.input.context.snapshot.details.existingApplication = "saved"; expect(await render()).toBeNull();
    test = setup(); delete test.input.context.snapshot.details.propertyAddress;
    delete (test.input.context.snapshot as unknown as { provenance: Record<string, unknown> }).provenance.propertyAddress;
    expect(await render()).toBeNull(); expect(ports.read).not.toHaveBeenCalled();
  });
  it.each(["owner", "authority", "request", "version", "program", "need", "mandate", "source", "approval", "grant"])("rejects a mismatched or expired %s context before plaintext", async change => {
    const context = test.input.context;
    if (change === "owner") context.ownerId = household;
    if (change === "authority") context.accountAuthority = "authorized_caregiver";
    if (change === "request") context.requestId = household;
    if (change === "version") context.requestVersion = 1;
    if (change === "program") context.programId = "pgw-crp";
    if (change === "need") context.need = "gas";
    if (change === "mandate") context.mandate.recipientIds = ["pgw-crp"];
    if (change === "source") context.sourceExpiresAt = now.toISOString();
    if (change === "approval") context.approvalExpiresAt = now.toISOString();
    if (change === "grant") context.grantExpiresAt = now.toISOString();
    await expect(render()).rejects.toEqual(new Error("The local test water preparation needs a service check.")); expect(ports.read).not.toHaveBeenCalled();
  });
  it.each(["subject", "source", "expired", "duplicate", "snapshot", "proofAccount"])("rejects an unrelated %s reference before plaintext", async change => {
    const reference = test.input.references[0];
    if (change === "subject") reference.targets[0].subjectId = childId;
    if (change === "source") reference.targets[0].sourceId = owner;
    if (change === "expired") reference.expiresAt = now.toISOString();
    if (change === "duplicate") test.input.references.push({ ...reference, inputId: owner });
    if (change === "snapshot") reference.snapshotId = owner;
    if (change === "proofAccount") test.input.references.push({ ...reference, inputId: owner, purpose: "residency_proof", accountReference: owner, targets: [{ subjectId: applicant, sourceId: null, field: "residency" }] });
    await expect(render()).rejects.toThrow("service check"); expect(ports.read).not.toHaveBeenCalled();
  });
  it.each(["accountAddress", "actor", "snapshot", "target", "expiry", "purpose", "malformed", "wrongScalar"])("rejects a substituted protected %s generically", async change => {
    if (change === "accountAddress") test.raw.snapshot.details.propertyAddress = "Another property";
    if (change === "actor") test.raw.snapshot.consent_evidence.actorId = household;
    if (change === "snapshot") test.raw.binding.snapshotId = household;
    if (change === "target") test.raw.binding.targets[0].subjectId = owner;
    if (change === "expiry") test.raw.binding.expiresAt = "2026-11-13T22:22:00.000Z";
    if (change === "purpose") test.raw.binding.purpose = "application_recovery";
    if (change === "malformed") test.raw.bytes = new TextEncoder().encode("{");
    if (change === "wrongScalar") test.raw.bytes = new TextEncoder().encode(JSON.stringify({ purpose: "application_recovery", applicationId: "00012" }));
    await expect(render()).rejects.toEqual(new Error("The local test water preparation needs a service check.")); expect(ports.proofs).not.toHaveBeenCalled();
  });
  it("copies caller fields/references/template before awaiting and keeps source-required unknown minor income as unknown", async () => {
    let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; });
    ports.read.mockImplementationOnce(async (_id, _options, action) => { await waiting; return action(test.raw); });
    const template = Uint8Array.from(source), renderer = createWaterLocalTestPreparationRenderer(template), pending = renderer(test.input);
    template.fill(0); test.input.context.snapshot.details.propertyAddress = "Changed"; test.input.references[0].targets[0].subjectId = owner; release();
    expect(await pending).not.toBeNull();
    const child = (ports.proofs.mock.calls[0][1].snapshot.details.householdMembers as { income?: unknown; grossMonthlyIncome?: unknown }[])[0];
    expect(child.income).toBeUndefined(); expect(child.grossMonthlyIncome).toBeUndefined();
  });
  it("labels appended proof pages as LOCAL TEST too and excludes them if original permission expires", async () => {
    ports.proofs.mockImplementationOnce(async bytes => { const pdf = await PDFDocument.load(bytes); pdf.addPage([612, 792]); return { bytes: await pdf.save(), inputs: [], expiresAt: null }; });
    const output = await render(), pdf = await PDFDocument.load(output!.bytes); expect(pdf.getPageCount()).toBe(2);
    const marker = Buffer.from("CASELINK LOCAL TEST WATER - NOT A CITY APPLICATION - NOT SENT").toString("hex").toUpperCase();
    for (const page of pdf.getPages()) {
      const content = page.node.lookup(PDFName.of("Contents"), PDFArray).asArray().map(ref => {
        const stream = pdf.context.lookup(ref); if (!(stream instanceof PDFRawStream)) throw new Error("Missing local-test page stream");
        return Buffer.from(decodePDFRawStream(stream).decode()).toString();
      }).join("\n");
      expect(content).toContain(marker);
    }
    ports.proofs.mockImplementationOnce(async bytes => { vi.setSystemTime(new Date("2026-11-13T22:21:00.000Z")); return { bytes: Uint8Array.from(bytes), inputs: [], expiresAt: null }; });
    await expect(render()).rejects.toThrow("service check");
  });
  it("fails closed if any other bytes are relabeled as the local template", async () => {
    await expect(createWaterLocalTestPreparationRenderer(source.subarray(1))(test.input)).rejects.toThrow("service check"); expect(ports.read).not.toHaveBeenCalled();
    await expect(renderWaterLocalTestDraft(source, test.input.context.snapshot.details, { access: { purpose: "application_recovery", applicationId: "1" } }, now)).rejects.toThrow("service check");
  });
});
