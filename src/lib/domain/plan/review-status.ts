import type { PlanWithSteps } from "@/types/family";

export type PlanReviewState = "draft" | "needs_review" | "reviewed" | "needs_attention";

export type PlanReviewStatus = {
  state: PlanReviewState;
  label: "Draft" | "Needs review" | "Reviewed" | "Needs attention";
  issue: string | null;
};

function hasValidReviewedAt(value: string | undefined): boolean {
  return Boolean(value && !Number.isNaN(Date.parse(value)));
}

function isValidDateOnly(value: string | null): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
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
    actions.some(
      (action) =>
        action.status !== "completed" &&
        !isValidDateOnly(action.target_date),
    )
  ) {
    return {
      state: "needs_attention",
      label: "Needs attention",
      issue: "Add a target date to every open action before reviewing the plan.",
    };
  }

  if (
    hasValidReviewedAt(plan.client_display?.reviewedAt) &&
    Boolean(plan.client_display?.reviewedById)
  ) {
    return { state: "reviewed", label: "Reviewed", issue: null };
  }

  return { state: "needs_review", label: "Needs review", issue: null };
}

export function isPlanReviewed(plan: PlanWithSteps | null): boolean {
  return getPlanReviewStatus(plan).state === "reviewed";
}
