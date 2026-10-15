import { describe, expect, it } from "vitest";
import {
  completedGenerationStageCount,
  pendingPhaseFromPersistedCounts,
} from "@/lib/domain/plan/generation-progress";
import type { PlanGenerationState } from "@/types/family";

function state(phases: PlanGenerationState["phases_complete"]): PlanGenerationState {
  return {
    v: 1,
    status: "running",
    pending_phase: "30",
    planning_brief: "",
    phases_complete: phases,
    models_used: [],
    stage_timings_ms: {},
  };
}

describe("generation progress", () => {
  it("finishes a single-plan job after its sole persisted batch without inventing later phases", () => {
    const single = { ...state({ "30": true, "60": false, "90": false }), generation_strategy: "single" as const };
    expect(completedGenerationStageCount(single)).toBe(1);
    expect(pendingPhaseFromPersistedCounts({ "30": 1, "60": 0, "90": 0 }, "single")).toBeNull();
    expect(pendingPhaseFromPersistedCounts({ "30": 0, "60": 0, "90": 0 }, "single")).toBe("30");
  });
  it("counts only stages that have been persisted", () => {
    expect(
      completedGenerationStageCount(
        state({ "30": true, "60": true, "90": false }),
      ),
    ).toBe(2);
  });

  it.each([
    [{ "30": 0, "60": 0, "90": 0 }, "30"],
    [{ "30": 2, "60": 0, "90": 0 }, "60"],
    [{ "30": 2, "60": 2, "90": 0 }, "90"],
    [{ "30": 2, "60": 2, "90": 1 }, null],
    [{ "30": 0, "60": 2, "90": 1 }, "30"],
    [{ "30": 2, "60": 0, "90": 1 }, "60"],
    [{ "30": 0, "60": 0, "90": 1 }, "30"],
  ] as const)("recovers the next stage from persisted row counts", (counts, expected) => {
    expect(pendingPhaseFromPersistedCounts(counts)).toBe(expected);
  });
});
