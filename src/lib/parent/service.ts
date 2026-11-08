import { createHash } from "node:crypto";
import { z } from "zod";
import { DOCUMENT_CONSENT_VERSION } from "./constants";
import { factAnswerSchema } from "./answers";
import { currentIntakeFields } from "./current-intake-fields";
import type { CoordinatorResult } from "./coordinator";
import {
  OUTCOME_PROGRESS as outcomeOrder,
  type NecessaryAction,
  type OutcomeState,
  type ParentDocument,
  type ServiceMandate,
  type SupportAction,
  type SupportNeed,
  type SupportPlan,
  type SupportRequest,
  type SupportRoute,
} from "./domain";
import {
  extractedFactsSchema,
  validateExtractedFacts,
  type ExtractedFacts,
} from "./documents";
import {
  hasUtilityAccountAuthority,
  utilityProviderFor,
  receiptSchema,
  type ProposedOperation,
  type ProviderCapability,
} from "./policy";
import {
  getProgram,
  getProgramsForNeeds,
  programRoutingIssue,
  supportsInitialServiceDelivery,
} from "./programs";
import { sameSnapProtectedPacket, snapProtectedOperationSchema, type SnapProtectedOperation } from "./snap-protected-operation";
import type { SnapCaptureProgress } from "./snap-capture-progress";
import { snapTransportFailureSchema } from "./snap-protected-submission-port";

export type ServiceReceipt = z.infer<typeof receiptSchema>;
export type ServiceDocument = ParentDocument & {
  consentVersion: string;
  facts?: ExtractedFacts;
  validatedAt?: string;
  sourceObservedAt?: string;
  factsExpiresAt?: string;
};
export type ServiceOperation = {
  id: string;
  need: SupportNeed;
  programId: string;
  action: SupportAction;
  state: OutcomeState | "delivery_unknown";
  idempotencyKey: string;
  packet: Record<string, unknown>;
  updatedAt: string;
  createdAt?: string;
  executedAt?: string;
  receipt?: ServiceReceipt;
  snapSubmissionAuthorized?: boolean;
  protectedSnap?: SnapProtectedOperation;
};
const personalActSchema = z
  .object({
    id: z.string().min(1).max(100),
    title: z.string().min(1).max(160),
    explanation: z.string().min(1).max(1000),
    url: z.url().optional(),
  })
  .strict();
export const serviceFormSchema = z
  .object({
    programId: z.string().min(1).max(60),
    templateId: z.string().min(1).max(100),
    version: z.string().min(1).max(100),
    artifactId: z.string().min(1).max(200).optional(),
    contentSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    formInputDigest: z.string().regex(/^[a-f0-9]{64}$/),
    validated: z.literal(true),
    preparationOnly: z.boolean().optional(),
    snapApplication: z.object({
      snapshotId: z.uuid(), snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
      state: z.enum(["ready", "needs_current_facts", "service_blocked"]),
      missingFields: z.array(z.string().min(1).max(200)).max(2000),
      invalidCurrentFields: z.array(z.string().min(1).max(200)).max(2000),
      staleFields: z.array(z.string().min(1).max(200)).max(2000),
      serviceQuestions: z.array(z.string().min(1).max(100)).max(20),
      renderingRequirements: z.array(z.string().min(1).max(100)).max(20),
      dataCategories: z.array(z.enum(["household", "income"])).min(1).max(2),
    }).strict().optional(),
    personalActs: z.array(personalActSchema).max(10).default([]),
    missingFields: z.array(z.string().min(1).max(100)).max(20).default([]),
  })
  .strict()
  .refine(
    (form) =>
      form.missingFields.length > 0 || form.snapApplication?.state === "service_blocked" ||
      !!(form.artifactId && form.contentSha256),
    "An executable form needs its exact stored artifact.",
  );
export type ServiceForm = z.infer<typeof serviceFormSchema>;
export type ServiceCapability = ProviderCapability & {
  requiredPersonalActs?: z.infer<typeof personalActSchema>[];
  requiresForm?: boolean;
  allowedFields?: string[];
  privateSnapPreview?: true;
  protectedSubmissionConfigured?: boolean;
  snapStatusTransportConfigured?: boolean;
};
export type ServiceProposedOperation = ProposedOperation & {
  need: SupportNeed;
  form?: ServiceForm;
};
export type ServiceExecutionResult = {
  state: OutcomeState | "delivery_unknown" | "blocked";
  reason?: string;
  receipt?: ServiceReceipt;
  transportStatus?: "FAILURE";
};
export type ServiceEvent = {
  id: string;
  need: SupportNeed;
  programId: string;
  kind: string;
  summary: string;
  receipt?: ServiceReceipt;
};
export type ServicePorts = {
  coordinate(request: SupportRequest): Promise<CoordinatorResult>;
  extractDocument(document: ServiceDocument): Promise<{
    facts: unknown;
    sourcePages: string[];
    sourceObservedAt?: string;
    pageCount?: number;
  }>;
  saveDocumentFacts(
    id: string,
    facts: ExtractedFacts,
    metadata?: { sourceObservedAt?: string; pageCount?: number },
  ): Promise<void>;
  capability(
    programId: string,
    action: SupportAction,
    need?: SupportNeed,
  ): Promise<ServiceCapability | null>;
  execute(operation: ServiceProposedOperation): Promise<ServiceExecutionResult>;
  /** Freeze an authorized preparation or exact packet without beginning delivery. */
  prepareOperation(operation: ServiceProposedOperation): Promise<void>;
  personalActsComplete(operation: ServiceProposedOperation): Promise<boolean>;
  reconcile(operation: ServiceOperation): Promise<unknown | null>;
  fillForm(
    programId: string,
    packet: Record<string, unknown>,
    need?: SupportNeed,
  ): Promise<ServiceForm | null>;
  /** The outbox deduplicates by event.id and checks current notification preferences. */
  notify(event: ServiceEvent): Promise<void>;
};
export type ServiceResult = {
  plan: SupportPlan;
  requiredActions: NecessaryAction[];
  nextRunAt: string | null;
  nextActor: "caselink" | "parent" | "operator" | "agency" | null;
  nextTrigger:
    | "scheduled_follow_up"
    | "parent_action_completed"
    | "provider_capability_enabled"
    | "verified_receipt_available"
    | "authorization_renewed"
    | "route_review_required"
    | "none";
  events: ServiceEvent[];
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
};
const utilityNeeds: SupportNeed[] = ["electricity", "gas", "water"];
const fieldQuestions: Record<string, { title: string; explanation: string }> = {
  income: {
    title: "What is your household income before taxes?",
    explanation:
      "This program requires an income amount and how often you receive it. Zero income is a valid answer.",
  },
  zip: {
    title: "What ZIP code is this household in?",
    explanation: "This program needs the household ZIP code to continue.",
  },
  householdSize: {
    title: "How many people are in your household?",
    explanation:
      "This program needs your household size. Include the people its instructions say to count.",
  },
  incomeAmount: {
    title: "What is your household income before taxes?",
    explanation:
      "This program requires an income amount and how often you receive it. Zero income is a valid answer.",
  },
  incomeFrequency: {
    title: "How often is that income received?",
    explanation:
      "This program needs the period for the income amount, so a weekly amount is not treated as monthly income.",
  },
  utilityProvider: {
    title: "Which utility provider is on this bill?",
    explanation:
      "The program needs the provider shown on this account. We will not guess from your address.",
  },
  accountAuthority: {
    title: "Can you act for this utility account?",
    explanation:
      "Confirm whether you hold the account or have permission to act for its holder.",
  },
  amountDue: {
    title: "What amount is currently due on the bill?",
    explanation:
      "This program requires the amount due. It can differ from the total account balance.",
  },
  totalBalance: {
    title: "What total balance is on the bill?",
    explanation:
      "This program requires the total account balance, which may differ from the current amount due.",
  },
  dueDate: {
    title: "What payment due date is shown?",
    explanation:
      "Use the bill’s payment due date. A shutoff date is a separate fact.",
  },
  shutoffDate: {
    title: "What shutoff date is on the notice?",
    explanation:
      "Use the notice’s shutoff or disconnection date, rather than the payment due date.",
  },
};
const factCategories: Record<string, ServiceMandate["allowedData"][number]> = {
  zip: "household",
  householdSize: "household",
  income: "income",
  incomeAmount: "income",
  incomeFrequency: "income",
  utilityProvider: "utility",
  accountAuthority: "utility",
  amountDue: "utility",
  totalBalance: "utility",
  dueDate: "utility",
  shutoffDate: "utility",
  documentIds: "documents",
};
const categoryLabels = {
  household: "household details",
  income: "income information",
  utility: "utility details",
  documents: "supporting documents",
};
const dateValue = (value: string | undefined) =>
  value ? Date.parse(value.length === 10 ? `${value}T12:00:00Z` : value) : NaN;
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

