import { pdfPlanFixtures } from "./pdf-plans";
import type { FamilyTakeawaySelection } from "../../src/features/families/family-takeaway-data";

export function familyTakeawayFixture() {
  const plan = pdfPlanFixtures()[0].plan;
  const step = plan.steps[0];
  plan.summary = "PRIVATE_MARKER plan summary";
  step.description = "PRIVATE_MARKER step description";
  step.details = {
    ...step.details,
    owner: "family",
    detailed_instructions: "PRIVATE_MARKER detailed instructions",
    rationale: "PRIVATE_MARKER rationale",
    expected_outcome: "PRIVATE_MARKER internal expected result",
    required_documents: ["PRIVATE_MARKER internal documents"],
    contacts: [{ name: "School support office", phone: "215-555-0148", email: "support@example.test", notes: "PRIVATE_MARKER contact notes" }],
  };
  step.workflow_data = { outcome_notes: "PRIVATE_MARKER workflow notes" };
  step.ai_helper_data = { family_explanation: "PRIVATE_MARKER unapproved AI explanation" };
  for (const action of step.action_items ?? []) {
    action.description = "PRIVATE_MARKER action narrative";
    action.notes = `${action.notes ?? ""}\nPRIVATE_MARKER progress notes`;
    action.outcome = "PRIVATE_MARKER outcome";
  }
  const selection: FamilyTakeawaySelection = {
    actionIds: ["action-1", "action-3"],
    contactKeys: ["step-1:0"],
    nextCheckIn: "2026-10-27",
    discussedWithFamily: true,
  };
  return { plan, selection };
}
