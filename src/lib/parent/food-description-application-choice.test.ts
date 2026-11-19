import { expect, it } from "vitest";
import { buildFoodDescriptionProjection, validateFoodDescriptionSelection, type FoodDescriptionContext } from "./food-description";
import { FOOD_DESCRIPTION_FINGERPRINT } from "./food-description-runtime";

const now = new Date("2026-11-18T12:00:00Z"), owner = "00000000-0000-4000-8000-000000000001";
const context = (): FoodDescriptionContext => ({ ownerId: owner, expectedOwnerId: owner, revision: 1, expectedRevision: 1,
  catalogVersion: FOOD_DESCRIPTION_FINGERPRINT, capabilityVersion: "synthetic", facts: {}, history: [], programIds: ["philly-food", "snap-pa", "uesf-benefits"], capabilities: [], excludedNeedIds: [] });
const cases = [
  { language: "en" as const, description: "I want a food site today, without applying for benefits.", quote: "without applying for benefits" },
  { language: "es" as const, description: "Quiero encontrar un lugar que ofrezca comida hoy, sin solicitar beneficios.", quote: "sin solicitar beneficios" },
];
it.each(cases)("does not ask SNAP history for food-only help after declining applications ($language)", ({ language, description, quote }) => {
  const current = context(), start = description.indexOf(quote);
  const selection = { needIds: ["food_now"], selections: [{ need: "food_now", programId: "philly-food", reason: "immediate" }],
    assertions: [], exclusions: [{ need: "snap_new", span: { start, end: start + quote.length, text: quote } }], questionIds: [], outOfScope: null };
  const projection = buildFoodDescriptionProjection({ description, screenLocale: language }, current, now);
  const validate = (value: unknown) => validateFoodDescriptionSelection({ projection, selection: value, currentContext: current, now });
  expect(validate(selection)).toMatchObject({ needIds: ["food_now"], questionIds: ["foodForTwoDays"], excludedNeedIds: ["snap_new"],
    proposedAnswers: { foodForTwoDays: "not_sure", benefitHistory: "not_sure" }, proposedUrgency: null, executionGranted: false });
  expect(validate({ ...selection, exclusions: [] }).questionIds).toEqual(["foodForTwoDays", "benefitHistory"]);
});
it("still asks the necessary current-benefit issue without reopening a declined new application", () => {
  const current = context(), dates = { source: "parent_typed" as const, confirmedAt: "2026-11-18T11:00:00Z", expiresAt: "2026-11-19T11:00:00Z" };
  current.facts = { foodForTwoDays: { value: "yes", ...dates }, benefitHistory: { value: "receiving", ...dates } };
  const description = "Help with my current SNAP, without a new application.", quote = "without a new application", start = description.indexOf(quote);
  const result = validateFoodDescriptionSelection({ projection: buildFoodDescriptionProjection({ description, screenLocale: "en" }, current, now), currentContext: current, now,
    selection: { needIds: ["snap_problem"], selections: [], assertions: [], exclusions: [{ need: "snap_new", span: { start, end: start + quote.length, text: quote } }], questionIds: [], outOfScope: null } });
  expect(result).toMatchObject({ needIds: ["snap_problem"], questionIds: ["existingIssue"], excludedNeedIds: ["snap_new"], executionGranted: false });
});
