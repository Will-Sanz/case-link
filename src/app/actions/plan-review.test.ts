import { beforeEach, expect, it, vi } from "vitest";
import { markPlanReviewed, validatePlanExport } from "./plans";
const m = vi.hoisted(() => ({ session: vi.fn(), family: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireAppUserWithClient: m.session }));
vi.mock("@/lib/services/families", () => ({ getFamilyDetail: m.family }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const input = { familyId: "10000000-0000-4000-8000-000000000001", planId: "10000000-0000-4000-8000-000000000002", expectedRevision: "a".repeat(64) };
beforeEach(() => {
  m.session.mockResolvedValue({ supabase: { rpc: m.rpc } });
  m.rpc.mockResolvedValue({ data: true, error: null });
  m.family.mockResolvedValue({ plan: { id: input.planId, review_revision: input.expectedRevision, steps: [{ title: "Call intake", details: { expected_outcome: "Options confirmed" }, action_items: [{ title: "Call intake", status: "pending", target_date: "2026-10-20" }] }] } });
});
it("binds approval to the exact displayed revision, even after a read races with a write", async () => {
  expect(await markPlanReviewed(input)).toEqual({ ok: true });
  expect(m.rpc).toHaveBeenCalledWith("mark_plan_reviewed", { p_family_id: input.familyId, p_plan_id: input.planId, p_expected_revision: input.expectedRevision });
  m.rpc.mockResolvedValue({ data: null, error: { code: "40001" } });
  expect(await markPlanReviewed(input)).toMatchObject({ ok: false, error: expect.stringContaining("plan changed") });
});
it("rejects a stale display without adopting the server's newer revision", async () => {
  expect(await markPlanReviewed({ ...input, expectedRevision: "b".repeat(64) })).toMatchObject({ ok: false });
  expect(m.rpc).not.toHaveBeenCalled();
});
it("requires a revision and authorization before review or export", async () => {
  expect(await markPlanReviewed({ ...input, expectedRevision: undefined })).toMatchObject({ ok: false });
  expect(await validatePlanExport({ ...input, expectedRevision: undefined })).toMatchObject({ ok: false });
  expect(m.session).not.toHaveBeenCalled();
  m.session.mockRejectedValue(new Error("private failure"));
  expect(await validatePlanExport(input)).toMatchObject({ ok: false });
  expect(m.rpc).not.toHaveBeenCalled();
});
it("fails closed on stale exports and database failures", async () => {
  for (const result of [{ data: false, error: null }, { data: null, error: { message: "private failure" } }]) {
    m.rpc.mockResolvedValue(result);
    const response = await validatePlanExport(input);
    expect(response).toMatchObject({ ok: false });
    expect(JSON.stringify(response)).not.toContain("private failure");
  }
});
