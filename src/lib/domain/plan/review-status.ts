import { parseDateOnly } from "@/lib/dates";
import type { PlanWithSteps } from "@/types/family";
import { actionUserNotes } from "@/lib/domain/plan/action-state";

export type PlanReviewState = "draft" | "needs_review" | "reviewed" | "needs_attention";

export type PlanReviewStatus = {
  state: PlanReviewState;
  label: "Draft" | "Needs review" | "Reviewed" | "Needs attention";
  issue: string | null;
};

function hasValidReviewedAt(value: string | undefined): boolean {
  return Boolean(value && !Number.isNaN(Date.parse(value)));
}

export function getPlanReviewStatus(plan: PlanWithSteps | null): PlanReviewStatus {
  if (!plan || plan.generation_state?.status === "running") {
    return { state: "draft", label: "Draft", issue: "Finish generating the plan first." };
  }
  if (plan.generation_state?.status === "failed") {
    return {
      state: "needs_attention",
      label: "Needs attention",
      issue: "Finish or regenerate the incomplete plan before reviewing it.",
    };
  }

  const actions = plan.steps.flatMap((step) => step.action_items ?? []);
  if (actions.length === 0) {
    return {
      state: "needs_attention",
      label: "Needs attention",
      issue: "Add at least one dated action before reviewing the plan.",
    };
  }
  if (
    plan.steps.some(
      (step) =>
        !step.title.trim() ||
        !(step.details?.expected_outcome?.trim()),
    ) ||
    actions.some((action) => !action.title.trim())
  ) {
    return {
      state: "needs_attention",
      label: "Needs attention",
      issue: "Give every action a clear title and expected result before reviewing the plan.",
    };
  }
  if (
    actions.some(
      (action) =>
        action.status !== "completed" &&
        !parseDateOnly(action.target_date),
    )
  ) {
    return {
      state: "needs_attention",
      label: "Needs attention",
      issue: "Add a target date to every open action before reviewing the plan.",
    };
  }
  if (
    actions.some(
      (action) =>
        action.status === "blocked" &&
        (!actionUserNotes(action.notes).trim() || !parseDateOnly(action.follow_up_date)),
    )
  ) {
    return {
      state: "needs_attention",
      label: "Needs attention",
      issue: "Every waiting action needs a reason and next follow-up date.",
    };
  }

  if (
    hasValidReviewedAt(plan.client_display?.reviewedAt) &&
    Boolean(plan.client_display?.reviewedById) &&
    Boolean(plan.material_revision) &&
    plan.client_display?.reviewedRevision === plan.material_revision
  ) {
    return { state: "reviewed", label: "Reviewed", issue: null };
  }

  return { state: "needs_review", label: "Needs review", issue: null };
}

export function isPlanReviewed(plan: PlanWithSteps | null): boolean {
  return getPlanReviewStatus(plan).state === "reviewed";
}
