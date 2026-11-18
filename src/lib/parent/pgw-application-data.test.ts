import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";
import { PGW_APPLICATION_NOTICE_VERSION as notice, PGW_APPLICATION_SOURCE, PGW_ACCOUNT_AUTHORITY_STATEMENT, PGW_SUBJECT_AUTHORITY_STATEMENT } from "./pgw-application-fields";
const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("./auth", () => ({ requireParentSession: mocks.session }));
import { getPgwApplicationCollection, getPgwApplicationDetails, savePgwApplicationDetails, startPgwApplication } from "./pgw-application-data";
const requestId = "11111111-1111-4111-8111-111111111111", snapshotId = "22222222-2222-4222-8222-222222222222", key = "33333333-3333-4333-8333-333333333333";
const saved = {
  id: snapshotId, request_id: requestId, revision: 1, base_version: 1, request_version: 2,
  details: { journey: "recertification", currentCrpState: "enrolled" },
  provenance: Object.fromEntries(["journey", "currentCrpState"].map(field => [field, { source: "parent", confirmedAt: "2026-11-13T21:50:00+00:00", asOf: "2026-11-13" }])),
  source: PGW_APPLICATION_SOURCE, notice_version: notice, created_at: "2026-11-13T21:50:00+00:00", idempotency_key: key,
  consent_evidence: { subjectAuthorityDeclared: true, subjectStatement: PGW_SUBJECT_AUTHORITY_STATEMENT, accountAuthorityDeclared: true, accountStatement: PGW_ACCOUNT_AUTHORITY_STATEMENT,
    accountAuthority: "self", actorId: requestId, noticeVersion: notice, declaredAt: "2026-11-13T21:50:00+00:00", revision: 1, detailsSha256: "a".repeat(64), accountNumberSha256: null, subjects: [] },
};
const intake = () => fixtureIntake({ needs: ["gas"], householdSize: null, utilityProviders: ["pgw"], accountAuthority: "self" });
const mandate = () => fixtureMandate({ mode: "prepare_only", recipientIds: ["pgw-crp"], allowedActions: ["research", "prepare"], allowedData: ["household", "income", "utility"] });
const input = () => ({ expectedVersion: 2, details: saved.details, noticeVersion: notice, subjectAuthorityDeclared: true, accountAuthorityDeclared: true });
beforeEach(() => { mocks.rpc.mockResolvedValue({ data: snapshotId, error: null }); mocks.session.mockResolvedValue({ supabase: { rpc: mocks.rpc, from: mocks.from } }); });
describe("owned private PGW preparation data", () => {
  it("reads exactly the selected immutable revision", async () => {
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: saved, error: null }) };
    mocks.from.mockReturnValue(query);
    expect(await getPgwApplicationDetails(requestId, snapshotId)).toEqual(saved);
    expect(mocks.from).toHaveBeenCalledWith("parent_pgw_application_details");
    expect(query.eq.mock.calls).toEqual([["request_id", requestId], ["id", snapshotId]]); expect(mocks.rpc).not.toHaveBeenCalled();
    query.maybeSingle.mockResolvedValue({ data: null as unknown as typeof saved, error: null });
    expect(await getPgwApplicationDetails(requestId)).toBeNull();
  });
  it.each([{ provenance: {} }, { consent_evidence: { ...saved.consent_evidence, revision: 2 } }, { source: { ...PGW_APPLICATION_SOURCE, sourceSha256: "wrong" } },
    { details: { ssn: "123-45-6789" } }, { consent_evidence: { ...saved.consent_evidence, subjects: ["unrelated"] } },
    { consent_evidence: { ...saved.consent_evidence, accountNumberSha256: "b".repeat(64) } }])("rejects malformed saved private evidence safely", async override => {
    mocks.from.mockReturnValue({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { ...saved, ...override }, error: null }) });
    await expect(getPgwApplicationDetails(requestId)).rejects.toThrow("CaseLink could not load this information. Please try again.");
  });
  it("uses the locked versioned save with both exact declarations and returns only its reference", async () => {
    expect(await savePgwApplicationDetails(requestId, input(), key)).toBe(snapshotId);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("parent_save_pgw_application_details", {
      p_request_id: requestId, p_expected_version: 2, p_details: saved.details, p_notice_version: notice, p_idempotency_key: key, p_subject_authority_declared: true, p_account_authority_declared: true,
    }); expect(mocks.from).not.toHaveBeenCalled();
  });
  it.each([{ noticeVersion: "wic-application-details-2026-11-13.v1" }, { details: { accountNumber: "<private>" } }, { details: { customer: { id: key, ssn: "123-45-6789" } } },
    { subjectAuthorityDeclared: false }, { accountAuthorityDeclared: false }, { accountAuthorityDeclared: undefined }, { expectedVersion: 0 }, { verifiedByClient: true }])("rejects malformed and cross-purpose writes before session or database access", async override => {
    await expect(savePgwApplicationDetails(requestId, { ...input(), ...override }, key)).rejects.toThrow("parent_invalid_input");
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.session).not.toHaveBeenCalled();
  });
  it.each([["40001", "private", "This request changed"], ["42501", "private", "This request is unavailable"], ["23514", "private", "parent_invalid_input"],
    ["XX000", "PgwPrivateCanary", "CaseLink could not save or load"], ["P0001", "parent_reuse_source_changed", "parent_reuse_source_changed"]])("maps %s without leaking private database text", async (code, message, expected) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message, details: "PgwPrivateCanary" } });
    await expect(savePgwApplicationDetails(requestId, input(), key)).rejects.toThrow(expected);
  });
  it("starts the exact prepare-only PGW request and optional routing source atomically", async () => {
    mocks.rpc.mockResolvedValue({ data: requestId, error: null });
    const application = { details: saved.details, noticeVersion: notice, subjectAuthorityDeclared: true, accountAuthorityDeclared: true };
    expect(await startPgwApplication(intake(), mandate(), application, key, { sourceRequestId: snapshotId, sourceVersion: 3 })).toBe(requestId);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("parent_start_pgw_application", {
      p_intake: intake(), p_mandate: mandate(), p_details: saved.details, p_notice_version: notice, p_idempotency_key: key,
      p_subject_authority_declared: true, p_account_authority_declared: true, p_source_request_id: snapshotId, p_source_version: 3,
    });
  });
  it("preserves an explicitly supplied utility shutoff date alongside CRP preparation", async () => {
    const urgent = { ...intake(), urgency: "today" as const, shutoffDate: "2026-11-15" };
    mocks.rpc.mockResolvedValue({ data: requestId, error: null });
    await startPgwApplication(urgent, mandate(), { details: {}, noticeVersion: notice, subjectAuthorityDeclared: true, accountAuthorityDeclared: true }, key);
    expect(mocks.rpc.mock.calls[0][1].p_intake).toEqual(urgent);
  });
  it("accepts explicit document preparation permission without treating it as upload authorization", async () => {
    const permission = { ...mandate(), allowedData: ["household", "income", "utility", "documents"] as const };
    mocks.rpc.mockResolvedValue({ data: requestId, error: null });
    await startPgwApplication(intake(), { ...permission, allowedData: [...permission.allowedData] }, {
      details: {}, noticeVersion: notice, subjectAuthorityDeclared: true, accountAuthorityDeclared: true,
    }, key);
    expect(mocks.rpc.mock.calls[0][1].p_mandate.allowedData).toEqual(permission.allowedData);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it.each([{ householdSize: 3 }, { incomeAmount: 100, incomeFrequency: "monthly" }, { needs: ["electricity"] }, { utilityProviders: ["peco"] }, { accountAuthority: "not_sure" }, { needs: ["gas", "water"] }])("rejects irrelevant or unscoped initial intake", async override => {
    const application = { details: {}, noticeVersion: notice, subjectAuthorityDeclared: true, accountAuthorityDeclared: true };
    await expect(startPgwApplication({ ...intake(), ...override } as ReturnType<typeof intake>, mandate(), application, key)).rejects.toThrow("parent_invalid_input");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([{ mode: "full", allowedActions: ["prepare"] }, { recipientIds: ["pwd-tap"] }, { allowedData: ["household", "income"] }, { allowedData: ["household", "income", "utility", "income"] }])("requires a PGW-specific preparation mandate", async override => {
    await expect(startPgwApplication(intake(), { ...mandate(), ...override } as ReturnType<typeof mandate>, { details: {}, noticeVersion: notice, subjectAuthorityDeclared: true, accountAuthorityDeclared: true }, key)).rejects.toThrow("parent_invalid_input");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([{ data: null, error: { message: "old deployment private" } }, { data: {}, error: null }, { data: { collectionEnabled: true, noticeVersion: "SNAP", expiresAt: "2026-11-20T20:06:00Z" }, error: null }])("keeps collection closed when the dedicated RPC is missing or invalid", async result => {
    mocks.rpc.mockResolvedValue(result); expect(await getPgwApplicationCollection()).toEqual({ collectionEnabled: false, noticeVersion: null, expiresAt: null });
  });
  it("returns the independent PGW collection deadline when the database verifies it", async () => {
    const collection = { collectionEnabled: true, noticeVersion: notice, expiresAt: "2026-11-13T22:10:00+00:00" };
    mocks.rpc.mockResolvedValue({ data: collection, error: null });
    expect(await getPgwApplicationCollection()).toEqual(collection);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("parent_pgw_application_collection");
  });
});
