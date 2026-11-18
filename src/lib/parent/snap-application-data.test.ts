import { beforeEach, describe, expect, it, vi } from "vitest";
import { SNAP_APPLICATION_SOURCE } from "./snap-application-fields";
import { SNAP_ES_TEMPLATE_ID, SNAP_SPANISH_APPLICATION_SOURCE } from "./snap-form-source";
import { fixtureIntake, fixtureMandate, fixtureSnapApplication } from "./test-fixtures";
import { AuthenticationRequiredError } from "@/lib/auth/session-errors";
const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("./auth", () => ({ requireParentSession: mocks.session }));
import { getSnapApplicationDetails, saveSnapApplicationDetails, SNAP_APPLICATION_NOTICE_VERSION, startSnapApplication } from "./snap-application-data";

const requestId = "11111111-1111-4111-8111-111111111111", snapshotId = "22222222-2222-4222-8222-222222222222", key = "33333333-3333-4333-8333-333333333333";
const familySource = () => ({ expectedOwnerId: requestId, revision: 2, options: {}, fields: [
  { applicationPath: "applicant.firstName", profilePaths: ["primaryPerson.firstName"] },
  { applicationPath: "address.street", profilePaths: ["homeAddress.street", "homeAddress.apartment"] },
] });
const saved = {
  id: snapshotId, request_id: requestId, revision: 2, base_version: 2, request_version: 3,
  details: { zip: "19104", income: { month: "2026-10", hasIncome: false } },
  provenance: { "income.month": { source: "parent", confirmedAt: "2026-10-05T12:00:00+00:00", asOf: "2026-10-05", period: "2026-10" } },
  source: SNAP_APPLICATION_SOURCE, notice_version: SNAP_APPLICATION_NOTICE_VERSION,
  created_at: "2026-10-05T12:00:00+00:00", idempotency_key: key,
};
beforeEach(() => {
  mocks.rpc.mockResolvedValue({ data: snapshotId, error: null });
  mocks.session.mockResolvedValue({ supabase: { rpc: mocks.rpc, from: mocks.from } });
});

