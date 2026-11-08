import { beforeEach, expect, it, vi } from "vitest";
import { runResourceMatching } from "./resource-matches";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), detail: vi.fn(), resources: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireAppUserWithClient: async () => ({ supabase: { rpc: mocks.rpc } }) }));
vi.mock("@/lib/services/families", () => ({ getFamilyDetail: mocks.detail }));
vi.mock("@/lib/services/matching-resources", () => ({ loadMatchingResources: mocks.resources }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const familyId = "7f58e830-7ba1-4f78-9e0c-d1fde9b814b7";
beforeEach(() => {
  mocks.detail.mockResolvedValue({ goals: [], barriers: [], summary: null, household_notes: null });
  mocks.resources.mockResolvedValue([]);
  mocks.rpc.mockResolvedValue({ error: null });
});
it.each(["detail", "resources"] as const)("reports unavailable %s without deleting existing suggestions", async failure => {
  mocks[failure].mockRejectedValue(new Error("private service detail"));
  const result = await runResourceMatching({ familyId });
  expect(result).toMatchObject({ ok: false });
  expect(JSON.stringify(result)).not.toContain("private service detail");
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("distinguishes a successfully loaded empty directory from a failed load", async () => {
  expect(await runResourceMatching({ familyId })).toEqual({ ok: true });
  expect(mocks.rpc).toHaveBeenCalledWith("replace_suggested_resource_matches", { p_family_id: familyId, p_matches: [], p_evaluated: 0 });
});
