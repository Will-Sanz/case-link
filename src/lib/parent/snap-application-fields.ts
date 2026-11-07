import { z } from "zod";
import source from "../../../data/verified-forms/snap-pa600fs-2019.json";

const text = (max = 160) => z.string().trim().min(1).max(max).refine((value) =>
  value.length <= max &&
  !/[\u0000-\u001f\u007f-\u009f]/.test(value) &&
  !/\b\d{3}[-.\s]*\d{2}[-.\s]*\d{4}\b/.test(value.normalize("NFKC").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")));
const amount = z.number().finite().min(0).max(1000000);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const frequency = z.enum(["weekly", "biweekly", "twice_monthly", "monthly", "yearly"]);
const nameSchema = z.object({ firstName: text(80), lastName: text(80), middleInitial: text(2).optional() }).strict();
const addressSchema = z.object({ street: text(180), city: text(80), state: z.string().regex(/^[A-Z]{2}$/) }).strict();
const personSchema = nameSchema.extend({
  dateOfBirth: date, sex: z.enum(["male", "female"]).optional(), student: z.boolean().optional(),
  relationship: text(40), requestingSnap: z.boolean(), citizen: z.boolean().optional(),
}).strict();
const rehearsalPerson = personSchema.superRefine((value, ctx) => {
  if (!value.requestingSnap && value.citizen !== undefined)
    ctx.addIssue({ code: "custom", message: "Do not supply applicant-only information for a non-applicant." });
});
const existingFields = {
  zip: z.string().regex(/^\d{5}$/).optional(), language: z.enum(["en", "es"]).optional(),
  householdSize: z.number().int().min(1).max(30).optional(),
  incomeAmount: amount.optional(), incomeFrequency: frequency.optional(),
};
const scopedSchema = z.object({ kind: z.literal("current_scoped_facts"), ...existingFields }).strict();
export const snapHistoryAnswerSchema = z.object({ answer: z.boolean(), names: text(200).optional(), date: date.optional(), state: text(40).optional() }).strict();
const historySchema = z.object({
  fleeingOrProbation: snapHistoryAnswerSchema.optional(), welfareFraud: snapHistoryAnswerSchema.optional(),
  otherStateDisqualification: snapHistoryAnswerSchema.omit({ date: true, state: true }).strict().optional(),
}).strict();
const expensesSchema = z.object({
  childSupport: z.boolean().optional(), courtOrdered: z.boolean().optional(),
  mealsIncludedInRent: z.boolean().optional(), heat: z.boolean().optional(),
  housingAssistance: z.boolean().optional(), housingAssistanceKind: text(160).optional(), utilityAllowance: z.boolean().optional(),
  outsidePayer: z.boolean().optional(), outsideExpenses: text(160).optional(), outsideAmount: amount.optional(),
  outsideFrequency: text(60).optional(), outsidePayee: text(160).optional(), airConditioning: z.boolean().optional(),
  utilities: z.array(z.enum(["telephone", "water", "garbage", "installation", "electric", "oil", "sewer", "gas", "propane", "other"])).max(10).optional(),
  otherUtility: text(160).optional(), care: z.boolean().optional(), careMonthlyAmount: amount.optional(), careRecipient: text(160).optional(),
  rent: amount.optional(), condoFees: amount.optional(), mortgage: amount.optional(), propertyFees: amount.optional(), homeownersInsurance: amount.optional(),
  medical: z.array(z.enum(["dental", "doctor", "equipment", "premiums", "hospital", "prescriptions", "homeAide", "supplies", "transport", "other"])).max(10).optional(),
  otherMedical: text(160).optional(),
}).strict();
const screeningSchema = z.object({ lowCashAndIncome: z.boolean().optional(), migrantOrSeasonal: z.boolean().optional(), belowShelterCosts: z.boolean().optional() }).strict();
const contactFields = {
  county: text(80).optional(), phone: text(30).optional(), otherPhone: text(30).optional(), bestTimeToCall: text(70).optional(),
  interpreter: z.boolean().optional(), interpreterLanguage: text(80).optional(),
};
export const snapRehearsalInputSchema = z.object({
  kind: z.literal("synthetic_rehearsal"), ...existingFields,
  applicant: nameSchema.optional(), address: addressSchema.optional(), ...contactFields,
  screening: screeningSchema.optional(), household: z.array(rehearsalPerson).min(1).max(8).optional(),
  income: z.object({ hasIncome: z.boolean().optional(), entries: z.array(z.object({
    personIndex: z.number().int().min(0).max(7), source: text(100), amount, frequency, receivedOn: date,
  }).strict()).max(5) }).strict().optional(),
  history: historySchema.optional(), expenses: expensesSchema.optional(),
}).strict();
export const snapPreparationInputSchema = z.discriminatedUnion("kind", [scopedSchema, snapRehearsalInputSchema]);

const housingFields = ["rent", "condoFees", "mortgage", "propertyFees", "homeownersInsurance"] as const;
const applicationPhone = text(30).refine(value => /^\+?[\d ().-]+$/.test(value) && value.replace(/\D/g, "").length >= 7 && value.replace(/\D/g, "").length <= 15);
const applicationPerson = personSchema.partial().extend({ id: z.uuid() }).strict();
const applicationFields = z.object({
  ...existingFields,
  language: z.enum(["en", "es", "other"]).optional(), otherLanguage: text(80).optional(),
  applicant: nameSchema.partial().optional(), address: addressSchema.partial().optional(), ...contactFields,
  phone: applicationPhone.optional(), otherPhone: applicationPhone.optional(),
  screening: screeningSchema.optional(), household: z.array(applicationPerson).min(1).max(30).optional(),
  income: z.object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(), hasIncome: z.boolean().optional(),
    entries: z.array(z.object({
      id: z.uuid(), personId: z.uuid().optional(), source: text(100).optional(), amount: amount.optional(),
      frequency: text(60).optional(), status: z.enum(["received", "expected"]).optional(), date: date.optional(),
    }).strict()).max(100).optional(),
  }).strict().optional(),
  history: z.object({
    fleeingOrProbation: snapHistoryAnswerSchema.partial().optional(), welfareFraud: snapHistoryAnswerSchema.partial().optional(),
    otherStateDisqualification: snapHistoryAnswerSchema.omit({ date: true, state: true }).partial().optional(),
  }).strict().optional(),
  expenses: expensesSchema.optional(),
  expenseClaims: z.object({
    household: z.enum(["claim", "do_not_claim"]).optional(),
    housing: z.array(z.enum(housingFields)).max(5).optional(),
    medical: z.enum(["claim", "not_applicable", "do_not_claim"]).optional(),
  }).strict().optional(),
  authorizedRepresentative: z.object({
    name: text(160).optional(), address: addressSchema.partial().extend({ zip: existingFields.zip }).optional(), phone: applicationPhone.optional(),
  }).strict().optional(),
}).strict();