function documentPeriodIsCurrent(
  document: ServiceDocument,
  facts: ExtractedFacts,
  now: Date,
): boolean {
  const sourceDate =
    document.sourceObservedAt ??
    facts.dueDate ??
    facts.shutoffDate ??
    undefined;
  const asOf = dateValue(sourceDate);
  if (
    !Number.isFinite(asOf) ||
    asOf < now.getTime() - 45 * 86400000 ||
    asOf > now.getTime() + (document.sourceObservedAt ? 1 : 60) * 86400000
  )
    return false;
  if (
    facts.shutoffDate &&
    dateValue(facts.shutoffDate) < dateValue(now.toISOString().slice(0, 10))
  )
    return false;
  return true;
}
function sameNeed(route: SupportRoute, need: SupportNeed) {
  return route.need === need;
}
function advance(route: SupportRoute, receipt: ServiceReceipt): SupportRoute {
  const current = outcomeOrder[route.state] ?? -1;
  const next = outcomeOrder[receipt.state] ?? -1;
  if (receipt.state !== "declined" && current > next) return route;
  return {
    ...route,
    state: receipt.state,
    nextActor: receipt.state === "support_received" ? "agency" : "caselink",
    limitation: null,
  };
}
function packetFor(
  request: SupportRequest,
  route: SupportRoute,
  documents: { document: ServiceDocument; facts: ExtractedFacts }[],
  now: Date,
): Record<string, unknown> {
  const { intake, mandate } = request;
  const packet: Record<string, unknown> = { ...currentIntakeFields(request, now, route.need) };
  if (
    utilityNeeds.includes(route.need) &&
    mandate.allowedData.includes("utility")
  ) {
    packet.utilityProvider = utilityProviderFor(request, route.need, now);
    if (intake.accountAuthority !== "not_sure")
      packet.accountAuthority = intake.accountAuthority;
    if (intake.shutoffDate) packet.shutoffDate = intake.shutoffDate;
  }
  // A fresh explicit parent answer overrides document evidence only for its named need.
  for (const fact of (request.facts ?? []).filter((fact) =>
    fact && !["zip", "householdSize", "income", "incomeAmount", "incomeFrequency"].includes(fact.field),
  ).sort(
    (a, b) => dateValue(a.confirmedAt) - dateValue(b.confirmedAt),
  )) {
    const confirmed = dateValue(fact.confirmedAt),
      asOf = dateValue(fact.asOf);
    if (
      fact.need !== route.need ||
      fact.source !== "parent" ||
      !Number.isFinite(confirmed) ||
      confirmed > now.getTime() ||
      !Number.isFinite(asOf) ||
      asOf > now.getTime() ||
      asOf < now.getTime() - 45 * 86400000
    )
      continue;
    const answer = factAnswerSchema.safeParse({
      need: fact.need,
      field: fact.field,
      value: fact.value,
      version: request.version,
    });
    if (!answer.success) continue;
    if (mandate.allowedData.includes("utility")) packet[fact.field] = fact.value;
  }
  if (
    utilityNeeds.includes(route.need) &&
    mandate.allowedData.includes("utility")
  ) {
    if (mandate.allowedData.includes("documents")) {
      const relevant = documents
        .filter(
          ({ facts, document }) =>
            facts.provider === packet.utilityProvider &&
            ["peco", "pgw", "pwd"].includes(String(packet.utilityProvider)) &&
            dateValue(document.created_at) >=
              (dateValue(request.account_changed_at?.[route.need]) ||
                -Infinity),
        )
        .sort(
          (a, b) =>
            dateValue(
              b.document.sourceObservedAt ??
                b.facts.dueDate ??
                b.facts.shutoffDate ??
                undefined,
            ) -
            dateValue(
              a.document.sourceObservedAt ??
                a.facts.dueDate ??
                a.facts.shutoffDate ??
                undefined,
            ),
        );
      const latest = relevant[0];
      if (latest) {
        const samePeriod = relevant.filter(
          (candidate) =>
            (candidate.document.sourceObservedAt ?? candidate.facts.dueDate) ===
            (latest.document.sourceObservedAt ?? latest.facts.dueDate),
        );
        const conflict = (
          ["amountDue", "totalBalance", "dueDate", "shutoffDate"] as const
        ).some(
          (field) =>
            new Set(
              samePeriod
                .map((candidate) => candidate.facts[field])
                .filter((value) => value !== null),
            ).size > 1,
        );
        if (!conflict) {
          for (const field of [
            "amountDue",
            "totalBalance",
            "dueDate",
            "shutoffDate",
          ] as const)
            if (latest.facts[field] !== null && packet[field] === undefined)
              packet[field] = latest.facts[field];
          if (
            latest.document.status !== "raw_deleted" &&
            Date.parse(latest.document.expires_at) > now.getTime()
          )
            packet.documentIds = [latest.document.id];
        }
      }
    }
  }
  return packet;
}
function packetCategories(
  packet: Record<string, unknown>,
): ServiceMandate["allowedData"] {
  const categories = new Set<ServiceMandate["allowedData"][number]>();
  for (const field of Object.keys(packet)) {
    if (["zip", "householdSize"].includes(field)) categories.add("household");
    else if (["incomeAmount", "incomeFrequency"].includes(field))
      categories.add("income");
    else if (field === "documentIds") categories.add("documents");
    else if (field === "statusReference") categories.add("household");
    else categories.add("utility");
  }
  return [...categories];
}

