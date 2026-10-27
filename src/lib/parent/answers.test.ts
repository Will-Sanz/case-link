import { describe, expect, it } from "vitest";
import { factAnswerSchema, factAnswerBundleSchema, factValueSchema } from "./answers";
import { NEEDS } from "./domain";

const answer = {
  need: "electricity",
  field: "amountDue",
  value: 0,
  version: 2,
};
describe("necessary parent facts", () => {
  it("accepts zero income and money, but rejects invented dates, unscoped facts and account secrets", () => {
    expect(factAnswerSchema.safeParse(answer).success).toBe(true);
    expect(
      factAnswerSchema.safeParse({
        ...answer,
        field: "income",
        value: { amount: 0, frequency: "monthly" },
      }).success,
    ).toBe(true);
    for (const change of [
      { value: -1 },
      { need: "food_now" },
      { field: "dueDate", value: "2026-02-30" },
      { field: "password", value: "secret" },
      { field: "income", value: { amount: 20, frequency: "unknown" } },
      { version: 0 },
    ])
      expect(factAnswerSchema.safeParse({ ...answer, ...change }).success).toBe(
        false,
      );
  });
});

describe("strict canonical factual answer bundles", () => {
  const income = { need: "electricity", field: "income", value: { amount: 0, frequency: "monthly" } };
  const bundle = { answers: [income, { need: "electricity", field: "amountDue", value: 0 }], version: 2 };

  it("validates shared factual values and preserves strict legacy single-fact refinements", () => {
    expect(factValueSchema.safeParse(income).success).toBe(true);
    expect(factValueSchema.safeParse({ ...income, version: 2 }).success).toBe(false);
    expect(factAnswerSchema.safeParse({ ...income, version: 2 }).success).toBe(true);
    for (const entry of [
      { need: "electricity", field: "incomeAmount", value: 0 },
      { need: "electricity", field: "incomeFrequency", value: "weekly" },
    ])
      expect(factAnswerSchema.safeParse({ ...entry, version: 2 }).success).toBe(true);
  });

  it("accepts one version for paired zero income and a distinct zero money answer", () => {
    expect(factAnswerBundleSchema.parse(bundle)).toEqual(bundle);
    expect(factAnswerBundleSchema.safeParse({
      answers: [
        { need: "electricity", field: "householdSize", value: 3 },
        { need: "water", field: "householdSize", value: 4 },
      ], version: 2,
    }).success).toBe(true);
  });

  it("keeps the bound at 1–30 valid unique canonical entries", () => {
    const thirty = NEEDS.slice(0, 10).flatMap((need) => [
      { need, field: "zip", value: "19104" },
      { need, field: "householdSize", value: 3 },
      { need, field: "income", value: { amount: 0, frequency: "monthly" } },
    ]);
    expect(thirty).toHaveLength(30);
    expect(factAnswerBundleSchema.safeParse({ answers: [income], version: 1 }).success).toBe(true);
    expect(factAnswerBundleSchema.safeParse({ answers: thirty, version: 1 }).success).toBe(true);
    expect(factAnswerBundleSchema.safeParse({ answers: [], version: 1 }).success).toBe(false);
    expect(factAnswerBundleSchema.safeParse({ answers: [...thirty, { need: "electricity", field: "utilityProvider", value: "peco" }], version: 1 }).success).toBe(false);
  });

  it("rejects duplicate targets, aliases, secrets and malformed values or scope", () => {
    const invalidEntries = [
      { ...income, field: "incomeAmount", value: 0 },
      { ...income, field: "incomeFrequency", value: "monthly" },
      { ...income, field: "ssn", value: "synthetic-identity" },
      { ...income, field: "password", value: "synthetic-secret" },
      { ...income, need: "unknown_need" },
      { ...income, value: { amount: -1, frequency: "monthly" } },
      { ...income, value: { amount: 0, frequency: "unknown" } },
      { ...income, value: { amount: 0, frequency: "monthly", password: "synthetic-secret" } },
      { need: "food_now", field: "amountDue", value: 0 },
      { need: "electricity", field: "dueDate", value: "2026-02-30" },
      { need: "electricity", field: "householdSize", value: "3" },
      { need: "electricity", field: "zip", value: "1910" },
      { ...income, version: 2 },
      { ...income, extra: true },
    ];
    for (const entry of invalidEntries)
      expect(factAnswerBundleSchema.safeParse({ answers: [entry], version: 2 }).success).toBe(false);
    expect(factAnswerBundleSchema.safeParse({ answers: [income, { ...income, value: { amount: 1, frequency: "weekly" } }], version: 2 }).success).toBe(false);
  });

  it("requires a strict positive integer bundle version and rejects unknown envelope keys", () => {
    for (const version of [0, -1, 1.5, "2", null, undefined])
      expect(factAnswerBundleSchema.safeParse({ ...bundle, version }).success).toBe(false);
    expect(factAnswerBundleSchema.safeParse({ ...bundle, extra: true }).success).toBe(false);
    expect(factAnswerBundleSchema.safeParse({ ...bundle, answers: "not-an-array" }).success).toBe(false);
  });
});
