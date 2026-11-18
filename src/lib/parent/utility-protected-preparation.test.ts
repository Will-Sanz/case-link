import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { fixtureMandate } from "./test-fixtures";
import { createPecoUtilityPreparationRenderer } from "./utility-application-preparation";
import type { UtilityProtectedApplicationContext } from "./utility-protected-client";
import { utilityProtectedBindingSchema, UTILITY_PROTECTED_INPUT_FORMAT, type UtilityProtectedBinding } from "./utility-protected-input-contract";
import { PECO_APPLICATION_SOURCE, PECO_APPLICATION_NOTICE_VERSION, PECO_ACCOUNT_AUTHORITY_STATEMENT, PECO_SUBJECT_AUTHORITY_STATEMENT, pecoApplicationLeaves } from "./peco-application-fields";
import { PGW_APPLICATION_SOURCE, PGW_APPLICATION_NOTICE_VERSION, PGW_ACCOUNT_AUTHORITY_STATEMENT, PGW_SUBJECT_AUTHORITY_STATEMENT, pgwApplicationLeaves } from "./pgw-application-fields";
import { WATER_APPLICATION_REFERENCE, WATER_APPLICATION_NOTICE_VERSION, WATER_ACCOUNT_AUTHORITY_STATEMENT, WATER_SUBJECT_AUTHORITY_STATEMENT, waterApplicationLeaves } from "./water-application-fields";
import { UTILITY_INCOME_PROOF_VERSION } from "./utility-income-proof";
const privateClient = vi.hoisted(() => ({ withInput: vi.fn(), record: vi.fn(), validate: vi.fn() }));
vi.mock("./utility-protected-client", () => ({ withUtilityProtectedInput: privateClient.withInput, recordUtilityProtectedIncomeValidation: privateClient.record }));
vi.mock("./utility-income-proof", async original => ({ ...await original<typeof import("./utility-income-proof")>(), validateUtilityIncomeProof: privateClient.validate }));
import { utilityIncomeProofContext, validateStoredUtilityIncomeProof } from "./utility-protected-preparation";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-11-13T22:30:00Z", expiry = "2026-11-13T22:35:00Z";
function fixture(programId: UtilityProtectedBinding["programId"]) {
  const person = { id: id(6), firstName: "Synthetic", lastName: "Parent", income: { state: "sources" as const, sources: [{ id: id(7), kind: "employment" as const }] } };
  const details = programId === "peco-cap" ? { journey: "new_enrollment", currentCapState: "not_enrolled", householdComplete: true, householdMembers: [], accountNumber: "9000000001", applicant: { ...person, dateOfBirth: "1990-01-01" }, address: { street: "1 Synthetic Lane", city: "Philadelphia", state: "PA", zip: "19147" } }
    : programId === "pgw-crp" ? { accountNumber: "TEST-PGW", customer: { ...person, under18: false } }
    : { applicant: { id: person.id, name: "Synthetic Parent", income: person.income } };
  const source = programId === "peco-cap" ? PECO_APPLICATION_SOURCE : programId === "pgw-crp" ? PGW_APPLICATION_SOURCE : WATER_APPLICATION_REFERENCE;
  const notice = programId === "peco-cap" ? PECO_APPLICATION_NOTICE_VERSION : programId === "pgw-crp" ? PGW_APPLICATION_NOTICE_VERSION : WATER_APPLICATION_NOTICE_VERSION;
  const leaves = programId === "peco-cap" ? pecoApplicationLeaves(details) : programId === "pgw-crp" ? pgwApplicationLeaves(details) : waterApplicationLeaves(details);
  const snapshot = { id: id(5), request_id: id(4), revision: 1, base_version: 1, request_version: 2, details, source,
    provenance: Object.fromEntries(Object.keys(leaves).map(path => [path, { source: "parent", confirmedAt: at, asOf: "2026-11-13" }])),
    consent_evidence: { subjectAuthorityDeclared: true, subjectStatement: programId === "peco-cap" ? PECO_SUBJECT_AUTHORITY_STATEMENT : programId === "pgw-crp" ? PGW_SUBJECT_AUTHORITY_STATEMENT : WATER_SUBJECT_AUTHORITY_STATEMENT,
      accountAuthorityDeclared: true, accountStatement: programId === "peco-cap" ? PECO_ACCOUNT_AUTHORITY_STATEMENT : programId === "pgw-crp" ? PGW_ACCOUNT_AUTHORITY_STATEMENT : WATER_ACCOUNT_AUTHORITY_STATEMENT,
      actorId: id(3), accountAuthority: "self", noticeVersion: notice, declaredAt: at, revision: 1, detailsSha256: "a".repeat(64),
      subjects: [`${programId === "pgw-crp" ? "customer" : "applicant"}.${person.id}`], ...(programId !== "pwd-tap" ? { accountNumberSha256: createHash("sha256").update(details.accountNumber!).digest("hex") } : {}) },
    notice_version: notice, created_at: at, idempotency_key: id(8) };
  const binding = utilityProtectedBindingSchema.parse({ format: UTILITY_PROTECTED_INPUT_FORMAT, inputId: id(1), authorizationId: id(2), ownerId: id(3), requestId: id(4), requestVersion: 2,
    programId, need: programId === "peco-cap" ? "electricity" : programId === "pgw-crp" ? "gas" : "water", snapshotId: id(5), snapshotRevision: 1, snapshotHash: "a".repeat(64), purpose: "income_proof",
    targets: [{ subjectId: id(6), sourceId: id(7), field: "income" }], policyVersion: "test-1", retentionPolicyVersion: "test-1", mediaType: "application/pdf", byteLength: 100,
    contentDigest: "f".repeat(64), consentedAt: at, expiresAt: expiry, accountReference: null });
  return { snapshot, binding };
}
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-13T22:31:00Z")); });
afterEach(() => vi.useRealTimers());
describe("trusted private employment source resolution", () => {
  it.each(["peco-cap", "pgw-crp", "pwd-tap"] as const)("resolves the exact %s person and stable source without collecting identifiers", program => {
    const { binding, snapshot } = fixture(program);
    expect(utilityIncomeProofContext(binding, snapshot)).toEqual({ programId: program, subjectId: id(6), sourceId: id(7), subjectNames: ["Synthetic Parent"], sourceKind: "employment" });
  });
  it.each(["owner", "snapshot", "source", "subject", "purpose", "multiple-targets", "unsupported-kind"])("rejects %s before extracting or recording source fields", problem => {
    const { binding, snapshot } = fixture("peco-cap");
    if (problem === "owner") binding.ownerId = id(99);
    if (problem === "snapshot") binding.snapshotHash = "c".repeat(64);
    if (problem === "source") binding.targets[0].sourceId = id(99);
    if (problem === "subject") binding.targets[0].subjectId = id(99);
    if (problem === "purpose") binding.purpose = "required_identifier";
    if (problem === "multiple-targets") binding.targets.push({ ...binding.targets[0], sourceId: id(99) });
    if (problem === "unsupported-kind") (snapshot.details as { applicant: { income: { sources: { kind: string }[] } } }).applicant.income.sources[0].kind = "pension";
    expect(() => utilityIncomeProofContext(binding, snapshot)).toThrow(); expect(privateClient.validate).not.toHaveBeenCalled(); expect(privateClient.record).not.toHaveBeenCalled();
  });
  it("uses only the isolated reader result and the original consent expiry for repeated validation", async () => {
    const { binding, snapshot } = fixture("peco-cap"), bytes = new Uint8Array(100);
    privateClient.withInput.mockImplementation(async (_id, _options, run) => run({ binding, snapshot, bytes, signal: undefined }));
    const projection = { version: UTILITY_INCOME_PROOF_VERSION, programId: "peco-cap", subjectId: id(6), sourceId: id(7), proofKind: "pay_stub", originalSha256: "e".repeat(64), currency: "USD", grossCents: 150000,
      periodStart: "2026-11-01", periodEnd: "2026-11-07", issuedOn: "2026-11-08", payFrequency: "weekly", subjectMatch: "printed_name_matches_authorized_target", sourceEvidence: [] };
    privateClient.validate.mockResolvedValue({ status: "source_fields_checked", projection, proofComplete: false, authenticity: "not_established" });
    const { format: _, need: __, policyVersion: ___, retentionPolicyVersion: ____, mediaType: _____, byteLength: ______, contentDigest: _______, ...reference } = binding;
    void _; void __; void ___; void ____; void _____; void ______; void _______;
    privateClient.record.mockResolvedValue({ ...reference, state: "stored", validation: { id: id(9), validatorVersion: UTILITY_INCOME_PROOF_VERSION, validatedAt: at, expiresAt: expiry } });
    const options = { connectionString: "never-opened-by-this-unit-test", deadline: new Date() };
    for (let repeat = 0; repeat < 2; repeat++) {
      const result = await validateStoredUtilityIncomeProof(id(1), options); expect(result.validation?.expiresAt).toBe(expiry);
      expect(privateClient.record).toHaveBeenLastCalledWith(id(1), projection, expiry, options);
    }
    expect(privateClient.validate.mock.calls[0][0]).toMatchObject({ bytes, mediaType: "application/pdf", context: { subjectNames: ["Synthetic Parent"] } });
    privateClient.validate.mockResolvedValue({ status: "needs_service_validation", reason: "unsupported-layout", proofComplete: false });
    await expect(validateStoredUtilityIncomeProof(id(1), options)).rejects.toThrow("The protected utility information could not be verified.");
    expect(privateClient.record).toHaveBeenCalledTimes(2);
  });
});

