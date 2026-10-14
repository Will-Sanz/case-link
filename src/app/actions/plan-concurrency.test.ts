import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { savePlanEdits, updatePlanStepActionItem } from "./plans";
import { captureCaseProgressUpdate } from "./case-progress";

const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireAppUserWithClient: mocks.session }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const familyId = "7f58e830-7ba1-4f78-9e0c-d1fde9b814b7";
const planId = "a7633b13-d74a-469d-80bd-40614f419e8c";
const stepId = "160e28d7-438d-4e85-844b-abb90b7e6ef4";
const actionItemId = "596a15f1-aa32-4371-b9c7-dfa081c85497";
const databaseTime = "2026-08-03T20:30:00.123456+00:00";

function database() {
  const predicates: unknown[][] = [];
  const writes: string[] = [];
  const from = vi.fn((table: string) => {
    let writing = false;
    const row = table === "plans" ? { id: planId, family_id: familyId }
      : table === "plan_steps" ? { id: stepId, plan_id: planId, updated_at: databaseTime }
      : { id: actionItemId, plan_step_id: stepId, updated_at: databaseTime, status: "pending", notes: null };
    const query = {
      select: vi.fn().mockImplementation(() => query),
      eq: vi.fn().mockImplementation((...args: unknown[]) => { if (writing) predicates.push(args); return query; }),
      order: vi.fn().mockImplementation(() => query),
      limit: vi.fn().mockImplementation(() => query),
      maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
      update: vi.fn().mockImplementation(() => { writing = true; writes.push(table); return query; }),
      then: (resolve: (value: unknown) => void) => resolve({ data: [row], error: null }),
    };
    return query;
  });
  mocks.session.mockResolvedValue({ supabase: { from, rpc: mocks.rpc } });
  return { predicates, writes };
}

afterEach(() => vi.useRealTimers());

beforeEach(() => {
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "save_plan_edits" ? { ok: true } : planId, error: null }));
  database();
});

describe("database revision timestamps", () => {
  it.each([databaseTime, "2026-08-03T20:30:00.123456Z", "2026-08-03T16:30:00.123456-04:00"])(
    "passes the complete timestamp to the atomic update: %s", async (expectedUpdatedAt) => {
      const db = database();
      expect(await savePlanEdits({ familyId, planId, steps: [{ stepId, expectedUpdatedAt, patch: { title: "Arrange an intake" }, actionItems: [] }] })).toMatchObject({ ok: true });
      expect(await updatePlanStepActionItem({ familyId, actionItemId, expectedUpdatedAt, title: "Arrange an intake" })).toMatchObject({ ok: true });
      expect(db.writes).toEqual([]);
      const saves = mocks.rpc.mock.calls.filter(([name]) => name === "save_plan_edits");
      expect(saves[0][1].p_changes[0].expectedUpdatedAt).toBe(expectedUpdatedAt);
      expect(saves[1][1].p_changes[0].actionItems[0].expectedUpdatedAt).toBe(expectedUpdatedAt);
    },
  );

  it("returns conflicts when the atomic database update finds a newer revision", async () => {
    database();
    mocks.rpc.mockResolvedValueOnce({ data: { ok: false, error: "Changed", conflict: { kind: "step" } }, error: null })
      .mockResolvedValueOnce({ data: { ok: false, error: "Changed", conflict: { kind: "action_item" } }, error: null });
    expect(await savePlanEdits({ familyId, planId, steps: [{ stepId, expectedUpdatedAt: databaseTime, patch: { title: "Arrange an intake" }, actionItems: [] }] })).toMatchObject({ ok: false, conflict: { kind: "step" } });
    expect(await updatePlanStepActionItem({ familyId, actionItemId, expectedUpdatedAt: databaseTime, title: "Arrange an intake" })).toMatchObject({ ok: false, conflict: { kind: "action_item" } });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["save_plan_edits", "save_plan_edits"]);
  });

  it("passes microseconds unchanged into the meeting transaction and preserves its conflict result", async () => {
    const input = { requestId: "9b731b93-485b-4629-8b25-c088f9743245", familyId, planId, occurredOn: "2026-08-03", summary: "Discussed next steps.", changes: [
      { actionItemId, expectedUpdatedAt: databaseTime, status: "pending", targetDate: "2026-08-10", followUpDate: null, notes: null, outcome: null },
    ] };
    expect(await captureCaseProgressUpdate(input)).toMatchObject({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith("capture_case_progress_update", expect.objectContaining({ p_request_id: input.requestId, p_changes: [expect.objectContaining({ expected_updated_at: databaseTime })] }));
    mocks.rpc.mockResolvedValue({ error: { message: "changed in another tab" }, data: null });
    expect(await captureCaseProgressUpdate(input)).toMatchObject({ ok: false, conflict: true });
  });

  it.each(["2026-02-30T00:00:00Z", "today", "2026-08-03T20:30:00", "2026-08-03T20:30:00+99:00"])(
    "rejects malformed revisions before accessing the database: %s", async (expectedUpdatedAt) => {
      expect(await savePlanEdits({ familyId, planId, steps: [{ stepId, expectedUpdatedAt, patch: { title: "Arrange an intake" }, actionItems: [] }] })).toMatchObject({ ok: false });
      expect(await updatePlanStepActionItem({ familyId, actionItemId, expectedUpdatedAt, title: "Arrange an intake" })).toMatchObject({ ok: false });
      expect(mocks.session).not.toHaveBeenCalled();
    },
  );
  it("rejects tomorrow's meeting during the UTC/school-date boundary", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-14T02:00:00Z"));
    const input = { requestId: "9b731b93-485b-4629-8b25-c088f9743245", familyId, planId, occurredOn: "2026-10-14", summary: "Discussed next steps", changes: [] };
    expect(await captureCaseProgressUpdate(input)).toEqual({ ok: false, error: "Meeting date cannot be in the future." });
    expect(mocks.session).not.toHaveBeenCalled();
    expect(await captureCaseProgressUpdate({ ...input, occurredOn: "2026-10-13" })).toMatchObject({ ok: true });
  });

});
