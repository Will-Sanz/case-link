import { z } from "zod";
import { isOrdinaryText } from "./ordinary-text";

export const WATER_APPLICATION_NOTICE_VERSION = "water-application-details-2026-11-13.v1";
export const WATER_SUBJECT_AUTHORITY_STATEMENT = "I have permission to provide this information and prepare Philadelphia water assistance for myself and every person named, including children, other adults and any outside supporter.";
export const WATER_ACCOUNT_AUTHORITY_STATEMENT = "I hold the water account or have the account holder's permission to prepare help for this account. Saving does not request an application from the City, authorize financial terms, sign or submit an application.";
export const WATER_APPLICATION_REFERENCE = {
  contractId: "philadelphia-water-reference-2026-11-13", contractVersion: "2026-11-13.v1",
  kind: "sample_reference_only", sampleVersion: "6.5 2/9/2026",
  sampleSha256: "e67bd9d90b61684513a77a0d633425423af4cb4795fbc1d582beb1eaf1348b50", sampleByteLength: 908735,
  sourceUrl: "https://www.phila.gov/media/20260202091704/2026-Water-bill-customer-assistance-sample-application.pdf",
  guidanceUrl: "https://www.phila.gov/services/payments-assistance-taxes/payment-plans-and-assistance-programs/senior-citizen-programs/apply-for-water-bill-customer-assistance/",
  portalUrl: "https://cap.phila.gov/apply/", sourceCheckedAt: "2026-11-13T22:09:11.918Z", verifiedUntil: "2026-11-20T22:09:11.918Z",
} as const;

