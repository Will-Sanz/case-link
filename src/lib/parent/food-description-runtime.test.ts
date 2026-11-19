import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { FOOD_DESCRIPTION_EVALUATION_BINDING, FOOD_DESCRIPTION_FINGERPRINT, foodDescriptionCatalogReady, foodDescriptionUsage, runOneFoodDescriptionTurn } from "./food-description-runtime";
import type { FoodDescriptionContext } from "./food-description";
const now = new Date("2026-11-18T15:00:00Z"), owner = randomUUID(), draft = randomUUID(), lease = randomUUID(), charge = randomUUID();
const description = "We have no food for tomorrow. I have never applied for SNAP.";
const span = (text: string) => ({ start: description.indexOf(text), end: description.indexOf(text) + text.length, text });
const context: FoodDescriptionContext = { expectedOwnerId: owner, ownerId: owner, expectedRevision: 1, revision: 1, catalogVersion: FOOD_DESCRIPTION_FINGERPRINT,
  capabilityVersion: "synthetic-capabilities-v1", facts: {}, history: [], programIds: ["philly-food", "snap-pa"], capabilities: [], excludedNeedIds: [] };
const selection = { needIds: ["food_now", "snap_new"], selections: [{ need: "food_now", programId: "philly-food", reason: "immediate" }, { need: "snap_new", programId: "snap-pa", reason: "new" }],
  assertions: [{ questionId: "foodForTwoDays", value: "no", span: span("no food for tomorrow") }, { questionId: "benefitHistory", value: "never", span: span("never applied for SNAP") }], exclusions: [], questionIds: [], outOfScope: null };
