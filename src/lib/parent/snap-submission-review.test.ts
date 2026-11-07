import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn() }));
vi.mock("./auth", () => ({ requireParentSession: mocks.session }));
import { getSnapSubmissionReview } from "./snap-submission-data";
import { fixtureProtectedSnapOperation } from "./test-fixtures";

const operation = fixtureProtectedSnapOperation();
const requestId = operation.requestId, scope = { expectedVersion: operation.requestVersion };
beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ supabase: { rpc: mocks.rpc } }); mocks.rpc.mockResolvedValue({ data: operation, error: null }); });
describe("owned protected SNAP review metadata", () => {
  it("keeps an executing exact application available for owned read-only review", async () => {
    const executing = { ...operation, state: "executing", protectedPacketCurrent: false, snapSubmissionAuthorized: false };
    mocks.rpc.mockResolvedValue({ data: executing, error: null }); expect(await getSnapSubmissionReview(requestId, scope)).toEqual(executing);
  });
  it("uses only the existing owning session and exact metadata RPC", async () => {
    expect(await getSnapSubmissionReview(requestId, scope)).toEqual(operation);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("parent_get_snap_review", { p_request: requestId, p_version: scope.expectedVersion });
  });
  it("keeps absent canonical work distinct from a completed or submitted application", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null }); expect(await getSnapSubmissionReview(requestId, scope)).toBeNull();
  });
  it.each([{ expectedVersion: 0 }, { expectedVersion: 2147483648 }, { ssn: "PRIVATE-CANARY" }])("rejects unsupported scope before Auth: %j", async change => {
    await expect(getSnapSubmissionReview(requestId, { ...scope, ...change })).rejects.toThrow(); expect(mocks.session).not.toHaveBeenCalled();
  });
  it.each([
    { requestId: "abcdef12-3456-4789-abcd-123456789abc" }, { requestVersion: scope.expectedVersion + 1 },
    { artifactId: "abcdef12-3456-4789-abcd-123456789abc" }, { protectedParentSubmitReady: undefined },
    { ciphertext: "PRIVATE-CANARY" }, { packetHash: "invalid" },
  ])("rejects another scope, incomplete readiness or private reply fields: %j", async change => {
    mocks.rpc.mockResolvedValue({ data: { ...operation, ...change }, error: null });
    await expect(getSnapSubmissionReview(requestId, scope)).rejects.toThrow("could not confirm");
  });
  it.each(["42501", "XX000"])("contains the private database error %s", async code => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "PRIVATE-CANARY" } });
    await expect(getSnapSubmissionReview(requestId, scope)).rejects.toThrow(code === "42501" ? "This request is unavailable" : "could not confirm");
  });
  it("contains rejected calls while preserving the existing personal-session requirement", async () => {
    mocks.rpc.mockRejectedValue(new Error("PRIVATE-CANARY")); await expect(getSnapSubmissionReview(requestId, scope)).rejects.toThrow("could not confirm");
    vi.clearAllMocks(); mocks.session.mockRejectedValue(new Error("Sign in again"));
    await expect(getSnapSubmissionReview(requestId, scope)).rejects.toThrow("Sign in again"); expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
