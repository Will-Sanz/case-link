import { describe, expect, it } from "vitest";
import {
  buildMainParagraph,
  contactsFromEditable,
  contactsToEditable,
  documentsFromEditable,
  documentsToEditable,
  formatContactDisplay,
  formatDocumentsDisplay,
  formatOutcomeDisplay,
  formatRecordNotes,
  parseMainParagraphOnSave,
  stepToCaseNoteDraft,
} from "@/features/families/plan-case-note-derive";
import type { PlanStepRow } from "@/types/family";

function makeStep(overrides: Partial<PlanStepRow> = {}): PlanStepRow {
  return {
    id: "step-1",
    plan_id: "plan-1",
    phase: "30",
    title: "Apply for housing support",
    description: "Help the family complete the application packet.",
    status: "pending",
    priority: "high",
    due_date: null,
    assigned_to_id: null,
    sort_order: 1,
    created_at: "2026-04-16T00:00:00.000Z",
    updated_at: "2026-04-16T00:00:00.000Z",
    details: null,
    workflow_data: null,
    ai_helper_data: null,
    action_items: [],
    ...overrides,
  };
}

describe("plan case note derive helpers", () => {
  it("deduplicates document lists and trims whitespace", () => {
    expect(
      documentsToEditable({
        required_documents: [" ID ", "Lease"],
        materials_needed: ["Lease", " Income proof "],
      }),
    ).toBe("ID\nLease\nIncome proof");

    expect(documentsFromEditable(" ID \n\nLease \n")).toEqual({
      required_documents: ["ID", "Lease"],
      materials_needed: undefined,
    });
  });

  it("converts contacts to and from editable text", () => {
    const editable = contactsToEditable([
      { name: "Ava", phone: "555-1000", email: "ava@example.org", notes: "Best after 3pm" },
      { name: "Ben" },
    ]);

    expect(editable).toBe("Ava · 555-1000 · ava@example.org · Best after 3pm\nBen");
    expect(contactsFromEditable(editable)).toEqual([
      { name: "Ava", phone: "555-1000", email: "ava@example.org", notes: "Best after 3pm" },
      { name: "Ben" },
    ]);
  });

  it("builds and parses the main paragraph with action items and timing", () => {
    const paragraph = buildMainParagraph(
      makeStep({
        action_items: [
          {
            id: "b",
            plan_step_id: "step-1",
            title: "Gather income documents",
            description: null,
            week_index: 0,
            target_date: null,
            status: "pending",
            sort_order: 2,
            outcome: null,
            notes: null,
            follow_up_date: null,
            created_at: "",
            updated_at: "",
          },
          {
            id: "a",
            plan_step_id: "step-1",
            title: "Call the housing office",
            description: null,
            week_index: 0,
            target_date: null,
            status: "pending",
            sort_order: 1,
            outcome: null,
            notes: null,
            follow_up_date: null,
            created_at: "",
            updated_at: "",
          },
        ],
        details: { timing_guidance: "Do this within 48 hours." },
      }),
    );

    expect(paragraph).toBe(
      "Help the family complete the application packet.\n\nPlanned tasks include Call the housing office; and Gather income documents.\n\nTiming: Do this within 48 hours.",
    );
    expect(parseMainParagraphOnSave(paragraph)).toEqual({
      description:
        "Help the family complete the application packet.\n\nPlanned tasks include Call the housing office; and Gather income documents.",
      timing_guidance: "Do this within 48 hours.",
    });
  });

  it("formats display sections and draft output", () => {
    const step = makeStep({
      details: {
        required_documents: ["Photo ID", "Lease"],
        contacts: [{ name: "Jordan", phone: "555-2000", email: "jordan@example.org" }],
        expected_outcome: "The family is approved for assistance.",
      },
      workflow_data: {
        outcome_notes: "Intake completed.",
        blocker_reason: "Awaiting landlord signature.",
      },
    });

    expect(formatDocumentsDisplay(step.details)).toBe(
      "The client will need the following: Photo ID; Lease.",
    );
    expect(formatContactDisplay(step.details)).toBe(
      "Primary contact: Jordan · 555-2000 · jordan@example.org",
    );
    expect(formatOutcomeDisplay(step.details)).toBe(
      "Expected outcome: The family is approved for assistance.",
    );
    expect(formatRecordNotes(step.workflow_data)).toBe(
      "Intake completed.\n\nCurrently blocked: Awaiting landlord signature.",
    );
    expect(stepToCaseNoteDraft(step)).toEqual({
      title: "Apply for housing support",
      mainParagraph: "Help the family complete the application packet.",
      documentsEditable: "Photo ID\nLease",
      contactEditable: "Jordan · 555-2000 · jordan@example.org",
      outcome: "The family is approved for assistance.",
    });
  });
});
