import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { FOOD_DESCRIPTION_EVALUATION_BINDING, FOOD_DESCRIPTION_FINGERPRINT, runOneFoodDescriptionTurn } from "./food-description-runtime";
import { validateFoodDescriptionSelection, type FoodDescriptionContext } from "./food-description";
const retained = JSON.parse(readFileSync(new URL("../../../tests/fixtures/parent/food-description-text-span-response-2026-11-18.json", import.meta.url), "utf8"));
const oldPlan = JSON.parse(readFileSync(new URL("../../../tests/fixtures/parent/food-description-2026-11-18.v8-adapter.json", import.meta.url), "utf8"));
const stage = oldPlan.cases.find((item: { id: string }) => item.id === retained.caseId).turns[retained.turn - 1];
const now = new Date("2026-11-18T15:00:00Z"), owner = "00000000-0000-4000-8000-000000000001";
function wire(text = "food today") {
  return { needIds: ["food_now"], selections: [], assertions: [{ questionId: "foodForTwoDays", value: "no", span: { text } }], exclusions: [], questionIds: [], outOfScope: null };
}
async function run(description: string, value: unknown, changedOwner = false) {
  const context: FoodDescriptionContext = { expectedOwnerId: owner, ownerId: owner, expectedRevision: 1, revision: 1,
    catalogVersion: FOOD_DESCRIPTION_FINGERPRINT, capabilityVersion: "synthetic-text-spans", facts: {}, history: [], programIds: ["philly-food", "share-community-fridge-19129", "snap-pa", "uesf-benefits"], capabilities: [], excludedNeedIds: [] };
  let replied = false;
  const query = vi.fn(async (sql: string): Promise<{ rows: Record<string, unknown>[] }> => {
    if (sql.includes("parent_claim_food_description")) return { rows: [{ value: { draftId: "00000000-0000-4000-8000-000000000101", revision: 1,
      leaseToken: "00000000-0000-4000-8000-000000000102", projectId: "proj_synthetic", input: { description, screenLocale: "es" }, context, dispatchUntil: "2026-11-18T15:15:00Z" } }] };
    if (sql.includes("parent_reserve_food_description")) return { rows: [{ value: "00000000-0000-4000-8000-000000000103" }] };
    if (sql.includes("parent_food_description_current")) return { rows: [{ value: changedOwner && replied ? { ...context, ownerId: "00000000-0000-4000-8000-000000000002" } : context }] };
    return { rows: [] };
  });
  const fetcher = vi.fn<typeof fetch>(async () => { replied = true; return Response.json({ id: "resp_synthetic", status: "completed", usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3,
    input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0, cache_write_tokens_details: { ttl_30m_tokens: 0, ttl_12h_tokens: 0 } }, output_tokens_details: { reasoning_tokens: 0 } },
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }] }); });
  await runOneFoodDescriptionTurn({ database: { query }, apiKey: "synthetic-no-network", projectId: "proj_synthetic", fetcher, now: () => now });
  const call = query.mock.calls.find(([sql]) => sql.includes("parent_finish_food_description"));
  const finished = call ? JSON.parse((call as unknown as [string, string[]])[1][3]) : null;
  expect(fetcher).toHaveBeenCalledOnce();
  expect(query.mock.calls.some(([sql]) => sql.includes("parent_record_food_description_usage"))).toBe(true);
  return { finished, query };
}
it("uses a strict text-only model span contract for assertions and exclusions", () => {
  const schema = FOOD_DESCRIPTION_EVALUATION_BINDING.request.text.format.schema as unknown as { properties: { assertions: { items: { anyOf: { properties: { span: object } }[] } }; exclusions: { items: { properties: { span: object } } } } };
  for (const span of [...schema.properties.assertions.items.anyOf.map(branch => branch.properties.span), schema.properties.exclusions.items.properties.span])
    expect(span).toMatchObject({ type: "object", additionalProperties: false, required: ["text"], properties: { text: { type: "string", minLength: 1, maxLength: 500 } } });
});
it("keeps the exact old off-by-one response invalid and accepts only an explicitly new text-only fixture", async () => {
  const original = JSON.parse(retained.message), description = stage.projection.description;
  expect(stage.requestSha256).toBe(retained.requestSha256);
  expect(original.assertions[0].span).toEqual({ start: 28, end: 57, text: "no sé si hemos solicitado SNAP" });
  expect(() => validateFoodDescriptionSelection({ projection: stage.projection, selection: original,
    currentContext: { expectedOwnerId: owner, ownerId: owner, expectedRevision: stage.projection.revision, revision: stage.projection.revision,
      catalogVersion: oldPlan.modelFingerprint, capabilityVersion: stage.projection.capabilityVersion, facts: {}, history: [], programIds: ["philly-food", "share-community-fridge-19129", "snap-pa", "uesf-benefits"], capabilities: [], excludedNeedIds: [] }, now })).toThrow("parent_food_description_unverified_selection");
  expect((await run(description, original)).finished).toBeNull();
  // New synthetic wire only: never rewrite or credit the retained paid response as current quality.
  const textOnly = { ...original, assertions: original.assertions.map((item: { span: { text: string } }) => ({ ...item, span: { text: item.span.text } })) };
  const saved = (await run(description, textOnly)).finished;
  expect(saved.assertions[0].span).toEqual({ start: 28, end: 58, text: "no sé si hemos solicitado SNAP" });
});
it("derives native UTF16 positions and exclusion offsets without normalization", async () => {
  const description = "🥕 Necesitamos comida hoy. No quiero solicitar SNAP.";
  const value = wire("Necesitamos comida hoy"), text = "No quiero solicitar SNAP";
  const saved = (await run(description, { ...value, exclusions: [{ need: "snap_new", span: { text } }] })).finished;
  expect(saved.assertions[0].span).toEqual({ start: 3, end: 25, text: "Necesitamos comida hoy" });
  expect(saved.exclusions[0].span).toEqual({ start: description.indexOf(text), end: description.indexOf(text) + text.length, text });
});
it.each([["food today", ""], ["food today", "Food today"], ["food today", "absent"], ["mañana", "mañana"], ["food food", "food"], ["aaaa", "aaa"]])("rejects absent, empty or multiply occurring exact text (%s / %s)", async (description, text) => {
  expect((await run(description, wire(text))).finished).toBeNull();
});
it("rejects old model index fields even when their positions would be correct", async () => {
  const value = wire(), description = "food today";
  expect((await run(description, { ...value, assertions: [{ ...value.assertions[0], span: { text: "food today", start: 0, end: 10 } }] })).finished).toBeNull();
});
it.each([{ text: "absent" }, { text: "SNAP" }, { text: "No SNAP", start: 11, end: 18 }])("also rejects ungrounded, ambiguous or indexed exclusion spans: %j", async span => {
  expect((await run("food today. No SNAP. No SNAP.", { ...wire(), exclusions: [{ need: "snap_new", span }] })).finished).toBeNull();
});
it("permits overlapping distinct exact spans while preserving duplicate-field and current-owner guards", async () => {
  const description = "We need food today and have never applied for SNAP", value = wire(description);
  const assertion = { questionId: "benefitHistory", value: "never", span: { text: "never applied for SNAP" } };
  expect((await run(description, { ...value, assertions: [...value.assertions, assertion] })).finished.assertions).toHaveLength(2);
  expect((await run(description, { ...value, assertions: [value.assertions[0], value.assertions[0]] })).finished).toBeNull();
  expect((await run(description, value, true)).finished).toBeNull();
});