const text = (maximum: number) => z.string().trim().min(1).max(maximum).refine(value => value.length <= maximum && isOrdinaryText(value));
const id = z.uuid().transform(value => value.toLowerCase());
const date = z.string().regex(/^(19|20)\d{2}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
// Seven whole digits is a local input bound, not a program income limit.
export const waterMoneySchema = z.string().regex(/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/).transform(value => {
  const [whole, fraction = ""] = value.split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
});
const answer = z.enum(["yes", "no", "unknown"]);
const income = z.object({ state: z.enum(["sources", "none", "unknown"]), sources: z.array(z.object({
  id, kind: z.enum(["employment", "self_employment", "benefits", "pension", "child_support", "outside_support", "rental", "other"]),
}).strict()).max(30) }).strict().superRefine((value, context) => {
  if ((value.state === "sources") !== (value.sources.length > 0) || new Set(value.sources.map(source => source.id)).size !== value.sources.length)
    context.addIssue({ code: "custom", path: ["sources"], message: "List distinct known sources, or leave the income inventory unanswered." });
});
export const waterPersonFieldsSchema = z.object({ id, name: text(160).optional(), dateOfBirth: date.optional(),
  grossMonthlyIncome: waterMoneySchema.optional(), income: income.optional() }).strict();
const supporter = z.object({ id, name: text(160).optional(), address: text(200).optional(),
  phone: z.string().regex(/^[0-9]{3}-[0-9]{3}-[0-9]{4}$/).optional(), relationship: text(80).optional(),
  amount: waterMoneySchema.optional(), frequency: z.enum(["weekly", "biweekly", "twice_monthly", "monthly", "yearly", "other"]).optional(),
  frequencyDescription: text(40).optional(),
  stillProviding: answer.optional(),
}).strict();

export const waterApplicationFieldsValueSchema = z.object({
  journey: z.enum(["new_application", "recertification", "pending", "unknown"]).optional(),
  existingApplication: z.enum(["none_known", "saved", "submitted", "unknown"]).optional(),
  preferredChannel: z.enum(["online", "paper", "assisted", "unknown"]).optional(),
  applicant: waterPersonFieldsSchema.optional(), propertyAddress: text(200).optional(), mailingAddress: text(200).optional(),
  phone: z.string().regex(/^[0-9]{3}-[0-9]{3}-[0-9]{4}$/).optional(), email: text(100).pipe(z.email()).optional(),
  householdMembers: z.array(waterPersonFieldsSchema.extend({ relationship: text(80).optional() }).strict()).max(99).optional(),
  householdComplete: z.boolean().optional(), oopa: answer.optional(), childSupportReceived: answer.optional(), childSupportMonthlyAmount: waterMoneySchema.optional(),
  outsideIncomeSupport: answer.optional(), outsideSupporters: z.array(supporter).max(30).optional(),
  livingExpenses: z.object({ food: text(400).optional(), housing: text(400).optional(), utilities: text(400).optional() }).strict().optional(),
}).strict().superRefine((value, context) => {
  const people = [...(value.applicant ? [value.applicant] : []), ...(value.householdMembers ?? []), ...(value.outsideSupporters ?? [])];
  if (new Set(people.map(person => person.id)).size !== people.length)
    context.addIssue({ code: "custom", path: ["householdMembers"], message: "Each person needs a distinct stable record." });
  if (value.householdComplete === true && (!value.applicant || !value.householdMembers))
    context.addIssue({ code: "custom", path: ["householdComplete"], message: "Identify the applicant and household list before declaring it complete." });
  if (value.childSupportMonthlyAmount !== undefined && value.childSupportReceived !== "yes")
    context.addIssue({ code: "custom", path: ["childSupportMonthlyAmount"], message: "A child-support amount applies only to the selected support answer." });
  if (value.outsideSupporters && value.outsideIncomeSupport !== "yes")
    context.addIssue({ code: "custom", path: ["outsideSupporters"], message: "Outside-supporter information applies only to the selected support answer." });
  if (value.livingExpenses && (value.applicant?.grossMonthlyIncome !== "0.00" || value.outsideIncomeSupport !== "no"))
    context.addIssue({ code: "custom", path: ["livingExpenses"], message: "The financial explanation needs the applicant's supplied zero-income amount and no outside household support." });
  for (const [index, person] of [value.applicant, ...(value.householdMembers ?? [])].entries())
    if (person?.income?.state === "none" && person.grossMonthlyIncome !== undefined && person.grossMonthlyIncome !== "0.00")
      context.addIssue({ code: "custom", path: index === 0 ? ["applicant", "grossMonthlyIncome"] : ["householdMembers", index - 1, "grossMonthlyIncome"], message: "The reported amount and no-income inventory disagree." });
  for (const [index, person] of (value.outsideSupporters ?? []).entries())
    if (person.frequencyDescription !== undefined && person.frequency !== "other")
      context.addIssue({ code: "custom", path: ["outsideSupporters", index, "frequencyDescription"], message: "Describe a frequency only for the selected other frequency." });
});
export type WaterApplicationFields = z.infer<typeof waterApplicationFieldsValueSchema>;

/** Stable subjects and sources preserve original provenance across reordering. */
export function waterApplicationLeaves(value: unknown, path = ""): Record<string, unknown> {
  if (Array.isArray(value) && (["householdMembers", "outsideSupporters"].includes(path) || path.endsWith(".sources")))
    return value.length ? Object.assign({}, ...value.map(item => waterApplicationLeaves(item, `${path}.${item.id}`))) : { [path]: [] };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value).filter(([key]) => key !== "id");
    const prefix = path === "applicant" ? `${path}.${(value as { id: string }).id}` : path;
    return entries.length ? Object.assign({}, ...entries.map(([key, child]) => waterApplicationLeaves(child, prefix ? `${prefix}.${key}` : key))) : prefix ? { [prefix]: {} } : {};
  }
  return { [path]: value };
}

