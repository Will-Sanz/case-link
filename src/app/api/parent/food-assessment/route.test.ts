import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn(), description: vi.fn() }));
vi.mock("@/lib/parent/auth", () => ({ requireParentSession: mocks.session }));
vi.mock("@/lib/parent/food-description-data", () => ({ getFoodDescriptionResult: mocks.description }));
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

it("keeps an optional description handoff bound to its current owned revision and exact vetted answers/subset", async () => {
  const descriptionSource={draftId:owner,revision:2}; mocks.description.mockResolvedValue({state:"proposal",proposedAnswers:input.answers,needIds:input.needs});
  expect((await POST(request({...input,descriptionSource}))).status).toBe(200);
  expect(mocks.description).toHaveBeenCalledWith(owner,{ownerId:owner,revision:2});
  mocks.description.mockResolvedValue({state:"open_existing",proposedAnswers:input.answers,needIds:input.needs});
  expect((await POST(request({...input,descriptionSource}))).status).toBe(409);
  mocks.description.mockResolvedValue({state:"proposal",proposedAnswers:{...input.answers,foodForTwoDays:"yes"},needIds:input.needs});
  expect((await POST(request({...input,descriptionSource}))).status).toBe(409);
});

it("allows only the independently ready SNAP path when food supply remains unanswered", async () => {
  const descriptionSource = { draftId: owner, revision: 2 }, answers = { foodForTwoDays: "not_sure", benefitHistory: "never", existingIssue: null };
  mocks.description.mockResolvedValue({ state: "needs_clarification", proposedAnswers: answers, needIds: ["food_now", "snap_new"], questionIds: ["foodForTwoDays"], conflicts: [] });
  const response = await POST(request({ answers, needs: ["snap_new"], descriptionSource }));
  expect(response.status).toBe(200);
  expect((await response.json()).candidates.map((value: { need: string }) => value.need)).toEqual(["snap_new"]);
  expect(mocks.description).toHaveBeenCalledExactlyOnceWith(owner, { ownerId: owner, revision: 2 });
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("parent_capability_summary");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});

it.each([
  { needs: ["food_now"], questions: ["foodForTwoDays"], conflicts: [] },
  { needs: ["food_now", "snap_new"], questions: ["foodForTwoDays"], conflicts: [] },
  { needs: ["snap_new"], questions: ["foodForTwoDays", "benefitHistory"], conflicts: [] },
  { needs: ["snap_new"], questions: ["foodForTwoDays", "existingIssue"], conflicts: [] },
  { needs: ["snap_new"], questions: ["foodForTwoDays"], conflicts: ["benefitHistory"] },
])("keeps unresolved selected work or current conflicts blocked: %j", async ({ needs, questions, conflicts }) => {
  const answers = { foodForTwoDays: "not_sure", benefitHistory: "never", existingIssue: null };
  mocks.description.mockResolvedValue({ state: "needs_clarification", proposedAnswers: answers, needIds: ["food_now", "snap_new"], questionIds: questions, conflicts });
  expect((await POST(request({ answers, needs, descriptionSource: { draftId: owner, revision: 2 } }))).status).toBe(409);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("does not convert an unanswered food fact into an explicit answer or ignore owned-source read failure", async () => {
  const descriptionSource = { draftId: owner, revision: 2 }, answers = { foodForTwoDays: "not_sure", benefitHistory: "never", existingIssue: null };
  mocks.description.mockResolvedValue({ state: "needs_clarification", proposedAnswers: answers, needIds: ["food_now", "snap_new"], questionIds: ["foodForTwoDays"], conflicts: [] });
  expect((await POST(request({ answers: { ...answers, foodForTwoDays: "no" }, needs: ["snap_new"], descriptionSource }))).status).toBe(409);
  mocks.description.mockRejectedValue(new Error("Authentication required"));
  expect((await POST(request({ answers, needs: ["snap_new"], descriptionSource }))).status).toBe(401);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it.each(["proposal", "needs_clarification"])("does not expose a Pennsylvania SNAP path for outside_pa, even when upstream state is %s", async state => {
  const answers = { foodForTwoDays: "not_sure", benefitHistory: "never", existingIssue: null };
  mocks.description.mockResolvedValue({ state, outOfScope: "outside_pa", proposedAnswers: answers, needIds: ["food_now", "snap_new"], questionIds: state === "proposal" ? [] : ["foodForTwoDays"], conflicts: [] });
  expect((await POST(request({ answers, needs: ["snap_new"], descriptionSource: { draftId: owner, revision: 2 } }))).status).toBe(409);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it.each(["benefitHistory", "existingIssue"])("allows ready food-only work while the unrelated %s answer is missing", async question => {
  const answers = { foodForTwoDays: "no", benefitHistory: question === "benefitHistory" ? "not_sure" : "receiving", existingIssue: question === "benefitHistory" ? null : "not_sure" };
  mocks.description.mockResolvedValue({ state: "needs_clarification", outOfScope: null, proposedAnswers: answers, needIds: ["food_now"], questionIds: [question], conflicts: [] });
  const response = await POST(request({ answers, needs: ["food_now"], descriptionSource: { draftId: owner, revision: 2 } }));
  expect(response.status).toBe(200);
  expect((await response.json()).candidates.map((value: { need: string }) => value.need)).toEqual(["food_now"]);
  expect(mocks.description).toHaveBeenCalledExactlyOnceWith(owner, { ownerId: owner, revision: 2 });
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("parent_capability_summary");
});
