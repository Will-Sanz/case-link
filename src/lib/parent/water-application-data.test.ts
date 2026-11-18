import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";
import { WATER_APPLICATION_NOTICE_VERSION as notice, WATER_APPLICATION_REFERENCE, WATER_ACCOUNT_AUTHORITY_STATEMENT, WATER_SUBJECT_AUTHORITY_STATEMENT } from "./water-application-fields";
const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("./auth", () => ({ requireParentSession: mocks.session }));
import { getWaterApplicationCollection, getWaterApplicationDetails, saveWaterApplicationDetails, startWaterApplication } from "./water-application-data";
const requestId = "11111111-1111-4111-8111-111111111111", snapshotId = "22222222-2222-4222-8222-222222222222", key = "33333333-3333-4333-8333-333333333333";
const saved = {
  id: snapshotId, request_id: requestId, revision: 1, base_version: 1, request_version: 2,
  details: { journey: "recertification", existingApplication: "saved" },
  provenance: Object.fromEntries(["journey", "existingApplication"].map(field => [field, { source: "parent", confirmedAt: "2026-11-13T22:20:00+00:00", asOf: "2026-11-13" }])),
  source: WATER_APPLICATION_REFERENCE, notice_version: notice, created_at: "2026-11-13T22:20:00+00:00", idempotency_key: key,
  consent_evidence: { subjectAuthorityDeclared: true, subjectStatement: WATER_SUBJECT_AUTHORITY_STATEMENT, accountAuthorityDeclared: true, accountStatement: WATER_ACCOUNT_AUTHORITY_STATEMENT,
    accountAuthority: "self", actorId: requestId, noticeVersion: notice, declaredAt: "2026-11-13T22:20:00+00:00", revision: 1, detailsSha256: "a".repeat(64), subjects: [] },
};
const intake = () => fixtureIntake({ needs: ["water"], householdSize: null, utilityProviders: ["pwd"], accountAuthority: "self", shutoffDate: "2026-12-01" });
const mandate = () => fixtureMandate({ mode: "prepare_only", recipientIds: ["pwd-tap"], allowedActions: ["research", "prepare"], allowedData: ["household", "income", "utility"] });
const input = () => ({ expectedVersion: 2, details: saved.details, noticeVersion: notice, subjectAuthorityDeclared: true, accountAuthorityDeclared: true });
beforeEach(() => { mocks.rpc.mockResolvedValue({ data: snapshotId, error: null }); mocks.session.mockResolvedValue({ supabase: { rpc: mocks.rpc, from: mocks.from } }); });
describe("owned water reference preparation data", () => {
  it("loads exactly the selected private revision without converting reported saved/recertification to City status", async () => {
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: saved, error: null }) };
    mocks.from.mockReturnValue(query);
    expect(await getWaterApplicationDetails(requestId, snapshotId)).toEqual(saved);
    expect(query.eq.mock.calls).toEqual([["request_id", requestId], ["id", snapshotId]]);
    query.maybeSingle.mockResolvedValue({ data: null as unknown as typeof saved, error: null });
    expect(await getWaterApplicationDetails(requestId)).toBeNull();
  });
  it.each([{ provenance: {} }, { source: { ...WATER_APPLICATION_REFERENCE, kind: "actual_issued_form" } }, { consent_evidence: { ...saved.consent_evidence, subjects: ["unrelated"] } },
    { details: { waterAccessCode: "123456789" } }])("rejects malformed or uncovered private evidence safely", async override => {
    mocks.from.mockReturnValue({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { ...saved, ...override }, error: null }) });
    await expect(getWaterApplicationDetails(requestId)).rejects.toThrow("CaseLink could not load this information. Please try again.");
  });
  it("sends only the exact write to its versioned owner RPC", async () => {
    expect(await saveWaterApplicationDetails(requestId, input(), key)).toBe(snapshotId);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("parent_save_water_application_details", { p_request_id: requestId, p_expected_version: 2, p_details: saved.details,
      p_notice_version: notice, p_idempotency_key: key, p_subject_authority_declared: true, p_account_authority_declared: true });
  });
  it.each([{ details: { accessCode: "123456789" } }, { details: { applicationId: "12345" } }, { details: { hardship: "illness" } },
    { details: { signature: "private" } }, { subjectAuthorityDeclared: false }, { accountAuthorityDeclared: false }, { noticeVersion: "peco-application-details-2026-11-13.v1" }])("rejects protected/cross-purpose input before session access", async override => {
    await expect(saveWaterApplicationDetails(requestId, { ...input(), ...override }, key)).rejects.toThrow("parent_invalid_input"); expect(mocks.session).not.toHaveBeenCalled();
  });
  it.each([false, true])("starts atomically with original routing and shutoff information, document scope %s", async documents => {
    const permission = mandate(); if (documents) permission.allowedData.push("documents");
    mocks.rpc.mockResolvedValue({ data: requestId, error: null });
    expect(await startWaterApplication(intake(), permission, { details: saved.details, noticeVersion: notice, subjectAuthorityDeclared: true, accountAuthorityDeclared: true }, key, { sourceRequestId: snapshotId, sourceVersion: 3 })).toBe(requestId);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("parent_start_water_application", { p_intake: intake(), p_mandate: permission, p_details: saved.details, p_notice_version: notice,
      p_idempotency_key: key, p_subject_authority_declared: true, p_account_authority_declared: true, p_source_request_id: snapshotId, p_source_version: 3 });
  });
  it.each([{ householdSize: 3 }, { needs: ["water", "gas"] }, { incomeAmount: 100, incomeFrequency: "monthly" }, { utilityProviders: ["peco"] }, { accountAuthority: "not_sure" }])("rejects irrelevant or ambiguous initial routing", async override => {
    await expect(startWaterApplication({ ...intake(), ...override } as ReturnType<typeof intake>, mandate(), { details: {}, noticeVersion: notice, subjectAuthorityDeclared: true, accountAuthorityDeclared: true }, key)).rejects.toThrow("parent_invalid_input");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([["40001", "This request changed"], ["42501", "This request is unavailable"], ["23514", "parent_invalid_input"], ["XX000", "CaseLink could not save or load"]])("sanitizes database %s errors", async (code, expected) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "WaterPrivateCanary", details: "123456789" } });
    await expect(saveWaterApplicationDetails(requestId, input(), key)).rejects.toThrow(expected);
  });
  it.each([{ data: null, error: { message: "private" } }, { data: {}, error: null }, { data: { collectionEnabled: true, noticeVersion: "wrong", expiresAt: "2026-11-20T22:00:00Z" }, error: null }])("keeps collection closed on unavailable independent purpose metadata", async result => {
    mocks.rpc.mockResolvedValue(result); expect(await getWaterApplicationCollection()).toEqual({ collectionEnabled: false, noticeVersion: null, expiresAt: null });
  });
});
