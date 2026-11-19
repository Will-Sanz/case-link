import { describe, expect, it, vi } from "vitest";
import { loadDescriptionEvaluationCorpus } from "./food-description-evaluation-adapter";
import { runDescriptionEvaluationCase } from "./food-description-evaluation";

const corpus = loadDescriptionEvaluationCorpus();
describe("independently ready terminal paths, with synthetic transport only", () => {
  it.each(["en", "es"].flatMap(language => ["valid", "invented supply", "omitted history"].map(kind => ({ language, kind }))))("checks the chosen SNAP path without inventing a food answer ($language, $kind)", async ({ language, kind }) => {
    const inventSupply = kind === "invented supply";
    const item = corpus.cases.find(value => value.id === `description-choice_and_scope-3-${language}`)!;
    const requests: { routingFacts: unknown }[] = [], halt = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const projection = JSON.parse(JSON.parse(String(init?.body)).input[0].content);
      requests.push(projection);
      const first = requests.length === 1;
      const exclusionText = language === "en" ? "without applying for benefits" : "sin solicitar beneficios";
      const benefitText = language === "en" ? "first SNAP application" : "primera solicitud de SNAP";
      const selection = { needIds: first ? ["food_now"] : ["food_now", "snap_new"], selections: [],
        assertions: first || kind === "omitted history" ? [] : [{ questionId: "benefitHistory", value: "never", span: { text: benefitText } },
          ...(inventSupply ? [{ questionId: "foodForTwoDays", value: "no", span: { text: language === "en" ? "food today" : "comida para hoy" } }] : [])],
        exclusions: first ? ["snap_new"].map(need => ({ need, span: { text: exclusionText } })) : [],
        questionIds: [], outOfScope: null };
      return Response.json({ id: "resp_synthetic", status: "completed", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0, cache_write_tokens_details: { ttl_30m_tokens: 0, ttl_12h_tokens: 0 } }, output_tokens_details: { reasoning_tokens: 0 } },
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(selection) }] }] });
    });
    const result = await runDescriptionEvaluationCase(item, { budget: { fetch: () => fetcher, halt, attempts: () => requests.length }, projectId: "proj_synthetic", apiKey: "synthetic" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    if (kind === "omitted history") {
      expect(halt).toHaveBeenCalled();expect(result.criticalFailure).toBe(true);
      expect(result.turns[2].status).toBe("failed_or_unknown");expect(result.turns[3].status).toBe("unrun_after_failure");
      expect(result.modelQualityApproved).toBe(false);return;
    }
    if (inventSupply) {
      expect(halt).toHaveBeenCalled();
      expect(result).toMatchObject({ criticalFailure: true, qualityFailures: 2, humanReview: "pending", modelQualityApproved: false });
      expect(result.turns[2]).toMatchObject({ checks: expect.arrayContaining([{ code: "answers", passed: false, severity: "critical", basis: "vetted_result" }, { code: "urgency", passed: false, severity: "critical", basis: "vetted_result" }]) });
      expect(result.turns[3].status).toBe("unrun_after_failure");
      return;
    }
    expect(halt).not.toHaveBeenCalled();
    expect(result).toMatchObject({ criticalFailure: false, qualityFailures: 0, humanReview: "pending", modelQualityApproved: false });
    expect(requests.every(value => !JSON.stringify(value.routingFacts).includes("foodForTwoDays"))).toBe(true);
    expect(result.turns[2]).toMatchObject({ result: { state: "needs_clarification", proposedAnswers: { foodForTwoDays: "not_sure", benefitHistory: "never" }, questionIds: ["foodForTwoDays"] } });
    expect(result.turns[2]).toMatchObject({ familyEffort: { observedFamilyEffort: false, unresolvedRoutingQuestionCount: 1, readyNeedIds: ["snap_new"], reusedRoutingFactCount: 0 } });
    expect(result.turns[3]).toMatchObject({ status: "typed_handoff_schema_checked", actual: { needs: ["snap_new"], answers: { foodForTwoDays: "not_sure", benefitHistory: "never", existingIssue: null } },
      pendingQuestionIds: ["foodForTwoDays"], noRequestOrMandateCreated: true });
    expect(result.turns[3].checks).toEqual(expect.arrayContaining([{ code: "only_ready_uncovered_need", passed: true, severity: "critical" },
      { code: "partial_handoff_preserves_pending_food", passed: true, severity: "critical" }]));
    expect(result.turns[3].oracleCoverage.retainedUnmeasuredFields).toContain("nativeActionEvidence");
    expect(result.turns).toHaveLength(4);
  });
  it.each(["en", "es"])("opens an owned application without inventing a supplied history answer (%s)", async language => {
    const item = corpus.cases.find(value => value.id === `description-owned_history-3-${language}`)!;
    let requests = 0;
    const halt = vi.fn(), fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      const first = ++requests === 1;
      const selection = { needIds: first ? [] : ["snap_pending"], selections: [],
        assertions: [{ questionId: first ? "foodForTwoDays" : "benefitHistory", value: first ? "yes" : "applied",
          span: { text: first ? language === "en" ? "food for this week" : "comida para esta semana"
            : language === "en" ? "my SNAP application is already pending" : "mi solicitud de SNAP ya está pendiente" } }],
        exclusions: [], questionIds: [], outOfScope: null };
      return Response.json({ id: "resp_synthetic", status: "completed", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0, cache_write_tokens_details: { ttl_30m_tokens: 0, ttl_12h_tokens: 0 } }, output_tokens_details: { reasoning_tokens: 0 } },
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(selection) }] }] });
    });
    const result = await runDescriptionEvaluationCase(item, { budget: { fetch: () => fetcher, halt, attempts: () => requests }, projectId: "proj_synthetic", apiKey: "synthetic" });
    expect(fetcher).toHaveBeenCalledTimes(2); expect(halt).not.toHaveBeenCalled();
    expect(result).toMatchObject({ criticalFailure: false, qualityFailures: 0, modelQualityApproved: false });
    expect(result.turns[1]).toMatchObject({ result: { state: "open_existing", needIds: [], proposedAnswers: { foodForTwoDays: "yes", benefitHistory: "not_sure", existingIssue: null },
      questionIds: [], existingRequests: [{ requestId: "00000000-0000-4000-8000-000000000101", needIds: ["snap_pending"] }] },
      archived: { answers: { benefitHistory: "applied" } }, current: { answers: { benefitHistory: "not_sure" } } });
    expect(result.turns[2]).toMatchObject({ result: { proposedAnswers: { benefitHistory: "applied" } } });
  });
});
