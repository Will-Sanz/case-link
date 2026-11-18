import type { ServiceMandate } from "./domain";

export type UtilityPreparationProgram = "peco-cap" | "pgw-crp" | "pwd-tap";

/** Scope compatibility only; documents still need their protected purpose and processing consent. */
export function isUtilityPreparationMandate(value: ServiceMandate, programId: UtilityPreparationProgram): boolean {
  return value.mode === "prepare_only" && value.recipientIds.length === 1 && value.recipientIds[0] === programId &&
    value.allowedActions.includes("prepare") && new Set(value.allowedActions).size === value.allowedActions.length &&
    value.allowedActions.every(action => action === "research" || action === "prepare") &&
    new Set(value.allowedData).size === value.allowedData.length &&
    ["household", "income", "utility"].every(category => value.allowedData.includes(category as "household" | "income" | "utility")) &&
    value.allowedData.every(category => ["household", "income", "utility", "documents"].includes(category));
}
