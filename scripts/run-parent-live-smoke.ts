import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { coordinateSupport } from "../src/lib/parent/coordinator";
import { type SupportNeed } from "../src/lib/parent/domain";
import { getProgram } from "../src/lib/parent/programs";
import {
  fixtureIntake,
  fixtureMandate,
  fixtureNow,
  fixtureRequest,
} from "../src/lib/parent/test-fixtures";
import { PARENT_EVAL_CASES } from "../tests/fixtures/parent-evaluation";

const maximumCalls = 30;
type SmokeCase = {
  id: string;
  intake: ReturnType<typeof fixtureIntake>;
  mandate: ReturnType<typeof fixtureMandate>;
};
export function parentLiveSmokeConfig(env: Record<string, string | undefined>) {
  if (
    env.CASELINK_PARENT_RUN_LIVE_SMOKE !== "1" ||
    env.CASELINK_PARENT_LIVE_SMOKE_APPROVED_EXISTING_KEY !== "1" ||
    !env.OPENAI_API_KEY
  )
    throw new Error(
      "Explicit synthetic-only existing-key approval is required.",
    );
  return env.OPENAI_API_KEY;
}
export function parentLiveSmokeCases(): SmokeCase[] {
  const lifecycle = PARENT_EVAL_CASES.filter(
    (test) => test.scenario === "permitted_lifecycle",
  );
  const cases = lifecycle.map((test) => ({
    id: `${test.id}-routing-smoke`,
    intake: fixtureIntake({
      needs: [test.need],
      language: test.language,
      childrenUnderFive: test.need.startsWith("wic_") ? true : null,
      pregnantOrPostpartum: test.need === "wic_new" ? true : null,
      incomeAmount: 120,
      incomeFrequency: "weekly",
      utilityProviders:
        test.need === "gas"
          ? ["pgw"]
          : test.need === "water"
            ? ["pwd"]
            : ["peco"],
    }),
    mandate: fixtureMandate({ recipientIds: [test.programId] }),
  }));
  for (const language of ["en", "es"] as const) {
    const needs: SupportNeed[] = [
      "food_now",
      language === "en" ? "snap_new" : "snap_renewal",
      language === "en" ? "wic_continuing" : "wic_new",
      "electricity",
      "gas",
      "water",
    ];
    cases.push({
      id: `combined-six-needs-${language}`,
      intake: fixtureIntake({
        needs,
        language,
        childrenUnderFive: true,
        pregnantOrPostpartum: true,
        utilityProviders: ["peco", "pgw", "pwd"],
      }),
      mandate: fixtureMandate({
        recipientIds: [
          ...new Set(
            lifecycle
              .filter((test) => needs.includes(test.need))
              .map((test) => test.programId),
          ),
        ],
      }),
    });
  }
  return [
    ...cases,
    {
      id: "preparation-only-minimized-context",
      intake: fixtureIntake({
        needs: ["electricity"],
        incomeAmount: 120,
        incomeFrequency: "weekly",
        shutoffDate: "2026-11-02",
      }),
      mandate: fixtureMandate({
        mode: "prepare_only",
        allowedData: ["household"],
        recipientIds: ["peco-cap"],
      }),
    },
    {
      id: "alternate-authorized-recipient",
      intake: fixtureIntake({ needs: ["electricity"] }),
      mandate: fixtureMandate({ recipientIds: ["uesf-utilities"] }),
    },
    {
      id: "missing-recipient-scope",
      intake: fixtureIntake({ needs: ["electricity"] }),
      mandate: fixtureMandate({ recipientIds: ["philly-food"] }),
    },
    {
      id: "outside-service-region",
      intake: fixtureIntake({ needs: ["electricity"], zip: "10001" }),
      mandate: fixtureMandate({ recipientIds: ["peco-cap"] }),
    },
  ];
}

