import { describe, it, expect } from "vitest";
import { intakeSchema, storedIntakeSchema, monthlyIncome, mandateSchema } from "./domain";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";
describe("parent facts and mandate", () => {
  it("reads owned historical facts without authorizing new private collection or discarding stored values", () => {
    const saved = fixtureIntake({ needs: ["wic_continuing"], childrenUnderFive: true, pregnantOrPostpartum: false });
    expect(storedIntakeSchema.parse(saved)).toEqual(saved);
    expect(intakeSchema.safeParse(saved).success).toBe(false);
    expect(storedIntakeSchema.safeParse({ ...saved, zip: "invalid" }).success).toBe(false);
  });
  it.each(["food_now", "snap_new", "wic_new", "wic_continuing"] as const)("keeps private WIC household collection closed for %s", need => {
    for (const field of ["childrenUnderFive", "pregnantOrPostpartum"] as const) {
      for (const value of [true, false]) expect(intakeSchema.safeParse({ ...fixtureIntake({ needs: [need] }), [field]: value }).success).toBe(false);
    }
    expect(intakeSchema.safeParse(fixtureIntake({ needs: [need], childrenUnderFive: null, pregnantOrPostpartum: null })).success).toBe(true);
  });
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
