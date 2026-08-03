import { describe, expect, it } from "vitest";
import { createDeterministicMappings } from "@/lib/paperwork/pdf-field-mapper";

const source = {
  familySummary: "Family is seeking stable housing.",
  currentCircumstances: "Temporary placement ends this month.",
  goals: ["Stable housing"],
  barriers: ["Housing instability", "Transportation"],
  planSummary: "Prioritize housing intake.",
  planSteps: [{ phase: "30", title: "Housing intake", description: "Gather documents.", action: "Complete the housing intake." }],
};

describe("createDeterministicMappings", () => {
  it("maps clearly named text fields to reviewed sources", () => {
    const [mapping] = createDeterministicMappings([{ name: "Primary_Barriers", kind: "text", options: [], maxLength: null }], source);
    expect(mapping.value).toBe("Housing instability, Transportation");
    expect(mapping.needsReview).toBe(false);
  });

  it("leaves unsupported checkbox fields for review", () => {
    const [mapping] = createDeterministicMappings([{ name: "consent", kind: "checkbox", options: [], maxLength: null }], source);
    expect(mapping.value).toBe("");
    expect(mapping.needsReview).toBe(true);
  });

  it("honors a PDF text field maximum length", () => {
    const [mapping] = createDeterministicMappings([{ name: "family_summary", kind: "text", options: [], maxLength: 10 }], source);
    expect(mapping.value).toHaveLength(10);
  });
});
