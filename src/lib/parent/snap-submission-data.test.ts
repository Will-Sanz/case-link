import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn() }));
vi.mock("./auth", () => ({ requireParentSession: mocks.session }));
import { authorizeSnapSubmission } from "./snap-submission-data";
import { SNAP_PARENT_CERTIFICATION_ACTS } from "./snap-protected-operation";

const requestId = "11111111-1111-4111-8111-111111111111";
const operationId = "abcdefab-cdef-4abc-8def-abcdefabcdef";
const artifactId = "33333333-3333-4333-8333-333333333333";
const input = () => ({ operationId, artifactId, expectedVersion: 3, packetHash: "a".repeat(64), contentSha256: "b".repeat(64) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ supabase: { rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ data: operationId, error: null });
});

describe("owned exact SNAP Submit decision", () => {
  it("records protected exact Submit and honest prior personal-step reports without applicant values", async () => {
    const { artifactId: packetId, ...common } = input();
    expect(await authorizeSnapSubmission(requestId, { ...common, packetId, completedActs: [...SNAP_PARENT_CERTIFICATION_ACTS] })).toBe(operationId);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("parent_authorize_snap_protected_submission", {
      p_request_id: requestId, p_operation_id: operationId, p_expected_version: 3, p_packet_hash: common.packetHash,
      p_packet_id: packetId, p_content_sha256: common.contentSha256, p_completed_acts: [...SNAP_PARENT_CERTIFICATION_ACTS],
    });
  });
  it.each([[], [SNAP_PARENT_CERTIFICATION_ACTS[0]], [SNAP_PARENT_CERTIFICATION_ACTS[0], SNAP_PARENT_CERTIFICATION_ACTS[0]],
    [...SNAP_PARENT_CERTIFICATION_ACTS, "invented_act"], ["invented_act", SNAP_PARENT_CERTIFICATION_ACTS[1]]].map(completedActs => ({ completedActs })))("rejects incomplete or invented protected act reports $completedActs before authentication", async ({ completedActs }) => {
    const { artifactId: packetId, ...common } = input();
    await expect(authorizeSnapSubmission(requestId, { ...common, packetId, completedActs })).rejects.toThrow("parent_invalid_input");
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it("rejects a mixed ordinary/protected artifact tuple", async () => {
    await expect(authorizeSnapSubmission(requestId, { ...input(), packetId: artifactId, completedActs: [...SNAP_PARENT_CERTIFICATION_ACTS] })).rejects.toThrow("parent_invalid_input");
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it("uses the parent's session and all exact immutable bindings, without applicant values", async () => {
    expect(await authorizeSnapSubmission(requestId, input())).toBe(operationId);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("parent_authorize_snap_submission", {
      p_request_id: requestId, p_operation_id: operationId, p_expected_version: 3,
      p_packet_hash: "a".repeat(64), p_artifact_id: artifactId, p_content_sha256: "b".repeat(64),
    });
  });
  it("canonicalizes valid UUID spelling before comparing the exact recorded operation", async () => {
    expect(await authorizeSnapSubmission(requestId, { ...input(), operationId: operationId.toUpperCase() })).toBe(operationId);
    expect(mocks.rpc.mock.calls[0][1].p_operation_id).toBe(operationId);
  });
  it.each([
    { operationId: "not-an-operation" }, { artifactId: null }, { expectedVersion: 0 },
    { expectedVersion: 1.5 }, { expectedVersion: 2147483648 }, { packetHash: "old" },
    { contentSha256: "B".repeat(64) }, { signature: "not accepted here" },
    { ssn: "123-45-6789" }, { requestId: "client cannot replace the path" },
  ])("rejects malformed or extra fields before authenticating: %j", async override => {
    await expect(authorizeSnapSubmission(requestId, { ...input(), ...override })).rejects.toThrow("parent_invalid_input");
    expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects a malformed request scope before authenticating", async () => {
    await expect(authorizeSnapSubmission("other", input())).rejects.toThrow("parent_invalid_input");
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it("preserves session denial before contacting the database", async () => {
    mocks.session.mockRejectedValue(new Error("Sign in again"));
    await expect(authorizeSnapSubmission(requestId, input())).rejects.toThrow("Sign in again");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    ["42501", "This request is unavailable"], ["23514", "parent_snap_submission_not_ready"],
    ["08006", "CaseLink could not confirm"],
  ])("keeps database denial details private: %s", async (code, expected) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "PRIVATE-ERROR-CANARY" } });
    const error = await authorizeSnapSubmission(requestId, input()).then(() => null, error => error as Error);
    expect(error?.message).toContain(expected); expect(error?.message).not.toContain("PRIVATE-ERROR-CANARY");
  });
  it.each([null, {}, "not-a-receipt", requestId])("does not confirm an absent or mismatched operation: %j", async data => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    await expect(authorizeSnapSubmission(requestId, input())).rejects.toThrow("CaseLink could not confirm");
  });
});
