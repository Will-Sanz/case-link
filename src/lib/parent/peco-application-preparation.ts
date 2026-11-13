import { createHash } from "node:crypto";
import { z } from "zod";
import { mandateSchema } from "./domain";
import { pecoApplicationCollectionSchema, pecoApplicationSnapshotSchema } from "./peco-application-snapshot";
import { pecoCapIncomeBindingSchema, pecoCapPreparationReferenceSchema } from "./peco-cap-income";
import { pecoCapPreparationSnapshotSchema, renderPecoCapPreparationDraft, type PecoCapDraftInput } from "./peco-cap-draft";
import type { PecoApplicationFields } from "./peco-application-fields";

export const PECO_APPLICATION_PREPARATION_ERROR = "The fictional PECO preparation could not be checked from the supplied information.";
const timestamp = z.iso.datetime({ offset: true });
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const contextSchema = z.object({
  kind: z.literal("fictional_offline_rehearsal"),
  expectedSnapshot: pecoCapPreparationReferenceSchema.extend({ binding: pecoCapIncomeBindingSchema }),
  binding: pecoCapIncomeBindingSchema,
  actorId: z.uuid(), accountAuthority: z.enum(["self", "authorized_caregiver"]),
  accountNumberSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  requestState: z.enum(["active", "paused", "cancelled", "closed"]),
  mandate: mandateSchema, mandateRevoked: z.boolean(),
  grant: z.object({ expiresAt: timestamp, revoked: z.boolean() }).strict(),
  collection: pecoApplicationCollectionSchema,
  validUntil: timestamp, retentionUntil: timestamp,
}).strict();
export type FictionalPecoPreparationContext = z.infer<typeof contextSchema>;
type MissingFacts = { group: string; fields: string[] }[];
type Person = NonNullable<PecoApplicationFields["applicant"]>;
const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const incomeLabels = {
  employment: "Employment", unemployment: "Unemployment", pension: "Pension", workers_compensation: "Workers compensation",
  veterans: "Veterans benefits", cash_welfare: "Cash welfare", child_support: "Child support", spousal_support: "Spousal support",
  social_security: "Social Security benefits", rental: "Rental income", self_employment: "Self-employment", other: "Other income",
} as const;

/**
 * Fictional fixtures only, with no runtime/API caller or persistence. Expected references and scope model
 * future trusted owned resolution; supplying them is not authentication, permission or a retention policy.
 */
