import type { PlanStepActionItemRow } from "@/types/family";

export type ActionUiStatus =
  | "pending"
  | "in_progress"
  | "waiting"
  | "completed"
  | "no_longer_needed";

const NO_LONGER_NEEDED_MARKER = "[[caselink:resolution=no_longer_needed]]";

export function actionUserNotes(notes: string | null | undefined): string {
  return (notes ?? "")
    .replace(NO_LONGER_NEEDED_MARKER, "")
    .replace(/^\s+/, "")
    .trimEnd();
}

export function encodeActionNotes(
  notes: string | null | undefined,
  noLongerNeeded: boolean,
): string | null {
  const clean = actionUserNotes(notes);
  if (!noLongerNeeded) return clean || null;
  return clean ? `${NO_LONGER_NEEDED_MARKER}\n${clean}` : NO_LONGER_NEEDED_MARKER;
}

export function isActionNoLongerNeeded(
  action: Pick<PlanStepActionItemRow, "status" | "notes">,
): boolean {
  return action.status === "completed" && (action.notes ?? "").includes(NO_LONGER_NEEDED_MARKER);
}

export function actionUiStatus(
  action: Pick<PlanStepActionItemRow, "status" | "notes">,
): ActionUiStatus {
  if (isActionNoLongerNeeded(action)) return "no_longer_needed";
  if (action.status === "blocked") return "waiting";
  return action.status;
}

