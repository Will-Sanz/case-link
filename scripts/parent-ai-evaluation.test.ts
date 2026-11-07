import { describe, expect, it, vi } from "vitest";
import { NEEDS } from "../src/lib/parent/domain";
import { PARENT_EVAL_CASES } from "../tests/fixtures/parent-evaluation";
import {
  liveParentCoordinator,
  parentLiveEvaluationConfig,
  runParentEvalCase,
  summarizeParentEvaluation,
} from "./parent-ai-evaluation";

describe("parent synthetic evaluation corpus", () => {
  it("covers every need, program and advertised language with sixty distinct multi-step cases", () => {
    expect(PARENT_EVAL_CASES).toHaveLength(60);
    expect(new Set(PARENT_EVAL_CASES.map((test) => test.id)).size).toBe(60);
    expect(new Set(PARENT_EVAL_CASES.map((test) => test.need))).toEqual(
      new Set(NEEDS),
    );
    expect(new Set(PARENT_EVAL_CASES.map((test) => test.programId)).size).toBe(
      8,
    );
    for (const need of NEEDS) {
      const cases = PARENT_EVAL_CASES.filter((test) => test.need === need);
      expect(cases).toHaveLength(6);
      expect(new Set(cases.map((test) => test.language))).toEqual(
        new Set(["en", "es"]),
      );
      expect(cases.every((test) => test.turns.length === 4)).toBe(true);
    }
  });
  it.each(PARENT_EVAL_CASES)(
    "deterministic journey: $id ($language)",
    async (test) => {
      const result = await runParentEvalCase(test);
      const expectedFailures: string[] = [];
      if (result.implementationBlock) {
        if (test.scenario === "unknown_delivery") expectedFailures.push("unknown_delivery_no_blind_retry");
        if (test.scenario === "scoped_personal_act") expectedFailures.push("personal_act_before_dispatch_0", "personal_act_before_dispatch_1");
        if (test.scenario !== "scope_and_revocation") expectedFailures.push("every_independent_need_reaches_received_support");
        expect(result.checks.find(check => check.code === "closed_initial_journey_never_dispatched")?.passed).toBe(true);
        expect(result.turns.every(turn => turn.routes.find(route => route.need === test.need)?.state === "prepared")).toBe(true);
      }
      expect(
        result.checks.filter((check) => !check.passed).map(check => check.code),
        JSON.stringify(result),
      ).toEqual(expectedFailures);
      expect(result.turns).toHaveLength(4);
      expect(result.humanReview).toBe("pending");
      expect(result.turns.every((turn) => turn.modelCalls === 0)).toBe(true);
    },
  );
  it("retains blocked journeys and failed outcomes in the full corpus denominator", async () => {
    const results = await Promise.all(PARENT_EVAL_CASES.map(test => runParentEvalCase(test)));
    const summary = summarizeParentEvaluation(results, "deterministic", "synthetic-source-hash");
    expect(summary.cases).toBe(60); expect(summary.turns).toBe(240);
    expect(summary.blockedInitialJourneyCases).toBe(12);
    expect(summary.outcomeCases).toBe(50); expect(summary.receivedSupportCases).toBe(40);
    expect(summary.criticalFailures).toBeGreaterThan(0);
    for (const result of results.filter(result => ["snap_pending", "snap_problem", "wic_continuing"].includes(result.need) && result.scenario === "unknown_delivery")) {
      expect(result.implementationBlock).toBeNull();
      expect(result.checks.find(check => check.code === "unknown_delivery_no_blind_retry")?.passed).toBe(true);
      expect(result.checks.find(check => check.code === "existing_application_not_restarted")?.passed).toBe(true);
    }
  });
  it("does not interpret ordinary production credentials or an incomplete flag as live-eval approval", () => {
    expect(
      parentLiveEvaluationConfig({ OPENAI_API_KEY: "ordinary-production-key" }),
    ).toBeNull();
    expect(() =>
      parentLiveEvaluationConfig({
        CASELINK_PARENT_RUN_LIVE_EVALS: "1",
        OPENAI_API_KEY: "ordinary-production-key",
      }),
    ).toThrow();
  });
  it("enforces a separate project-scoped key, explicit case subset and hard maximum call count", async () => {
    const config = parentLiveEvaluationConfig({
      CASELINK_PARENT_RUN_LIVE_EVALS: "1",
      CASELINK_PARENT_EVAL_OPENAI_API_KEY: "synthetic-test-key",
      CASELINK_PARENT_EVAL_PROJECT_ID: "proj_synthetic_test",
      CASELINK_PARENT_EVAL_APPROVED_PROJECT_ID: "proj_synthetic_test",
      CASELINK_PARENT_EVAL_SYNTHETIC_PROJECT: "1",
      CASELINK_PARENT_EVAL_MAX_CALLS: "1",
      CASELINK_PARENT_EVAL_CASE_IDS: PARENT_EVAL_CASES[0].id,
    })!;
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        status: "completed",
        output: [
          {
            type: "function_call",
            name: "select_programs",
            call_id: "synthetic-call",
            arguments: JSON.stringify({
              selections: [{ need: "food_now", programId: "philly-food" }],
            }),
          },
        ],
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    );
    const live = liveParentCoordinator(config, fetcher as typeof fetch);
    await runParentEvalCase(PARENT_EVAL_CASES[0], live.coordinate);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(live.calls()).toBe(1);
    const init = fetcher.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(new Headers(init?.headers).get("OpenAI-Project")).toBe(
      "proj_synthetic_test",
    );
  });
  it("never calls deterministic evidence a human-reviewed model-quality pass", () => {
    const summary = summarizeParentEvaluation(
      [],
      "deterministic",
      "synthetic-source-hash",
    );
    expect(summary.model).toBe("not_called");
    expect(summary.modelQualityApproval).toBe("not_established");
    expect(summary.humanReviewedCases).toBe(0);
  });
});