const response = (value: unknown = selection, usage: unknown = { input_tokens: 100, output_tokens: 40, total_tokens: 140, input_tokens_details: { cached_tokens: 20, cache_write_tokens: 30, cache_write_tokens_details: { ttl_30m_tokens: 30, ttl_12h_tokens: 0 } }, output_tokens_details: { reasoning_tokens: 10 } }) => Response.json({ id: "resp_synthetic", status: "completed", usage, output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value, (key, item) => key === "span" ? { text: item.text } : item) }] }] }, { headers: { "x-request-id": "req_synthetic" } });
function setup() {
  const query = vi.fn(async (sql: string): Promise<{ rows: Record<string, unknown>[] }> => {
    if (sql.includes("parent_claim_food_description")) return { rows: [{ value: { draftId: draft, revision: 1, leaseToken: lease, projectId: "proj_synthetic", input: { description, screenLocale: "en" }, context, dispatchUntil: "2026-11-18T15:15:00Z" } }] };
    if (sql.includes("parent_reserve_food_description")) return { rows: [{ value: charge }] };
    if (sql.includes("parent_food_description_current")) return { rows: [{ value: context }] };
    return { rows: [] };
  });
  return { database: { query }, apiKey: "synthetic-private-only", projectId: "proj_synthetic", fetcher: vi.fn<typeof fetch>().mockResolvedValue(response()), now: () => now };
}
describe("one reserved private food interpretation turn", () => {
  it("minimizes inputs, reserves before the single Responses call, validates source and records actual usage before commit", async () => {
    const options = setup(); expect(await runOneFoodDescriptionTurn(options)).toBe(true);
    expect(options.fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = options.fetcher.mock.calls[0], body = JSON.parse(String(init!.body));
    expect(url).toBe(FOOD_DESCRIPTION_EVALUATION_BINDING.transport.endpoint);
    expect(init?.method).toBe(FOOD_DESCRIPTION_EVALUATION_BINDING.transport.method); expect(init?.redirect).toBe(FOOD_DESCRIPTION_EVALUATION_BINDING.transport.redirect); expect(init).toMatchObject({ redirect: "error", headers: expect.objectContaining({ "OpenAI-Project": "proj_synthetic" }) });
    expect(body).toMatchObject({ model: "gpt-6.1-sol", service_tier: "default", store: false, max_output_tokens: 1500, reasoning: { effort: "medium" } });
    const { input: variableInput, ...fixedRequest } = body; expect(variableInput).toHaveLength(1);
    expect(fixedRequest).toEqual(FOOD_DESCRIPTION_EVALUATION_BINDING.request);
    expect(fixedRequest.instructions).toContain("An application described only as started is not evidence it was submitted.");
    expect(fixedRequest.instructions).toContain("the server handles owned-request coverage");
    expect(fixedRequest.instructions).toContain("An explicit current need for food or groceries today supports foodForTwoDays:no.");
    expect(fixedRequest.instructions).toContain("An existingIssue assertion requires benefitHistory:receiving from a governing fact or another source-backed assertion.");
    expect(fixedRequest.instructions).toContain("receiving includes current or past benefits.");
    expect(FOOD_DESCRIPTION_FINGERPRINT).toBe(createHash("sha256").update(JSON.stringify(FOOD_DESCRIPTION_EVALUATION_BINDING)).digest("hex"));
    for (const drift of [{ service_tier: "priority" }, { store: true }, { reasoning: { effort: "low" } }, { max_output_tokens: 2000 }]) {
      const changed = { ...FOOD_DESCRIPTION_EVALUATION_BINDING, request: { ...fixedRequest, ...drift } };
      expect(createHash("sha256").update(JSON.stringify(changed)).digest("hex")).not.toBe(FOOD_DESCRIPTION_FINGERPRINT);
    }

    for (const forbidden of ["tools", "conversation", "previous_response_id", "background", "stream", "metadata", "user"]) expect(body).not.toHaveProperty(forbidden);
    const projection = body.input[0].content; for (const id of [owner, draft, lease, charge]) expect(projection).not.toContain(id);
    const sql = options.database.query.mock.calls.map(call => call[0]);
    expect(sql.findIndex(text => text.includes("reserve_food_description"))).toBeLessThan(sql.findIndex(text => text.includes("food_description_current")));
    expect(options.database.query.mock.invocationCallOrder[2]).toBeLessThan(options.fetcher.mock.invocationCallOrder[0]);
    expect(sql.findIndex(text => text.includes("record_food_description_usage"))).toBeLessThan(sql.findIndex(text => text.includes("finish_food_description")));
    expect(options.database.query).toHaveBeenCalledWith("select parent_private.parent_record_food_description_usage($1,$2)", [charge, JSON.stringify({ complete: true, requestId: "req_synthetic", responseId: "resp_synthetic", inputTokens: 100, outputTokens: 40, cachedInputTokens: 20, cacheWriteInputTokens: 30, cacheWrite30mInputTokens: 30, cacheWrite12hInputTokens: 0, reasoningTokens: 10 })]);
  });
  it.each(["budget", "purpose", "source", "private input", "no key"])("never dispatches when %s fails", async kind => {
    const options = setup(), original = options.database.query.getMockImplementation()!;
    options.database.query.mockImplementation(async sql => {
      if (kind === "budget" && sql.includes("reserve_food_description")) return { rows: [{ value: null }] };
      if (kind === "purpose" && sql.includes("food_description_current")) throw new Error("42501");
      const result = await original(sql);
      if (sql.includes("claim_food_description")) {
        const claim = result.rows[0].value as { context: FoodDescriptionContext; input: { description: string } };
        if (kind === "source") claim.context = { ...context, catalogVersion: "changed" };
        if (kind === "private input") claim.input = { description: "My password is private" };
      }
      return result;
    });
    await runOneFoodDescriptionTurn({ ...options, apiKey: kind === "no key" ? undefined : options.apiKey }); expect(options.fetcher).not.toHaveBeenCalled();
  });
  it.each(["timeout", "invalid result", "missing usage", "revoked after response"])("keeps charged %s unknown without a second dispatch or result", async kind => {
    const options = setup();
    if (kind === "timeout") options.fetcher.mockRejectedValue(new Error("network unknown"));
    if (kind === "invalid result") options.fetcher.mockResolvedValue(response({ ...selection, permission: true }));
    if (kind === "missing usage") options.fetcher.mockResolvedValue(response(selection, null));
    if (kind === "revoked after response") {
      const original = options.database.query.getMockImplementation()!; let current = 0;
      options.database.query.mockImplementation(async sql => { if (sql.includes("food_description_current") && ++current === 2) throw new Error("42501"); return original(sql); });
    }
    await runOneFoodDescriptionTurn(options); expect(options.fetcher).toHaveBeenCalledTimes(1);
    expect(options.database.query.mock.calls.some(call => call[0].includes("finish_food_description"))).toBe(false);
    expect(options.database.query.mock.calls.some(call => call[0].includes("record_food_description_usage"))).toBe(true);
    expect(options.database.query).toHaveBeenLastCalledWith("select parent_private.parent_fail_food_description($1,$2,$3)", [draft, 1, lease]);
  });
  it.each([undefined,"invalid","proj_other"])("does not dispatch with missing/mismatched project binding %s", async projectId => {
    const options=setup(); await runOneFoodDescriptionTurn({...options,projectId}); expect(options.fetcher).not.toHaveBeenCalled();
    expect(options.database.query.mock.calls.some(call=>call[0].includes("reserve_food_description"))).toBe(false);
  });
  it("keeps question selection with the server and rejects a model-owned question list before finish", async () => {
    const current: FoodDescriptionContext = { ...context, facts: { benefitHistory: { value: "applied", source: "parent_typed", confirmedAt: "2026-11-18T14:00:00Z", expiresAt: "2026-11-19T14:00:00Z" } } };
    const options = setup(), original = options.database.query.getMockImplementation()!;
    options.database.query.mockImplementation(async sql => {
      const result = await original(sql);
      if (sql.includes("claim_food_description")) (result.rows[0].value as {context:FoodDescriptionContext}).context = current;
      if (sql.includes("food_description_current")) return { rows: [{ value: current }] };
      return result;
    });
    options.fetcher.mockResolvedValue(response({ needIds: ["snap_pending"], selections: [], assertions: [selection.assertions[1]], exclusions: [], questionIds: ["foodForTwoDays"], outOfScope: null }));
    await runOneFoodDescriptionTurn(options);
    expect(options.database.query.mock.calls.some(([sql]) => sql.includes("finish_food_description"))).toBe(false);
    expect(options.database.query.mock.calls.some(([sql]) => sql.includes("record_food_description_usage"))).toBe(true);
    const questions = FOOD_DESCRIPTION_EVALUATION_BINDING.request.text.format.schema.properties!.questionIds;
    expect(questions).toMatchObject({ type: "array", minItems: 0, maxItems: 0 });
  });
  it("exports the supported strict Responses schema while retaining the disjoint assertion branches", () => {
    const schema = FOOD_DESCRIPTION_EVALUATION_BINDING.request.text.format.schema;
    expect(schema).not.toHaveProperty("$schema"); expect(JSON.stringify(schema)).not.toContain('"oneOf"');
    function check(value: unknown) {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) { value.forEach(check); return; }
      const node = value as Record<string, unknown>;
      if (node.type === "object") {
        expect(node.additionalProperties).toBe(false);
        expect([...(node.required as string[])].sort()).toEqual(Object.keys(node.properties as object).sort());
      }
      Object.values(node).forEach(check);
    }
    check(schema);
    const assertions = schema.properties!.assertions as { items: { anyOf: { properties: { questionId: { const: string } } }[] } };
    expect(assertions.items.anyOf.map(branch => branch.properties.questionId.const)).toEqual(["foodForTwoDays", "benefitHistory", "existingIssue"]);
  });
  it("keeps expired or invalid catalog readiness distinct from an installed model key", async () => {
    expect(foodDescriptionCatalogReady(now)).toBe(true); expect(foodDescriptionCatalogReady(new Date("2027-01-01T00:00:00Z"))).toBe(false);
    const options = setup(); expect(await runOneFoodDescriptionTurn({ ...options, now: () => new Date("2027-01-01T00:00:00Z") })).toBe(false);
    expect(options.database.query).not.toHaveBeenCalled(); expect(options.fetcher).not.toHaveBeenCalled();
  });
  it("does not fabricate free usage; cached/reasoning tokens are subsets, never added twice", () => {
    for (const usage of [null, {}, { input_tokens: -1, output_tokens: 2 }, { input_tokens: 3, output_tokens: 2, input_tokens_details: { cached_tokens: 4 } }, { input_tokens: 3, output_tokens: 2, output_tokens_details: { reasoning_tokens: 4 } }]) expect(foodDescriptionUsage({ usage })).toEqual({ complete: false });
    expect(foodDescriptionUsage({ usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } })).toEqual({ complete: false });
    expect(foodDescriptionUsage({ usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0, cache_write_tokens_details: { ttl_30m_tokens: 0, ttl_12h_tokens: 0 } }, output_tokens_details: { reasoning_tokens: 0 } } })).toMatchObject({ complete: true, inputTokens: 0, outputTokens: 0 });
  });
  it("records documented Sol cache-write subsets without treating a valid response as unknown", () => {
    const usage = { input_tokens: 12000, output_tokens: 40, total_tokens: 12040,
      input_tokens_details: { cached_tokens: 4000, cache_write_tokens: 7000, cache_write_tokens_details: { ttl_30m_tokens: 3000, ttl_12h_tokens: 4000 } },
      output_tokens_details: { reasoning_tokens: 10 } };
    expect(foodDescriptionUsage({ id: "resp_synthetic", usage }, "req_synthetic")).toEqual({ complete: true, responseId: "resp_synthetic", requestId: "req_synthetic",
      inputTokens: 12000, outputTokens: 40, cachedInputTokens: 4000, cacheWriteInputTokens: 7000, cacheWrite30mInputTokens: 3000, cacheWrite12hInputTokens: 4000, reasoningTokens: 10 });
  });

  it("keeps incomplete, contradictory, fractional and unrecognized cache counters unknown", () => {
    const details = { cached_tokens: 20, cache_write_tokens: 30, cache_write_tokens_details: { ttl_30m_tokens: 30, ttl_12h_tokens: 0 } };
    const usage = { input_tokens: 100, output_tokens: 40, total_tokens: 140, input_tokens_details: details, output_tokens_details: { reasoning_tokens: 10 } };
    for (const input_tokens_details of [
      { cached_tokens: 20 }, { ...details, cache_write_tokens: undefined }, { ...details, cache_write_tokens_details: undefined },
      { ...details, cache_write_tokens: 31 }, { ...details, cached_tokens: 80 }, { ...details, cache_write_tokens: -1 },
      { ...details, cache_write_tokens: 1.5 }, { ...details, cache_write_tokens_details: { ttl_30m_tokens: 30 } },
      { ...details, cache_write_tokens_details: { ttl_30m_tokens: 30, ttl_12h_tokens: 0, unpriced_tokens: 1 } }, { ...details, unpriced_tokens: 1 },
    ]) expect(foodDescriptionUsage({ usage: { ...usage, input_tokens_details } })).toEqual({ complete: false });
  });

});
