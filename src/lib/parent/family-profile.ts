import { z } from "zod";
import { isOrdinaryText } from "./ordinary-text";

export const FAMILY_PROFILE_NOTICE_VERSION = "family-profile-2026-11-17.v1";
export const FAMILY_PROFILE_RETENTION_DAYS = 45;
export const FAMILY_PROFILE_CONSENT_STATEMENT = "Save these family basics privately for reuse in support applications I choose and authorize. Each confirmed answer can be kept for up to 45 days; opening it or starting another request does not extend that time. I have permission to provide this information for everyone named. This does not authorize an application, signature, account access or financial agreement.";
const id = z.uuid().transform(value => value.toLowerCase());
const text = (max: number) => z.string().trim().min(1).max(max).refine(value => value.length <= max && isOrdinaryText(value));
const easternDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const date = z.string().regex(/^(19|20)\d{2}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && value <= easternDay.format(new Date());
});
export const familyProfileIncomeKinds = ["employment", "self_employment", "unemployment", "pension", "workers_compensation", "veterans", "cash_welfare", "cash_benefits", "child_support", "spousal_support", "social_security", "disability", "foster_care", "benefits", "outside_support", "rental", "other"] as const;
export type FamilyProfileIncomeKind = typeof familyProfileIncomeKinds[number];
const income = z.object({ state: z.enum(["sources", "none", "unknown"]), sources: z.array(z.object({ id, kind: z.enum(familyProfileIncomeKinds) }).strict()).max(30) }).strict().superRefine((value, context) => {
  if ((value.state === "sources") !== (value.sources.length > 0) || new Set(value.sources.map(source => source.id)).size !== value.sources.length)
    context.addIssue({ code: "custom", message: "List each income source once, or choose no income or not sure." });
}).transform(value => ({ ...value, sources: [...value.sources].sort((a, b) => a.id.localeCompare(b.id)) }));
const person = z.object({ id, firstName: text(80).optional(), middleInitial: text(2).optional(), lastName: text(80).optional(), dateOfBirth: date.optional(), income: income.optional() }).strict();
const address = z.object({ street: text(160).optional(), apartment: text(80).optional(), city: text(80).optional(), state: z.string().regex(/^[A-Z]{2}$/).optional(), zip: z.string().regex(/^[0-9]{5}$/).optional(), county: text(80).optional() }).strict();
export const familyProfileDetailsSchema = z.object({
  primaryPerson: person,
  contact: z.object({ phone: z.string().regex(/^[0-9]{3}-[0-9]{3}-[0-9]{4}$/).optional(), email: text(100).pipe(z.email()).optional() }).strict().optional(),
  homeAddress: address.optional(), mailingAddress: address.optional(), mailingAddressSameAsHome: z.boolean().optional(),
  preferredLanguage: z.enum(["en", "es", "other"]).optional(), otherLanguage: text(80).optional(),
  members: z.array(person.extend({ relationship: text(80).optional() }).strict()).max(29).optional(),
}).strict().superRefine((value, context) => {
  if (new Set([value.primaryPerson.id, ...(value.members ?? []).map(member => member.id)]).size !== 1 + (value.members?.length ?? 0))
    context.addIssue({ code: "custom", path: ["members"], message: "Each person needs a distinct record." });
  if (value.mailingAddressSameAsHome === true && value.mailingAddress !== undefined)
    context.addIssue({ code: "custom", path: ["mailingAddress"], message: "Use the home address or a separate mailing address." });
  if (value.otherLanguage !== undefined && value.preferredLanguage !== "other")
    context.addIssue({ code: "custom", path: ["otherLanguage"], message: "Describe only the selected other language." });
}).transform(value => ({ ...value, ...(value.members ? { members: [...value.members].sort((a, b) => a.id.localeCompare(b.id)) } : {}) }));
export type FamilyProfileDetails = z.infer<typeof familyProfileDetailsSchema>;

