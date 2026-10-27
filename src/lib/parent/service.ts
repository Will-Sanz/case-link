import { createHash } from "node:crypto";
import { z } from "zod";
import { DOCUMENT_CONSENT_VERSION } from "./constants";
import { factAnswerSchema } from "./answers";
import type { CoordinatorResult } from "./coordinator";
import {
  type NecessaryAction,
  type OutcomeState,
  type ParentDocument,
  type ServiceMandate,
  type SupportAction,
  type SupportIntake,
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
} from "./programs";

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
  receipt?: ServiceReceipt;
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
    personalActs: z.array(personalActSchema).max(10).default([]),
    missingFields: z.array(z.string().min(1).max(100)).max(20).default([]),
  })
  .strict()
  .refine(
    (form) =>
      form.missingFields.length > 0 ||
      !!(form.artifactId && form.contentSha256),
    "An executable form needs its exact stored artifact.",
  );
export type ServiceForm = z.infer<typeof serviceFormSchema>;
export type ServiceCapability = ProviderCapability & {
  requiredPersonalActs?: z.infer<typeof personalActSchema>[];
  requiresForm?: boolean;
  allowedFields?: string[];
};
export type ServiceProposedOperation = ProposedOperation & {
  need: SupportNeed;
  form?: ServiceForm;
};
export type ServiceExecutionResult = {
  state: OutcomeState | "delivery_unknown" | "blocked";
  reason?: string;
  receipt?: ServiceReceipt;
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
  coordinate(
    intake: SupportIntake,
    mandate: ServiceMandate,
  ): Promise<CoordinatorResult>;
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
  ): Promise<ServiceCapability | null>;
  execute(operation: ServiceProposedOperation): Promise<ServiceExecutionResult>;
  /** Freeze the exact packet for a required personal act without beginning delivery. */
  preparePersonalStep(operation: ServiceProposedOperation): Promise<void>;
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
const outcomeOrder: Partial<Record<OutcomeState, number>> = {
  checking: 0,
  prepared: 1,
  sent: 2,
  partner_received: 3,
  partner_accepted: 4,
  agency_submitted: 5,
  assistance_approved: 6,
  support_received: 7,
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
  const packet: Record<string, unknown> = {};
  if (mandate.allowedData.includes("household")) {
    packet.zip = intake.zip;
    if (intake.householdSize !== null)
      packet.householdSize = intake.householdSize;
  }
  if (
    mandate.allowedData.includes("income") &&
    intake.incomeAmount !== null &&
    intake.incomeFrequency !== "unknown"
  ) {
    packet.incomeAmount = intake.incomeAmount;
    packet.incomeFrequency = intake.incomeFrequency;
  }
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
  for (const fact of [...(request.facts ?? [])].sort(
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
    const category = ["zip", "householdSize"].includes(fact.field)
      ? "household"
      : ["income", "incomeAmount", "incomeFrequency"].includes(fact.field)
        ? "income"
        : "utility";
    if (!mandate.allowedData.includes(category)) continue;
    if (fact.field === "income") {
      const value = fact.value as { amount: number; frequency: string };
      packet.incomeAmount = value.amount;
      packet.incomeFrequency = value.frequency;
    } else packet[fact.field] = fact.value;
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
  const coordinated = await ports.coordinate(effectiveIntake, request.mandate);
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
        ...(resolver === "parent" && getProgram(route.programId)
          ? { url: getProgram(route.programId)!.officialUrl }
          : {}),
      });
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
      const program = getProgram(route.programId);
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
      if (programRoutingIssue(program, request.intake.zip, now)) {
        if ((outcomeOrder[route.state] ?? 0) < 2) route.state = "unresolved";
        addAction(
          route,
          "execution_issue",
          "Check this program’s current coverage",
          "Program coverage or source freshness must be verified before this route continues.",
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
      for (const operation of unknown) {
        if (
          request.mandate.mode !== "full" ||
          !request.mandate.allowedActions.includes("follow_up")
        ) {
          stillUnknown = true;
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
            continue;
          }
          const receipt = receiptSchema.safeParse(
            await ports.reconcile(operation),
          );
          if (!receipt.success) {
            stillUnknown = true;
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
        }
      }
      if (stillUnknown) {
        unknownDelivery = true;
        addAction(
          route,
          "execution_issue",
          "Confirm the previous delivery",
          "The previous attempt has no reliable receipt yet. CaseLink must reconcile it before retrying; nothing will be blindly resubmitted.",
        );
        route.nextActor = "caselink";
        plan.routes[index] = route;
        continue;
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
            !programRoutingIssue(candidate, request.intake.zip, now),
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
      if (request.mandate.mode === "prepare_only") {
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
          .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
        const due = last
          ? Date.parse(last.updatedAt) +
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
          !capability?.enabled
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
        for (const candidateAction of [
          "submit",
          "share",
          "schedule",
        ] as const) {
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
      }
      if (!action || !capability) {
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
      if (
        action === "schedule" &&
        request.mandate.bookingPreference === "ask_me"
      ) {
        addAction(
          route,
          "meaningful_choice",
          "Choose an appointment time",
          "A confirmed appointment choice is required before booking. Other permitted preparation can continue.",
          "parent",
          "bookingPreference",
        );
        route.nextActor = "parent";
        plan.routes[index] = route;
        continue;
      }
      let followUpCycle: string | null = null;
      let preparedForm: ServiceForm | undefined;
      let packet = packetFor(
        { ...request, intake: effectiveIntake },
        route,
        validDocuments,
        now,
      );
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
      } else {
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
            if (checked.missingFields.length) {
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
              route.nextActor = "parent";
              plan.routes[index] = route;
              continue;
            }
            preparedForm = checked;
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
      const operation: ServiceProposedOperation = {
        need: route.need,
        ...(preparedForm ? { form: preparedForm } : {}),
        requestVersion: request.version,
        programId: route.programId,
        action,
        dataCategories: packetCategories(packet),
        documentIds: Array.isArray(packet.documentIds)
          ? (packet.documentIds as string[])
          : [],
        packet,
        idempotencyKey: `parent:${request.id}:${digest({ requestVersion: request.version, need: route.need, programId: route.programId, action, packet, formDigest: preparedForm?.contentSha256 ?? null, followUpCycle })}`,
      };
      if (
        !capability.personalActsComplete &&
        !(await ports.personalActsComplete(operation))
      ) {
        await ports.preparePersonalStep(operation);
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
      try {
        const result = await ports.execute(operation);
        if (result.state === "delivery_unknown") {
          unknownDelivery = true;
          addAction(
            route,
            "execution_issue",
            "Confirm the attempted delivery",
            "CaseLink will reconcile the exact attempt before retrying. A timeout is not proof that the program did or did not receive it.",
          );
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
            addAction(
              route,
              "execution_issue",
              "Check the program’s receipt",
              "The result is missing reliable matching evidence. CaseLink must reconcile it before retrying.",
            );
          } else {
            route = advance(route, receipt.data);
            await record(route, receipt.data);
            if (
              route.state !== "support_received" &&
              route.state !== "declined"
            )
              nextRuns.push(
                now.getTime() +
                  (request.intake.urgency === "today" ? 3600000 : 86400000),
              );
          }
        }
      } catch {
        unknownDelivery = true;
        addAction(
          route,
          "execution_issue",
          "Check the attempted service step",
          "The execution result is uncertain. CaseLink must verify the recorded operation before any retry.",
        );
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
    (action) => !action.resolved && action.resolver === "operator",
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
