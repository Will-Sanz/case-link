import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { foodAssessmentHandoffSchema } from "./food-assessment";
import { foodDescriptionMutationSchema } from "./food-description-draft";
const corpus = JSON.parse(readFileSync("tests/fixtures/parent/food-description-2026-11-18.v3.json", "utf8")) as { cases: { id: string; turns: { kind: string; handoff?: { need: string; answers: unknown } }[] }[] };
describe("existing reviewed terminal corpus with current selected-needs wrapper", () => {
  const terminals = corpus.cases.flatMap(item => item.turns.filter(turn => turn.kind === "typed_handoff").map(turn => ({ id: item.id, handoff: turn.handoff! })));
  it.each(terminals)("retains the explicit single choice for $id without introducing a compound request", ({ handoff }) => {
    const wrapped = { needs: [handoff.need], answers: handoff.answers };
    expect(foodAssessmentHandoffSchema.parse(wrapped)).toEqual(wrapped);
  });
  it("preserves all26 reviewed handoff oracles without altering the60-case80-call corpus", () => { expect(terminals).toHaveLength(26); expect(corpus.cases).toHaveLength(60); });
  it("refuses a fake pre-mandate request, private input and invented client context", () => {
    const queue = { action: "queue", expectedOwnerId: "00000000-0000-4000-8000-000000000001", draftId: "00000000-0000-4000-8000-000000000002", expectedRevision: 0, idempotencyKey: "00000000-0000-4000-8000-000000000003", input: { description: "Food help", screenLocale: "en" } };
    for (const extra of [{ requestId: queue.draftId }, { mandate: {} }, { context: {} }, { purpose: "assistant" }]) expect(foodDescriptionMutationSchema.safeParse({ ...queue, ...extra }).success).toBe(false);
    expect(foodDescriptionMutationSchema.safeParse({ ...queue, input: { ...queue.input, description: "My SSN is 000-00-0000" } }).success).toBe(false);
  });
});