/** Reference gaps only. This cannot establish an issued form, an application, a personal act or protection. */
export function assessWaterApplicationFields(input: unknown, now: Date) {
  const value = waterApplicationFieldsValueSchema.parse(input), today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const missingFacts: { group: string; fields: string[] }[] = [];
  const missing = (group: string, fields: string[]) => {
    if (!fields.length) return;
    const existing = missingFacts.find(item => item.group === group);
    if (existing) existing.fields.push(...fields); else missingFacts.push({ group, fields });
  };
  const under18 = (birth: string) => Number(today.slice(0, 4)) - Number(birth.slice(0, 4)) - (today.slice(5) < birth.slice(5) ? 1 : 0) < 18;
  missing("journey", value.journey && value.journey !== "unknown" ? [] : ["journey"]);
  missing("existing_application", value.existingApplication && value.existingApplication !== "unknown" ? [] : ["existingApplication"]);
  missing("household", value.householdComplete === true ? [] : ["householdComplete"]);
  const householdIncome: { subjectId: string; amount: string; basis: "parent_answer" | "sample_under_18_instruction" }[] = [];
  for (const [person, path, applicant] of [[value.applicant, "applicant", true], ...(value.householdMembers ?? []).map(person => [person, `householdMembers.${person.id}`, false] as const)] as const) {
    missing(path, ["name", "dateOfBirth"].filter(key => !person?.[key as "name" | "dateOfBirth"]).map(key => `${path}.${key}`));
    if (person?.dateOfBirth && person.dateOfBirth > today) throw new Error("Check the supplied birth dates.");
    // The SAMPLE's zero instruction is inside the other-member table; the applicant has a separate income box.
    const minor = !applicant && !!person?.dateOfBirth && under18(person.dateOfBirth);
    if (person && minor) householdIncome.push({ subjectId: person.id, amount: "0.00", basis: "sample_under_18_instruction" });
    else if (person) {
      missing(path, person.grossMonthlyIncome !== undefined ? [] : [`${path}.grossMonthlyIncome`]);
      missing(path, person.income && person.income.state !== "unknown" ? [] : [`${path}.income`]);
      if (person.grossMonthlyIncome !== undefined) householdIncome.push({ subjectId: person.id, amount: person.grossMonthlyIncome, basis: "parent_answer" });
    }
    if (!applicant) missing(path, person && "relationship" in person && person.relationship ? [] : [`${path}.relationship`]);
  }
  missing("property", value.propertyAddress ? [] : ["propertyAddress"]);
  missing("child_support", value.childSupportReceived && value.childSupportReceived !== "unknown" ? [] : ["childSupportReceived"]);
  if (value.childSupportReceived === "yes") missing("child_support", value.childSupportMonthlyAmount !== undefined ? [] : ["childSupportMonthlyAmount"]);
  missing("outside_support", value.outsideIncomeSupport && value.outsideIncomeSupport !== "unknown" ? [] : ["outsideIncomeSupport"]);
  if (value.outsideIncomeSupport === "yes") {
    missing("outside_support", value.outsideSupporters?.length ? [] : ["outsideSupporters"]);
    for (const person of value.outsideSupporters ?? []) {
      missing(`outsideSupporters.${person.id}`, ["name", "address", "amount", "frequency"].filter(key => !person[key as keyof typeof person]).map(key => `outsideSupporters.${person.id}.${key}`));
      if (person.frequency === "other" && !person.frequencyDescription) missing(`outsideSupporters.${person.id}`, [`outsideSupporters.${person.id}.frequencyDescription`]);
    }
  }
  if (value.applicant?.grossMonthlyIncome === "0.00" && value.outsideIncomeSupport === "no") {
    missing("zero_income", ["food", "housing", "utilities"].filter(key => !value.livingExpenses?.[key as keyof NonNullable<typeof value.livingExpenses>]).map(key => `livingExpenses.${key}`));
  }
  const serviceBlockers = ["actual_account_issued_form_unverified", "protected_account_access_unresolved", "proofs_not_validated", "personal_terms_and_signatures_not_recorded", "provider_execution_unverified"];
  const sourceCurrent = Number.isFinite(now.getTime()) && now.getTime() >= Date.parse(WATER_APPLICATION_REFERENCE.sourceCheckedAt) && now.getTime() < Date.parse(WATER_APPLICATION_REFERENCE.verifiedUntil);
  if (!sourceCurrent) serviceBlockers.push("reference_review_expired");
  if (value.existingApplication === "saved" || value.existingApplication === "submitted" || value.journey === "pending") serviceBlockers.push("reconcile_existing_application_before_new_request");
  return { kind: "water_sample_reference_assessment" as const, sourceCurrent, missingFacts, householdIncome,
    referenceFieldsPresent: sourceCurrent && missingFacts.length === 0, serviceBlockers,
    actualFormReady: false as const, submissionReady: false as const, providerStatus: "unverified" as const, shutoffProtection: "unverified" as const };
}
