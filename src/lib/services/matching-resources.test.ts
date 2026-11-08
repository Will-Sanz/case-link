import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadMatchingResources } from "./matching-resources";

function database(count: number, failureAtPage = -1) {
  const rows = Array.from({ length: count }, (_, i) => ({ id: String(i).padStart(6, "0"), program_name: `Program ${i}` }));
  const filters: unknown[][] = [];
  let calls = 0;
  const from = vi.fn(() => {
    let after: string | undefined;
    const query = {
      select: () => query, order: () => query, limit: () => query,
      eq: (...args: unknown[]) => { filters.push(args); return query; },
      gt: (_: string, value: string) => { after = value; return query; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(calls++ === failureAtPage
        ? { data: null, error: { message: "private database error" } }
        : { data: rows.filter(row => !after || row.id > after).slice(0,200), error: null }).then(resolve),
    };
    return query;
  });
  return { client: { from } as unknown as SupabaseClient, rows, from, filters };
}

describe("resource directory paging", () => {
  it.each([0,1,200,1_065])("loads every active non-demo entry across the API cap (%i rows)", async count => {
    const db = database(count);
    expect(await loadMatchingResources(db.client)).toEqual(db.rows);
    expect(db.filters).toContainEqual(["active", true]);
    expect(db.filters).toContainEqual(["is_demo", false]);
    expect(db.from).toHaveBeenCalledTimes(Math.floor(count/200)+1);
  });
  it("does not replace existing suggestions with a partially loaded catalog", async () => {
    await expect(loadMatchingResources(database(1065,1).client)).rejects.toThrow("could not be loaded");
  });
  it("rejects an oversized directory instead of silently cutting it off", async () => {
    await expect(loadMatchingResources(database(10_001).client)).rejects.toThrow("exceeds the matching limit");
  });
});
