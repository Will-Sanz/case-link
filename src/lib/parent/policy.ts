import { z } from "zod";
import {
  mandateSchema,
  type ServiceMandate,
  type SupportAction,
  type SupportRequest,
  type SupportNeed,
} from "./domain";
import { getProgram, supportsInitialServiceDelivery } from "./programs";
import { factAnswerSchema } from "./answers";
import { CURRENT_INTAKE_FIELDS, currentIntakeFields } from "./current-intake-fields";
import { sameSnapProtectedPacket, snapProtectedOperationSchema, type SnapProtectedOperation } from "./snap-protected-operation";
import { hasExcludedAssistantInformation } from "./assistant-contract";

export type ProviderCapability = {
  programId: string;
  enabled: boolean;
  actions: SupportAction[];
  permissionReference: string | null;
  permissionExpiresAt: string | null;
  dataCategories: ServiceMandate["allowedData"];
  personalActsComplete: boolean;
  permissionVersion?: string | null;
};
export type ProposedOperation = {
  need?: SupportNeed;
  requestVersion: number;
  programId: string;
  action: SupportAction;
  dataCategories: ServiceMandate["allowedData"];
  documentIds: string[];
  packet: Record<string, unknown>;
  idempotencyKey: string;
  protectedSnap?: SnapProtectedOperation;
};
const packetSchema = z
  .object({
    zip: z
      .string()
      .regex(/^\d{5}$/)
      .optional(),
    householdSize: z.number().int().min(1).max(30).optional(),
    incomeAmount: z.number().finite().min(0).max(1000000).optional(),
    incomeFrequency: z
      .enum(["weekly", "biweekly", "twice_monthly", "monthly", "yearly"])
      .optional(),
    utilityProvider: z
      .enum(["peco", "pgw", "pwd", "other", "unknown"])
      .optional(),
    accountAuthority: z.enum(["self", "authorized_caregiver"]).optional(),
    amountDue: z.number().finite().min(0).max(1000000).optional(),
    totalBalance: z.number().finite().min(0).max(1000000).optional(),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    shutoffDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    documentIds: z.array(z.uuid()).max(10).optional(),
    statusReference: z.string().min(1).max(200).optional(),
  })
  .strict();