/** Stable person IDs preserve dates when the household list is reordered. An income inventory is one indivisible fact. */
export function familyProfileLeaves(value: unknown, path = ""): Record<string, unknown> {
  if (path.endsWith(".income")) return { [path]: value };
  if (Array.isArray(value) && path === "members") return value.length ? Object.assign({}, ...value.map(item => familyProfileLeaves(item, `${path}.${item.id}`))) : { members: [] };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value).filter(([key, child]) => key !== "id" && child !== undefined);
    return entries.length ? Object.assign({}, ...entries.map(([key, child]) => familyProfileLeaves(child, path ? `${path}.${key}` : key))) : {};
  }
  return { [path]: value };
}
const path = z.string().min(1).max(200).regex(/^[A-Za-z0-9_.-]+$/);
const timestamp = z.iso.datetime({ offset: true });
export const familyProfileProvenanceSchema = z.record(path, z.object({ confirmedAt: timestamp, expiresAt: timestamp }).strict().refine(value => Date.parse(value.expiresAt) > Date.parse(value.confirmedAt)));
export const familyProfileSnapshotSchema = z.object({ revision: z.number().int().positive(), details: familyProfileDetailsSchema, provenance: familyProfileProvenanceSchema, idempotencyKey: id }).strict().superRefine((value, context) => {
  const paths = Object.keys(familyProfileLeaves(value.details)).sort(), recorded = Object.keys(value.provenance).sort();
  if (JSON.stringify(paths) !== JSON.stringify(recorded) || Object.values(value.provenance).some(dates => Date.parse(dates.expiresAt) - Date.parse(dates.confirmedAt) > FAMILY_PROFILE_RETENTION_DAYS * 86400000))
    context.addIssue({ code: "custom", message: "The saved family answer dates are unavailable." });
});
export type FamilyProfileSnapshot = z.infer<typeof familyProfileSnapshotSchema>;
export const familyProfileCollectionSchema = z.object({ collectionEnabled: z.boolean(), noticeVersion: z.literal(FAMILY_PROFILE_NOTICE_VERSION).nullable(), expiresAt: timestamp.nullable(), retentionDays: z.literal(FAMILY_PROFILE_RETENTION_DAYS) }).strict();
export const familyProfileReadSchema = z.object({ ownerId: id, revision: z.number().int().nonnegative(), collection: familyProfileCollectionSchema, profile: familyProfileSnapshotSchema.nullable(), lastMutationKey: id.nullable() }).strict().superRefine((value, context) => {
  if (value.profile && (value.profile.revision !== value.revision || value.profile.idempotencyKey !== value.lastMutationKey || Object.values(value.profile.provenance).some(dates => Date.parse(dates.confirmedAt) > Date.now() || Date.parse(dates.expiresAt) <= Date.now()))) context.addIssue({ code: "custom", message: "The saved profile changed." });
});
export type FamilyProfileRead = z.infer<typeof familyProfileReadSchema>;
export const familyProfileWriteSchema = z.object({ expectedOwnerId: id, expectedRevision: z.number().int().nonnegative(), details: familyProfileDetailsSchema,
  noticeVersion: z.literal(FAMILY_PROFILE_NOTICE_VERSION), consentAccepted: z.literal(true), subjectAuthorityDeclared: z.literal(true), confirmedPaths: z.array(path).max(1000).optional(),
}).strict().superRefine((value, context) => {
  const leaves = familyProfileLeaves(value.details);
  if (value.confirmedPaths && (new Set(value.confirmedPaths).size !== value.confirmedPaths.length || value.confirmedPaths.some(path => !(path in leaves))))
    context.addIssue({ code: "custom", path: ["confirmedPaths"], message: "Confirm only distinct saved answers." });
});
export const familyProfileClearSchema = z.object({ expectedOwnerId: id, expectedRevision: z.number().int().nonnegative() }).strict();
export const familyProfileSourceSchema = z.object({ expectedOwnerId: id, revision: z.number().int().positive(), options: z.object({ accountPersonId: id.optional(), useHomeAddress: z.boolean().optional(), wicChildIds: z.array(id).max(29).refine(values => new Set(values).size === values.length).optional(), pecoPhoneType: z.enum(["home", "cell"]).optional() }).strict().optional(), fields: z.array(z.object({ applicationPath: path, profilePaths: z.array(path).min(1).max(10).refine(values => new Set(values).size === values.length) }).strict()).min(1).max(1000) }).strict().superRefine((value, context) => {
  if (new Set(value.fields.map(field => field.applicationPath)).size !== value.fields.length) context.addIssue({ code: "custom", message: "Each application answer needs one source." });
});
export type FamilyProfileSource = z.infer<typeof familyProfileSourceSchema>;
export const familyProfileBindingsSchema = z.object({ fields: z.array(familyProfileSourceSchema.shape.fields.element).max(1000) }).strict();
