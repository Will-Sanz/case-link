import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { applyDescriptionEvaluationAnswers, DESCRIPTION_EVALUATION_NOW, descriptionEvaluationContext, descriptionEvaluationInput, descriptionEvaluationPlannedProjection, loadDescriptionEvaluationCorpus } from "../../../scripts/food-description-evaluation-adapter";
import { buildFoodDescriptionProjection, reconcileFoodDescriptionRequests, validateFoodDescriptionSelection, type FoodDescriptionContext } from "./food-description";
import { FOOD_DESCRIPTION_EVALUATION_BINDING } from "./food-description-runtime";

const retained = JSON.parse(readFileSync(new URL("../../../tests/fixtures/parent/food-description-unknown-resolution-response-2026-11-18.json", import.meta.url), "utf8")) as {
  caseId: string; fingerprint: string; attempts: { attempt: number; turn: number; requestSha256: string; responseSha256: string; message: string }[];
};
const legacyPlan = JSON.parse(readFileSync(new URL("../../../tests/fixtures/parent/food-description-2026-11-18.v7-adapter.json", import.meta.url), "utf8"));
const item = loadDescriptionEvaluationCorpus().cases.find(value => value.id === retained.caseId)!;
const now = new Date(DESCRIPTION_EVALUATION_NOW), editedInput = descriptionEvaluationInput(item, 2);
const selection = () => JSON.parse(retained.attempts[1].message);
function editedContext() {
  const value = applyDescriptionEvaluationAnswers(descriptionEvaluationContext(item), item.turns[1].suppliedAnswers ?? {});
  return { ...value, revision: value.revision + 1, expectedRevision: value.revision + 1 };
}
function result(context = editedContext(), selected = selection()) {
  const projection = buildFoodDescriptionProjection(editedInput, context, now);
  return reconcileFoodDescriptionRequests(validateFoodDescriptionSelection({ projection, selection: selected, currentContext: context, now }), [], context.ownerId);
}
afterEach(() => vi.unstubAllGlobals());

it("resolves only prior unknown facts from the exact retained current source assertions without rewriting their records", () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const context = editedContext(), projection = descriptionEvaluationPlannedProjection(item, 2);
  const stage = legacyPlan.cases.find((value: { id: string }) => value.id === retained.caseId).turns[2];
  expect(legacyPlan.modelFingerprint).toBe(retained.fingerprint);
  expect({ ...projection, catalogVersion: retained.fingerprint }).toEqual(stage.projection);
  expect(stage.requestSha256).toBe(retained.attempts[1].requestSha256);
  expect(result(context)).toMatchObject({ state: "proposal", proposedAnswers: { foodForTwoDays: "no", benefitHistory: "never", existingIssue: null },
    needIds: ["food_now", "snap_new"], questionIds: [], conflicts: [], proposedUrgency: "today", requiresTypedTiming: false, executionGranted: false });
  expect(result(context).originalFacts).toEqual(context.facts);
  expect(result(context).originalFacts.foodForTwoDays).toEqual({ value: "not_sure", source: "parent_typed", confirmedAt: "2026-11-18T12:00:00Z", expiresAt: "2026-11-19T12:00:00.000Z" });
  expect(result(context).assertions).toEqual(selection().assertions);
  expect(fetcher).not.toHaveBeenCalled();
});

it("keeps an explicit unknown unresolved without a new assertion or another identical question", () => {
  expect(result(editedContext(), { ...selection(), assertions: [] })).toMatchObject({ proposedAnswers: { foodForTwoDays: "not_sure", benefitHistory: "not_sure" },
    needIds: ["food_now"], questionIds: [], proposedUrgency: null, requiresTypedTiming: true, executionGranted: false });
});

