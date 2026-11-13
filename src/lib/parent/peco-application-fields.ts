import { z } from "zod";

export const PECO_APPLICATION_NOTICE_VERSION = "peco-application-details-2026-11-13.v1";
export const PECO_SUBJECT_AUTHORITY_STATEMENT = "I have permission to provide this information and prepare PECO CAP help for myself and every person named, including children and any other adult.";
export const PECO_ACCOUNT_AUTHORITY_STATEMENT = "I am the PECO account holder or have the account holder's permission to prepare help for the exact PECO account provided in this request. This does not authorize payments, a financial agreement, a signature or submission.";
export const PECO_APPLICATION_SOURCE = {
  contractId: "peco-cap-2026-private-preparation-2026-11-13", contractVersion: "2026-11-13.v1",
  sourceUrl: "https://www.peco.com/cdn/assets/v3/assets/blt1b5616c79bacadb4/blt9d4fc50508d00567/69f41a34626de91f304d9b8f/PECO_CAP_Application_2026_v2.pdf?branch=prod_alias",
  sourceSha256: "87d4a25f808eac9e79eaf49197bb38c1e375d22b18ce0533995eca81698099cc", sourceByteLength: 269140,
  sourceCheckedAt: "2026-11-13T20:06:00.000Z", verifiedUntil: "2026-11-20T20:06:00.000Z",
} as const;

const text = (maximum: number) => z.string().trim().min(1).max(maximum).refine(value => {
  const normalized = value.normalize("NFKC").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");
  return value.length <= maximum && !/[\u0000-\u001f\u007f-\u009f<>]/.test(value) &&
    !/\d{3}[-.\/\s‐‑‒–—―]*\d{2}[-.\/\s‐‑‒–—―]*\d{4}|\d{12,19}/.test(normalized) &&
    !/\b(?:password|passcode|pin|ssn|social\s+security(?:\s+number)?|signature|ebt\s+pin)\s*(?:is\s+|[:=#]\s*)\S+/i.test(normalized);
});
const date = z.string().regex(/^(19|20)\d{2}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const stableId = z.uuid().transform(value => value.toLowerCase());
const income = z.object({
  state: z.enum(["sources", "none", "unknown"]),
  sources: z.array(z.object({
    id: stableId, kind: z.enum(["employment", "unemployment", "pension", "workers_compensation", "veterans", "cash_welfare", "child_support", "spousal_support", "social_security", "rental", "self_employment", "other"]),
  }).strict()).max(30),
}).strict().superRefine((value, context) => {
  if ((value.state === "sources") !== (value.sources.length > 0) || new Set(value.sources.map(source => source.id)).size !== value.sources.length)
    context.addIssue({ code: "custom", path: ["sources"], message: "List each known source once, or leave the income inventory unanswered." });
});
export const pecoPersonFieldsSchema = z.object({
  id: stableId, firstName: text(80).optional(), lastName: text(80).optional(), middleInitial: text(2).optional(),
  dateOfBirth: date.optional(), income: income.optional(),
}).strict();

export const pecoApplicationFieldsValueSchema = z.object({
  journey: z.enum(["new_enrollment", "renewal", "unknown"]).optional(),
  currentCapState: z.enum(["not_enrolled", "enrolled", "unknown"]).optional(),
  householdComplete: z.boolean().optional(),
  // This dedicated field accepts the supported ten-digit utility account, never an optional government ID.
  accountNumber: z.string().regex(/^[0-9]{10}$/).optional(),
  applicant: pecoPersonFieldsSchema.optional(),
  address: z.object({ street: text(160).optional(), apartment: text(80).optional(), city: text(80).optional(), state: z.literal("PA").optional(), zip: z.string().regex(/^[0-9]{5}$/).optional() }).strict().optional(),
  homePhone: z.string().regex(/^[0-9]{3}-[0-9]{3}-[0-9]{4}$/).optional(),
  cellPhone: z.string().regex(/^[0-9]{3}-[0-9]{3}-[0-9]{4}$/).optional(), smsUpdates: z.boolean().optional(),
  householdMembers: z.array(pecoPersonFieldsSchema.extend({ relationship: text(80).optional() }).strict()).max(99).optional(),
}).strict().superRefine((value, context) => {
  const people = [...(value.applicant ? [value.applicant] : []), ...(value.householdMembers ?? [])];
  if (new Set(people.map(person => person.id)).size !== people.length)
    context.addIssue({ code: "custom", path: ["householdMembers"], message: "Each person needs a distinct stable record." });
  if (value.householdComplete === true && (!value.applicant || !value.householdMembers))
    context.addIssue({ code: "custom", path: ["householdComplete"], message: "Identify the applicant and household list before marking it complete." });
  if (value.smsUpdates === true && !value.cellPhone)
    context.addIssue({ code: "custom", path: ["cellPhone"], message: "A mobile number is needed for the selected text updates." });
});
export type PecoApplicationFields = z.infer<typeof pecoApplicationFieldsValueSchema>;

/** Stable IDs identify people and sources; merely reordering them does not refresh answers. */
export function pecoApplicationLeaves(value: unknown, path = ""): Record<string, unknown> {
  if (Array.isArray(value) && (path === "householdMembers" || path.endsWith(".sources")))
    return value.length ? Object.assign({}, ...value.map(item => pecoApplicationLeaves(item, `${path}.${item.id}`))) : { [path]: [] };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value).filter(([key]) => key !== "id");
    const prefix = path === "applicant" ? `${path}.${(value as { id: string }).id}` : path;
    return entries.length ? Object.assign({}, ...entries.map(([key, child]) => pecoApplicationLeaves(child, prefix ? `${prefix}.${key}` : key))) : prefix ? { [prefix]: {} } : {};
  }
  return { [path]: value };
}