describe("private SNAP details data boundary", () => {
  it("reads an exact owned revision with original historical values and provenance", async () => {
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: saved, error: null }) };
    mocks.from.mockReturnValue(query);
    expect(await getSnapApplicationDetails(requestId, snapshotId)).toEqual(saved);
    expect(mocks.from).toHaveBeenCalledWith("parent_snap_application_details");
    expect(query.eq.mock.calls).toEqual([["request_id", requestId], ["id", snapshotId]]);
    expect(query.order).toHaveBeenCalledWith("revision", { ascending: false });
    expect(query.limit).toHaveBeenCalledWith(1);
  });
  it("keeps explicit document choice in the atomic start/save boundary without altering contact facts", async () => {
    const intake=fixtureIntake({needs:["snap_new"],language:"en"}), mandate=fixtureMandate({recipientIds:["snap-pa"]});
    await startSnapApplication(intake,mandate,{language:"en"},SNAP_APPLICATION_NOTICE_VERSION,key,undefined,SNAP_ES_TEMPLATE_ID);
    expect(mocks.rpc).toHaveBeenLastCalledWith("parent_start_snap_application_source", {p_intake:intake,p_mandate:mandate,p_details:{language:"en"},p_notice_version:SNAP_APPLICATION_NOTICE_VERSION,p_idempotency_key:key,p_template_id:SNAP_ES_TEMPLATE_ID});
    await saveSnapApplicationDetails(requestId,{expectedVersion:3,details:saved.details,noticeVersion:SNAP_APPLICATION_NOTICE_VERSION,documentTemplateId:SNAP_ES_TEMPLATE_ID,familyProfileSource:familySource()},key);
    expect(mocks.rpc).toHaveBeenLastCalledWith("parent_save_snap_application_source",expect.objectContaining({p_template_id:SNAP_ES_TEMPLATE_ID,p_family_profile_source:familySource(),p_details:saved.details}));
  });
  it("reads the exact Spanish source without converting the stored packet to English", async () => {
    const value={...saved,source:SNAP_SPANISH_APPLICATION_SOURCE};
    const query={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),limit:vi.fn().mockReturnThis(),maybeSingle:vi.fn().mockResolvedValue({data:value,error:null})};mocks.from.mockReturnValue(query);
    expect(await getSnapApplicationDetails(requestId)).toEqual(value);
  });
  it.each(["es","../../private",{templateId:SNAP_ES_TEMPLATE_ID},null])("rejects arbitrary source selection before Auth",async documentTemplateId=>{
    await expect(saveSnapApplicationDetails(requestId,{expectedVersion:3,details:{},noticeVersion:SNAP_APPLICATION_NOTICE_VERSION,documentTemplateId},key)).rejects.toThrow("parent_invalid_input");
    expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.session).not.toHaveBeenCalled();
  });
  it("returns no data for an unavailable owned revision", async () => {
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
    mocks.from.mockReturnValue(query);
    expect(await getSnapApplicationDetails(requestId)).toBeNull();
    expect(query.eq.mock.calls).toEqual([["request_id", requestId]]);
  });
  it("refuses malformed saved values or an unexpected source without exposing private error details", async () => {
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { ...saved, source: { ...saved.source, inventorySha256: "unexpected" } }, error: null }) };
    mocks.from.mockReturnValue(query);
    await expect(getSnapApplicationDetails(requestId)).rejects.toThrow("CaseLink could not load this information. Please try again.");
  });
  it("leaves unchanged historical timing to the locked save without refreshing or pre-reading", async () => {
    const value = { expectedVersion: 3, details: saved.details, noticeVersion: SNAP_APPLICATION_NOTICE_VERSION };
    expect(await saveSnapApplicationDetails(requestId, value, key)).toBe(snapshotId);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("parent_save_application_with_family_profile", { p_kind: "snap_application", p_family_profile_source: null,
      p_request_id: requestId, p_expected_version: 3, p_details: saved.details, p_notice_version: SNAP_APPLICATION_NOTICE_VERSION, p_idempotency_key: key,
    });
  });
  it("keeps explicit reaffirmation paths inside the same locked source-aware write", async () => {
    const details = { ...saved.details, address: { street: "1 Synthetic Street" } };
    const value = { expectedVersion: 3, details, noticeVersion: SNAP_APPLICATION_NOTICE_VERSION, confirmedPaths: ["address.street"] };
    await saveSnapApplicationDetails(requestId, value, key);
    expect(mocks.rpc).toHaveBeenCalledWith("parent_save_application_with_family_profile", { p_kind: "snap_application", p_family_profile_source: null, p_request_id: requestId, p_expected_version: 3,
      p_details: details, p_notice_version: SNAP_APPLICATION_NOTICE_VERSION, p_idempotency_key: key, p_confirmed_paths: ["address.street"] });
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it.each([
    { details: { "123-45-6789": true } }, { details: { applicant: { firstName: "password=secret" } } },
    { details: { signature: "private" } }, { noticeVersion: "unaccepted-purpose" }, { expectedVersion: 0 }, { confirmedPaths: ["zip", "zip"] },
    { confirmedPaths: ["ssn"] }, { confirmedPaths: ["123-45-6789"] },
  ])("rejects invalid private input without echoing it or calling the database: %j", async (override) => {
    await expect(saveSnapApplicationDetails(requestId, { expectedVersion: 3, details: {}, noticeVersion: SNAP_APPLICATION_NOTICE_VERSION, ...override }, key)).rejects.toThrow("parent_invalid_input");
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it.each([
    ["40001", "This request changed"], ["PT409", "This request changed"], ["42501", "This request is unavailable"], ["23514", "parent_invalid_input"], ["XX000", "CaseLink could not save or load"],
  ])("maps database %s without leaking provider error details", async (code, message) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "private value 123-45-6789", details: "private" } });
    await expect(saveSnapApplicationDetails(requestId, { expectedVersion: 3, details: {}, noticeVersion: SNAP_APPLICATION_NOTICE_VERSION }, key)).rejects.toThrow(message);
  });
  it("starts and saves through one atomic RPC rather than a separate request and details write", async () => {
    const intake = fixtureIntake({ needs: ["snap_new"] }), mandate = fixtureMandate({ recipientIds: ["snap-pa"] });
    mocks.rpc.mockResolvedValue({ data: requestId, error: null });
    expect(await startSnapApplication(intake, mandate, saved.details, SNAP_APPLICATION_NOTICE_VERSION, key)).toBe(requestId);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("parent_start_snap_application", { p_intake: intake, p_mandate: mandate, p_details: saved.details, p_notice_version: SNAP_APPLICATION_NOTICE_VERSION, p_idempotency_key: key });
  });
  it("forwards full typed details and exact source metadata through source-aware atomic start and save", async () => {
    const details = fixtureSnapApplication(new Date("2026-11-17T18:00:00Z")), source = familySource();
    const intake = fixtureIntake({ needs: ["snap_new"] }), mandate = fixtureMandate({ recipientIds: ["snap-pa"] });
    await startSnapApplication(intake, mandate, details, SNAP_APPLICATION_NOTICE_VERSION, key, source);
    expect(mocks.rpc).toHaveBeenLastCalledWith("parent_start_application_with_family_profile", {
      p_kind: "snap_application", p_family_profile_source: source, p_intake: intake, p_mandate: mandate,
      p_details: details, p_notice_version: SNAP_APPLICATION_NOTICE_VERSION, p_idempotency_key: key,
    });
    await saveSnapApplicationDetails(requestId, { expectedVersion: 3, details, noticeVersion: SNAP_APPLICATION_NOTICE_VERSION,
      familyProfileSource: source, confirmedPaths: ["applicant.firstName"] }, key);
    expect(mocks.rpc).toHaveBeenLastCalledWith("parent_save_application_with_family_profile", {
      p_kind: "snap_application", p_family_profile_source: source, p_request_id: requestId, p_expected_version: 3,
      p_details: details, p_notice_version: SNAP_APPLICATION_NOTICE_VERSION, p_idempotency_key: key, p_confirmed_paths: ["applicant.firstName"],
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(2); expect(mocks.from).not.toHaveBeenCalled();
  });
  it.each([
    null, { ...familySource(), expectedOwnerId: "invalid-owner" }, { ...familySource(), revision: 0 },
    { ...familySource(), confirmedAt: "2026-11-17T18:00:00Z" },
    { ...familySource(), fields: [{ ...familySource().fields[0], expiresAt: "2026-12-17T18:00:00Z" }] },
    { ...familySource(), fields: [{ applicationPath: "applicant/<private>", profilePaths: ["primaryPerson.firstName"] }] },
    { ...familySource(), fields: [familySource().fields[0], familySource().fields[0]] },
    { ...familySource(), options: { permission: true } },
  ])("rejects malformed source metadata before Auth or RPC", async source => {
    const intake = fixtureIntake({ needs: ["snap_new"] }), mandate = fixtureMandate({ recipientIds: ["snap-pa"] });
    await expect(startSnapApplication(intake, mandate, {}, SNAP_APPLICATION_NOTICE_VERSION, key, source)).rejects.toThrow("parent_invalid_input");
    await expect(saveSnapApplicationDetails(requestId, { expectedVersion: 3, details: {}, noticeVersion: SNAP_APPLICATION_NOTICE_VERSION, familyProfileSource: source }, key)).rejects.toThrow("parent_invalid_input");
    expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    ["P0001", "parent_family_profile_source_changed", "parent_family_profile_source_changed"],
    ["XX000", "parent_family_profile_source_changed", "CaseLink could not save or load this information. Please try again."],
    ["P0001", "parent_family_profile_source_changed PrivateCanary", "CaseLink could not save or load this information. Please try again."],
    ["42501", "PrivateCanary foreign owner", "This request is unavailable, or its permission has changed."],
  ])("classifies only the exact known %s source failure and never retries through a legacy RPC", async (code, message, expected) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message, details: "PrivateCanary" } });
    const source = { ...familySource(), expectedOwnerId: snapshotId, fields: [{ applicationPath: "custom.secret", profilePaths: ["custom.secret"] }] };
    await expect(startSnapApplication(fixtureIntake({ needs: ["snap_new"] }), fixtureMandate({ recipientIds: ["snap-pa"] }), {}, SNAP_APPLICATION_NOTICE_VERSION, key, source)).rejects.toThrow(expected);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("parent_start_application_with_family_profile", expect.objectContaining({ p_family_profile_source: source }));
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("requires the current parent session even for a well-formed saved source", async () => {
    mocks.session.mockRejectedValue(new AuthenticationRequiredError());
    await expect(saveSnapApplicationDetails(requestId, { expectedVersion: 3, details: {}, noticeVersion: SNAP_APPLICATION_NOTICE_VERSION, familyProfileSource: familySource() }, key)).rejects.toBeInstanceOf(AuthenticationRequiredError);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