it.each(["en", "es"] as const)("resolves all three unknown fields from exact current %s source spans", screenLocale => {
  const parts = screenLocale === "en" ? ["We need food today", "I receive SNAP", "my card is lost"] : ["Necesitamos comida hoy", "Recibo SNAP", "perdí mi tarjeta"];
  const input = { description: parts.join(". "), screenLocale }, context = editedContext();
  context.facts.existingIssue = { ...context.facts.benefitHistory!, value: "not_sure" };
  const projection = buildFoodDescriptionProjection(input, context, now);
  const fields = ["foodForTwoDays", "benefitHistory", "existingIssue"], values = ["no", "receiving", "card"];
  const selected = { needIds: [], selections: [], questionIds: [], exclusions: [], outOfScope: null,
    assertions: parts.map((text, index) => ({ questionId: fields[index], value: values[index], span: { text, start: input.description.indexOf(text), end: input.description.indexOf(text) + text.length } })) };
  const value = validateFoodDescriptionSelection({ projection, selection: selected, currentContext: context, now });
  expect(value).toMatchObject({ proposedAnswers: { foodForTwoDays: "no", benefitHistory: "receiving", existingIssue: "card" },
    needIds: ["food_now", "snap_problem"], conflicts: [], questionIds: [], proposedUrgency: "today", executionGranted: false });
  expect(value.originalFacts).toEqual(context.facts);
});

it("keeps clear typed values and original dates authoritative over contradictory source assertions", () => {
  const old = editedContext(), context: FoodDescriptionContext = { ...old, facts: {
    foodForTwoDays: { ...old.facts.foodForTwoDays!, value: "yes" }, benefitHistory: { ...old.facts.benefitHistory!, value: "applied" },
  } };
  const value = result(context, { ...selection(), needIds: [], selections: [] });
  expect(value).toMatchObject({ proposedAnswers: { foodForTwoDays: "yes", benefitHistory: "applied" }, needIds: ["snap_pending"],
    questionIds: [], conflicts: ["foodForTwoDays", "benefitHistory"], proposedUrgency: null, executionGranted: false });
  expect(value.originalFacts).toEqual(context.facts);
});

it.each(["owner", "revision", "source_date"])("still rejects changed %s before resolving any unknown", kind => {
  const context = editedContext(), projection = buildFoodDescriptionProjection(editedInput, context, now);
  const changed = structuredClone(context);
  if (kind === "owner") changed.ownerId = "00000000-0000-4000-8000-000000000002";
  if (kind === "revision") changed.revision++;
  if (kind === "source_date" && changed.facts.foodForTwoDays?.source !== "parent_description") changed.facts.foodForTwoDays!.confirmedAt = "2026-11-18T11:59:00Z";
  expect(() => validateFoodDescriptionSelection({ projection, selection: selection(), currentContext: changed, now })).toThrow();
});

it("still rejects invented spans, honors exclusions and blocks duplicate applications", () => {
  const selected = selection(); selected.assertions[0].span.text = "Invented source text";
  expect(() => result(editedContext(), selected)).toThrow("parent_food_description_unverified_selection");
  expect(result({ ...editedContext(), excludedNeedIds: ["snap_new"] }).needIds).toEqual(["food_now"]);
  const context = editedContext(); context.history = [{ ownerId: context.ownerId, requestId: "00000000-0000-4000-8000-000000000201", requestVersion: 2,
    requestStatus: "active", need: "snap_pending", state: "agency_submitted", current: true }];
  const value = result(context);
  expect(value.duplicateApplicationBlocked).toBe(true); expect(value.needIds).not.toContain("snap_new"); expect(value.executionGranted).toBe(false);
});

it("honors the retained family's explicit unknown instead of repeating the same benefit question", () => {
  const context = descriptionEvaluationContext(item), projection = buildFoodDescriptionProjection(descriptionEvaluationInput(item, 0), context, now);
  const selected = JSON.parse(retained.attempts[0].message);
  const value = validateFoodDescriptionSelection({ projection, selection: selected, currentContext: context, now });
  expect(value).toMatchObject({ proposedAnswers: { benefitHistory: "not_sure" }, questionIds: ["foodForTwoDays"], proposedUrgency: null, executionGranted: false });
});

it("tells the driver that not_sure is unknown while the server still chooses questions", () => {
  expect(FOOD_DESCRIPTION_EVALUATION_BINDING.request.instructions).toContain("not_sure is unknown");
  expect(FOOD_DESCRIPTION_EVALUATION_BINDING.request.instructions).toContain("Return questionIds as an empty array");
});