const FIELD_CATEGORY: Record<string, ServiceMandate["allowedData"][number]> = {
  zip: "household",
  householdSize: "household",
  incomeAmount: "income",
  incomeFrequency: "income",
  utilityProvider: "utility",
  accountAuthority: "utility",
  amountDue: "utility",
  totalBalance: "utility",
  dueDate: "utility",
  shutoffDate: "utility",
  documentIds: "documents",
  statusReference: "household",
};
export function utilityProviderFor(
  request: SupportRequest,
  need: SupportNeed,
  now: Date,
): string {
  const expected = (
    { electricity: "peco", gas: "pgw", water: "pwd" } as Partial<
      Record<SupportNeed, string>
    >
  )[need];
  let provider =
    expected &&
    request.intake.utilityProviders.includes(expected as "peco" | "pgw" | "pwd")
      ? expected
      : request.intake.utilityProviders.includes("other")
        ? "other"
        : "unknown";
  for (const fact of [...(request.facts ?? [])].sort(
    (a, b) => Date.parse(a.confirmedAt) - Date.parse(b.confirmedAt),
  )) {
    if (
      fact.need !== need ||
      fact.field !== "utilityProvider" ||
      fact.source !== "parent" ||
      !Number.isFinite(Date.parse(fact.confirmedAt)) ||
      Date.parse(fact.confirmedAt) > now.getTime() ||
      !Number.isFinite(Date.parse(fact.asOf)) ||
      Date.parse(fact.asOf) > now.getTime() ||
      Date.parse(fact.asOf) < now.getTime() - 45 * 86400000
    )
      continue;
    if (
      factAnswerSchema.safeParse({
        need,
        field: "utilityProvider",
        value: fact.value,
        version: request.version,
      }).success
    )
      provider = String(fact.value);
  }
  return provider;
}
export function hasUtilityAccountAuthority(
  request: SupportRequest,
  need: SupportNeed | undefined,
  packetAuthority: unknown,
  now: Date,
): boolean {
  if (request.intake.accountAuthority !== "not_sure") return true;
  if (!need || !["electricity", "gas", "water"].includes(need)) return false;
  const facts = (request.facts ?? [])
    .filter(
      (fact) =>
        fact.need === need &&
        fact.field === "accountAuthority" &&
        fact.source === "parent",
    )
    .sort((a, b) => Date.parse(b.confirmedAt) - Date.parse(a.confirmedAt));
  const fact = facts[0];
  if (
    !fact ||
    !Number.isFinite(Date.parse(fact.confirmedAt)) ||
    Date.parse(fact.confirmedAt) > now.getTime() ||
    !Number.isFinite(Date.parse(fact.asOf)) ||
    Date.parse(fact.asOf) > now.getTime() ||
    Date.parse(fact.asOf) < now.getTime() - 45 * 86400000
  )
    return false;
  return (
    (packetAuthority === undefined || fact.value === packetAuthority) &&
    factAnswerSchema.safeParse({
      need,
      field: "accountAuthority",
      value: fact.value,
      version: request.version,
    }).success
  );
}
export function validateMandate(
  mandate: ServiceMandate,
  now: Date,
): string | null {
  if (!mandateSchema.safeParse(mandate).success) return "invalid_mandate";
  const expiry = Date.parse(mandate.expiresAt);
  if (expiry <= now.getTime() || expiry > now.getTime() + 30 * 86400000)
    return "invalid_expiry";
  if (mandate.recipientIds.some((id) => !getProgram(id)))
    return "unknown_recipient";
  return null;
}
export function authorizeOperation(input: {
  request: SupportRequest;
  operation: ProposedOperation;
  capability: ProviderCapability;
  accountActive: boolean;
  attempts: number;
  now: Date;
  revoked: boolean;
  documentsValid: boolean;
  statusReferences?: readonly string[];
}): { allowed: true } | { allowed: false; reason: string } {
  const { request, operation, capability, now } = input;
  const deny = (reason: string) => ({ allowed: false as const, reason });
  if (!input.accountActive || input.revoked) return deny("authority_revoked");
  if (request.status !== "active") return deny("request_not_active");
  if (!mandateSchema.safeParse(request.mandate).success)
    return deny("invalid_mandate");
  if (
    !Number.isFinite(Date.parse(request.mandate.expiresAt)) ||
    Date.parse(request.mandate.expiresAt) <= now.getTime()
  )
    return deny("mandate_expired");
  if (request.version !== operation.requestVersion)
    return deny("superseded_facts");
  if (!request.mandate.recipientIds.includes(operation.programId))
    return deny("recipient_not_authorized");
  const compatibleNeeds =
    getProgram(operation.programId)?.needs.filter((need) =>
      request.intake.needs.includes(need),
    ) ?? [];
  const need =
    operation.need === undefined && compatibleNeeds.length === 1
      ? compatibleNeeds[0]
      : operation.need;
  if (!need || !compatibleNeeds.includes(need))
    return deny("need_not_authorized");
  if (!request.mandate.allowedActions.includes(operation.action))
    return deny("action_not_authorized");
  const sideEffect = !["research", "prepare"].includes(operation.action);
  if (sideEffect && request.mandate.mode !== "full")
    return deny("preparation_only");
  if (!supportsInitialServiceDelivery(need, operation.action))
    return deny("journey_not_supported");
  if (
    operation.dataCategories.some(
      (c) => !request.mandate.allowedData.includes(c),
    )
  )
    return deny("data_not_authorized");
  const protectedPacket = operation.packet != null && typeof operation.packet === "object" && Object.hasOwn(operation.packet, "protectedSnapPacket");
  if (operation.protectedSnap && !protectedPacket) return deny("invalid_protected_operation");
  const canonical = protectedPacket ? snapProtectedOperationSchema.safeParse(operation.protectedSnap) : null;
  if (protectedPacket && (!canonical?.success || need !== "snap_new" || operation.programId !== "snap-pa" || operation.action !== "submit" ||
    canonical.data.state !== "prepared" || canonical.data.requestId !== request.id || canonical.data.requestVersion !== operation.requestVersion ||
    canonical.data.idempotencyKey !== operation.idempotencyKey || !sameSnapProtectedPacket(canonical.data.packet, operation.packet) ||
    JSON.stringify(canonical.data.dataCategories) !== JSON.stringify(operation.dataCategories) || operation.documentIds.length))
    return deny("invalid_protected_operation");
  if (canonical?.success && !canonical.data.protectedPacketCurrent) return deny("protected_packet_not_current");
  const parsedPacket = packetSchema.safeParse(protectedPacket ? {} : operation.packet);
  if (!parsedPacket.success || !Object.keys(operation.packet).length)
    return deny("invalid_packet");
  if (
    !protectedPacket && Object.keys(operation.packet).some(
      (field) => !operation.dataCategories.includes(FIELD_CATEGORY[field]),
    )
  )
    return deny("undeclared_packet_data");
  if (
    parsedPacket.data.statusReference &&
    (operation.action !== "follow_up" ||
      !input.statusReferences?.includes(parsedPacket.data.statusReference))
  )
    return deny("unverified_status_reference");
  if (
    JSON.stringify([...(parsedPacket.data.documentIds ?? [])].sort()) !==
    JSON.stringify([...operation.documentIds].sort())
  )
    return deny("attachment_mismatch");
  if (
    operation.documentIds.length &&
    (!request.mandate.allowedData.includes("documents") ||
      !input.documentsValid)
  )
    return deny("document_not_authorized");
  const current = currentIntakeFields(request, now, need);
  if (CURRENT_INTAKE_FIELDS.some((field) =>
    Object.hasOwn(parsedPacket.data, field) &&
    (current[field] === undefined || parsedPacket.data[field] !== current[field]),
  ))
    return deny("packet_source_not_current");
  if (!/^[a-zA-Z0-9:_-]{8,200}$/.test(operation.idempotencyKey))
    return deny("invalid_operation_key");
  if (input.attempts >= request.mandate.maxAttempts)
    return deny("attempt_limit");
  if (
    sideEffect &&
    (capability.programId !== operation.programId ||
      !capability.enabled ||
      !capability.permissionReference ||
      !capability.actions.includes(operation.action) ||
      !capability.permissionExpiresAt ||
      !Number.isFinite(Date.parse(capability.permissionExpiresAt)) ||
      Date.parse(capability.permissionExpiresAt) <= now.getTime())
  )
    return deny("provider_permission_unverified");
  if (
    sideEffect &&
    operation.dataCategories.some((c) => !capability.dataCategories.includes(c))
  )
    return deny("provider_data_not_permitted");
  if (canonical?.success && capability.permissionVersion !== canonical.data.permissionVersion)
    return deny("provider_permission_unverified");
  const knownCase = operation.action === "follow_up" && parsedPacket.data.statusReference !== undefined;
  if (sideEffect && !knownCase && !protectedPacket && (current.zip === undefined || !/^191\d{2}$/.test(current.zip)))
    return deny("routing_source_not_current");
  if (sideEffect && ["electricity", "gas", "water"].includes(need)) {
    const expected = (
      { electricity: "peco", gas: "pgw", water: "pwd" } as Partial<
        Record<SupportNeed, string>
      >
    )[need];
    const provider = utilityProviderFor(request, need, now);
    if (
      (provider !== "unknown" && provider !== expected) ||
      (parsedPacket.data.utilityProvider !== undefined &&
        parsedPacket.data.utilityProvider !== expected)
    )
      return deny("provider_account_mismatch");
  }
  if (sideEffect && !capability.personalActsComplete)
    return deny("required_personal_act");
  if (canonical?.success && !canonical.data.personalActsComplete) return deny("required_personal_act");
  if (canonical?.success && !canonical.data.protectedParentSubmitReady) return deny("required_personal_act");
  if (canonical?.success && !canonical.data.snapSubmissionAuthorized) return deny("snap_submission_review_required");
  if (
    sideEffect &&
    operation.dataCategories.includes("utility") &&
    !hasUtilityAccountAuthority(
      request,
      need,
      parsedPacket.data.accountAuthority,
      now,
    )
  )
    return deny("account_authority_unresolved");
  if (
    operation.action === "schedule" &&
    request.mandate.bookingPreference === "ask_me"
  )
    return deny("booking_choice_required");
  if (JSON.stringify(operation.packet).length > 50000)
    return deny("packet_too_large");
  return { allowed: true };
}
const noticeLabel = z.string().trim().min(1).max(160).refine(
  value => !hasExcludedAssistantInformation(value) && !/[<>]/.test(value),
  "Use a document description without private identifiers or markup.",
);
export const agencyStatusSchema = z.object({
  reference: z.string().trim().min(1).max(200),
  observedAt: z.iso.datetime({ offset: true }),
  documents: z.array(z.object({
    name: noticeLabel,
    dueDate: z.iso.date().optional(),
  }).strict()).min(1).max(8).optional(),
  interview: z.object({
    scheduledAt: z.iso.datetime({ offset: true }).optional(),
    dueDate: z.iso.date().optional(),
    channel: z.enum(["phone", "in_person", "video"]).optional(),
  }).strict().optional(),
  waitingForDecision: z.literal(true).optional(),
}).strict().refine(value => Boolean(value.documents || value.interview || value.waitingForDecision),
  "A status record needs an observed next step.");