export async function runParentLiveSmoke(
  apiKey: string,
  fetcher: typeof fetch = fetch,
) {
  let calls = 0,
    inputTokens = 0,
    outputTokens = 0;
  const results: Record<string, unknown>[] = [];
  const providerCalls: Record<string, unknown>[] = [];
  let failed = false;
  for (const test of parentLiveSmokeCases()) {
    const start = performance.now(),
      before = calls,
      firstObservation = providerCalls.length;
    try {
      const result = await coordinateSupport({
        request: fixtureRequest({ intake: test.intake, mandate: test.mandate }),
        now: fixtureNow,
        apiKey,
        beforeCall: async () => {
          assert(calls < maximumCalls, "response_call_budget_exhausted");
          calls++;
        },
        fetcher: async (url, init) => {
          assert.equal(String(url), "https://api.openai.com/v1/responses");
          const body = JSON.parse(String(init?.body));
          assert.equal(body.model, "gpt-6.1-sol");
          assert.equal(body.store, false);
          const context = JSON.parse(body.input[0].content);
          if (!test.mandate.allowedData.includes("income")) {
            assert(!("incomeAmount" in context.facts));
            assert(!("incomeFrequency" in context.facts));
          }
          if (!test.mandate.allowedData.includes("utility")) {
            assert(!("utilityProviders" in context.facts));
            assert(!("shutoffDate" in context.facts));
            assert(!("accountAuthority" in context.facts));
          }
          const response = await fetcher(url, { ...init, redirect: "error" });
          const data = await response.clone().json();
          providerCalls.push({
            caseId: test.id,
            status: response.status,
            model: data.model ?? null,
            responseStatus: data.status ?? null,
            projectHeaderPresent: response.headers.has("openai-project"),
            usage: data.usage ?? null,
            errorCode:
              typeof data.error?.code === "string" ? data.error.code : null,
            output: Array.isArray(data.output)
              ? data.output.map((item: Record<string, unknown>) => ({
                  type: item.type,
                  ...(item.type === "function_call"
                    ? { name: item.name, arguments: item.arguments }
                    : item.type === "message"
                      ? { content: item.content }
                      : {}),
                }))
              : [],
          });
          if (typeof data.usage?.input_tokens === "number")
            inputTokens += data.usage.input_tokens;
          if (typeof data.usage?.output_tokens === "number")
            outputTokens += data.usage.output_tokens;
          return response;
        },
      });
      const observations = providerCalls.slice(firstObservation);
      const selected = observations.flatMap((observation) =>
        (
          observation.output as {
            type: string;
            name?: string;
            arguments?: string;
          }[]
        )
          .filter((item) => item.type === "function_call")
          .flatMap((item) => {
            assert.equal(item.name, "select_programs");
            return JSON.parse(item.arguments!).selections as {
              need: SupportNeed;
              programId: string;
            }[];
          }),
      );
      if (observations.length) {
        for (const need of test.intake.needs)
          assert(
            selected.some((selection) => selection.need === need),
            "model_omitted_requested_need",
          );
        for (const selection of selected) {
          assert(
            test.intake.needs.includes(selection.need),
            "model_added_unrequested_need",
          );
          assert(
            test.mandate.recipientIds.includes(selection.programId),
            "model_selected_unauthorized_recipient",
          );
          assert(
            getProgram(selection.programId)?.needs.includes(selection.need),
            "model_selected_incompatible_program",
          );
        }
        assert(result.plan.routes.every((route) => route.state === "prepared"));
      } else assert.equal(result.modelCalls, 0);
      if (test.id === "missing-recipient-scope")
        assert(
          result.requiredActions.some(
            (action) => action.reason === "expanded_permission",
          ),
        );
      if (test.id === "outside-service-region")
        assert(
          result.plan.routes.every((route) => route.state === "unresolved"),
        );
      results.push({
        id: test.id,
        passed: true,
        needs: test.intake.needs,
        language: test.intake.language,
        modelCalls: calls - before,
        elapsedMs: performance.now() - start,
        selections: selected,
        plan: result.plan,
        requiredActions: result.requiredActions,
      });
    } catch {
      results.push({
        id: test.id,
        passed: false,
        needs: test.intake.needs,
        language: test.intake.language,
        modelCalls: calls - before,
        elapsedMs: performance.now() - start,
        error: "direct_smoke_failed_no_automatic_retry",
      });
      failed = true;
      break;
    }
  }
  return {
    recordedAt: new Date().toISOString(),
    scope: "direct_coordinator_routing_smoke_not_four_turn_live_corpus",
    model: "gpt-6.1-sol",
    reasoningEffort: "medium",
    store: false,
    maximumCalls,
    calls,
    inputTokens,
    outputTokens,
    tokenUsageComplete:
      providerCalls.length === calls &&
      providerCalls.every((call) => call.usage !== null),
    existingKeyExplicitlyApprovedForSyntheticRun: true,
    projectIdentityEstablished: false,
    dedicatedTestProjectVerified: false,
    humanReviewedCases: 0,
    modelQualityApproval: "not_established",
    failed,
    results,
    providerCalls,
  };
}

async function main() {
  const key = parentLiveSmokeConfig(process.env);
  const manifest = [
    "scripts/run-parent-live-smoke.ts",
    "src/lib/parent/coordinator.ts",
    "src/lib/parent/domain.ts",
    "src/lib/parent/planning.ts",
    "src/lib/parent/programs.ts",
    "src/lib/parent/test-fixtures.ts",
    "tests/fixtures/parent-evaluation.ts",
    "package-lock.json",
  ];
  const sourceManifest = await Promise.all(
    manifest.map(async (path) => ({
      path,
      sha256: createHash("sha256")
        .update(await readFile(path))
        .digest("hex"),
    })),
  );
  const report = { ...(await runParentLiveSmoke(key)), sourceManifest };
  await mkdir("docs/verification", { recursive: true });
  const path = `docs/verification/parent-live-smoke-${report.recordedAt.replace(/[:.]/g, "-")}.json`;
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });
  process.stdout.write(
    `Parent direct live smoke: ${report.results.length} cases, ${report.calls}/${maximumCalls} Responses calls; ${report.failed ? "FAILED (stopped)" : "passed"}; ${report.inputTokens} input / ${report.outputTokens} output tokens. Report: ${path}\n`,
  );
  if (report.failed) process.exitCode = 1;
}
if (basename(process.argv[1] ?? "") === "run-parent-live-smoke.ts")
  void main().catch(() => {
    process.stderr.write(
      "Parent direct live smoke was not run: explicit approved synthetic configuration is required; no sensitive errors are logged.\n",
    );
    process.exitCode = 1;
  });
