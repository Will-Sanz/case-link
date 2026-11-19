import { describe, expect, it } from "vitest";
import { formatMatchesForAiPrompt, formatMatchesForPlannerPrompt, matchesForPlanContext } from "./resource-context";
import type { ResourceMatchRow } from "@/types/family";
import { isDemoResource } from "@/lib/matching/resource-availability";

const match = { id: "match", status: "suggested", score: 10, match_reason: "Matches housing", resource: {
  id: "10000000-0000-4000-8000-000000000001", category: null, program_name: "Housing support", office_or_department: "Community office", active: true, is_demo: false, updated_at: "2026-10-13T12:00:00Z",
} } as ResourceMatchRow;

describe("directory availability in every AI context", () => {
  it("distinguishes demo labels without misclassifying similarly named real programs", () => {
    expect(isDemoResource("Housing support (Demo)", "Sample office")).toBe(true);
    expect(isDemoResource("Democracy and housing", "Demonstration center")).toBe(false);
  });
  it.each(["dismissed", "inactive", "demo", "missing", "unknown status"])("excludes %s records from planning and chat", state => {
    const row = structuredClone(match);
    if (state === "dismissed") row.status = "dismissed";
    if (state === "inactive") row.resource!.active = false;
    if (state === "demo") row.resource!.is_demo = true;
    if (state === "missing") row.resource = null;
    if (state === "unknown status") delete (row.resource as Partial<NonNullable<ResourceMatchRow["resource"]>>).active;
    expect(matchesForPlanContext([row],10)).toEqual([]);
    expect(formatMatchesForPlannerPrompt([row])).not.toContain("Housing support");
    expect(formatMatchesForAiPrompt([row],10)).not.toContain("Housing support");
  });
  it("retains active supplied resources and prioritizes case-manager acceptance", () => {
    const accepted = { ...match, id: "accepted", status: "accepted" as const, score: 1 };
    expect(matchesForPlanContext([match,accepted],1)[0].id).toBe("accepted");
    expect(formatMatchesForPlannerPrompt([match])).toContain("Housing support");
    expect(formatMatchesForAiPrompt([match],10)).toContain("verify current contacts");
  });
});
