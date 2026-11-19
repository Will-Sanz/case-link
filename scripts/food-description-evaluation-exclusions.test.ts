import { expect, it, vi } from "vitest";
import { loadDescriptionEvaluationCorpus } from "./food-description-evaluation-adapter";
import { runDescriptionEvaluationCase } from "./food-description-evaluation";

it.each(["en", "es"].flatMap(language => [1, 3].flatMap(kind => [false, true].map(inventedOptOut => ({ language, kind, inventedOptOut })))))(
  "separately checks inventory versus an opt-out ($language/$kind, invented $inventedOptOut)", async ({ language, kind, inventedOptOut }) => {
    const item = loadDescriptionEvaluationCorpus().cases.find(value => value.id === `description-new_snap-${kind}-${language}`)!;
    const description = String((item.turns[0].input as { description: string }).description);
    const food = description.slice(0, description.indexOf(".") + 1), benefit = description.slice(food.length + 1);
    const selection = { needIds: ["snap_new"], selections: [], assertions: [
      { questionId: "foodForTwoDays", value: "yes", span: { text: food } },
      { questionId: "benefitHistory", value: "never", span: { text: benefit } },
    ], exclusions: inventedOptOut ? [{ need: "food_now", span: { text: food } }] : [], questionIds: [], outOfScope: null };
    let calls = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      calls++;
      return Response.json({ id: "resp_synthetic", status: "completed", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0, cache_write_tokens_details: { ttl_30m_tokens: 0, ttl_12h_tokens: 0 } }, output_tokens_details: { reasoning_tokens: 0 } },
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(calls === 1 ? selection : { ...selection,
          needIds: ["snap_pending"], assertions: [{ questionId: "benefitHistory", value: "applied", span: { text: item.turns[2].description } }],
        }) }] }] });
    });
    const halt = vi.fn(), result = await runDescriptionEvaluationCase(item, { budget: { fetch: () => fetcher, halt, attempts: () => calls }, projectId: "proj_synthetic", apiKey: "synthetic" });
    expect(result).toMatchObject({ criticalFailure: inventedOptOut, humanReview: "pending", modelQualityApproved: false });
    expect(result.turns[0]).toMatchObject({ checks: expect.arrayContaining([{ code: "excludedNeedIds", passed: !inventedOptOut, severity: "critical", basis: "vetted_result" }]) });
    expect(halt.mock.calls.length > 0).toBe(inventedOptOut);
    expect(calls).toBe(!inventedOptOut && kind === 3 ? 2 : 1);
  },
);
