import { describe, expect, it } from "vitest";
import {
  localActionDraftKey,
  parseLocalActionDraft,
  serializeLocalActionDraft,
} from "@/lib/domain/plan/local-action-draft";
import type { PlanStepRow } from "@/types/family";

const step = {
  id: "00000000-0000-4000-8000-000000000003",
  plan_id: "00000000-0000-4000-8000-000000000001",
  phase: "30",
  title: "Call the program",
  description: "",
  status: "pending",
  due_date: null,
  assigned_to_id: null,
  sort_order: 0,
  created_at: "2026-08-03T12:00:00.000Z",
  updated_at: "2026-08-03T12:00:00.000Z",
  action_items: [],
} satisfies PlanStepRow;

describe("local action draft", () => {
  it("round-trips a synthetic action draft", () => {
    const value = serializeLocalActionDraft(step.plan_id, step, "2026-08-03T13:00:00.000Z");
    expect(parseLocalActionDraft(value)).toMatchObject({
      planId: step.plan_id,
      savedAt: "2026-08-03T13:00:00.000Z",
      step: { id: step.id, title: step.title },
    });
  });

  it("rejects malformed storage and scopes keys to one plan", () => {
    expect(parseLocalActionDraft("not json")).toBeNull();
    expect(parseLocalActionDraft(JSON.stringify({ v: 1, planId: "x" }))).toBeNull();
    expect(localActionDraftKey(step.plan_id)).toContain(step.plan_id);
  });
});