/** A service turn prepares and pursues independent needs; registered ports enforce authority again at each side effect. */
export async function runSupportService(input: {
  request: SupportRequest;
  documents: ServiceDocument[];
  operations?: ServiceOperation[];
  unknownOperations?: ServiceOperation[];
  snapCapture?: { state: SnapCaptureProgress["state"]; reason: SnapCaptureProgress["reason"]; retryAt?: string };
  jobAttempts?: number;
  now: Date;
  ports: ServicePorts;
}): Promise<ServiceResult> {
  const { request, now, ports } = input;
  const expiry = Date.parse(request.mandate.expiresAt);
  const emptyPlan: SupportPlan = {
    version: 1,
    summary: "Support work is waiting for valid authorization.",
    routes: [],
    generatedAt: now.toISOString(),
    model: null,
  };
  const idle: ServiceResult = {
    plan: request.plan ?? emptyPlan,
    requiredActions: request.required_actions,
    nextRunAt: null,
    nextActor: null,
    nextTrigger: "none",
    events: [],
    modelCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
  if (request.status !== "active") return idle;
  if (!Number.isFinite(expiry) || expiry <= now.getTime())
    return {
      ...idle,
      nextActor: "parent",
      nextTrigger: "authorization_renewed",
    };
  const currentAccountOperation = (operation: ServiceOperation) =>
    !request.account_changed_at?.[operation.need] ||
    dateValue(operation.createdAt ?? operation.updatedAt) >=
      dateValue(request.account_changed_at[operation.need]);
  const operations = [
    ...(input.operations ?? []),
    ...(input.unknownOperations ?? []),
  ].filter(
    (operation, index, all) =>
      all.findIndex((other) => other.id === operation.id) === index,
  );
  const validDocuments: { document: ServiceDocument; facts: ExtractedFacts }[] =
    [];
  const documentIssues: string[] = [];
  if (
    request.mandate.allowedData.includes("documents") &&
    request.mandate.allowedData.includes("utility") &&
    request.intake.needs.some((need) => utilityNeeds.includes(need))
  ) {
    for (const document of [...input.documents].sort((a, b) =>
      a.id.localeCompare(b.id),
    )) {
      const rawAvailable =
        document.status !== "raw_deleted" &&
        Number.isFinite(Date.parse(document.expires_at)) &&
        Date.parse(document.expires_at) > now.getTime();
      const derivedAvailable =
        document.status === "raw_deleted" &&
        !!document.factsExpiresAt &&
        Date.parse(document.factsExpiresAt) > now.getTime();
      if (
        document.request_id !== request.id ||
        document.consentVersion !== DOCUMENT_CONSENT_VERSION ||
        ["deleted", "deletion_pending"].includes(document.status) ||
        (!rawAvailable && !derivedAvailable)
      )
        continue;
      try {
        let sourcedDocument = document;
        let facts = document.facts
          ? extractedFactsSchema.parse(document.facts)
          : undefined;
        let validatedAt = document.validatedAt;
        const derivedStillValid =
          !!document.factsExpiresAt &&
          Number.isFinite(Date.parse(document.factsExpiresAt)) &&
          Date.parse(document.factsExpiresAt) > now.getTime();
        if (
          !facts ||
          !["validated", "raw_deleted"].includes(document.status) ||
          !validatedAt ||
          !Number.isFinite(Date.parse(validatedAt)) ||
          Date.parse(validatedAt) > now.getTime() ||
          (!derivedStillValid &&
            Date.parse(validatedAt) < now.getTime() - 86400000)
        ) {
          if (!rawAvailable) {
            documentIssues.push(document.id);
            continue;
          }
          const extracted = await ports.extractDocument(document);
          sourcedDocument = {
            ...document,
            ...(extracted.sourceObservedAt
              ? { sourceObservedAt: extracted.sourceObservedAt }
              : {}),
          };
          facts = validateExtractedFacts(
            extracted.facts,
            extracted.sourcePages,
          );
          if (!documentPeriodIsCurrent(sourcedDocument, facts, now)) {
            documentIssues.push(document.id);
            continue;
          }
          await ports.saveDocumentFacts(document.id, facts, {
            ...(extracted.sourceObservedAt
              ? { sourceObservedAt: extracted.sourceObservedAt }
              : {}),
            ...(extracted.pageCount ? { pageCount: extracted.pageCount } : {}),
          });
          validatedAt = now.toISOString();
        }
        if (!documentPeriodIsCurrent(sourcedDocument, facts, now)) {
          documentIssues.push(document.id);
          continue;
        }
        if (
          request.intake.shutoffDate &&
          facts.shutoffDate &&
          request.intake.shutoffDate !== facts.shutoffDate
        ) {
          documentIssues.push(document.id);
          continue;
        }
        validDocuments.push({
          document: { ...sourcedDocument, validatedAt },
          facts,
        });
      } catch {
        documentIssues.push(document.id);
      }
    }
  }
  const effectiveIntake = { ...request.intake };
  const currentAccountDocuments = validDocuments.filter(({ document, facts }) =>
    request.intake.needs.some(
      (need) =>
        utilityNeeds.includes(need) &&
        facts.provider ===
          (
            { electricity: "peco", gas: "pgw", water: "pwd" } as Record<
              string,
              string
            >
          )[need] &&
        (!request.account_changed_at?.[need] ||
          dateValue(document.created_at) >=
            dateValue(request.account_changed_at[need])),
    ),
  );
  const providers = [
    ...new Set(
      currentAccountDocuments
        .map(({ facts }) => facts.provider)
        .filter(
          (provider): provider is "peco" | "pgw" | "pwd" =>
            provider !== "unknown",
        ),
    ),
  ];
  if (
    (!effectiveIntake.utilityProviders.length ||
      effectiveIntake.utilityProviders.every(
        (provider) => provider === "unknown",
      )) &&
    providers.length
  )
    effectiveIntake.utilityProviders = providers;
  const shutoffDates = [
    ...new Set(
      currentAccountDocuments.flatMap(({ facts }) =>
        facts.shutoffDate ? [facts.shutoffDate] : [],
      ),
    ),
  ];
  if (
    !effectiveIntake.shutoffDate &&
    shutoffDates.length === 1 &&
    effectiveIntake.needs.filter((need) => utilityNeeds.includes(need))
      .length === 1
  )
    effectiveIntake.shutoffDate = shutoffDates[0];
  const coordinated = await ports.coordinate({ ...request, intake: effectiveIntake });
  const plan = {
    ...coordinated.plan,
    routes: coordinated.plan.routes
      .filter(
        (route, index, all) =>
          request.intake.needs.includes(route.need) &&
          all.findIndex((other) => other.need === route.need) === index,
      )
      .map((route) => {
        const previous = request.plan?.routes.find(
          (previous) =>
            sameNeed(previous, route.need) &&
            (!request.account_changed_at?.[route.need] ||
              dateValue(request.plan?.generatedAt) >=
                dateValue(request.account_changed_at[route.need])),
        );
        let restored =
          previous &&
          ((outcomeOrder[previous.state] ?? 0) >= 2 ||
            previous.state === "declined")
            ? { ...previous }
            : { ...route };
        const history = operations
          .filter(
            (operation) =>
              operation.need === route.need &&
              currentAccountOperation(operation) &&
              receiptSchema.safeParse(operation.receipt).success &&
              getProgram(operation.programId)?.needs.includes(route.need),
          )
          .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
        const programs = new Map<string, SupportRoute>();
        for (const operation of history) {
          const program = getProgram(operation.programId)!;
          const current = programs.get(program.id) ?? {
            ...route,
            programId: program.id,
            title: program.name,
            summary: program.description,
            officialUrl: program.officialUrl,
            sourceUrl: program.sourceUrl,
          };
          programs.set(
            program.id,
            current.state === "support_received"
              ? current
              : advance(current, operation.receipt!),
          );
        }
        const strongest = [...programs.values()].sort(
          (a, b) =>
            (outcomeOrder[b.state] ?? -1) - (outcomeOrder[a.state] ?? -1),
        )[0];
        if (
          strongest &&
          (!previous ||
            (outcomeOrder[previous.state] ?? -1) < 2 ||
            (outcomeOrder[strongest.state] ?? -1) >=
              (outcomeOrder[previous.state] ?? -1))
        )
          restored = strongest;
        return restored;
      }),
  };
  const actions = coordinated.requiredActions.filter(
    (action) =>
      action.id !== "provider-connection" &&
      action.field !== "accountAuthority",
  );
  for (const action of request.required_actions.filter(
    (action) => !action.resolved && action.reason === "qualified_help",
  ))
    if (!actions.some((existing) => existing.id === action.id))
      actions.push(action);
  const events: ServiceEvent[] = [];
  const nextRuns: number[] = [];
  let unknownDelivery = false;
  let routesExhausted = false;
  let captureRetryActionId: string | undefined;
  const reconciliationActionIds = new Set<string>();
  const addAction = (
    route: SupportRoute,
    reason: NecessaryAction["reason"],
    title: string,
    explanation: string,
    resolver: "parent" | "operator" = "operator",
    field?: string,
    key?: string,
  ) => {
    const id = `service-${route.need}-${reason}${key ? `-${digest(key).slice(0, 10)}` : ""}`;
    if (!actions.some((action) => action.id === id))
      actions.push({
        id,
        need: route.need,
        reason,
        title,
        explanation,
        resolver,
        ...(field ? { field } : {}),
        ...(resolver === "parent" && reason !== "submission_review" && field !== "snap_personal_pages" && getProgram(route.programId)
          ? { url: getProgram(route.programId)!.officialUrl }
          : {}),
      });
    return id;
  };
  const scheduleProtectedReconciliation = async (canonical: SnapProtectedOperation | undefined, attemptedAt: string,
    knownCapability?: ServiceCapability | null) => {
    try {
      const attempts = input.jobAttempts;
      if (!canonical || canonical.requestId !== request.id || !snapProtectedOperationSchema.safeParse(canonical).success ||
        request.mandate.mode !== "full" || !request.mandate.allowedActions.includes("follow_up") ||
        !request.mandate.allowedData.includes("household") || !request.mandate.recipientIds.includes("snap-pa") ||
        typeof attempts !== "number" || !Number.isInteger(attempts) || attempts < 1 || attempts >= 48) return false;
      const capability = knownCapability ?? await ports.capability("snap-pa", "follow_up");
      if (!capability?.enabled || capability.programId !== "snap-pa" || !capability.actions.includes("follow_up") ||
        !capability.permissionReference || !capability.permissionExpiresAt || !capability.dataCategories.includes("household") ||
        capability.protectedSubmissionConfigured !== true) return false;
      const started = Date.parse(attemptedAt), retry = now.getTime() + 300000;
      const deadline = Math.min(started + 7200000, expiry, Date.parse(capability.permissionExpiresAt));
      if (!Number.isFinite(started) || started > now.getTime() || !Number.isFinite(deadline) || retry >= deadline) return false;
      nextRuns.push(retry); return true;
    } catch { return false; }
  };
  const record = async (route: SupportRoute, receipt?: ServiceReceipt) => {
    const prior = request.plan?.routes.find((previous) =>
      sameNeed(previous, route.need),
    );
    if (prior?.state === route.state && prior.programId === route.programId)
      return;
    const event: ServiceEvent = {
      id: digest({
        request: request.id,
        version: request.version,
        need: route.need,
        program: route.programId,
        state: route.state,
        reference: receipt?.reference ?? null,
      }),
      need: route.need,
      programId: route.programId,
      kind: `support.${route.state}`,
      summary: `${getProgram(route.programId)?.name ?? "Support"}: ${route.state.replaceAll("_", " ")}.`,
      ...(receipt ? { receipt } : {}),
    };
    events.push(event);
  };
  for (let index = 0; index < plan.routes.length; index++) {
    let route = plan.routes[index];
    try {
      let canonical: SnapProtectedOperation | undefined;
      const protectedCandidates = route.need === "snap_new" ? operations.filter(operation => operation.state === "prepared" &&
        Object.hasOwn(operation.packet, "protectedSnapPacket") && (!operation.protectedSnap || operation.protectedSnap.requestVersion === request.version)) : [];
      if (request.mandate.mode === "full" && protectedCandidates.length && (outcomeOrder[route.state] ?? 0) < 2) {
        for (let actionIndex = actions.length - 1; actionIndex >= 0; actionIndex--)
          if (actions[actionIndex].need === route.need && actions[actionIndex].reason === "missing_fact") actions.splice(actionIndex, 1);
        const owned = protectedCandidates[0], parsed = snapProtectedOperationSchema.safeParse(owned.protectedSnap);
        if (protectedCandidates.length !== 1 || !parsed.success || parsed.data.state !== "prepared" || !parsed.data.protectedPacketCurrent ||
          parsed.data.requestId !== request.id || parsed.data.operationId !== owned.id || parsed.data.idempotencyKey !== owned.idempotencyKey ||
          parsed.data.programId !== owned.programId || parsed.data.need !== owned.need || parsed.data.action !== owned.action ||
          !sameSnapProtectedPacket(parsed.data.packet, owned.packet)) {
          addAction(route, "execution_issue", "CaseLink is checking the prepared application",
            "The exact current application or its authority needs a service check. Your saved work remains recorded.");
          plan.routes[index] = route; continue;
        }
        canonical = parsed.data;
        const snap = getProgram("snap-pa")!;
        route = { ...route, programId: snap.id, title: snap.name, summary: snap.description, officialUrl: snap.officialUrl, sourceUrl: snap.sourceUrl };
      }
      let program = getProgram(route.programId);
      if (!program || !program.needs.includes(route.need)) continue;
      if (!request.mandate.recipientIds.includes(program.id)) {
        addAction(
          route,
          "expanded_permission",
          "Review permission for an existing program",
          "There is a recorded attempt with this program, but the current permission does not include it. Its status must be reconciled before a new application is started.",
          "parent",
        );
        plan.routes[index] = route;
        continue;
      }
      if (documentIssues.length && utilityNeeds.includes(route.need))
        addAction(
          route,
          "execution_issue",
          "A document needs a source check",
          "CaseLink must check the document’s readable evidence and applicable period. Other useful work can continue; no uncertain document values will be sent.",
        );
      const needHistory = operations.filter(
        (operation) =>
          operation.need === route.need && currentAccountOperation(operation),
      );
      let history = needHistory.filter(
        (operation) => operation.programId === route.programId,
      );
      const unknown = operations.filter(
        (operation) =>
          operation.need === route.need &&
          operation.state === "delivery_unknown",
      );
      let stillUnknown = false;
      let unresolvedRetries = true;
      let transportFailed = false;
      for (const operation of unknown) {
        if (
          request.mandate.mode !== "full" ||
          !request.mandate.allowedActions.includes("follow_up")
        ) {
          stillUnknown = true;
          unresolvedRetries = false;
          continue;
        }
        try {
          const currentCapability = await ports.capability(
            operation.programId,
            "follow_up",
          );
          if (!request.mandate.recipientIds.includes(operation.programId)) {
            addAction(
              route,
              "expanded_permission",
              "Review permission to check an earlier attempt",
              "A previous attempt remains unconfirmed with a program outside your current permission. We need specific permission or verified evidence before starting another application.",
              "parent",
              "recipientIds",
            );
            stillUnknown = true;
            unresolvedRetries = false;
            continue;
          }
          if (
            !currentCapability?.enabled ||
            !currentCapability.actions.includes("follow_up") ||
            !currentCapability.permissionReference ||
            !currentCapability.permissionExpiresAt ||
            Date.parse(currentCapability.permissionExpiresAt) <= now.getTime()
          ) {
            stillUnknown = true;
            unresolvedRetries = false;
            continue;
          }
          const observed = await ports.reconcile(operation);
          if (operation.protectedSnap && snapTransportFailureSchema.safeParse(observed).success) {
            stillUnknown = true; transportFailed = true; unresolvedRetries = false;
            continue;
          }
          const receipt = receiptSchema.safeParse(observed);
          if (!receipt.success) {
            stillUnknown = true;
            unresolvedRetries = await scheduleProtectedReconciliation(operation.protectedSnap,
              operation.executedAt ?? operation.updatedAt, currentCapability) && unresolvedRetries;
            continue;
          }
          // A real old-account receipt remains history; it does not complete the changed account.
          if (!currentAccountOperation(operation)) continue;
          if (route.programId !== operation.programId) {
            const original = getProgram(operation.programId)!;
            route = {
              ...route,
              programId: original.id,
              title: original.name,
              summary: original.description,
              officialUrl: original.officialUrl,
              sourceUrl: original.sourceUrl,
            };
            history = needHistory.filter(
              (item) => item.programId === original.id,
            );
          }
          route = advance(route, receipt.data);
          history.push({
            ...operation,
            state: receipt.data.state,
            receipt: receipt.data,
            updatedAt: receipt.data.recordedAt,
          });
          await record(route, receipt.data);
        } catch {
          stillUnknown = true;
          unresolvedRetries = await scheduleProtectedReconciliation(operation.protectedSnap,
            operation.executedAt ?? operation.updatedAt) && unresolvedRetries;
        }
      }
      if (stillUnknown) {
        unknownDelivery = true;
        const issueId = addAction(
          route,
          "execution_issue",
          transportFailed ? "Resolve the failed fax transmission" : "Confirm the previous delivery",
          transportFailed ? "The fax service reported a failed transmission. Some pages may have arrived. CaseLink must check agency receipt and the permitted next step before any resend."
            : "The previous attempt has no reliable receipt yet. CaseLink must reconcile it before retrying; nothing will be blindly resubmitted.",
        );
        if (unresolvedRetries) reconciliationActionIds.add(issueId);
        route.nextActor = "caselink";
        plan.routes[index] = route;
        continue;
      }
      if ((outcomeOrder[route.state] ?? 0) >= 2) canonical = undefined;
      if (route.need === "snap_new" && input.snapCapture && input.snapCapture.state !== "checked" && (outcomeOrder[route.state] ?? 0) < 2) {
        for (let actionIndex = actions.length - 1; actionIndex >= 0; actionIndex--)
          if (actions[actionIndex].need === route.need && actions[actionIndex].reason === "missing_fact") actions.splice(actionIndex, 1);
        const reason = input.snapCapture.reason;
        const personal: Record<string, [string, string]> = {
          page_1_unreadable: ["Retake the first personal application page", "The first personal page could not be read. Replace it through the protected application pages; your saved answers stay reused."],
          page_5_unreadable: ["Retake the certification application page", "The certification page could not be read. Replace it through the protected application pages; your saved answers stay reused."],
          applicant_identifier_needed: ["Complete the required secure identifier step", "A required applicant identifier or accepted exception needs protected entry. Use the protected application pages and keep identifiers out of chat."],
          personal_mark_or_date_needed: ["Complete the required personal marks and dates", "The exact application still needs a required personal mark or date. Complete that step through the protected application pages."],
          facts_correction_needed: ["Check the personal application pages", "The saved answers and personal pages differ. Review the exact application and correct only the affected information."],
        };
        if (input.snapCapture.state === "needs_parent" && reason && personal[reason]) {
          addAction(route, "personal_step", ...personal[reason], "parent", "snap_personal_pages", reason); route.nextActor = "parent";
        } else {
          const issueId = addAction(route, "execution_issue", "CaseLink is checking your saved application",
            "The exact file is saved, but its private check or permitted source needs a service check. Nothing has been submitted."); route.nextActor = "caselink";
          const retry = Date.parse(input.snapCapture.retryAt ?? "");
          if (Number.isFinite(retry) && retry>=now.getTime()+30000 && retry<expiry && (input.snapCapture.state === "pending" || reason === "check_unavailable")) {
            nextRuns.push(retry); captureRetryActionId = issueId;
          }
        }
        plan.routes[index] = route; continue;
      }
      if (route.state === "support_received" || route.state === "withdrawn") {
        plan.routes[index] = route;
        continue;
      }
      if (
        utilityNeeds.includes(route.need) &&
        request.mandate.allowedData.includes("utility")
      ) {
        const accountPacket = packetFor(
          { ...request, intake: effectiveIntake },
          route,
          validDocuments,
          now,
        );
        const expectedProvider = (
          { electricity: "peco", gas: "pgw", water: "pwd" } as Record<
            string,
            string
          >
        )[route.need];
        if (accountPacket.utilityProvider !== expectedProvider) {
          if ((outcomeOrder[route.state] ?? 0) < 2) route.state = "unresolved";
          if (accountPacket.utilityProvider === "unknown") {
            addAction(
              route,
              "missing_fact",
              "Which company is this account with?",
              "The provider is needed to prepare the right account material. Other support can continue.",
              "parent",
              "utilityProvider",
            );
            route.nextActor = "parent";
          } else {
            addAction(
              route,
              "execution_issue",
              "Find the right provider connection",
              "The saved provider does not match this route. CaseLink must verify a suitable connection before preparing or sending account material.",
            );
            route.nextActor = "caselink";
          }
          route.limitation =
            "This account is waiting for a matching provider connection. Use the contact on your current bill for urgent help.";
          plan.routes[index] = route;
          continue;
        }
      }
      if (route.state === "declined") {
        const exhausted = new Set(
          needHistory
            .filter((operation) => operation.receipt?.state === "declined")
            .map((operation) => operation.programId),
        );
        exhausted.add(route.programId);
        const alternative = getProgramsForNeeds([route.need]).find(
          (candidate) =>
            !exhausted.has(candidate.id) &&
            request.mandate.recipientIds.includes(candidate.id) &&
            !programRoutingIssue(candidate, currentIntakeFields(request, now, route.need).zip, now),
        );
        if (!alternative) {
          routesExhausted = true;
          route.state = "unresolved";
          route.limitation =
            "The currently authorized routes have declined or are unavailable. No previously declined application will be restarted.";
          addAction(
            route,
            "execution_issue",
            "Review the remaining support options",
            "The authorized routes are exhausted. CaseLink must record an honest unresolved outcome or verify a genuinely new compatible option, with any new permission required.",
          );
          plan.routes[index] = route;
          await record(route);
          continue;
        }
        program = alternative;
        route = {
          ...route,
          programId: alternative.id,
          title: alternative.name,
          summary: alternative.description,
          officialUrl: alternative.officialUrl,
          sourceUrl: alternative.sourceUrl,
          state: "prepared",
          nextActor: "caselink",
          limitation: null,
        };
      }
      const progress = outcomeOrder[route.state] ?? 0;
      let action: SupportAction | null = null;
      let capability: ServiceCapability | null = null;
      if (request.mandate.mode === "prepare_only" && progress >= 2) {
        await record(route);
        plan.routes[index] = route;
        continue;
      }
      if (progress >= 2) {
        const last = history
          .filter(
            (operation) =>
              operation.receipt &&
              receiptSchema.safeParse(operation.receipt).success,
          )
          .sort((a, b) => Date.parse(b.receipt?.agencyStatus?.observedAt ?? b.updatedAt) - Date.parse(a.receipt?.agencyStatus?.observedAt ?? a.updatedAt))[0];
        const due = last
          ? Date.parse(last.receipt?.agencyStatus?.observedAt ?? last.updatedAt) +
            (request.intake.urgency === "today" ? 3600000 : 86400000)
          : NaN;
        capability = await ports.capability(route.programId, "follow_up");
        if (!last || !Number.isFinite(due)) {
          addAction(
            route,
            "execution_issue",
            "Confirm the program’s status reference",
            "A verified delivery or agency reference is needed before an automated status check can run.",
          );
          plan.routes[index] = route;
          continue;
        }
        if (
          !request.mandate.allowedActions.includes("follow_up") ||
          !capability?.enabled || capability.snapStatusTransportConfigured === false
        ) {
          addAction(
            route,
            "execution_issue",
            "Connect verified status updates",
            "CaseLink needs an authorized status channel. Provider silence is not a result.",
          );
          plan.routes[index] = route;
          continue;
        }
        if (due > now.getTime()) {
          nextRuns.push(due);
          plan.routes[index] = route;
          continue;
        }
        action = "follow_up";
      } else {
        for (const candidateAction of request.mandate.mode === "full" ? [
          "submit",
          "share",
          "schedule",
        ] as const : []) {
          if (!supportsInitialServiceDelivery(route.need, candidateAction)) continue;
          if (!request.mandate.allowedActions.includes(candidateAction))
            continue;
          const candidate = await ports.capability(
            route.programId,
            candidateAction,
          );
          if (
            candidate?.enabled &&
            candidate.actions.includes(candidateAction)
          ) {
            action = candidateAction;
            capability = candidate;
            break;
          }
        }
        if (!action && request.mandate.allowedActions.includes("prepare")) {
          const preparation = await ports.capability(route.programId, "prepare", route.need);
          if (preparation?.enabled && preparation.actions.includes("prepare") &&
            preparation.requiresForm && (preparation.allowedFields?.length ||
              (preparation.privateSnapPreview && route.programId === "snap-pa" && route.need === "snap_new"))) {
            action = "prepare";
            capability = preparation;
          }
        }
      }
      if (!action || !capability) {
        if (request.mandate.mode === "prepare_only") {
          await record(route);
          plan.routes[index] = route;
          continue;
        }
        addAction(
          route,
          "execution_issue",
          "CaseLink is verifying the service connection",
          "Preparation can continue. A verified permitted delivery channel is required before information can be sent. There is nothing for you to approve again.",
        );
        route.limitation =
          "No information has been sent through an unverified channel.";
        plan.routes[index] = route;
        await record(route);
        continue;
      }
      if (canonical && action !== "submit") {
        addAction(route, "execution_issue", "CaseLink is verifying the application connection",
          "The exact prepared application is saved. CaseLink must restore its permitted submission connection before continuing.");
        plan.routes[index] = route; continue;
      }
      const knownCase = action === "follow_up" && history.some((operation) => operation.receipt);
      const zip = currentIntakeFields(request, now, route.need).zip;
      const privatePreviewRoute = capability.privateSnapPreview && action === "prepare" && route.programId === "snap-pa" && route.need === "snap_new";
      if (!knownCase && !privatePreviewRoute && !canonical && programRoutingIssue(program, zip, now)) {
        route.state = "unresolved";
        addAction(route, "execution_issue", "Check this program’s current coverage",
          "CaseLink must verify its supported service area or refresh this program's source information before starting new work.");
        plan.routes[index] = route;
        continue;
      }
      const needsRouting = !knownCase && !canonical && zip === undefined;
      if (needsRouting) {
        if (!request.mandate.allowedData.includes("household"))
          addAction(route, "expanded_permission", "Review permission for routing details",
            "CaseLink needs permission to use current household routing details to check its Philadelphia service area before a new service action. Your existing permission stays unchanged until you choose.",
            "parent", "allowedData", "data-household");
        else
          addAction(route, "missing_fact", "What is your current household ZIP code?",
            "CaseLink currently coordinates new support in Philadelphia. A current ZIP lets us check the service area for this need; this is a CaseLink routing check, not an extra program form requirement.",
            "parent", "zip", "zip");
      }
      let followUpCycle: string | null = null;
      let preparedForm: ServiceForm | undefined;
      let privateSnapPreparation = false;
      let needsFormDetails = false;
      let packet = packetFor(
        { ...request, intake: effectiveIntake },
        route,
        validDocuments,
        now,
      );
      if (canonical) {
        packet = canonical.packet;
      }
      if (
        utilityNeeds.includes(route.need) &&
        action !== "follow_up" &&
        !hasUtilityAccountAuthority(
          request,
          route.need,
          packet.accountAuthority,
          now,
        )
      ) {
        addAction(
          route,
          "missing_fact",
          "Can you act for this utility account?",
          "Confirm that you hold this account or have permission to act for its holder. This answer applies only to this utility.",
          "parent",
          "accountAuthority",
        );
        route.nextActor = "parent";
        plan.routes[index] = route;
        continue;
      }
      if (capability.allowedFields)
        packet = Object.fromEntries(
          Object.entries(packet).filter(([field]) =>
            capability!.allowedFields!.includes(field),
          ),
        );
      if (action === "follow_up") {
        const last = history
          .filter((operation) => operation.receipt)
          .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
        packet = { statusReference: last.receipt!.reference };
        followUpCycle = `${last.id}:${last.updatedAt}`;
      } else if (!canonical) {
        try {
          const formInputDigest = digest(packet);
          const form = await ports.fillForm(
            route.programId,
            structuredClone(packet),
            route.need,
          );
          if (form) {
            const checked = serviceFormSchema.parse(form);
            if (
              checked.programId !== route.programId ||
              checked.formInputDigest !== formInputDigest
            )
              throw new Error("form_packet_mismatch");
            if (checked.snapApplication) {
              if (route.need !== "snap_new" || route.programId !== "snap-pa" || !checked.preparationOnly)
                throw new Error("private_form_purpose_mismatch");
              privateSnapPreparation = true;
              for (let actionIndex = actions.length - 1; actionIndex >= 0; actionIndex--)
                if (actions[actionIndex].need === route.need && actions[actionIndex].reason === "missing_fact") actions.splice(actionIndex, 1);
              // The private snapshot is bound separately; no private answer enters an ordinary packet.
              packet = {};
            }
            if (checked.preparationOnly) {
              if (!request.mandate.allowedActions.includes("prepare"))
                throw new Error("form_preparation_not_authorized");
              action = "prepare";
            }
            if (checked.snapApplication?.state === "service_blocked") {
              route.state = "unresolved";
              addAction(route, "execution_issue", "CaseLink is checking the application",
                "CaseLink must resolve a verified form or service-area requirement before preparation can finish. You do not need to shorten an answer or approve again.");
              plan.routes[index] = route;
              continue;
            }
            if (checked.snapApplication?.state === "needs_current_facts") {
              route.state = "checking";
              addAction(route, "missing_fact", "Update the required SNAP application answers",
                "Open the grouped SNAP application details to supply only the missing or outdated answers. Your saved answers and service permission remain recorded.",
                "parent", "snap_application_details", "snap_application_details");
              route.nextActor = "parent";
              plan.routes[index] = route;
              continue;
            }
            if (checked.missingFields.length) {
              needsFormDetails = true;
              const missingFields = [
                ...new Set(
                  checked.missingFields.map((field) =>
                    ["incomeAmount", "incomeFrequency"].includes(field)
                      ? "income"
                      : field,
                  ),
                ),
              ];
              for (const field of missingFields) {
                const category = factCategories[field];
                if (
                  category &&
                  !request.mandate.allowedData.includes(category)
                ) {
                  addAction(
                    route,
                    "expanded_permission",
                    `Review permission to use ${categoryLabels[category]}`,
                    `${program.name} requires ${categoryLabels[category]} for this step. Your current permission does not include it. Review that information scope before we request or use the missing details; your existing permission stays unchanged until you choose.`,
                    "parent",
                    "allowedData",
                    `data-${category}`,
                  );
                  continue;
                }
                const question = fieldQuestions[field];
                if (question)
                  addAction(
                    route,
                    "missing_fact",
                    question.title,
                    question.explanation,
                    "parent",
                    field,
                    field,
                  );
                else
                  addAction(
                    route,
                    "execution_issue",
                    "Check a required program detail",
                    "The form requests information outside this supported data inventory. CaseLink must verify a safe direct-entry or qualified help route.",
                  );
              }
            } else preparedForm = checked;
          } else if (capability.requiresForm) {
            addAction(
              route,
              "execution_issue",
              "Verify the required form",
              "This route requires a tested current form. CaseLink cannot invent a form or send an unverified version.",
            );
            plan.routes[index] = route;
            continue;
          }
        } catch {
          addAction(
            route,
            "execution_issue",
            "Check the prepared form",
            "The form could not be validated against the exact packet. Other support work can continue.",
          );
          plan.routes[index] = route;
          continue;
        }
      }
      const needsBookingChoice = action === "schedule" && request.mandate.bookingPreference === "ask_me";
      if (needsBookingChoice) {
        addAction(
          route,
          "meaningful_choice",
          "Choose an appointment time",
          "A confirmed appointment choice is required before booking. Other permitted preparation can continue.",
          "parent",
          "bookingPreference",
        );
      }
      if ((needsRouting && !privateSnapPreparation) || needsBookingChoice || needsFormDetails) {
        route.nextActor = actions.some((item) => item.need === route.need &&
          !item.resolved && (!item.resolver || item.resolver === "parent")) ? "parent" : "caselink";
        plan.routes[index] = route;
        continue;
      }
      const operation: ServiceProposedOperation = canonical ? {
        need: "snap_new", requestVersion: canonical.requestVersion, programId: "snap-pa", action: "submit",
        packet: canonical.packet, dataCategories: canonical.dataCategories, documentIds: [], idempotencyKey: canonical.idempotencyKey, protectedSnap: canonical,
      } : {
        need: route.need,
        ...(preparedForm ? { form: preparedForm } : {}),
        requestVersion: request.version,
        programId: route.programId,
        action,
        dataCategories: [...new Set([...packetCategories(packet), ...(preparedForm?.snapApplication?.dataCategories ?? [])])],
        documentIds: Array.isArray(packet.documentIds)
          ? (packet.documentIds as string[])
          : [],
        packet,
        idempotencyKey: `parent:${request.id}:${digest({ requestVersion: request.version, need: route.need, programId: route.programId, action, packet, formDigest: preparedForm?.contentSha256 ?? null,
          snapSnapshot: preparedForm?.snapApplication ? { id: preparedForm.snapApplication.snapshotId, hash: preparedForm.snapApplication.snapshotHash } : undefined, followUpCycle })}`,
      };
      if (canonical && !canonical.protectedParentSubmitReady) {
        addAction(route, "execution_issue", "CaseLink is checking the remaining personal-step route",
          "An additional required personal step needs an accepted completion route before this application can be submitted. Your exact file remains saved.");
        plan.routes[index] = route; continue;
      }
      if (canonical && capability.protectedSubmissionConfigured !== true) {
        addAction(route, "execution_issue", "CaseLink is connecting application submission",
          "The exact application is saved. CaseLink must connect its isolated submission service before asking you to submit it.");
        plan.routes[index] = route; continue;
      }
      if (canonical && !canonical.snapSubmissionAuthorized) {
        route.state = "prepared"; route.nextActor = "parent";
        route.limitation = "The exact protected application is saved for your review. Nothing has been sent.";
        addAction(route, "submission_review", "Review and submit your SNAP application",
          "Review the exact application, correct anything needed, and confirm your completed handwritten certifications when choosing Submit.",
          "parent", "snap_final_submit", canonical.idempotencyKey);
        plan.routes[index] = route; continue;
      }
      if (canonical && !canonical.personalActsComplete) {
        addAction(route, "execution_issue", "CaseLink is checking the personal-step evidence",
          "A required step or its evidence has changed. CaseLink must identify the exact remaining requirement before asking you to repeat anything.");
        plan.routes[index] = route; continue;
      }
      if (action === "prepare") {
        await ports.prepareOperation(operation);
        route.state = "prepared";
        route.nextActor = "caselink";
        route.limitation = preparedForm?.snapApplication
          ? "The saved SNAP application answers are filled in an unsigned preview. Required protected fields, genuine certifications and permitted submission remain incomplete. No application has been sent."
          : preparedForm?.preparationOnly
          ? "An incomplete unsigned draft is saved. Current supported details are filled; protected application fields and permitted submission still need a service connection. No application has been sent."
          : "An unsigned application form is prepared. No application has been sent.";
        if (request.mandate.mode === "full")
          addAction(route, "execution_issue", "CaseLink is verifying the service connection",
            "Your prepared form is saved. CaseLink must verify the permitted submission and status channel; there is nothing for you to approve again.");
        plan.routes[index] = route;
        await record(route);
        continue;
      }
      if (
        !capability.personalActsComplete &&
        !(await ports.personalActsComplete(operation))
      ) {
        await ports.prepareOperation(operation);
        const acts = preparedForm?.personalActs.length
          ? [
              ...preparedForm.personalActs,
              ...(capability.requiredPersonalActs ?? []),
            ]
          : (capability.requiredPersonalActs ?? [
              {
                id: "required-personal-step",
                title: `${getProgram(route.programId)!.name} needs your personal step`,
                explanation: getProgram(route.programId)!.personalSteps.join(
                  " ",
                ),
              },
            ]);
        const distinctActs = acts.filter(
          (act, index) => acts.findIndex((other) => other.id === act.id) === index,
        );
        for (const act of distinctActs)
          addAction(
            route,
            "personal_step",
            act.title,
            act.explanation,
            "parent",
            undefined,
            act.id,
          );
        route.nextActor = "parent";
        plan.routes[index] = route;
        continue;
      }
      if (operation.need === "snap_new" && operation.action === "submit" && !operations.some(
        (previous) => previous.need === operation.need && previous.programId === operation.programId &&
          previous.action === operation.action && previous.state === "prepared" &&
          previous.idempotencyKey === operation.idempotencyKey && previous.snapSubmissionAuthorized === true &&
          currentAccountOperation(previous),
      )) {
        await ports.prepareOperation(operation);
        route.state = "prepared";
        route.nextActor = "parent";
        route.limitation = "Your prepared SNAP application is ready for your review. Nothing has been sent.";
        addAction(route, "submission_review", "Review and submit your SNAP application",
          "Review the exact prepared application and correct anything needed, then choose Submit. This choice is separate from required signatures and certifications.",
          "parent", "snap_final_submit", operation.idempotencyKey);
        plan.routes[index] = route;
        continue;
      }
      try {
        const result = await ports.execute(operation);
        if (result.state === "delivery_unknown") {
          unknownDelivery = true;
          const failed = canonical && result.transportStatus === "FAILURE";
          const retrying = !failed && await scheduleProtectedReconciliation(canonical,
            operations.find(item => item.id === canonical?.operationId)?.executedAt ?? now.toISOString());
          const issueId = addAction(
            route,
            "execution_issue",
            failed ? "Resolve the failed fax transmission" : retrying ? "CaseLink is checking application delivery" : "Confirm the attempted delivery",
            failed ? "The fax service reported a failed transmission. Some pages may have arrived. CaseLink must check agency receipt and the permitted next step before any resend."
              : retrying ? "CaseLink will check the exact fax automatically. Delivery and agency receipt remain unconfirmed; nothing will be blindly resubmitted."
              : "The exact attempt needs a service check before any retry. A timeout is not proof that the program did or did not receive it.",
          );
          if (retrying) reconciliationActionIds.add(issueId);
        } else if (result.state === "blocked")
          addAction(
            route,
            "execution_issue",
            "A service permission needs checking",
            "Current authority or provider policy stopped this step. No additional action is assumed; independent needs can continue.",
          );
        else {
          const receipt = receiptSchema.safeParse(result.receipt);
          if (!receipt.success || receipt.data.state !== result.state) {
            unknownDelivery = true;
            const issueId = addAction(
              route,
              "execution_issue",
              "Check the program’s receipt",
              "The result is missing reliable matching evidence. CaseLink must reconcile it before retrying.",
            );
            if (await scheduleProtectedReconciliation(canonical, operations.find(item => item.id === canonical?.operationId)?.executedAt ?? now.toISOString()))
              reconciliationActionIds.add(issueId);
          } else {
            route = advance(route, receipt.data);
            await record(route, receipt.data);
            if (route.state !== "support_received" && route.state !== "declined") {
              const status = canonical ? await ports.capability("snap-pa", "follow_up") : null;
              if (canonical && (!status?.enabled || status.snapStatusTransportConfigured === false))
                addAction(route, "execution_issue", "Connect verified status updates",
                  "The carrier delivery result is recorded. CaseLink needs an authorized agency status channel; fax delivery is not DHS confirmation.");
              else nextRuns.push(now.getTime() + (request.intake.urgency === "today" ? 3600000 : 86400000));
            }
          }
        }
      } catch {
        unknownDelivery = true;
        const issueId = addAction(
          route,
          "execution_issue",
          "Check the attempted service step",
          "The execution result is uncertain. CaseLink must verify the recorded operation before any retry.",
        );
        if (await scheduleProtectedReconciliation(canonical, operations.find(item => item.id === canonical?.operationId)?.executedAt ?? now.toISOString()))
          reconciliationActionIds.add(issueId);
      }
      plan.routes[index] = route;
    } catch {
      addAction(
        route,
        "execution_issue",
        "A service step needs checking",
        "A registered service tool is temporarily unavailable. This need remains open while independent support continues.",
      );
      plan.routes[index] = route;
    }
  }
  for (const event of events) {
    try {
      await ports.notify(event);
    } catch {
      const route = plan.routes.find((route) => route.need === event.need);
      if (route)
        addAction(
          route,
          "execution_issue",
          "A support update needs delivery",
          "The support result is recorded, but CaseLink could not queue its notification. Your recorded outcome has not changed.",
        );
    }
  }
  const nextRunAt = nextRuns.length
    ? new Date(Math.min(...nextRuns, expiry)).toISOString()
    : null;
  const parentNeeded = actions.some(
    (action) =>
      !action.resolved && (!action.resolver || action.resolver === "parent"),
  );
  const operatorNeeded = actions.some(
    (action) => !action.resolved && action.resolver === "operator" && action.id !== captureRetryActionId && !reconciliationActionIds.has(action.id),
  );
  return {
    plan,
    requiredActions: actions,
    nextRunAt,
    nextActor: parentNeeded
      ? "parent"
      : operatorNeeded
        ? "operator"
        : nextRunAt
          ? "caselink"
          : plan.routes.some(
                (route) =>
                  (outcomeOrder[route.state] ?? 0) >= 2 &&
                  route.state !== "support_received",
              )
            ? "agency"
            : null,
    nextTrigger: nextRunAt
      ? "scheduled_follow_up"
      : parentNeeded
        ? "parent_action_completed"
        : unknownDelivery
          ? "verified_receipt_available"
          : routesExhausted
            ? "route_review_required"
            : operatorNeeded
              ? "provider_capability_enabled"
              : "none",
    events,
    modelCalls: coordinated.modelCalls,
    inputTokens: coordinated.inputTokens,
    outputTokens: coordinated.outputTokens,
  };
}
