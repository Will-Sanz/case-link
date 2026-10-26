import { describe, expect, it } from "vitest";
import { factAnswerSchema } from "./answers";

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