it("prepares the real pinned unsigned PECO form through the owned renderer, without a fictional label or proof claim", async () => {
  const { binding, snapshot } = fixture("peco-cap");
  const context = { ownerId: binding.ownerId, householdId: id(9), accountAuthority: "self", grantExpiresAt: expiry, requestId: binding.requestId, requestVersion: binding.requestVersion, programId: binding.programId, need: binding.need, snapshot,
    mandate: fixtureMandate({ mode: "prepare_only", recipientIds: ["peco-cap"], allowedActions: ["research", "prepare"], allowedData: ["household", "income", "utility", "documents"], expiresAt: expiry }), sourceExpiresAt: expiry, approvalExpiresAt: expiry } as UtilityProtectedApplicationContext;
  const render = createPecoUtilityPreparationRenderer(readFileSync("tests/fixtures/parent/peco-cap-2026.pdf"));
  const options = { connectionString: "unused-with-no-proofs", deadline: new Date("2026-11-13T22:31:20Z") };
  const result = await render({ context, references: [], options });
  expect(result?.source).toMatchObject({ kind: "official_public_form", id: PECO_APPLICATION_SOURCE.contractId, sha256: PECO_APPLICATION_SOURCE.sourceSha256 });
  expect(result?.expiresAt).toBe("2026-11-13T22:35:00.000Z"); expect(result?.inputs).toEqual([]);
  expect((await PDFDocument.load(result!.bytes)).getPageCount()).toBe(2);
  await expect(render({ context: { ...context, ownerId: id(99) }, references: [], options })).rejects.toThrow();
  await expect(render({ context: { ...context, programId: "pgw-crp" }, references: [], options })).rejects.toThrow();
  expect(await render({ context: { ...context, snapshot: { ...context.snapshot, details: {}, provenance: {}, consent_evidence: { ...snapshot.consent_evidence, subjects: [], accountNumberSha256: null } } }, references: [], options })).toBeNull();
});