export const receiptSchema = z
  .object({
    state: z.enum([
      "sent",
      "partner_received",
      "partner_accepted",
      "agency_submitted",
      "assistance_approved",
      "support_received",
      "declined",
    ]),
    source: z.enum([
      "provider_api",
      "authenticated_partner",
      "agency_receipt",
      "operator_confirmed",
    ]),
    reference: z.string().min(1).max(200),
    recordedAt: z.iso.datetime({ offset: true }),
    agencyStatus: agencyStatusSchema.optional(),
  })
  .strict()
  .superRefine((receipt, context) => {
    if (!receipt.agencyStatus) return;
    if (!["agency_submitted", "assistance_approved", "support_received", "declined"].includes(receipt.state))
      context.addIssue({ code: "custom", path: ["agencyStatus"], message: "A transport acknowledgement is not an agency status record." });
    if (Date.parse(receipt.agencyStatus.observedAt) > Date.parse(receipt.recordedAt))
      context.addIssue({ code: "custom", path: ["agencyStatus", "observedAt"], message: "The status must have been observed by the recorded time." });
    if (receipt.agencyStatus.waitingForDecision && receipt.state !== "agency_submitted")
      context.addIssue({ code: "custom", path: ["agencyStatus", "waitingForDecision"], message: "A recorded decision is no longer awaiting a decision." });
    // Existing reconciliation stores a bounded receipt; never truncate a notice or drop its attribution.
    if (new TextEncoder().encode(JSON.stringify(receipt)).byteLength > 1600)
      context.addIssue({ code: "custom", path: ["agencyStatus"], message: "The status record is too large." });
  });
export function validateReceipt(value: unknown): boolean {
  return receiptSchema.safeParse(value).success;
}
