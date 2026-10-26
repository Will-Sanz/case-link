import { describe, it, expect } from "vitest";
import { intakeSchema, monthlyIncome, mandateSchema } from "./domain";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";
describe("parent facts and mandate", () => {
  it("keeps unknown and zero income distinct with explicit period", () => {
    expect(intakeSchema.safeParse(fixtureIntake()).success).toBe(true);
    expect(
      intakeSchema.safeParse(
        fixtureIntake({ incomeAmount: 0, incomeFrequency: "unknown" }),
      ).success,
    ).toBe(false);
    expect(monthlyIncome(0, "monthly")).toBe(0);
    expect(monthlyIncome(100, "biweekly")).toBe(216.67);
    expect(monthlyIncome(100, "twice_monthly")).toBe(200);
    expect(monthlyIncome(100, "unknown")).toBeNull();
  });
  it("rejects duplicate needs, malformed calendar dates and unbounded permissions", () => {
    expect(
      intakeSchema.safeParse(fixtureIntake({ needs: ["food_now", "food_now"] }))
        .success,
    ).toBe(false);
    for (const shutoffDate of ["2026-99-99", "2026-02-30"])
      expect(
        intakeSchema.safeParse(fixtureIntake({ shutoffDate })).success,
      ).toBe(false);
    expect(
      mandateSchema.safeParse(fixtureMandate({ mode: "prepare_only" })).success,
    ).toBe(false);
    expect(
      mandateSchema.safeParse(fixtureMandate({ maxAttempts: 25 })).success,
    ).toBe(false);
  });
});
