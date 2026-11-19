import { describe, expect, it, vi } from "vitest";
import { loadDescriptionEvaluationCorpus } from "./food-description-evaluation-adapter";
import { runDescriptionEvaluationCase } from "./food-description-evaluation";

const corpus = loadDescriptionEvaluationCorpus();
describe("source-backed current or past benefit receipt and its issue", () => {
  it.each(["en", "es"].flatMap(language => [false, true].map(paired => ({ language, paired }))))("keeps the receiving dependency strict in $language (paired $paired)", async ({ language, paired }) => {
    const item = corpus.cases.find(value => value.id === `description-benefit_problem-1-${language}`)!;
    const text = language === "en" ? "My SNAP stopped." : "Se suspendió mi SNAP.";
    const selection = { needIds: ["snap_problem"], selections: [], assertions: [
      ...(paired ? [{ questionId: "benefitHistory", value: "receiving", span: { text } }] : []),
      { questionId: "existingIssue", value: "stopped", span: { text } },
    ], exclusions: [], questionIds: [], outOfScope: null };
    const halt = vi.fn(), fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ id: "resp_synthetic", status: "completed",
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0,
        cache_write_tokens_details: { ttl_30m_tokens: 0, ttl_12h_tokens: 0 } }, output_tokens_details: { reasoning_tokens: 0 } },
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(selection) }] }] }));
    const result = await runDescriptionEvaluationCase(item, { budget: { fetch: () => fetcher, halt, attempts: () => fetcher.mock.calls.length }, projectId: "proj_synthetic", apiKey: "synthetic" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ criticalFailure: !paired, qualityFailures: 0, humanReview: "pending", modelQualityApproved: false });
    if (paired) {
      expect(halt).not.toHaveBeenCalled();
      expect(result.turns[0]).toMatchObject({ result: { proposedAnswers: { foodForTwoDays: "not_sure", benefitHistory: "receiving", existingIssue: "stopped" }, questionIds: ["foodForTwoDays"] } });
      expect(result.turns[1]).toMatchObject({ result: { proposedAnswers: { foodForTwoDays: "yes", benefitHistory: "receiving", existingIssue: "stopped" }, questionIds: [] } });
    } else {
      expect(halt).toHaveBeenCalled();
      expect(result.turns[0]).toMatchObject({ status: "failed_or_unknown" });
      expect(result.turns.slice(1).every(turn => turn.status === "unrun_after_failure")).toBe(true);
    }
  });
});
