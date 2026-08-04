import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getFamilyDetail: vi.fn(),
  requireAppUserWithClient: vi.fn(),
  runResourceMatching: vi.fn(),
  startStagedLeanPlanGeneration: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({
  requireAppUserWithClient: mocks.requireAppUserWithClient,
}));
vi.mock("@/app/actions/resource-matches", () => ({
  runResourceMatching: mocks.runResourceMatching,
}));
vi.mock("@/app/actions/plans", () => ({
  startStagedLeanPlanGeneration: mocks.startStagedLeanPlanGeneration,
  updatePlanStepActionItem: vi.fn(),
}));
vi.mock("@/lib/services/families", () => ({
  getFamilyDetail: mocks.getFamilyDetail,
}));

import { generateBarrierWorkflowAction } from "@/app/actions/barrier-workflow";

describe("generateBarrierWorkflowAction", () => {
  beforeEach(() => {
    mocks.runResourceMatching.mockResolvedValue({ ok: true });
    mocks.startStagedLeanPlanGeneration.mockResolvedValue({ ok: true });
    mocks.getFamilyDetail.mockResolvedValue({ plan: null, resourceMatches: [] });
  });

  it("replaces barriers without overwriting an existing family profile", async () => {
    let savingRecord = false;
    const from = vi.fn((table: string) => {
      if (table !== "barrier_plan_records") {
        throw new Error(`Unexpected write to ${table}`);
      }

      const query = {
        eq: vi.fn(() => query),
        maybeSingle: vi.fn(async () =>
          savingRecord
            ? { data: { updated_at: "2026-08-03T12:00:00.000Z" }, error: null }
            : { data: { family_id: "family-1" }, error: null }),
        select: vi.fn(() => query),
        upsert: vi.fn(() => {
          savingRecord = true;
          return query;
        }),
      };
      return query;
    });
    const rpc = vi.fn().mockResolvedValue({ error: null });
    mocks.requireAppUserWithClient.mockResolvedValue({
      supabase: { from, rpc },
      user: { id: "user-1" },
    });

    const result = await generateBarrierWorkflowAction({
      referenceId: "Case A",
      selectedBarriers: ["Housing"],
      additionalBarriers: "",
      additionalDetails: "Temporary housing support needed.",
    });

    expect(result.ok).toBe(true);
    expect(from).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith("replace_family_barriers", {
      p_family_id: "family-1",
      p_barriers: [
        { label: "Housing", preset_key: "housing_instability", sort_order: 0 },
      ],
    });
  });

  it("preserves existing barriers while replacing them when the RPC migration is missing", async () => {
    let savingRecord = false;
    let familyBarrierQuery = 0;
    const operations: string[] = [];
    let insertedRows: unknown;
    let deletedIds: unknown;

    const recordQuery = {
      eq: vi.fn(() => recordQuery),
      maybeSingle: vi.fn(async () =>
        savingRecord
          ? { data: { updated_at: "2026-08-03T12:00:00.000Z" }, error: null }
          : { data: { family_id: "family-1" }, error: null }),
      select: vi.fn(() => recordQuery),
      upsert: vi.fn(() => {
        savingRecord = true;
        return recordQuery;
      }),
    };
    const from = vi.fn((table: string) => {
      if (table === "barrier_plan_records") return recordQuery;
      if (table !== "family_barriers") throw new Error(`Unexpected table ${table}`);

      familyBarrierQuery += 1;
      if (familyBarrierQuery === 1) {
        const readQuery = {
          select: vi.fn(() => readQuery),
          eq: vi.fn(async () => {
            operations.push("read-existing");
            return { data: [{ id: "old-barrier" }], error: null };
          }),
        };
        return readQuery;
      }
      if (familyBarrierQuery === 2) {
        const insertQuery = {
          insert: vi.fn((rows: unknown) => {
            operations.push("insert-new");
            insertedRows = rows;
            return insertQuery;
          }),
          select: vi.fn(async () => ({ data: [{ id: "new-barrier" }], error: null })),
        };
        return insertQuery;
      }
      const deleteQuery = {
        delete: vi.fn(() => {
          operations.push("delete-existing");
          return deleteQuery;
        }),
        eq: vi.fn(() => deleteQuery),
        in: vi.fn(async (_column: string, ids: unknown) => {
          deletedIds = ids;
          return { error: null };
        }),
      };
      return deleteQuery;
    });
    const rpc = vi.fn().mockResolvedValue({
      error: {
        code: "PGRST202",
        message: "Could not find the function public.replace_family_barriers in the schema cache",
      },
    });
    mocks.requireAppUserWithClient.mockResolvedValue({
      supabase: { from, rpc },
      user: { id: "user-1" },
    });

    const result = await generateBarrierWorkflowAction({
      referenceId: "Case A",
      selectedBarriers: ["Housing"],
      additionalBarriers: "",
      additionalDetails: "Temporary housing support needed.",
    });

    expect(result.ok).toBe(true);
    expect(operations).toEqual(["read-existing", "insert-new", "delete-existing"]);
    expect(insertedRows).toEqual([
      {
        family_id: "family-1",
        label: "Housing",
        preset_key: "housing_instability",
        sort_order: 0,
      },
    ]);
    expect(deletedIds).toEqual(["old-barrier"]);
  });
});
