import { OUTCOME_LABELS, type SupportRoute } from "./domain";
import { authorizeOperation } from "./policy";

type OperationAuthority = Parameters<typeof authorizeOperation>[0];
export type ApplicationFieldEvidence = {
  field: string;
  label: string;
  present: boolean;
  source: "parent" | "validated_document" | "provider" | "unverified";
  verifiedAt: string | null;
  validUntil: string | null;
  conflicted: boolean;
};
export type ApplicationReadinessCheck = {
  id: string;
  label: string;
  complete: boolean;
  owner: "parent" | "caselink";
};
// Scores come from a versioned evaluation of this decision type, never a model’s self-reported confidence.
export type DecisionCalibration = {
  score: number;
  threshold: number;
  evaluationId: string;
  evaluatedAt: string;
  validUntil: string;
};

/** Readiness describes one exact operation; execution still rechecks authority at its side effect. */
export function applicationReadiness(input: {
  authority: OperationAuthority;
  requiredFields: readonly ApplicationFieldEvidence[];
  formVerified: boolean;
  transportReady: boolean;
  modelJudgmentUsed?: boolean;
  calibration?: DecisionCalibration;
}) {
  const now = input.authority.now.getTime();
  const checks: ApplicationReadinessCheck[] = input.requiredFields.map(
    (fact) => {
      const verified = Date.parse(fact.verifiedAt ?? "");
      const expiry = Date.parse(fact.validUntil ?? "");
      return {
        id: `field-${fact.field}`,
        label: fact.label,
        complete:
          fact.present &&
          fact.source !== "unverified" &&
          Number.isFinite(verified) &&
          verified <= now &&
          Number.isFinite(expiry) &&
          expiry > now &&
          !fact.conflicted,
        owner: fact.present ? "caselink" : "parent",
      };
    },
  );
  const decision = authorizeOperation(input.authority);
  checks.push(
    {
      id: "authority",
      label: decision.allowed
        ? "Current permission and required personal steps verified"
        : authorityReason(decision.reason),
      complete: decision.allowed,
      owner:
        !decision.allowed &&
        [
          "required_personal_act",
          "account_authority_unresolved",
          "booking_choice_required",
          "mandate_expired",
          "recipient_not_authorized",
          "action_not_authorized",
          "data_not_authorized",
          "preparation_only",
        ].includes(decision.reason)
          ? "parent"
          : "caselink",
    },
    {
      id: "verified-form",
      label: "Current application form and exact fields verified",
      complete: input.formVerified,
      owner: "caselink",
    },
    {
      id: "connected-submission",
      label: "Permitted application delivery connected",
      complete: input.transportReady,
      owner: "caselink",
    },
  );
  if (input.modelJudgmentUsed) {
    const calibration = input.calibration;
    const evaluated = Date.parse(calibration?.evaluatedAt ?? "");
    const expiry = Date.parse(calibration?.validUntil ?? "");
    checks.push({
      id: "evaluated-decision",
      label: "Decision meets its tested automatic-handling threshold",
      complete: Boolean(
        calibration &&
        calibration.evaluationId.trim() &&
        Number.isFinite(calibration.score) &&
        calibration.score >= 0 &&
        calibration.score <= 1 &&
        Number.isFinite(calibration.threshold) &&
        calibration.threshold > 0 &&
        calibration.threshold <= 1 &&
        calibration.score >= calibration.threshold &&
        Number.isFinite(evaluated) &&
        evaluated <= now &&
        Number.isFinite(expiry) &&
        expiry > now,
      ),
      owner: "caselink",
    });
  }
  const blockers = checks.filter((check) => !check.complete);
  return {
    automaticHandlingAllowed: blockers.length === 0,
    authorityDeniedReason: decision.allowed ? null : decision.reason,
    reviewRequired: blockers.length > 0,
    parentActionRequired: blockers.some((check) => check.owner === "parent"),
    checks,
    blockers,
  };
}

function authorityReason(reason: string): string {
  switch (reason) {
    case "required_personal_act":
      return "Complete the provider’s required personal step";
    case "account_authority_unresolved":
      return "Confirm authority for this utility account";
    case "booking_choice_required":
      return "Choose an appointment preference";
    case "preparation_only":
      return "Current permission covers preparation only";
    case "mandate_expired":
      return "Renew the expired permission";
    case "provider_permission_unverified":
      return "CaseLink must verify the provider’s execution permission";
    default:
      return "CaseLink must resolve the operation’s permission or evidence";
  }
}

/** A plan is guidance; only a matching recorded artifact establishes an application was filled. */
export function supportRouteLabel(
  route: SupportRoute,
  operations: readonly {
    programId: string;
    need?: SupportRoute["need"];
    state: string;
    artifactId?: string | null;
  }[] = [],
): string {
  if (route.state !== "prepared") return OUTCOME_LABELS[route.state];
  const prepared = operations.filter(
    (operation) =>
      operation.programId === route.programId &&
      operation.need === route.need &&
      operation.state === "prepared",
  );
  if (prepared.some((operation) => operation.artifactId))
    return "Application prepared";
  return prepared.length ? "Information packet prepared" : "Guidance ready";
}
