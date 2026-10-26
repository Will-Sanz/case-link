import {
  NEED_LABELS,
  type NecessaryAction,
  type SupportIntake,
  type SupportNeed,
  type SupportPlan,
  type ServiceMandate,
} from "./domain";
import {
  getProgramsForNeeds,
  getProgram,
  programRoutingIssue,
} from "./programs";

export function buildSupportPlan(
  intake: SupportIntake,
  mandate: ServiceMandate,
  now: Date,
  selections: Partial<Record<SupportNeed, string>> = {},
): SupportPlan {
  const routes = intake.needs.map((need) => {
    const candidates = getProgramsForNeeds([need]).filter((p) =>
      mandate.recipientIds.includes(p.id),
    );
    const selected =
      candidates.find((p) => p.id === selections[need]) ?? candidates[0];
    if (!selected)
      return {
        need,
        programId: "",
        title: NEED_LABELS[need],
        summary: "No program is authorized for this need yet.",
        state: "checking" as const,
        nextActor: "parent" as const,
        officialUrl: "",
        sourceUrl: "",
        steps: ["Add a relevant named program to your permission."],
        limitation:
          "An expanded permission is needed before sharing with a new recipient.",
      };
    const existing = [
      "snap_renewal",
      "snap_pending",
      "snap_problem",
      "wic_continuing",
    ].includes(need);
    const routingIssue = programRoutingIssue(selected, intake.zip, now);
    if (routingIssue)
      return {
        need,
        programId: selected.id,
        title: selected.name,
        summary: routingIssue,
        state: "unresolved" as const,
        nextActor: "caselink" as const,
        officialUrl: selected.officialUrl,
        sourceUrl: selected.sourceUrl,
        steps: [
          "Check local official help; no application or referral has been sent.",
        ],
        limitation: routingIssue,
      };
    return {
      need,
      programId: selected.id,
      title: selected.name,
      summary: selected.description,
      state: "prepared" as const,
      nextActor: "caselink" as const,
      officialUrl: selected.officialUrl,
      sourceUrl: selected.sourceUrl,
      steps: [
        existing
          ? "Continue the existing benefit journey; do not start a duplicate application."
          : "Check the exact required application fields and reuse the household information already saved.",
        ...selected.personalSteps,
        "Check an actual receipt and follow the outcome; opening a link is not submission.",
      ],
      limitation:
        mandate.mode === "prepare_only"
          ? "Your current permission covers preparation. Nothing will be sent."
          : "Independent sharing and submission are waiting for this program's verified service connection. Nothing has been sent.",
    };
  });
  return {
    version: 1,
    summary:
      "Each need has its own support path. Track guidance, completed application forms and confirmed submissions separately.",
    routes,
    generatedAt: now.toISOString(),
    model: null,
  };
}
export function requiredActions(
  intake: SupportIntake,
  mandate: ServiceMandate,
): NecessaryAction[] {
  const actions: NecessaryAction[] = [];
  if (
    intake.accountAuthority === "not_sure" &&
    intake.needs.some((n) => ["electricity", "gas", "water"].includes(n))
  )
    actions.push({
      id: "account-authority",
      need: intake.needs.find((n) =>
        ["electricity", "gas", "water"].includes(n),
      )!,
      reason: "missing_fact",
      title: "Whose utility account is this?",
      explanation:
        "We need to know whether you are the account holder or have permission to act for them before using their account information.",
      field: "accountAuthority",
    });
  for (const need of intake.needs)
    if (
      !getProgramsForNeeds([need]).some((p) =>
        mandate.recipientIds.includes(p.id),
      )
    )
      actions.push({
        id: `permission-${need}`,
        need,
        reason: "expanded_permission",
        title: `Add a program for ${NEED_LABELS[need].toLowerCase()}`,
        explanation:
          "Your permission does not name a relevant program for this need. Other authorized work can continue.",
      });
  if (mandate.mode === "full")
    actions.push({
      id: "provider-connection",
      need: intake.needs[0],
      reason: "execution_issue",
      resolver: "operator",
      title: "CaseLink is verifying the service connection",
      explanation:
        "Your preparation is saved. CaseLink must verify the program's permitted delivery and status channel before it can send anything. There is nothing for you to approve again. Official help remains available.",
    });
  return actions;
}
export function validProgramSelection(
  need: SupportNeed,
  id: string,
  mandate: ServiceMandate,
): boolean {
  return (
    mandate.recipientIds.includes(id) &&
    Boolean(getProgram(id)?.needs.includes(need))
  );
}
