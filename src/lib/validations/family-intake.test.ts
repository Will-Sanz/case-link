import { describe, expect, it } from "vitest";
import {
  familyIntakeFormSchema,
  normalizeIntakeForDb,
} from "@/lib/validations/family-intake";

const minimumValidIntake = {
  name: "Family 014",
  summary: "",
  urgency: "" as const,
  householdNotes: "",
  initialCaseNote: "",
  goals: [],
  barriers: [{ presetKey: "housing_instability", label: "Housing instability" }],
  members: [],
};

describe("family intake", () => {
  it("accepts the minimum label and one barrier", () => {
    expect(familyIntakeFormSchema.safeParse(minimumValidIntake).success).toBe(true);
  });

  it("requires at least one barrier", () => {
    const result = familyIntakeFormSchema.safeParse({
      ...minimumValidIntake,
      barriers: [],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.barriers).toContain(
        "Choose at least one barrier",
      );
    }
  });

  it("normalizes optional fields without inventing family details", () => {
    const parsed = familyIntakeFormSchema.parse({
      ...minimumValidIntake,
      name: "  Family 014  ",
      summary: "  Needs support with stable housing.  ",
      barriers: [
        { presetKey: "housing_instability", label: "  Housing instability  " },
        { presetKey: null, label: "  School attendance  " },
      ],
    });

    expect(normalizeIntakeForDb(parsed)).toMatchObject({
      name: "Family 014",
      summary: "Needs support with stable housing.",
      urgency: null,
      barriers: [
        { presetKey: "housing_instability", label: "Housing instability" },
        { presetKey: null, label: "School attendance" },
      ],
    });
  });
});
