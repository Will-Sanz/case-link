import { describe, expect, it } from "vitest";
import { createDeterministicMappings } from "@/lib/paperwork/pdf-field-mapper";

const source = {
  familySummary: "Family is seeking stable housing.",
  currentCircumstances: "Temporary placement ends this month.",
  goals: ["Stable housing"],
  barriers: ["Housing instability", "Transportation"],
  planSummary: "Prioritize housing intake.",
  planActions: [{
    goal: "Stable housing",
    title: "Complete the housing intake",
    description: "Gather documents.",
    targetDate: "2026-08-10",
    status: "in_progress",
    expectedOutcome: "Housing intake submitted",
    owner: "case_manager" as const,
  }],
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

  it("maps numbered service-plan fields to the matching barrier and goal", () => {
    const mappings = createDeterministicMappings(
      [
        { name: "Contributing_Factor_2", kind: "text", options: [], maxLength: null },
        { name: "Goal_1", kind: "text", options: [], maxLength: null },
        { name: "Strategy_Case_Worker_Objective_1", kind: "text", options: [], maxLength: null },
        { name: "Target_Date_1", kind: "text", options: [], maxLength: null },
      ],
      source,
    );
    expect(mappings.map((mapping) => mapping.value)).toEqual([
      "Transportation",
      "Stable housing",
      "Complete the housing intake",
      "2026-08-10",
    ]);
  });

  it("leaves family objectives blank unless responsibility was explicitly confirmed", () => {
    const field = {
      name: "Client_Objective_1",
      kind: "text" as const,
      options: [],
      maxLength: null,
    };
    const [unconfirmed] = createDeterministicMappings([field], source);
    const [confirmed] = createDeterministicMappings([field], {
      ...source,
      planActions: [{ ...source.planActions[0], owner: "family" as const }],
    });

    expect(unconfirmed.value).toBe("");
    expect(unconfirmed.needsReview).toBe(true);
    expect(confirmed.value).toBe("Complete the housing intake");
  });
});
