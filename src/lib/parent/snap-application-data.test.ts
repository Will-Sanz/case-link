import { beforeEach, describe, expect, it, vi } from "vitest";
import { SNAP_APPLICATION_SOURCE } from "./snap-application-fields";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";
const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("./auth", () => ({ requireParentSession: mocks.session }));
import { getSnapApplicationDetails, saveSnapApplicationDetails, SNAP_APPLICATION_NOTICE_VERSION, startSnapApplication } from "./snap-application-data";

const requestId = "11111111-1111-4111-8111-111111111111", snapshotId = "22222222-2222-4222-8222-222222222222", key = "33333333-3333-4333-8333-333333333333";
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
    expect(mocks.rpc).toHaveBeenCalledWith("parent_save_snap_application_details", {
      p_request_id: requestId, p_expected_version: 3, p_details: saved.details, p_notice_version: SNAP_APPLICATION_NOTICE_VERSION, p_idempotency_key: key,
    });
  });
  it("uses the distinct reaffirmation RPC only for an explicit list, keeping legacy saves unchanged", async () => {
    const details = { ...saved.details, address: { street: "1 Synthetic Street" } };
    const value = { expectedVersion: 3, details, noticeVersion: SNAP_APPLICATION_NOTICE_VERSION, confirmedPaths: ["address.street"] };
    await saveSnapApplicationDetails(requestId, value, key);
    expect(mocks.rpc).toHaveBeenCalledWith("parent_reaffirm_snap_application_details", { p_request_id: requestId, p_expected_version: 3,
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
    ["40001", "This request changed"], ["42501", "This request is unavailable"], ["23514", "parent_invalid_input"], ["XX000", "CaseLink could not save or load"],
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
});
