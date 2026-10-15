import { addCalendarDays, schoolDate } from "../../src/lib/dates";
import type { FamilyDetail, PlanStepRow } from "../../src/types/family";
import type { SupportedRefinementRequest } from "../../scripts/ai-evaluation";

export const substantiveRefinementCaseIds = ["pilot-pending-consent", "pilot-newer-choice", "pilot-unknown-history", "pilot-completed-work", "pilot-provider-hours"];

/** Existing editable fields only: no new goals/actions, submission, or structural replanning. */
export function substantiveRefinementRequest(id: string, detail: FamilyDetail, base: PlanStepRow[], now: Date): SupportedRefinementRequest {
  const step = base[0], action = step.action_items![0];
  const preserve = " Preserve every other field, ID, date, document, contact, status, owner, note, outcome and completed record exactly. Return reviewable proposals only.";
  switch (id) {
    case "pilot-pending-consent":
      return { feedback: "Rewrite only the first goal's summary and expected result to make them concrete for this family's utilities and school-travel priorities, pending application and permission before referral. Keep the wording concise; do not imply an application must be restarted." + preserve,
        expectedChanges: [`${step.id}:description`, `${step.id}:expected_outcome`],
        reviewCriteria: ["Utilities and school travel are explicit", "Follow up the existing application", "Family review precedes referral", "Expected result is observable without promising services"] };
    case "pilot-newer-choice":
      step.description = "Call the family to discuss a referral.";
      action.description = "Telephone the family to agree a next step.";
      return { feedback: "Revise only the first goal's summary and its first action description to follow the latest meeting's in-person-only preference and postponed referral decision. Resolve the outdated telephone wording using those saved facts." + preserve,
        expectedChanges: [`${step.id}:description`, `${step.id}:${action.id}:description`],
        reviewCriteria: ["Private in-person conversation at school", "No telephone or unsolicited provider contact", "Referral decision remains postponed"] };
    case "pilot-unknown-history":
      step.details = { ...step.details, required_documents: ["Photo identification", "Agreed preparation checklist"] };
      return { feedback: "Remove only Photo identification from the first goal's required documents because no provider requirement has been verified. Keep Agreed preparation checklist exactly. Do not substitute another document." + preserve,
        expectedChanges: [`${step.id}:required_documents`], expectedDocuments: { stepId: step.id, value: ["Agreed preparation checklist"] },
        reviewCriteria: ["Only the unverified document demand is removed", "No new eligibility or documentation assumption"] };
    case "pilot-completed-work": {
      const target = addCalendarDays(schoolDate(now), 10);
      return { feedback: `Change only the draft's first open action target date to ${target}. Leave the separate Waiting action's next follow-up date and all completed work exactly as saved.` + preserve,
        expectedChanges: [`${step.id}:${action.id}:target_date`], expectedDate: { actionId: action.id, value: target },
        reviewCriteria: ["Exact requested open-action date", "Waiting follow-up and completed records unchanged", "No invented completion date"] };
    }
    case "pilot-provider-hours": {
      const resource = detail.resourceMatches[0]?.resource;
      if (!resource) throw new Error("Resource-evidence refinement requires its synthetic directory record.");
      resource.description = "Intake information can be requested on weekday mornings. Appointment availability and documentation requirements are not confirmed.";
      step.description = "The family should call the provider after work.";
      action.description = "Ask the family to miss a shift and complete intake.";
      return { feedback: "Rewrite only the first goal's summary and first action description using the directory evidence and the family's work constraint. Make the case manager's preparation practical while keeping family permission, intake availability and requirements unconfirmed. Do not impose a missed shift or assume the provider is open after work." + preserve,
        expectedChanges: [`${step.id}:description`, `${step.id}:${action.id}:description`],
        reviewCriteria: ["Uses weekday-morning information access accurately", "No after-work provider-hours claim", "Preserves work schedule", "No provider outreach before required family review", "No promised appointment or invented requirement"] };
    }
    default: throw new Error("Unknown substantive refinement scenario.");
  }
}
