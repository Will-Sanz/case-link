import { factAnswerSchema } from "./answers";
import type { SupportIntake, SupportNeed, SupportRequest } from "./domain";

type CurrentIntakeFields = Partial<{
  zip: string;
  householdSize: number;
  incomeAmount: number;
  incomeFrequency: Exclude<SupportIntake["incomeFrequency"], "unknown">;
}>;
export const CURRENT_INTAKE_FIELDS = [
  "zip", "householdSize", "incomeAmount", "incomeFrequency",
] as const;

/** The existing 45-day ceiling is not proof of a provider's evidence requirements. */
export function currentIntakeFields(
  request: SupportRequest,
  now: Date,
  need?: SupportNeed,
): CurrentIntakeFields {
  const result: CurrentIntakeFields = {};
  if (
    !Number.isFinite(now.getTime()) ||
    (need && !request.intake.needs.includes(need))
  )
    return result;
  const cutoff = now.getTime() - 45 * 86400000;
  const current = (value: unknown) => {
    if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value))
      return false;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) &&
      new Date(`${value.slice(0, 10)}T12:00:00Z`).toISOString().slice(0, 10) === value.slice(0, 10) &&
      timestamp >= cutoff && timestamp <= now.getTime();
  };
  const restrictions = request.intake_need_scoped_fields;
  const reusable = (field: keyof SupportIntake) => {
    if (
      !Array.isArray(restrictions) ||
      restrictions.some((key) => !CURRENT_INTAKE_FIELDS.some((field) => field === key)) ||
      restrictions.includes(field)
    )
      return false;
    const dates = request.intake_confirmed_at ?? {};
    return current(Object.hasOwn(dates, field) ? dates[field] : request.created_at);
  };
  const valid = (field: string, value: unknown) =>
    factAnswerSchema.safeParse({
      need: need ?? request.intake.needs[0],
      field,
      value,
      version: request.version,
    }).success;
  if (request.mandate.allowedData.includes("household")) {
    if (reusable("zip") && valid("zip", request.intake.zip))
      result.zip = request.intake.zip;
    if (
      request.intake.householdSize !== null && reusable("householdSize") &&
      valid("householdSize", request.intake.householdSize)
    )
      result.householdSize = request.intake.householdSize;
  }
  const { incomeAmount, incomeFrequency } = request.intake;
  if (
    request.mandate.allowedData.includes("income") &&
    incomeAmount !== null && incomeFrequency !== "unknown" &&
    reusable("incomeAmount") && reusable("incomeFrequency") &&
    valid("income", { amount: incomeAmount, frequency: incomeFrequency })
  ) {
    result.incomeAmount = incomeAmount;
    result.incomeFrequency = incomeFrequency;
  }
  if (!need) return result;
  for (const fact of (request.facts ?? [])
    .filter((fact) => fact !== null && typeof fact === "object" && current(fact.confirmedAt))
    .sort((a, b) => Date.parse(a.confirmedAt) - Date.parse(b.confirmedAt))) {
    if (
      fact.need !== need || fact.source !== "parent" ||
      !current(fact.asOf) ||
      Date.parse(fact.asOf) > Date.parse(fact.confirmedAt) ||
      !valid(fact.field, fact.value)
    )
      continue;
    if (request.mandate.allowedData.includes("household")) {
      if (fact.field === "zip" && typeof fact.value === "string") result.zip = fact.value;
      if (fact.field === "householdSize" && typeof fact.value === "number")
        result.householdSize = fact.value;
    }
    if (!request.mandate.allowedData.includes("income")) continue;
    if (fact.field === "income") {
      const value = fact.value as {
        amount: number;
        frequency: NonNullable<CurrentIntakeFields["incomeFrequency"]>;
      };
      result.incomeAmount = value.amount;
      result.incomeFrequency = value.frequency;
    } else if (
      (fact.field === "incomeAmount" && fact.value !== result.incomeAmount) ||
      (fact.field === "incomeFrequency" && fact.value !== result.incomeFrequency)
    ) {
      delete result.incomeAmount;
      delete result.incomeFrequency;
    }
  }
  return result;
}
