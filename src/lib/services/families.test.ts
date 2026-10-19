import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { enrichFamiliesWithCurrentStep, getFamilyDetail, getFamilyProfile } from "./families";
import { directoryCase } from "../../../tests/fixtures/directory-case";
import type { ResourceMatchRow } from "@/types/family";

function clientWithFailure(failedTable?: string, missingFamily = false, resourceMatches: ResourceMatchRow[] = []) {
  return {
    rpc: vi.fn().mockResolvedValue({ data: { family: { id: "family", name: "Snapshot label" }, barriers: [], plan: { id: "plan", generation_source: "rules", steps: [{ id: "step", action_items: [] }] } }, error: failedTable === "get_family_plan_snapshot" ? { message: "get_family_plan_snapshot unavailable" } : null }),
    from: vi.fn((table: string) => {
      const data = table === "families" ? (missingFamily ? null : { id: "family", creator: null, goals: [], members: [], caseNotes: [], progressUpdates: [], resourceMatches })
        : table === "plans" ? { id: "plan", generation_source: "rules" }
        : table === "plan_steps" ? [{ id: "step" }] : table === "resource_matches" ? resourceMatches : [];
      const result = { data, error: table === failedTable ? { message: `${table} unavailable` } : null };
      const query = {
        select: vi.fn(() => query), eq: vi.fn(() => query), is: vi.fn(() => query), in: () => query, order: vi.fn(() => query),
        limit: vi.fn(() => query), maybeSingle: () => Promise.resolve(result),
        then: (resolve: (value: unknown) => void) => resolve(result),
      };
      return query;
    }),
  } as unknown as SupabaseClient;
}

describe("getFamilyDetail", () => {
  it("loads the stored service evidence with the authorized family's resource matches", async () => {
    const matches = directoryCase().resourceMatches;
    Object.assign(matches[0].resource!, { description: "Housing stabilization", services_select_all: "Intake preparation", additional_info: "School coordination is available." });
    const client = clientWithFailure(undefined, false, matches);
    const detail = await getFamilyDetail(client, "family");
    expect(detail?.resourceMatches[0].resource).toMatchObject(matches[0].resource!);
    const calls = vi.mocked(client.from).mock;
    const query = calls.results[calls.calls.findIndex(([table]) => table === "families")].value;
    expect(query.select.mock.calls[0][0]).toMatch(/description,\s+services_select_all,\s+additional_info/);
  });
  it("loads scoped relations and bounded histories in one family query plus the existing plan snapshot", async () => {
    const client = clientWithFailure();
    await getFamilyDetail(client, "family");
    expect(client.from).toHaveBeenCalledExactlyOnceWith("families");
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith("get_family_plan_snapshot", { p_family_id: "family" });
    const query = vi.mocked(client.from).mock.results[0].value;
    expect(query.eq).toHaveBeenCalledWith("id", "family");
    expect(query.is).toHaveBeenCalledWith("archived_at", null);
    expect(query.order.mock.calls).toEqual([
      ["sort_order", { referencedTable: "goals", ascending: true }],
      ["created_at", { referencedTable: "members", ascending: true }],
      ["created_at", { referencedTable: "caseNotes", ascending: false }],
      ["occurred_on", { referencedTable: "progressUpdates", ascending: false }],
      ["created_at", { referencedTable: "progressUpdates", ascending: false }],
    ]);
    expect(query.limit.mock.calls).toEqual([[50, { referencedTable: "caseNotes" }], [50, { referencedTable: "progressUpdates" }]]);
  });
  it.each(["families", "get_family_plan_snapshot"])(
    "refuses a partial workspace when %s fails", async (table) => {
      await expect(getFamilyDetail(clientWithFailure(table), "family")).rejects.toThrow(`${table} unavailable`);
    },
  );

  it("keeps genuinely missing content distinct from a load failure", async () => {
    expect(await getFamilyDetail(clientWithFailure(undefined, true), "family")).toBeNull();
    const detail = await getFamilyDetail(clientWithFailure(), "family");
    expect(detail?.name).toBe("Snapshot label");
    expect(detail?.plan?.steps).toHaveLength(1);
    expect(detail?.plan?.steps[0].action_items).toEqual([]);
  });
});

it("loads profile counts with one protected family read and no plan or directory requests", async () => {
  const row = { id: "family", name: "Household label", summary: null, household_notes: null, urgency: null, status: "active", updated_at: "2026-10-19T03:30:00Z", goals: [{ count: 2 }], barriers: [{ count: 3 }], plans: [{ count: 4 }] };
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
  const query = { select: vi.fn(() => query), eq: vi.fn(() => query), is: vi.fn(() => query), maybeSingle };
  const client = { from: vi.fn(() => query), rpc: vi.fn() } as unknown as SupabaseClient;
  expect(await getFamilyProfile(client, "family")).toMatchObject({ id: "family", goalCount: 2, barrierCount: 3, hasPlan: true });
  expect(client.from).toHaveBeenCalledExactlyOnceWith("families");
  expect(client.rpc).not.toHaveBeenCalled();
  expect(query.is).toHaveBeenCalledWith("archived_at", null);
  maybeSingle.mockResolvedValueOnce({ data: null, error: null });
  expect(await getFamilyProfile(client, "hidden")).toBeNull();
  maybeSingle.mockResolvedValueOnce({ data: null, error: { message: "Unavailable" } });
  await expect(getFamilyProfile(client, "family")).rejects.toThrow("Unavailable");
});

describe("bounded family next-work summaries", () => {
  const ids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];
  const items = ids.map(id => ({ id, name: "Family label" })) as import("@/types/family").FamilyListItem[];
  function summaryClient(data: unknown, error: unknown = null) {
    return { rpc: vi.fn().mockResolvedValue({ data, error }) } as unknown as SupabaseClient;
  }
  it("joins summaries by ID, preserves list order, and accepts genuinely empty work", async () => {
    const work = { id: ids[0], title: "Housing goal", phase: "30", status: "blocked", due_date: "2026-11-02", action_needed_now: "Follow up", is_blocked: true, is_escalated: false };
    const client = summaryClient([{ family_id: ids[1], current_step: null }, { family_id: ids[0], current_step: work }]);
    const result = await enrichFamiliesWithCurrentStep(client, items);
    expect(result.map(row => row.current_step)).toEqual([work, null]);
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith("get_family_next_work", { p_family_ids: ids });
    expect(await enrichFamiliesWithCurrentStep(client, [])).toEqual([]);
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([null, [], [{ family_id: ids[0], current_step: null }],
    ids.map(() => ({ family_id: ids[0], current_step: null })),
    [{ family_id: ids[0], current_step: { id: ids[0] } }],
  ])("refuses missing, duplicate, or malformed summaries: %j", async data => {
    await expect(enrichFamiliesWithCurrentStep(summaryClient(data), items)).rejects.toThrow();
  });
  it("propagates a database failure instead of showing no work", async () => {
    await expect(enrichFamiliesWithCurrentStep(summaryClient(null, { message: "Unavailable" }), items)).rejects.toThrow("Unavailable");
  });
});
