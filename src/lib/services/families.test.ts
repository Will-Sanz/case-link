import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { getFamilyDetail } from "./families";

function clientWithFailure(failedTable?: string, missingFamily = false) {
  return {
    from: vi.fn((table: string) => {
      const data = table === "families" ? (missingFamily ? null : { id: "family", creator: null })
        : table === "plans" ? { id: "plan", generation_source: "rules" }
        : table === "plan_steps" ? [{ id: "step" }] : [];
      const result = { data, error: table === failedTable ? { message: `${table} unavailable` } : null };
      const query = {
        select: () => query, eq: () => query, in: () => query, order: () => query,
        limit: () => query, maybeSingle: () => Promise.resolve(result),
        then: (resolve: (value: unknown) => void) => resolve(result),
      };
      return query;
    }),
  } as unknown as SupabaseClient;
}

describe("getFamilyDetail", () => {
  it.each(["families", "family_goals", "family_barriers", "family_members", "case_notes", "case_progress_updates", "resource_matches", "plans", "plan_steps", "plan_step_action_items"])(
    "refuses a partial workspace when %s fails", async (table) => {
      await expect(getFamilyDetail(clientWithFailure(table), "family")).rejects.toThrow(`${table} unavailable`);
    },
  );

  it("keeps genuinely missing content distinct from a load failure", async () => {
    expect(await getFamilyDetail(clientWithFailure(undefined, true), "family")).toBeNull();
    const detail = await getFamilyDetail(clientWithFailure(), "family");
    expect(detail?.plan?.steps).toHaveLength(1);
    expect(detail?.plan?.steps[0].action_items).toEqual([]);
  });
});
