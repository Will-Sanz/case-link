import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  liveParentCoordinator,
  parentLiveEvaluationConfig,
  runParentEvalCase,
  summarizeParentEvaluation,
} from "./parent-ai-evaluation";
import {
  PARENT_EVAL_CASES,
  PARENT_EVALUATION_VERSION,
} from "../tests/fixtures/parent-evaluation";

async function main() {
  const config = parentLiveEvaluationConfig(process.env),
    mode = config ? "live" : "deterministic";
  const manifest = [
    "tests/fixtures/parent-evaluation.ts",
    "scripts/parent-ai-evaluation.ts",
    "scripts/run-parent-ai-evaluation.ts",
    "src/lib/parent/coordinator.ts",
    "src/lib/parent/service.ts",
    "src/lib/parent/policy.ts",
    "src/lib/parent/planning.ts",
    "src/lib/parent/programs.ts",
    "src/lib/parent/domain.ts",
    "src/lib/parent/answers.ts",
    "src/lib/parent/documents.ts",
    "src/lib/parent/document-processing.ts",
    "package-lock.json",
  ];
  const fingerprints = await Promise.all(
    manifest.map(async (path) => ({
      path,
      sha256: createHash("sha256")
        .update(await readFile(path))
        .digest("hex"),
    })),
  );
  const sourceHash = createHash("sha256")
    .update(JSON.stringify(fingerprints))
    .digest("hex");
  const live = config ? liveParentCoordinator(config) : null;
  const selected = config
    ? PARENT_EVAL_CASES.filter((test) => config.ids.includes(test.id))
    : PARENT_EVAL_CASES;
  const results = [];
  for (const test of selected)
    results.push(await runParentEvalCase(test, live?.coordinate, config?.key));
  const summary = summarizeParentEvaluation(
    results,
    mode,
    sourceHash,
    live?.calls() ?? 0,
  );
  const usage = live?.usage();
  const report = {
    ...summary,
    ...(usage
      ? {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          tokenUsageComplete: usage.complete,
        }
      : {}),
    recordedAt: new Date().toISOString(),
    sourceManifest: fingerprints,
    ...(config
      ? {
          syntheticProjectAttestation: true,
          projectFingerprint: createHash("sha256")
            .update(config.project)
            .digest("hex"),
          maximumCalls: config.maxCalls,
        }
      : {}),
  };
  const basename = `parent-ai-evaluation-${mode}${config ? `-${new Date().toISOString().replace(/[:.]/g, "-")}` : ""}`;
  await mkdir("docs/verification", { recursive: true });
  await writeFile(
    `docs/verification/${basename}.json`,
    `${JSON.stringify(report, null, 2)}\n`,
    { mode: 0o600 },
  );
  const rows = results
    .map(
      (result) =>
        `| ${result.id} | ${result.language} | ${result.turns.length} | ${result.checks.filter((check) => !check.passed).length} | Pending |`,
    )
    .join("\n");
  await writeFile(
    `docs/verification/${basename}.md`,
    `# Parent support evaluation — ${mode}\n\nCorpus: ${PARENT_EVALUATION_VERSION}. Recorded: ${report.recordedAt}. Source fingerprint: \`${sourceHash}\`.\n\n${results.length} synthetic cases, ${summary.turns} turns, ${summary.needs.length} needs, ${summary.programs.length} programs; languages ${summary.languages.join("/")}. Critical checks failed: ${summary.criticalFailures}; quality checks failed: ${summary.qualityFailures}. Live model calls: ${summary.liveCalls}. Human-reviewed cases: **0**. Model-quality approval: **not established**.\n\n${summary.limitations}\n\nThe complete synthetic transcript, individual checks, intervention reasons, token counts, measured harness durations and exact source manifest are in [the JSON report](${basename}.json). Harness time does not establish hosted latency. Synthetic capabilities and receipts are fixtures, not working partner integrations. No production autonomy percentage is inferred.\n\n| Case | Language | Turns | Failed checks | Human review |\n| --- | --- | ---: | ---: | --- |\n${rows}\n`,
    { mode: 0o600 },
  );
  process.stdout.write(
    `Parent ${mode} evaluation: ${results.length} cases / ${summary.turns} turns; ${summary.criticalFailures} critical and ${summary.qualityFailures} quality check failures. Report: docs/verification/${basename}.md. Human/model review remains pending.\n`,
  );
  if (summary.criticalFailures || summary.qualityFailures) process.exitCode = 1;
}
void main().catch(() => {
  process.stderr.write(
    "Parent evaluation could not complete. Check the explicit synthetic evaluation configuration; no sensitive error content is logged.\n",
  );
  process.exitCode = 1;
});
