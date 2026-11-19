import { z } from "zod";
import { isOrdinaryText } from "./ordinary-text";
import source from "../../../data/verified-forms/pgw-crp-2026-11-13.json";

export const PGW_APPLICATION_SOURCE = source;
export const PGW_APPLICATION_NOTICE_VERSION = "pgw-application-details-2026-11-13.v1";
export const PGW_SUBJECT_AUTHORITY_STATEMENT = "I have permission to provide this information and prepare PGW CRP help for the customer of record, each household member named, including children and other adults, and any outside supporter whose information I provide.";
export const PGW_ACCOUNT_AUTHORITY_STATEMENT = "I am the PGW account holder or have the account holder's permission to prepare help for the exact PGW account provided. This does not authorize a signature, financial agreement, payment, submission or declaration for an outside supporter.";
const stableId = z.uuid().transform(value => value.toLowerCase());
const text = (maximum: number) => z.string().trim().min(1).max(maximum).refine(value => value.length <= maximum && isOrdinaryText(value));
const date = z.string().regex(/^(19|20)\d{2}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const amount = z.number().int().min(0).max(1000000000000);
const phone = z.string().regex(/^[0-9]{3}-[0-9]{3}-[0-9]{4}$/);
const address = z.object({ street: text(160).optional(), city: text(80).optional(), state: text(40).optional(), zip: z.string().regex(/^[0-9]{5}$/).optional() }).strict();
const income = z.object({
  state: z.enum(["sources", "none", "unknown"]),
  sources: z.array(z.object({ id: stableId, kind: z.enum(["employment", "social_security", "pension", "cash_benefits", "unemployment", "disability", "self_employment", "child_support", "spousal_support", "foster_care", "rental", "other"]) }).strict()).max(30),
  noIncomeSituation: text(400).optional(),
}).strict().superRefine((value, context) => {
  if ((value.state === "sources") !== (value.sources.length > 0) || new Set(value.sources.map(item => item.id)).size !== value.sources.length || value.state !== "none" && value.noIncomeSituation)
    context.addIssue({ code: "custom", message: "List distinct known sources, or leave the income inventory unanswered." });
});
const person = z.object({ id: stableId, firstName: text(80).optional(), lastName: text(80).optional(), income: income.optional() }).strict();
const assistance = z.object({ receives: z.boolean().optional(), monthlyAmountCents: amount.optional() }).strict().superRefine((value, context) => {
  if (value.monthlyAmountCents !== undefined && value.receives !== true) context.addIssue({ code: "custom", message: "The monthly amount needs its actual assistance answer." });
});
export const pgwApplicationFieldsValueSchema = z.object({
  journey: z.enum(["new_enrollment", "recertification", "reenrollment", "pending", "unknown"]).optional(),
  currentCrpState: z.enum(["not_enrolled", "enrolled", "previously_enrolled", "unknown"]).optional(),
  householdComplete: z.boolean().optional(),
  // The printed account field has no published mask; this local limit is not a provider format claim.
  accountNumber: z.string().trim().min(1).max(80).refine(value => value.length <= 80 && !/[\u0000-\u001f\u007f-\u009f<>]/.test(value) && !/\b(?:password|passcode|ssn|itin|passport|pin|signature)\b/i.test(value)).optional(),
  customer: person.extend({ under18: z.boolean().optional() }).strict().optional(),
  address: address.optional(), phone: phone.optional(),
  householdMembers: z.array(person.extend({ dateOfBirth: date.optional(), relationship: text(80).optional() }).strict()).max(99).optional(),
  outsideSupport: z.object({ receives: z.boolean().optional(), supporter: z.object({ id: stableId, firstName: text(80).optional(), lastName: text(80).optional(), address: address.optional(), phone: phone.optional(), monthlyAmountCents: amount.optional() }).strict().optional() }).strict().superRefine((value, context) => {
    if (value.supporter && value.receives !== true) context.addIssue({ code: "custom", message: "Outside supporter details need the actual support answer." });
  }).optional(),
  zeroIncomePast30Days: z.boolean().optional(),
  livingExpenses: z.object({ food: text(400).optional(), housing: text(400).optional(), utilities: text(400).optional() }).strict().optional(),
  snap: assistance.optional(), housingSubsidy: assistance.optional(),
}).strict().superRefine((value, context) => {
  const people = [...(value.customer ? [value.customer] : []), ...(value.householdMembers ?? [])];
  if (new Set(people.map(item => item.id)).size !== people.length || value.outsideSupport?.supporter && people.some(item => item.id === value.outsideSupport!.supporter!.id))
    context.addIssue({ code: "custom", message: "Every household member and outside supporter needs a distinct record." });
  if (value.householdComplete === true && (!value.customer || !value.householdMembers)) context.addIssue({ code: "custom", message: "Identify the customer and household list before marking it complete." });
  if (value.livingExpenses && value.zeroIncomePast30Days !== true || value.zeroIncomePast30Days === true && (value.outsideSupport?.receives === true || people.some(item => item.income?.state === "sources")))
    context.addIssue({ code: "custom", message: "The zero-income explanation needs an explicit consistent household statement." });
});
export type PgwApplicationFields = z.infer<typeof pgwApplicationFieldsValueSchema>;

/** Stable person/source references preserve provenance when rows are reordered or corrected. */
export function pgwApplicationLeaves(value: unknown, path = ""): Record<string, unknown> {
  if (Array.isArray(value) && (path === "householdMembers" || path.endsWith(".sources")))
    return value.length ? Object.assign({}, ...value.map(item => pgwApplicationLeaves(item, `${path}.${item.id}`))) : { [path]: [] };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value).filter(([key]) => key !== "id");
    const prefix = path === "customer" || path === "outsideSupport.supporter" ? `${path}.${(value as { id: string }).id}` : path;
    return entries.length ? Object.assign({}, ...entries.map(([key, child]) => pgwApplicationLeaves(child, prefix ? `${prefix}.${key}` : key))) : prefix ? { [prefix]: {} } : {};
  }
  return { [path]: value };
}
