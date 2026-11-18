import { z } from "zod";
import { PGW_APPLICATION_SOURCE, pgwApplicationFieldsValueSchema, type PgwApplicationFields } from "./pgw-application-fields";

export const PGW_PREPARATION_ERROR = "The PGW preparation could not be checked from the supplied information.";
export const fictionalPgwApplicationSchema = z.object({ kind: z.literal("fictional_offline_rehearsal"), fields: pgwApplicationFieldsValueSchema }).strict();
const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
export function pgwUnder18(birth: string, today: string): boolean {
  return Number(today.slice(0, 4)) - Number(birth.slice(0, 4)) - (today.slice(5) < birth.slice(5) ? 1 : 0) < 18;
}

/** Source-specific assessment only; it establishes no ownership, protected input or personal act. */
export function assessPgwApplicationFields(input: unknown, now: Date) {
  try {
    const at = new Date(now), fields = pgwApplicationFieldsValueSchema.parse(structuredClone(input));
    if (!Number.isFinite(at.getTime()) || at.getTime() < Date.parse(PGW_APPLICATION_SOURCE.sourceCheckedAt) || at.getTime() >= Date.parse(PGW_APPLICATION_SOURCE.verifiedUntil)) throw new Error();
    const today = localDate.format(at), missingFacts: { group: string; fields: string[] }[] = [], serviceRequirements: string[] = [];
    const missing = (group: string, paths: string[]) => {
      if (!paths.length) return;
      const existing = missingFacts.find(item => item.group === group);
      if (existing) existing.fields.push(...paths); else missingFacts.push({ group, fields: paths });
    };
    if (!fields.journey || fields.journey === "unknown") missing("journey", ["journey"]);
    if (!fields.currentCrpState || fields.currentCrpState === "unknown") missing("journey", ["currentCrpState"]);
    if (fields.journey === "pending") serviceRequirements.push("reconcile_existing_application_before_preparing_another");
    const expectedState = { new_enrollment: "not_enrolled", recertification: "enrolled", reenrollment: "previously_enrolled" };
    if (fields.journey && fields.journey in expectedState && fields.currentCrpState && fields.currentCrpState !== "unknown" &&
      fields.currentCrpState !== expectedState[fields.journey as keyof typeof expectedState]) serviceRequirements.push("resolve_account_journey_conflict");
    if (fields.journey === "reenrollment") serviceRequirements.push("verify_current_cure_reconnection_and_financial_terms");
    missing("account", fields.accountNumber ? [] : ["accountNumber"]);
    missing("customer", ["firstName", "lastName", "under18"].filter(key => fields.customer?.[key as "firstName" | "lastName" | "under18"] === undefined).map(key => `customer.${key}`));
    missing("service_address", ["street", "city", "state", "zip"].filter(key => !fields.address?.[key as "street" | "city" | "state" | "zip"]).map(key => `address.${key}`));
    missing("contact", fields.phone ? [] : ["phone"]);
    missing("household", fields.householdComplete === true ? [] : ["householdComplete"]);
    const income = (person: NonNullable<PgwApplicationFields["customer"]>, path: string, adult: boolean) => {
      if (!person.income || person.income.state === "unknown") missing(path, [`${path}.income`]);
      if (adult && person.income?.state === "none" && !person.income.noIncomeSituation) missing(path, [`${path}.income.noIncomeSituation`]);
    };
    if (fields.customer) income(fields.customer, "customer", fields.customer.under18 === false);
    for (const member of fields.householdMembers ?? []) {
      const path = `householdMembers.${member.id}`;
      missing(path, ["firstName", "lastName", "relationship", "dateOfBirth"].filter(key => !member[key as "firstName" | "lastName" | "relationship" | "dateOfBirth"]).map(key => `${path}.${key}`));
      if (member.dateOfBirth && member.dateOfBirth > today) throw new Error();
      income(member, path, !!member.dateOfBirth && !pgwUnder18(member.dateOfBirth, today));
    }
    missing("outside_support", fields.outsideSupport?.receives === undefined ? ["outsideSupport.receives"] : []);
    if (fields.outsideSupport?.receives) {
      const supporter = fields.outsideSupport.supporter;
      missing("outside_supporter", ["firstName", "lastName", "phone", "monthlyAmountCents"].filter(key => supporter?.[key as "firstName" | "lastName" | "phone" | "monthlyAmountCents"] === undefined).map(key => `outsideSupport.supporter.${key}`));
      missing("outside_supporter", ["street", "city", "state", "zip"].filter(key => !supporter?.address?.[key as "street" | "city" | "state" | "zip"]).map(key => `outsideSupport.supporter.address.${key}`));
    }
    const people = [...(fields.customer ? [fields.customer] : []), ...(fields.householdMembers ?? [])];
    if (people.length && fields.householdComplete === true && people.every(person => person.income?.state === "none") && fields.outsideSupport?.receives === false && fields.zeroIncomePast30Days === undefined)
      missing("household_zero_income", ["zeroIncomePast30Days"]);
    if (fields.zeroIncomePast30Days) missing("living_expenses", ["food", "housing", "utilities"].filter(key => !fields.livingExpenses?.[key as "food" | "housing" | "utilities"]).map(key => `livingExpenses.${key}`));
    for (const key of ["snap", "housingSubsidy"] as const) {
      missing("other_assistance", fields[key]?.receives === undefined ? [`${key}.receives`] : []);
      if (fields[key]?.receives && fields[key].monthlyAmountCents === undefined) missing("other_assistance", [`${key}.monthlyAmountCents`]);
    }
    const protectedRequirements = (fields.householdMembers ?? []).map(member => ({ subjectId: member.id,
      field: "pgw_household_identifier" as const, sourceId: null, acceptedTypes: [...PGW_APPLICATION_SOURCE.identifierTypes], state: "protected_entry_unresolved" as const }));
    const personalActs = [{ id: "customer_signature_and_responsibilities", actor: "customer", state: "not_recorded" },
      ...(fields.outsideSupport?.receives ? [{ id: "outside_supporter_signature", actor: "outside_supporter", state: "not_recorded" }] : [])];
    return { fields, today, missingFacts, serviceRequirements,
      formFieldsReady: missingFacts.length === 0 && !serviceRequirements.some(item => item !== "verify_current_cure_reconnection_and_financial_terms"),
      protectedRequirements, personalActs, incomeProof: "not_assessed" as const, financialAssent: "not_recorded" as const,
      submissionReady: false as const, sending: "not_attempted" as const, enrollment: "unconfirmed" as const };
  } catch { throw new Error(PGW_PREPARATION_ERROR); }
}

/** Retains the explicit fictional fixture boundary; no owned values are relabeled as rehearsal data. */
export function prepareFictionalPgwApplication(input: unknown, now: Date) {
  try {
    const value = fictionalPgwApplicationSchema.parse(structuredClone(input));
    return { kind: "fictional_unsigned_preparation" as const, ...assessPgwApplicationFields(value.fields, now) };
  } catch { throw new Error(PGW_PREPARATION_ERROR); }
}
