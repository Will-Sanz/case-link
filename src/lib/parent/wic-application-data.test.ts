import { beforeEach, describe, expect, it, vi } from "vitest";
import { WIC_APPLICATION_SOURCE } from "./wic-application-fields";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";
import { WIC_SUBJECT_AUTHORITY_STATEMENT } from "./constants";
const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("./auth", () => ({ requireParentSession: mocks.session }));
import { getWicApplicationDetails, saveWicApplicationDetails, startWicApplication, WIC_APPLICATION_NOTICE_VERSION as notice } from "./wic-application-data";
const requestId = "11111111-1111-4111-8111-111111111111", snapshotId = "22222222-2222-4222-8222-222222222222", key = "33333333-3333-4333-8333-333333333333";
const saved = {
  id: snapshotId, request_id: requestId, revision: 1, base_version: 1, request_version: 2,
  details: { contact: { firstName: "WicPrivateCanary" } },
  provenance: { "contact.firstName": { source: "parent", confirmedAt: "2026-11-13T19:00:00+00:00", asOf: "2026-11-13" } },
  source: WIC_APPLICATION_SOURCE, notice_version: notice, created_at: "2026-11-13T19:00:00+00:00", idempotency_key: key,
  consent_evidence: { subjectAuthorityDeclared: true, statement: WIC_SUBJECT_AUTHORITY_STATEMENT, actorId: requestId,
    noticeVersion: notice, declaredAt: "2026-11-13T19:00:00+00:00", revision: 1, detailsSha256: "a".repeat(64), subjects: ["contact"] },
};
const intake = () => fixtureIntake({ needs: ["wic_new"], householdSize: null, utilityProviders: [] });
const mandate = () => fixtureMandate({ recipientIds: ["wic-pa"], allowedData: ["household"] });
const input = () => ({ expectedVersion: 2, details: saved.details, noticeVersion: notice, subjectAuthorityDeclared: true });
beforeEach(() => {
  mocks.rpc.mockResolvedValue({ data: snapshotId, error: null });
  mocks.session.mockResolvedValue({ supabase: { rpc: mocks.rpc, from: mocks.from } });
});
describe("separate WIC private data boundary", () => {
  it("reads one exact owned revision without changing its original evidence", async () => {
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: saved, error: null }) };
    mocks.from.mockReturnValue(query);
    expect(await getWicApplicationDetails(requestId, snapshotId)).toEqual(saved);
    expect(mocks.from).toHaveBeenCalledWith("parent_wic_application_details");
    expect(query.eq.mock.calls).toEqual([["request_id", requestId], ["id", snapshotId]]);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("returns null for an unavailable owned revision", async () => {
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
    mocks.from.mockReturnValue(query);
    expect(await getWicApplicationDetails(requestId)).toBeNull();
  });
  it.each([
    { provenance: {} }, { provenance: { "contact.firstName": { ...saved.provenance["contact.firstName"], confirmedAt: "2026-11-14T19:00:00Z" } } },
    { source: { ...WIC_APPLICATION_SOURCE, sourceSha256: "wrong" } }, { details: { contact: { firstName: "WicPrivateCanary", postalZip: "19104" } } },
    { consent_evidence: { ...saved.consent_evidence, revision: 2 } },
  ])("fails safely on malformed private saved evidence", async override => {
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { ...saved, ...override }, error: null }) };
    mocks.from.mockReturnValue(query);
    await expect(getWicApplicationDetails(requestId)).rejects.toThrow("CaseLink could not load this information. Please try again.");
  });
  it("saves once through the versioned locked WIC write without a pre-read or ordinary update", async () => {
    expect(await saveWicApplicationDetails(requestId, input(), key)).toBe(snapshotId);
    expect(mocks.rpc).toHaveBeenCalledWith("parent_save_wic_application_details", {
      p_request_id: requestId, p_expected_version: 2, p_details: saved.details, p_notice_version: notice, p_idempotency_key: key, p_subject_authority_declared: true,
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it.each([
    { noticeVersion: "snap-application-details-2026-11-03.v1" }, { expectedVersion: 0 }, { details: { kind: "synthetic_rehearsal" } },
    { details: { contact: { zip: "invalid" } } }, { details: { contact: { firstName: "password=private" } } },
    { details: { ssn: "123-45-6789" } }, { details: { acknowledgment: true } }, { source: "client supplied" },
    { subjectAuthorityDeclared: false }, { subjectAuthorityDeclared: undefined },
  ])("rejects cross-purpose and malformed values before a database/session call", async override => {
    await expect(saveWicApplicationDetails(requestId, { ...input(), ...override }, key)).rejects.toThrow("parent_invalid_input");
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.session).not.toHaveBeenCalled();
  });
  it.each([
    ["40001", "private", "This request changed"], ["42501", "private", "This request is unavailable"], ["23514", "private", "parent_invalid_input"],
    ["XX000", "private-canary", "CaseLink could not save or load"], ["P0001", "parent_reuse_source_changed", "parent_reuse_source_changed"],
  ])("maps %s to a fixed safe message", async (code, message, expected) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message, details: "WicPrivateCanary" } });
    await expect(saveWicApplicationDetails(requestId, input(), key)).rejects.toThrow(expected);
  });
  it("starts atomically using the reviewed routing-reference path without copying ZIP into private details", async () => {
    const reusedZip = { sourceRequestId: snapshotId, sourceVersion: 2 };
    mocks.rpc.mockResolvedValue({ data: requestId, error: null });
    expect(await startWicApplication(intake(), mandate(), saved.details, notice, true, key, reusedZip)).toBe(requestId);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("parent_start_wic_application", {
      p_intake: intake(), p_mandate: mandate(), p_details: saved.details, p_notice_version: notice, p_idempotency_key: key, p_subject_authority_declared: true,
      p_source_request_id: snapshotId, p_source_version: 2,
    });
  });
  it.each([{ householdSize: 3 }, { incomeAmount: 100, incomeFrequency: "monthly" }, { utilityProviders: ["peco"] }, { needs: ["wic_continuing"] }, { needs: ["wic_new", "electricity"] }])("does not persist hidden irrelevant intake on initial WIC start", async override => {
    await expect(startWicApplication({ ...intake(), ...override } as ReturnType<typeof intake>, mandate(), {}, notice, true, key)).rejects.toThrow("parent_invalid_input");
    expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
