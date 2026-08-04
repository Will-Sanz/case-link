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
  ] as const)("recovers the next stage from persisted row counts", (counts, expected) => {
    expect(pendingPhaseFromPersistedCounts(counts)).toBe(expected);
  });
});