export async function prepareFictionalPecoApplicationDraft(template: Uint8Array, sourceSnapshot: unknown, sourceContext: unknown, now: Date) {
  try {
    const at = new Date(now), bytes = Uint8Array.from(template);
    const snapshot = pecoApplicationSnapshotSchema.parse(structuredClone(sourceSnapshot)), context = contextSchema.parse(structuredClone(sourceContext));
    const reference = { id: snapshot.id, revision: snapshot.revision, sha256: hash(JSON.stringify(snapshot)) };
    const expected = context.expectedSnapshot, scope = context.binding, details = snapshot.details;
    const deadlines = [context.validUntil, context.retentionUntil, context.mandate.expiresAt, context.grant.expiresAt,
      context.collection.expiresAt ?? "", snapshot.source.verifiedUntil].map(Date.parse);
    const deadline = Math.min(...deadlines);
    if (!Number.isFinite(at.getTime()) || !Number.isFinite(deadline) || deadline <= at.getTime() ||
      at.getTime() < Date.parse(snapshot.source.sourceCheckedAt) || Date.parse(snapshot.created_at) > at.getTime() ||
      expected.id !== reference.id || expected.revision !== reference.revision || expected.sha256 !== reference.sha256 ||
      Object.entries(expected.binding).some(([key, value]) => scope[key as keyof typeof scope] !== value) ||
      snapshot.request_id !== scope.requestId || snapshot.request_version > scope.requestVersion ||
      snapshot.consent_evidence.actorId !== context.actorId || snapshot.consent_evidence.accountAuthority !== context.accountAuthority ||
      snapshot.consent_evidence.accountNumberSha256 !== context.accountNumberSha256 ||
      (details.accountNumber ? hash(details.accountNumber) : null) !== context.accountNumberSha256 ||
      context.requestState !== "active" || context.mandateRevoked || context.grant.revoked || !context.collection.collectionEnabled ||
      context.mandate.mode !== "prepare_only" || context.mandate.recipientIds.length !== 1 || context.mandate.recipientIds[0] !== "peco-cap" ||
      !context.mandate.allowedActions.includes("prepare") || context.mandate.allowedData.length !== 3 ||
      !["household", "income", "utility"].every(category => context.mandate.allowedData.includes(category as "household" | "income" | "utility"))) throw new Error();
    const today = localDate.format(at), missingFacts: MissingFacts = [], serviceBlockers: string[] = [];
    const missing = (group: string, fields: string[]) => {
      if (!fields.length) return;
      const existing = missingFacts.find(item => item.group === group);
      if (existing) existing.fields.push(...fields); else missingFacts.push({ group, fields });
    };
    const adult = (birth: string) => Number(today.slice(0, 4)) - Number(birth.slice(0, 4)) - (today.slice(5) < birth.slice(5) ? 1 : 0) >= 18;
    const income = (person: Person) => person.income?.state === "none" ? "No income" : person.income?.state === "sources"
      ? person.income.sources.map(source => incomeLabels[source.kind]).join("; ") : undefined;
    const person = (value: Person | undefined, path: string, applicant = false) => {
      missing(path, ["firstName", "lastName", "dateOfBirth"].filter(key => !value?.[key as "firstName" | "lastName" | "dateOfBirth"]).map(key => `${path}.${key}`));
      if (value?.dateOfBirth && value.dateOfBirth > today) throw new Error();
      if (applicant && value?.dateOfBirth && !adult(value.dateOfBirth)) serviceBlockers.push("adult_applicant_required");
      const incomeSource = value && income(value);
      if (value?.dateOfBirth && adult(value.dateOfBirth) && !incomeSource) missing(path, [`${path}.income`]);
      return value?.firstName && value.lastName && value.dateOfBirth ? {
        firstName: value.firstName, lastName: value.lastName, dateOfBirth: value.dateOfBirth,
        ...(value.middleInitial ? { middleInitial: value.middleInitial } : {}), ...(incomeSource ? { incomeSource } : {}),
      } : null;
    };
    if (!details.journey || details.journey === "unknown") missing("cap_journey", ["journey"]);
    else if (details.journey !== "new_enrollment") serviceBlockers.push("different_cap_journey_required");
    if (!details.currentCapState || details.currentCapState === "unknown") missing("cap_enrollment", ["currentCapState"]);
    else if (details.currentCapState !== "not_enrolled") serviceBlockers.push("different_cap_journey_required");
    missing("account", details.accountNumber ? [] : ["accountNumber"]);
    missing("household", details.householdComplete === true ? [] : ["householdComplete"]);
    const applicant = person(details.applicant, "applicant", true);
    const members = (details.householdMembers ?? []).map(member => {
      const path = `householdMembers.${member.id}`, projected = person(member, path);
      missing(path, member.relationship ? [] : [`${path}.relationship`]);
      return projected && member.relationship ? { ...projected, relationship: member.relationship } : null;
    });
    missing("service_address", ["street", "city", "state", "zip"].filter(key => !details.address?.[key as "street" | "city" | "state" | "zip"]).map(key => `address.${key}`));
    const readiness = { kind: "fictional_unsigned_preparation" as const, sourceSnapshot: reference,
      missingFacts, serviceBlockers: [...new Set(serviceBlockers)], formFieldsReady: missingFacts.length === 0 && serviceBlockers.length === 0,
      incomeProof: "not_assessed" as const, certification: "not_recorded" as const, submissionReady: false as const, sending: "not_attempted" as const };
    if (!readiness.formFieldsReady) return { ...readiness, bytes: null, manifest: null };
    if (!applicant || members.some(member => !member) || !details.accountNumber || !details.address?.street || !details.address.city || !details.address.state || !details.address.zip) throw new Error();
    const form: PecoCapDraftInput = {
      accountNumber: details.accountNumber, applicant,
      address: { street: details.address.street, city: details.address.city, state: details.address.state, zip: details.address.zip, ...(details.address.apartment ? { apartment: details.address.apartment } : {}) },
      householdMembers: members.filter((member): member is NonNullable<typeof member> => member !== null),
      ...(details.homePhone ? { homePhone: details.homePhone } : {}), ...(details.cellPhone ? { cellPhone: details.cellPhone } : {}),
      ...(details.smsUpdates !== undefined ? { smsUpdates: details.smsUpdates } : {}),
    };
    const confirmation = Math.min(Date.parse(snapshot.created_at), ...Object.values(snapshot.provenance).map(item => Date.parse(item.confirmedAt)));
    const projection = pecoCapPreparationSnapshotSchema.parse({ id: snapshot.id, revision: snapshot.revision, binding: scope,
      subjectIds: [details.applicant!.id, ...(details.householdMembers ?? []).map(member => member.id)], confirmedAt: new Date(confirmation).toISOString(),
      validUntil: new Date(deadline).toISOString(), retentionUntil: new Date(deadline).toISOString(), details: form });
    let rendered: Uint8Array;
    try { rendered = await renderPecoCapPreparationDraft(bytes, projection.details, at); }
    catch { return { ...readiness, formFieldsReady: false, serviceBlockers: ["form_rendering_requires_service_check"], bytes: null, manifest: null }; }
    return { ...readiness, bytes: rendered, manifest: {
      sourceSnapshot: reference, preparationSnapshot: { id: projection.id, revision: projection.revision, sha256: hash(JSON.stringify(projection)) },
      binding: projection.binding, subjectIds: projection.subjectIds, confirmedAt: projection.confirmedAt,
      validUntil: projection.validUntil, retentionUntil: projection.retentionUntil, templateSha256: snapshot.source.sourceSha256,
      formInputSha256: hash(JSON.stringify(projection.details)), artifactSha256: hash(rendered),
    } };
  } catch { throw new Error(PECO_APPLICATION_PREPARATION_ERROR); }
}
