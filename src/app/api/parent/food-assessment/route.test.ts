import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/parent/auth", () => ({ requireParentSession: mocks.session }));
import { POST } from "./route";
const owner = "11111111-1111-4111-8111-111111111111";
const input = { answers: { foodForTwoDays: "no", benefitHistory: "applied", existingIssue: null }, needs: ["food_now", "snap_pending"] };
function request(body: unknown = input, origin = "https://case.invalid") {
  return new Request("https://case.invalid/api/parent/food-assessment", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-17T18:00:00Z"));
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://case.invalid");
  mocks.session.mockResolvedValue({ user: { id: owner }, supabase: { rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ data: [{ programId: "snap-pa", enabled: true, actions: ["submit", "follow_up"] }], error: null });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
describe("authenticated deterministic food preflight", () => {
  it("recomputes relevant proposed paths without creating work or borrowing new-application capability", async () => {
    const response = await POST(request()); expect(response.status).toBe(200);
    const value = await response.json(); expect(value.ownerId).toBe(owner);
    expect(value.candidates.map((path: { need: string }) => path.need)).toEqual(["food_now", "snap_pending"]);
    expect(value.candidates[1].programs.find((program: { programId: string }) => program.programId === "snap-pa")).toEqual({ programId: "snap-pa", actions: [] });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("parent_capability_summary");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("returns only compatible initial sending actions for a current source", async () => {
    const response = await POST(request({ ...input, needs: ["food_now", "snap_new"], answers: { ...input.answers, benefitHistory: "never" } }));
    expect((await response.json()).candidates[1].programs.find((program: { programId: string }) => program.programId === "snap-pa")).toEqual({ programId: "snap-pa", actions: ["submit"] });
  });
  it("never presents a stale program source as ready for sending", async () => {
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    const response = await POST(request({ ...input, needs: ["food_now", "snap_new"], answers: { ...input.answers, benefitHistory: "never" } }));
    expect((await response.json()).candidates[1].programs.find((program: { programId: string }) => program.programId === "snap-pa")).toEqual({ programId: "snap-pa", actions: [] });
  });
  it("rejects untrusted fields and stale branches before reading account data", async () => {
    for (const value of [{ ...input, mandate: {} }, { ...input, answers: { ...input.answers, pregnant: true } }, { ...input, answers: { ...input.answers, existingIssue: "renewal" } }, { ...input, needs: [] }, { ...input, needs: ["food_now", "food_now"] }, { ...input, needs: ["snap_new", "snap_pending"] }, { ...input, needs: ["food_now", "wic_new"] }, { ...input, needs: ["snap_new"] }, { answers: input.answers }])
      expect((await POST(request(value))).status).toBe(400);
    expect(mocks.session).not.toHaveBeenCalled();
    expect((await POST(request({ ...input, padding: "x".repeat(2048) }))).status).toBe(400);
  });
  it("returns only the canonical selected subset and leaves a compatible sibling proposed", async () => {
    const one = await POST(request({ ...input, needs: ["snap_pending"] }));
    expect((await one.json()).candidates.map((path: { need: string }) => path.need)).toEqual(["snap_pending"]);
    const both = await POST(request({ ...input, needs: ["snap_pending", "food_now"] }));
    expect((await both.json()).candidates.map((path: { need: string }) => path.need)).toEqual(["food_now", "snap_pending"]);
  });
  it("requires the original site and a current authenticated parent", async () => {
    expect((await POST(request(input, "https://wrong.invalid"))).status).toBe(403); expect(mocks.session).not.toHaveBeenCalled();
    mocks.session.mockRejectedValue(new Error("Authentication required"));
    expect((await POST(request())).status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("fails visibly when current connection facts cannot be verified", async () => {
    mocks.rpc.mockResolvedValue({ data: { secret: "untrusted-runtime-detail" }, error: null });
    const response = await POST(request()); expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("untrusted-runtime-detail");
  });
});
