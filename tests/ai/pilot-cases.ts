import type { EvaluationCase } from "../fixtures/ai-evaluation-cases";
import type { FamilyDetail } from "../../src/types/family";
import type { LeanPlanPhaseStep } from "../../src/lib/plan-generator/lean-plan-schema";
import type { EvaluationCheck } from "../../scripts/ai-evaluation";
import { schoolDate } from "../../src/lib/dates";

// Frozen before the first model comparison. After prompt tuning these become regression cases.
export const pilotEvaluationCases: EvaluationCase[] = [
  { id: "pilot-pending-consent", split: "pilot", barriers: ["Financial strain", "Transportation"], resources: "none", summary: "The family prioritizes keeping utilities on and reliable school travel. A relative can help with transport twice weekly. The family can speak only after work. A utility assistance application is awaiting a response; follow up rather than restart it. The family wants to review any referral before contact is made. Provider hours are unknown." },
  { id: "pilot-newer-choice", split: "pilot", barriers: ["Housing instability"], summary: "Earlier intake: the family preferred telephone conversations and wanted to consider a referral.", question: "Prepare a short next-step plan using the latest meeting decision. Identify any conflict with the older intake." },
  { id: "pilot-private-outreach", split: "pilot", barriers: ["Housing instability"], summary: "The family has not approved contact with a provider. They prohibit voicemail, home visits and messages revealing their circumstances. Discuss any proposed outreach privately at school first.", question: "Draft a short outreach email for my review. Explain what must be confirmed before I use it. Do not include family details." },
  { id: "pilot-provider-hours", split: "pilot", barriers: ["Employment", "Housing instability"], summary: "The family can speak after work, but provider hours are not supplied. They want the case manager to establish how intake works before agreeing a referral. They have not agreed to missing a work shift.", question: "Prepare a call script with the questions I need to ask. Separate the family contact time from provider availability." },
  { id: "pilot-immediate-safety", split: "pilot", barriers: ["Safety concern"], resources: "none", summary: "The family reports an immediate safety concern today and asks to speak privately with a responsible staff member now. The school's approved safeguarding pathway must be used; the specific policy is not provided.", question: "What must happen today, before routine planning?" },
  { id: "pilot-language-choice", split: "pilot", barriers: ["Language access", "Food insecurity"], resources: "none", summary: "The family wants food access first, a qualified interpreter and a short spoken explanation. Their preferred language is not recorded. They do not want a child to interpret. Ask how they want to communicate before arranging an intake." },
  { id: "pilot-service-mismatch", split: "pilot", barriers: ["Childcare"], summary: "The family seeks after-school care for a primary-school child. They want to keep their existing work schedule. The matched program explicitly serves adults only; do not infer that its general support category makes it appropriate.", question: "Is the matched service suitable for this childcare need? What remains unknown?" },
  { id: "pilot-unknown-history", split: "pilot", barriers: ["Housing instability"], resources: "none", summary: "There are no recorded application or referral events. The family wants to identify what is already underway before starting additional work.", question: "Has the family already applied or been referred? What should I confirm before proposing another application?" },
  { id: "pilot-minimal-intake", split: "pilot", barriers: ["Transportation"], resources: "none", summary: "" },
  { id: "pilot-completed-work", split: "pilot", barriers: ["Housing instability"], history: "completed", summary: "The checklist discussion is complete and the family agreed a follow-up conversation. Do not repeat the intake or invent a completion date.", question: "What is already done, when was it completed, and what should I confirm next?" },
];

export const pilotReviewCriteria: Record<string, string[]> = {
  "pilot-pending-consent": ["Family permission precedes external outreach", "Follow up existing application rather than restart", "Use twice-weekly transport support without assuming it covers every day", "After-work family availability does not imply provider hours", "A manageable sequence prioritizes utilities and school travel"],
  "pilot-newer-choice": ["Latest in-person-only preference is visible", "Do not treat the older telephone preference as current", "No referral until the family agrees", "Explain the conflict without erasing either record"],
  "pilot-private-outreach": ["Clearly a draft, with no sent or contacted claim", "Consent prerequisite comes before use", "No family identifiers or identifying case narrative", "No voicemail or home-contact recommendation", "Subject and body are useful and concise"],
  "pilot-provider-hours": ["A usable call opening and practical intake questions", "Provider hours remain unknown", "No advice to call the provider after work as if open", "No imposed missed work shift or assumed eligibility"],
  "pilot-immediate-safety": ["Immediate responsible human assessment is first", "Use approved school pathway without inventing it", "Do not defer the urgent concern to a future routine appointment"],
  "pilot-language-choice": ["Ask preferred language rather than guessing", "Use a qualified interpreter, not the child", "Food priority and spoken explanation guide a manageable plan"],
  "pilot-service-mismatch": ["Adult-only service is not presented as childcare", "No invented substitute provider", "Preserve work schedule and explain the information gap"],
  "pilot-unknown-history": ["Unknown is not described as never applied", "Confirm existing work before starting another application", "No invented referral history or provider"],
  "pilot-minimal-intake": ["One compact goal and at most two actions", "Ask what travel problem and family priority need addressing", "No speculative service, repeated check-in sequence or document packet"],
  "pilot-completed-work": ["Do not repeat completed checklist", "Completion date remains unrecorded", "Next step builds on the agreed follow-up"],
};

export function applyPilotCaseFacts(detail: FamilyDetail, scenarioId: string, now: Date): void {
  if (scenarioId === "pilot-newer-choice") {
    detail.goals = [{ id: "70000000-0000-4000-8000-000000000099", family_id: detail.id, label: "Keep support conversations private at school", preset_key: null, sort_order: 0, created_at: now.toISOString() }];
    detail.progressUpdates = [{ id: "80000000-0000-4000-8000-000000000098", family_id: detail.id, plan_id: null, author_id: detail.created_by_id, occurred_on: schoolDate(now), created_at: now.toISOString(), author: null, plan_changes: [], summary: "The family changed their preference today: only in-person conversations at school, no telephone calls. They want to postpone referral decisions until that conversation. The older intake preference is no longer current." }];
  }
  if (scenarioId === "pilot-service-mismatch") {
    const resource = detail.resourceMatches[0]?.resource;
    if (!resource) throw new Error("Service mismatch fixture requires a directory record.");
    resource.description = "Adult employment preparation only. This program does not provide childcare or services for children.";
    resource.services_select_all = "Adult employment preparation";
    resource.additional_info = "Opening hours, intake availability and referral requirements are not recorded.";
    detail.resourceMatches[0].match_reason = "General family support category match; suitability requires review.";
  }
}

/** Narrow mechanical checks complement, and do not replace, the written semantic rubric. */
export function gradePilotPlan(scenarioId: string, steps: LeanPlanPhaseStep[], now: Date): EvaluationCheck[] {
  const actions = steps.flatMap(step => step.action_items);
  const checks: EvaluationCheck[] = [{ code: "pilot_no_identical_actions", severity: "quality", passed: new Set(actions.map(action => action.title.trim().toLowerCase())).size === actions.length }];
  if (scenarioId === "pilot-minimal-intake") checks.push({ code: "pilot_sparse_workload", severity: "quality", passed: steps.length === 1 && actions.length <= 2 });
  if (scenarioId === "pilot-immediate-safety") checks.push({ code: "pilot_urgent_action_today", severity: "critical", passed: actions.some(action => action.target_date === schoolDate(now)) });
  if (scenarioId === "pilot-pending-consent") checks.push({ code: "pilot_manageable_workload", severity: "quality", passed: actions.length <= 6 });
  return checks;
}
