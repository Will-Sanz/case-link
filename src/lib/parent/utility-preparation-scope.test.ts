import { describe, expect, it } from "vitest";
import { fixtureMandate } from "./test-fixtures";
import { isUtilityPreparationMandate, type UtilityPreparationProgram } from "./utility-preparation-scope";

const permission = (programId: UtilityPreparationProgram) => fixtureMandate({ mode: "prepare_only", recipientIds: [programId],
  allowedActions: ["research", "prepare"], allowedData: ["household", "income", "utility"] });

describe("utility preparation mandate scope", () => {
  it.each<UtilityPreparationProgram>(["peco-cap", "pgw-crp", "pwd-tap"])("preserves fields-only and explicit document scope for %s", programId => {
    const value = permission(programId);
    expect(isUtilityPreparationMandate(value, programId)).toBe(true);
    expect(isUtilityPreparationMandate({ ...value, allowedData: [...value.allowedData, "documents"] }, programId)).toBe(true);
    expect(isUtilityPreparationMandate({ ...value, allowedActions: ["prepare"] }, programId)).toBe(true);
  });
  it.each([
    { mode: "full" }, { recipientIds: ["pgw-crp"] }, { recipientIds: ["peco-cap", "pgw-crp"] },
    { allowedActions: ["research"] }, { allowedActions: ["prepare", "share"] }, { allowedActions: ["prepare", "prepare"] },
    { allowedData: ["household", "income"] }, { allowedData: ["household", "utility", "documents"] },
    { allowedData: ["household", "income", "utility", "income"] }, { allowedData: ["household", "income", "utility", "health"] },
  ])("rejects changed or ambiguous scope %#", change => {
    expect(isUtilityPreparationMandate({ ...permission("peco-cap"), ...change } as ReturnType<typeof permission>, "peco-cap")).toBe(false);
  });
});
