import { describe, expect, it } from "vitest";
import {
  describeProgressChange,
  listProgressActionOptions,
} from "@/lib/domain/family-workspace/case-progress";
import type { CaseProgressPlanChange, PlanWithSteps } from "@/types/family";

const plan = {
  id: "10000000-0000-4000-8000-000000000001",
  family_id: "20000000-0000-4000-8000-000000000002",
  version: 1,
  summary: null,
  generation_source: "openai",
  ai_model: null,
  created_at: "2026-08-01T12:00:00.000Z",
  presentation: { sourceKind: "ai" as const },
  steps: [
    {
      id: "30000000-0000-4000-8000-000000000003",
      plan_id: "10000000-0000-4000-8000-000000000001",
      phase: "30" as const,
      title: "Housing intake",
      description: "Prepare the intake.",
      status: "in_progress" as const,
      due_date: null,
      assigned_to_id: null,
      sort_order: 0,
      created_at: "2026-08-01T12:00:00.000Z",
      updated_at: "2026-08-01T12:00:00.000Z",
      details: { stage_goal: "Stable housing" },
      action_items: [
        {
          id: "40000000-0000-4000-8000-000000000004",
          plan_step_id: "30000000-0000-4000-8000-000000000003",
          title: "Waiting for documents",
          description: null,
          week_index: 1,
          target_date: "2026-08-01",
          status: "blocked" as const,
          sort_order: 0,
          outcome: null,
          notes: "Documents requested",
          follow_up_date: "2026-08-05",
          created_at: "2026-08-01T12:00:00.000Z",
          updated_at: "2026-08-01T12:00:00.000Z",
        },
        {
          id: "50000000-0000-4000-8000-000000000005",
          plan_step_id: "30000000-0000-4000-8000-000000000003",
          title: "Submit intake",
          description: null,
          week_index: 2,
          target_date: "2026-08-10",
          status: "pending" as const,
          sort_order: 1,
          outcome: null,
          notes: null,
          follow_up_date: null,
          created_at: "2026-08-01T12:00:00.000Z",
          updated_at: "2026-08-01T12:00:00.000Z",
        },
      ],
    },
  ],
} satisfies PlanWithSteps;

describe("case progress continuity", () => {
  it("uses a waiting follow-up date when ordering the next plan work", () => {
    const actions = listProgressActionOptions(plan);
    expect(actions.map((item) => item.action.title)).toEqual([
      "Waiting for documents",
      "Submit intake",
    ]);
    expect(actions[0].effectiveDate).toBe("2026-08-05");
  });

  it("turns a saved snapshot into a concise, human-readable history entry", () => {
    const change: CaseProgressPlanChange = {
      action_item_id: plan.steps[0].action_items[0].id,
      plan_step_id: plan.steps[0].id,
      title: "Waiting for documents",
      previous: {
        status: "blocked",
        target_date: "2026-08-01",
        follow_up_date: "2026-08-05",
        notes: "Documents requested",
        outcome: null,
      },
      current: {
        status: "completed",
        target_date: "2026-08-01",
        follow_up_date: null,
        notes: "Documents received",
        outcome: "Intake packet is ready",
      },
    };
    expect(describeProgressChange(change)).toEqual([
      "Waiting → Completed",
      "Follow-up date cleared",
      "Progress note updated",
      "Outcome updated",
    ]);
  });
});
