import { z } from "zod";
import contract from "../../../data/verified-forms/wic-pa-preapplication-2026-11-13.json";

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
const fields = contract.fields;
export const wicPersonFieldsSchema = z.object({
  firstName: text(fields.motherFirstName.maxLength).optional(),
  lastName: text(fields.motherLastName.maxLength).optional(), dateOfBirth: date.optional(),
}).strict();
export const wicContactFieldsSchema = wicPersonFieldsSchema.extend({
  street: text(fields.street.maxLength).optional(), city: text(fields.city.maxLength).optional(),
  zip: z.string().regex(/^[0-9]{5}$/).optional(),
  county: z.literal("Philadelphia").optional(),
  email: text(fields.email.maxLength).pipe(z.email()).optional(),
  phone: z.string().regex(/^\d{3}-\d{3}-\d{4}$/).optional(),
}).strict();
export const wicMotherFieldsSchema = wicPersonFieldsSchema.extend({
  status: z.enum(["pregnant", "postpartum", "breastfeeding"]).optional(), expectedDeliveryDate: date.optional(),
}).strict();
export const wicApplicationFieldsShape = {
  applicationType: z.enum(["new", "reapplying", "transfer"]).optional(),
  beneficiaries: z.enum(["mother", "children", "mother_and_children"]).optional(),
  appointmentPreference: z.enum(["morning", "afternoon"]).optional(),
  contact: wicContactFieldsSchema.optional(), mother: wicMotherFieldsSchema.optional(),
  children: z.array(wicPersonFieldsSchema.extend({ id: z.uuid() }).strict()).max(30).optional(),
};
type ConditionalFields = {
  beneficiaries?: string; mother?: z.infer<typeof wicMotherFieldsSchema>; children?: unknown[];
};
export function wicFieldConditions(value: ConditionalFields, context: z.RefinementCtx) {
  if (value.mother && !["mother", "mother_and_children"].includes(value.beneficiaries ?? ""))
    context.addIssue({ code: "custom", path: ["mother"], message: "Select the relevant beneficiary before providing their information." });
  if (value.children && !["children", "mother_and_children"].includes(value.beneficiaries ?? ""))
    context.addIssue({ code: "custom", path: ["children"], message: "Select the relevant beneficiaries before providing their information." });
  if (value.mother?.expectedDeliveryDate && value.mother.status !== "pregnant")
    context.addIssue({ code: "custom", path: ["mother", "expectedDeliveryDate"], message: "A delivery date applies only to the selected pregnancy branch." });
  if (value.mother?.expectedDeliveryDate && value.mother.dateOfBirth && value.mother.expectedDeliveryDate < value.mother.dateOfBirth)
    context.addIssue({ code: "custom", path: ["mother", "expectedDeliveryDate"], message: "A delivery date cannot precede the mother's birth date." });
}
// Contact postal ZIP is a separate parent answer; household routing never supplies or confirms it.
export const wicApplicationFieldsValueSchema = z.object(wicApplicationFieldsShape).strict().superRefine((value, context) => {
  wicFieldConditions(value, context);
  if (new Set(value.children?.map(child => child.id)).size !== (value.children?.length ?? 0))
    context.addIssue({ code: "custom", path: ["children"], message: "Each person needs a distinct stable record." });
});
export type WicApplicationFields = z.infer<typeof wicApplicationFieldsValueSchema>;
export const WIC_APPLICATION_SOURCE = {
  contractId: contract.id, contractVersion: contract.version, sourceUrl: contract.sourceUrl,
  sourceSha256: contract.sourceSha256, sourceCheckedAt: contract.sourceCheckedAt, verifiedUntil: contract.verifiedUntil,
} as const;

/** Stable person IDs preserve provenance across reordering; empty containers remain change evidence. */
export function wicApplicationLeaves(value: unknown, path = ""): Record<string, unknown> {
  if (Array.isArray(value) && path === "children")
    return value.length ? Object.assign({}, ...value.map(child => wicApplicationLeaves(child, `${path}.${child.id}`))) : { [path]: [] };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value).filter(([key]) => key !== "id");
    return entries.length ? Object.assign({}, ...entries.map(([key, child]) => wicApplicationLeaves(child, path ? `${path}.${key}` : key))) : path ? { [path]: {} } : {};
  }
  return { [path]: value };
}
