import { expect, it } from "vitest";
import { evaluationFamily } from "../tests/fixtures/ai-evaluation-cases";
import { pilotEvaluationCases, applyPilotCaseFacts } from "../tests/ai/pilot-cases";
import { substantiveRefinementCaseIds, substantiveRefinementRequest } from "../tests/ai/refinement-cases";
import { evaluationPlan, gradeSupportedRefinement } from "./ai-evaluation";
import { toRefinementDraft } from "../src/lib/domain/plan/refinement-review";
import { findLikelyIdentifiers } from "../src/lib/privacy/no-pii";

const now = new Date("2026-10-15T12:00:00Z");
function prepared(id: string) {
  const detail = evaluationFamily(pilotEvaluationCases.find(item => item.id === id)!, now);
  applyPilotCaseFacts(detail, id, now);
  const base = evaluationPlan(detail, now);
  const request = substantiveRefinementRequest(id, detail, base, now);
  return { base, request, proposed: structuredClone(base).map(toRefinementDraft) };
}

it.each(substantiveRefinementCaseIds)("requires only explicitly requested supported fields for %s", id => {
  const { base, request, proposed } = prepared(id);
  const step = proposed[0], action = step.action_items[0];
  expect(findLikelyIdentifiers(request.feedback)).toEqual([]);
  expect(gradeSupportedRefinement(base, proposed, request).some(check => check.code === "requested_fields_changed" && !check.passed)).toBe(true);
  for (const key of request.expectedChanges) {
    if (key === `${step.id}:description`) step.description = "Review the family priority and permission together.";
    else if (key === `${step.id}:expected_outcome`) step.details.expected_outcome = "A specific next step is agreed without restarting an application.";
    else if (key === `${step.id}:${action.id}:description`) action.description = "Discuss the chosen approach privately at school.";
  }
  if (request.expectedDocuments) step.details.required_documents = request.expectedDocuments.value;
  if (request.expectedDate) action.target_date = request.expectedDate.value;
  expect(gradeSupportedRefinement(base, proposed, request).every(check => check.passed)).toBe(true);
  proposed[1].action_items[0].follow_up_date = "2026-12-01";
  proposed[1].action_items[0].target_date = "2026-12-01";
  expect(gradeSupportedRefinement(base, proposed, request).filter(check => !check.passed).map(check => check.code)).toContain("human_records_preserved");
});

it("rejects the wrong requested date even when the edit stays within the allowed field", () => {
  const { base, request, proposed } = prepared("pilot-completed-work");
  proposed[0].action_items[0].target_date = "2026-10-26";
  expect(gradeSupportedRefinement(base, proposed, request).filter(check => !check.passed).map(check => check.code)).toEqual(["requested_exact_date"]);
});
