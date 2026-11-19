import { beforeEach, describe, expect, it, vi } from "vitest";
import { SNAP_APPLICATION_SOURCE } from "./snap-application-fields";
import { snapCaptureContextSchema, snapCaptureQuery } from "./snap-capture-context";
const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn() }));
vi.mock("./auth", () => ({ requireParentSession: mocks.session }));
import { getSnapCaptureContext } from "./snap-capture-data";

const requestId = "11111111-1111-4111-8111-111111111111", snapshotId = "22222222-2222-4222-8222-222222222222";
const scope = { expectedVersion: 3, snapshotId };
const context = { requestVersion: 3, snapshotId, snapshotHash: "a".repeat(64), source: SNAP_APPLICATION_SOURCE, applyingSubjectIds: [requestId] };
beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ supabase: { rpc: mocks.rpc } }); mocks.rpc.mockResolvedValue({ data: structuredClone(context), error: null }); });

describe("parent-owned SNAP preparation context", () => {
  it("uses the existing parent session and one exact metadata-only RPC", async () => {
    expect(await getSnapCaptureContext(requestId, scope)).toEqual(context);
    expect(mocks.session).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("parent_get_snap_capture_context", { p_request_id: requestId, p_expected_version: 3 });
  });
  it.each([{ expectedVersion: 0 }, { expectedVersion: 2147483648 }, { snapshotId: "invalid" }, { privateValue: "PRIVATE-CANARY" }])("rejects malformed input before Auth: %j", async change => {
    await expect(getSnapCaptureContext(requestId, { ...scope, ...change })).rejects.toThrow(); expect(mocks.session).not.toHaveBeenCalled();
  });
  it.each(["requestVersion", "snapshotId"])("never substitutes a newer %s silently", async field => {
    mocks.rpc.mockResolvedValue({ data: { ...context, [field]: field === "requestVersion" ? 4 : requestId }, error: null });
    await expect(getSnapCaptureContext(requestId, scope)).rejects.toThrow("This request changed");
  });
  it.each([{ source: { ...SNAP_APPLICATION_SOURCE, inventorySha256: "f".repeat(64) } }, { snapshotHash: "invalid" }, { applyingSubjectIds: [] }, { applyingSubjectIds: [requestId, requestId] }, { ssn: "PRIVATE-CANARY" }])("rejects unverified or extra context metadata: %j", async change => {
    mocks.rpc.mockResolvedValue({ data: { ...context, ...change }, error: null });
    await expect(getSnapCaptureContext(requestId, scope)).rejects.toThrow("not available");
  });
  it.each(["42501", "XX000"])("contains the database %s failure", async code => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "PRIVATE-CANARY" } });
    await expect(getSnapCaptureContext(requestId, scope)).rejects.toThrow(code === "42501" ? "This request is unavailable" : "not available");
  });
  it("does not acquire context when the existing parent session is unavailable", async () => {
    mocks.session.mockRejectedValue(new Error("Sign in again"));
    await expect(getSnapCaptureContext(requestId, scope)).rejects.toThrow("Sign in again"); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("contains a rejected provider call without returning its private exception", async () => {
    mocks.rpc.mockRejectedValue(new Error("PRIVATE-CANARY"));
    await expect(getSnapCaptureContext(requestId, scope)).rejects.toThrow("The current SNAP application connection is not available.");
  });
  it("accepts only canonical bounded scope queries", () => {
    expect(snapCaptureQuery(new URL(`http://localhost/?expectedVersion=3&snapshotId=${snapshotId}`))).toEqual(scope);
    expect(snapCaptureContextSchema.parse(context)).toEqual(context);
    for (const query of [`expectedVersion=03&snapshotId=${snapshotId}`, `expectedVersion=3&snapshotId=${snapshotId}&expectedVersion=4`,
      `expectedVersion=3&snapshotId=${snapshotId}&ssn=PRIVATE-CANARY`, `expectedVersion=3&snapshotId=${snapshotId}&__proto__=PRIVATE-CANARY`,
      `expectedVersion=3`, `expectedVersion=2147483648&snapshotId=${snapshotId}`, `x=${"a".repeat(300)}`])
      expect(() => snapCaptureQuery(new URL(`http://localhost/?${query}`))).toThrow();
  });
});