export type SnapApplicationFields = z.infer<typeof applicationFields>;
export const SNAP_APPLICATION_SOURCE = {
  templateId: source.id, templateVersion: source.version, templateSha256: source.sha256,
  inventoryId: "pa-snap-pa600fs-sg-2019-field-inventory", inventoryVersion: "2026-11-03.v1",
  inventorySha256: "5db4a308b834836d2fb4681e77e13c2834a0ff70b08dbcd5c6188fb7c05d88ee",
} as const;
const agencyDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

/** Historical values stay readable; permission and original per-field provenance remain server-owned. */
export const snapApplicationFieldsValueSchema = applicationFields.superRefine((value, ctx) => {
    const issue = (path: (string | number)[], message = "Check this field and its applicable answers.") => ctx.addIssue({ code: "custom", path, message });
    const scan = (item: unknown, path: (string | number)[] = []) => {
      if (typeof item === "string") {
        const normalized = item.normalize("NFKC").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");
        if (/\b\d{3}[-.\/\s‐‑‒–—―]*\d{2}[-.\/\s‐‑‒–—―]*\d{4}\b/.test(normalized) ||
          (!['phone', 'otherPhone'].includes(String(path.at(-1))) && /\b\d{12,19}\b/.test(normalized)) ||
          /\b(?:password|passcode|pin|ssn|social\s+security(?:\s+number)?|signature|ebt\s+pin)\s*(?:is\s+|[:=#]\s*)\S+/i.test(normalized))
          issue(path, "Use the protected official-program step for identifiers, credentials and signatures.");
      } else if (item && typeof item === "object")
        for (const [key, child] of Object.entries(item))
          if (key !== "id" && key !== "personId") scan(child, [...path, Array.isArray(item) ? Number(key) : key]);
    };
    scan(value);
    const people = value.household ?? [], entries = value.income?.entries ?? [];
    if (new Set(people.map(p => p.id)).size !== people.length) issue(["household"], "Each person needs a distinct stable record.");
    if (new Set(entries.map(e => e.id)).size !== entries.length) issue(["income", "entries"], "Each income entry needs a distinct stable record.");
    people.forEach((person, index) => {
      if (person.requestingSnap !== true && person.citizen !== undefined) issue(["household", index, "citizen"], "Applicant-only information cannot be supplied for a non-applicant or undecided applicant.");
      if (index === 0 && person.relationship && person.relationship.toUpperCase() !== "SELF") issue(["household", index, "relationship"]);
    });
    const self = people[0];
    for (const field of ["firstName", "lastName", "middleInitial"] as const)
      if (self?.[field] !== undefined && value.applicant?.[field] !== undefined && self[field] !== value.applicant[field]) issue(["applicant", field], "The applicant and SELF row must identify the same person.");
    if (value.income?.hasIncome === false && entries.length) issue(["income", "hasIncome"]);
    entries.forEach((entry, index) => {
      if (entry.personId && !people.some(p => p.id === entry.personId)) issue(["income", "entries", index, "personId"]);
    });
    for (const [key, answer] of Object.entries(value.history ?? {})) {
      if (answer?.answer === false && Object.keys(answer).some(field => field !== "answer")) issue(["history", key]);
    }
    if (value.otherLanguage && value.language !== "other") issue(["otherLanguage"]);
    if (value.interpreter === false && value.interpreterLanguage !== undefined) issue(["interpreterLanguage"]);
    const e = value.expenses, claims = value.expenseClaims;
    if (e) {
      for (const [condition, fields] of [
        [e.childSupport, ["courtOrdered"]], [e.housingAssistance, ["housingAssistanceKind", "utilityAllowance"]],
        [e.outsidePayer, ["outsideExpenses", "outsideAmount", "outsideFrequency", "outsidePayee"]], [e.care, ["careMonthlyAmount", "careRecipient"]],
      ] as [boolean | undefined, (keyof typeof e)[]][])
        if (condition === false && fields.some(field => e[field] !== undefined)) issue(["expenses", fields[0]]);
      if (e.otherUtility && !e.utilities?.includes("other")) issue(["expenses", "otherUtility"]);
      if (e.otherMedical && !e.medical?.includes("other")) issue(["expenses", "otherMedical"]);
      for (const field of ["utilities", "medical"] as const)
        if (e[field] && new Set(e[field]).size !== e[field].length) issue(["expenses", field]);
      if (claims?.household === "do_not_claim" && Object.keys(e).some(field => !["medical", "otherMedical"].includes(field))) issue(["expenseClaims", "household"]);
      if (["not_applicable", "do_not_claim"].includes(claims?.medical ?? "") && (e.medical?.length || e.otherMedical)) issue(["expenseClaims", "medical"]);
      if (claims?.housing && housingFields.some(field => e[field] !== undefined && !claims.housing!.includes(field))) issue(["expenseClaims", "housing"]);
    }
    if (claims?.housing && new Set(claims.housing).size !== claims.housing.length) issue(["expenseClaims", "housing"]);
    if (claims?.household === "do_not_claim" && claims.housing?.length) issue(["expenseClaims", "housing"]);
});

/** New preparation writes must also match the current Eastern calendar period. */
export function snapApplicationFieldsSchema(now: Date) {
  if (!Number.isFinite(now.getTime())) throw new Error("A valid assessment time is required.");
  const today = agencyDate.format(now), month = today.slice(0, 7);
  return snapApplicationFieldsValueSchema.superRefine((value, ctx) => {
    const issue = (path: (string | number)[], message = "Check this field and its applicable date.") => ctx.addIssue({ code: "custom", path, message });
    value.household?.forEach((person, index) => {
      if (person.dateOfBirth && person.dateOfBirth > today) issue(["household", index, "dateOfBirth"]);
    });
    if (value.income?.month && value.income.month !== month) issue(["income", "month"], "This form asks about the current calendar month.");
    value.income?.entries?.forEach((entry, index) => {
      if (entry.date && (entry.date.slice(0, 7) !== month ||
        (entry.status === "received" && entry.date > today) || (entry.status === "expected" && entry.date < today))) issue(["income", "entries", index, "date"], "Keep actual receipts and expected current-month payments distinct.");
    });
    for (const [key, answer] of Object.entries(value.history ?? {}))
      if (answer && "date" in answer && answer.date && answer.date > today) issue(["history", key, "date"]);
  });
}

export function assessSnapApplicationFields(input: unknown, now: Date) {
  const value = snapApplicationFieldsValueSchema.parse(input);
  const current = snapApplicationFieldsSchema(now).safeParse(value);
  const invalidCurrentFields = current.success ? [] : current.error.issues.map(issue => {
    const path = [...issue.path];
    if (path[0] === "household" && typeof path[1] === "number") path[1] = value.household![path[1]].id;
    if (path[0] === "income" && path[1] === "entries" && typeof path[2] === "number") path[2] = value.income!.entries![path[2]].id;
    return path.join(".");
  });
  const missingFields: string[] = [], serviceQuestions: string[] = [];
  const need = (path: string, present: boolean) => { if (!present) missingFields.push(path); };
  need("applicant.firstName", !!value.applicant?.firstName); need("applicant.lastName", !!value.applicant?.lastName);
  if (!value.address?.street || !value.address.city || !value.address.state || !value.zip) serviceQuestions.push("address_or_provider_accepted_alternative");
  if (invalidCurrentFields.some(path => path.startsWith("income."))) serviceQuestions.push("refresh_current_month_income");
  need("county", !!value.county); need("language", !!value.language);
  if (value.language === "other") need("otherLanguage", !!value.otherLanguage);
  need("interpreter", value.interpreter !== undefined);
  if (value.interpreter) need("interpreterLanguage", !!value.interpreterLanguage);
  for (const field of ["lowCashAndIncome", "migrantOrSeasonal", "belowShelterCosts"] as const) need(`screening.${field}`, value.screening?.[field] !== undefined);
  const people = value.household ?? [], entries = value.income?.entries ?? [];
  need("household", people.length > 0); need("household.applicants", people.some(p => p.requestingSnap === true));
  if (value.householdSize !== undefined) need("household.count_consistency", people.length === value.householdSize);
  people.forEach(person => {
    for (const field of ["firstName", "lastName", "dateOfBirth", "sex", "student", "relationship", "requestingSnap"] as const) need(`household.${person.id}.${field}`, person[field] !== undefined);
    if (person.requestingSnap) need(`household.${person.id}.citizen`, person.citizen !== undefined);
  });
  need("income", value.income?.hasIncome === false || entries.length > 0);
  if (value.income && !value.income.month) serviceQuestions.push("record_original_current_month_income_period");
  entries.forEach(entry => {
    for (const field of ["personId", "source", "amount", "frequency", "status", "date"] as const) need(`income.entries.${entry.id}.${field}`, entry[field] !== undefined);
  });
  for (const field of ["fleeingOrProbation", "welfareFraud", "otherStateDisqualification"] as const) {
    const answer = value.history?.[field]; need(`history.${field}.answer`, answer?.answer !== undefined);
    if (answer?.answer) {
      need(`history.${field}.names`, !!answer.names);
      if (field !== "otherStateDisqualification") {
        const detail = value.history?.[field]; need(`history.${field}.date`, !!detail?.date); need(`history.${field}.state`, !!detail?.state);
      }
    }
  }
  const e = value.expenses, claims = value.expenseClaims;
  need("expenseClaims.household", claims?.household !== undefined);
  if (claims?.household === "claim") {
    for (const field of ["childSupport", "mealsIncludedInRent", "heat", "housingAssistance", "outsidePayer", "airConditioning", "care", "utilities"] as const) need(`expenses.${field}`, e?.[field] !== undefined);
    for (const [condition, fields] of [
      [e?.childSupport, ["courtOrdered"]], [e?.housingAssistance, ["housingAssistanceKind", "utilityAllowance"]],
      [e?.outsidePayer, ["outsideExpenses", "outsideAmount", "outsideFrequency", "outsidePayee"]], [e?.care, ["careMonthlyAmount", "careRecipient"]],
    ] as [boolean | undefined, (keyof NonNullable<typeof e>)[]][])
      if (condition) for (const field of fields) need(`expenses.${field}`, e?.[field] !== undefined);
    need("expenseClaims.housing", claims.housing !== undefined);
    for (const field of claims.housing ?? []) need(`expenses.${field}`, e?.[field] !== undefined);
    if (e?.utilities?.includes("other")) need("expenses.otherUtility", !!e.otherUtility);
  }
  need("expenseClaims.medical", claims?.medical !== undefined);
  if (claims?.medical === "claim") {
    need("expenses.medical", !!e?.medical?.length);
    if (e?.medical?.includes("other")) need("expenses.otherMedical", !!e.otherMedical);
  }
  const representative = value.authorizedRepresentative;
  if (representative) {
    for (const field of ["name", "phone"] as const) need(`authorizedRepresentative.${field}`, !!representative[field]);
    for (const field of ["street", "city", "state", "zip"] as const) need(`authorizedRepresentative.address.${field}`, !!representative.address?.[field]);
  }
  const sourceReviewCurrent = now.getTime() >= Date.parse(`${source.sourceCheckedAt}T00:00:00Z`) && now.getTime() < Date.parse(source.verifiedUntil);
  if (!sourceReviewCurrent) serviceQuestions.push("current_form_source_review");
  return {
    source: SNAP_APPLICATION_SOURCE, sourceReviewCurrent, missingFields, serviceQuestions, invalidCurrentFields,
    optionalContactNotes: value.phone ? [] : ["phone_not_supplied"],
    nonProtectedDataReadyForReview: !missingFields.length && !serviceQuestions.length && !invalidCurrentFields.length,
    minimumFilingNameAndAddressPresent: !!value.applicant?.firstName && !!value.applicant.lastName && !!value.address?.street && !!value.address.city && !!value.address.state && !!value.zip,
    submissionReady: false as const,
    protectedSteps: [
      ...people.filter(p => p.requestingSnap).map(p => ({ step: "required_identifier_or_verified_exception", personId: p.id })),
      ...people.filter(p => p.requestingSnap && p.citizen === false).map(p => ({ step: "noncitizen_applicant_documentation", personId: p.id })),
      { step: "genuine_applicant_certifications_printed_pages_1_and_5" },
      ...(representative ? [{ step: "genuine_representative_designation_and_personal_act" }] : []),
      { step: "permitted_delivery_and_actual_agency_receipt" },
    ],
    renderingRequirements: [
      ...(people.length > source.limits.householdRows ? ["accepted_household_continuation"] : []),
      ...(entries.length > source.limits.incomeRows ? ["accepted_income_continuation"] : []),
      ...(entries.some(e => e.status === "expected") ? ["explicit_expected_income_rendering"] : []),
      ...(value.language === "other" ? ["other_language_field_mapping"] : []),
    ],
  };
}
