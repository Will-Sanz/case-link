import { z } from "zod";
import { intakeSchema, needSchema } from "./domain";

const amount = z.number().finite().min(0).max(1000000);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T12:00:00Z`);
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "Enter a real date.");
const values = {
  zip: z.string().regex(/^\d{5}$/),
  householdSize: z.number().int().min(1).max(30),
  income: z
    .object({
      amount,
      frequency: intakeSchema.shape.incomeFrequency.exclude(["unknown"]),
    })
    .strict(),
  incomeAmount: amount,
  incomeFrequency: intakeSchema.shape.incomeFrequency.exclude(["unknown"]),
  utilityProvider: z.enum(["peco", "pgw", "pwd", "other"]),
  accountAuthority: z.enum(["self", "authorized_caregiver"]),
  amountDue: amount,
  totalBalance: amount,
  dueDate: date,
  shutoffDate: date,
} as const;
export const ANSWER_FIELDS = Object.keys(values) as (keyof typeof values)[];
export const factValueSchema = z
  .object({
    need: needSchema,
    field: z.enum(ANSWER_FIELDS),
    value: z.unknown(),
  })
  .strict()
  .superRefine((answer, context) => {
    const result = values[answer.field].safeParse(answer.value);
    if (!result.success)
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: result.error.issues[0]?.message ?? "Check your answer.",
      });
    if (
      ![
        "zip",
        "householdSize",
        "income",
        "incomeAmount",
        "incomeFrequency",
      ].includes(answer.field) &&
      !["electricity", "gas", "water"].includes(answer.need)
    )
      context.addIssue({
        code: "custom",
        path: ["need"],
        message: "This fact must identify its utility account.",
      });
  });
export const factAnswerSchema = factValueSchema.safeExtend({
  version: z.number().int().positive(),
});
export const factAnswerBundleSchema = z.object({
  answers: z.array(factValueSchema.safeExtend({
    field: z.enum(ANSWER_FIELDS).exclude(["incomeAmount", "incomeFrequency"]),
  })).min(1).max(30),
  version: z.number().int().positive(),
}).strict().superRefine(({ answers }, context) => {
  const seen = new Set<string>();
  answers.forEach((answer, index) => {
    const key = `${answer.need}:${answer.field}`;
    if (seen.has(key)) context.addIssue({
      code: "custom", path: ["answers", index, "field"],
      message: "Answer each question once, with income and its frequency together.",
    });
    seen.add(key);
  });
});
export type FactAnswer = z.infer<typeof factAnswerSchema>;
export type FactAnswerBundle = z.infer<typeof factAnswerBundleSchema>;
