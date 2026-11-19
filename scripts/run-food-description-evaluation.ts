import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, openSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {z}from"zod";
import { foodDescriptionInputSchema } from "../src/lib/parent/food-description";
import { descriptionEvaluationAdapterHash, descriptionEvaluationPlan, loadDescriptionEvaluationCorpus } from "./food-description-evaluation-adapter";
import { descriptionEvaluationAccounting, descriptionEvaluationApprovalSchema, descriptionEvaluationHash, readDescriptionEvaluationEvidence, sealedDescriptionEvaluationPriorAccounting, withFoodDescriptionEvaluationBudget, writeDescriptionEvaluationEvidence } from "./food-description-evaluation-budget";
import { descriptionEvaluationBatches, descriptionEvaluationSourceManifest, runDescriptionEvaluationCase } from "./food-description-evaluation";

const generic = "Description evaluation did not dispatch or could not complete. Reconcile the same approved run; private errors are not printed.";
function privateApproval(path: string, expectedHash: string | undefined) {
  if (!isAbsolute(path) || !expectedHash || !/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error(generic);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd); if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o600 || info.size > 16384) throw new Error(generic);
    const bytes = readFileSync(fd); if (createHash("sha256").update(bytes).digest("hex") !== expectedHash) throw new Error(generic);
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } finally { closeSync(fd); }
}
/** Dry mode never reads a key/configuration and has no network path. */
export async function foodDescriptionEvaluationCommand(args: string[], env: Record<string, string | undefined> = process.env, fetcher?: typeof fetch) {
  if (args.length === 2 && args[0] === "--report") {
    const saved = privateApproval(args[1], env.CASELINK_FOOD_DESCRIPTION_EVAL_APPROVAL_SHA256) as { sourceSha256?: unknown; approval?: unknown };
    const approval = descriptionEvaluationApprovalSchema.extend({fingerprint:z.string().regex(/^[a-f0-9]{64}$/),adapterSha256:z.string().regex(/^[a-f0-9]{64}$/)}).parse(saved.approval);
    return { mode: "retained_report", sourceSha256: saved.sourceSha256, accounting: descriptionEvaluationAccounting(approval.runDirectory),
      reports: readdirSync(approval.runDirectory).filter(name => /^batch-[0-7]-report(?:-[a-f0-9]{64})?\.json$/.test(name) || /^reconciliation-[a-f0-9]{64}-report\.json$/.test(name)).sort().map(name => readDescriptionEvaluationEvidence(join(approval.runDirectory,name))), noHttpRequests: true };
  }
  const corpus = loadDescriptionEvaluationCorpus(), plan = descriptionEvaluationPlan(corpus), sourceManifest = descriptionEvaluationSourceManifest();
  const blocked = corpus.blockedCases.map(item => ({ id: item.id, blockedBeforeHttp: !foodDescriptionInputSchema.safeParse({ description: item.description, screenLocale: item.language }).success }));
  if (blocked.some(item => !item.blockedBeforeHttp)) throw new Error(generic);
  const batches = descriptionEvaluationBatches(corpus.cases), adapterSha256 = descriptionEvaluationAdapterHash(), sourceSha256 = descriptionEvaluationHash(sourceManifest);
  if (args.length === 0 || args[0] === "--dry") return { mode: "dry", claim: "Input/guard/DTO plan only; no model quality or native authority measured.", ...plan, sourceManifest, sourceSha256, adapterSha256, batches, blocked, modelCalls: 0, countRequests: 0, humanReviewedCases: 0 };
  if (args.length !== 3 || args[0] !== "--approved-live" || !/^[0-7]$/.test(args[2])) throw new Error(generic);
  if (env.CASELINK_FOOD_DESCRIPTION_EVAL_NEW_APPROVAL !== "1") throw new Error(generic);
  const envelope = privateApproval(args[1], env.CASELINK_FOOD_DESCRIPTION_EVAL_APPROVAL_SHA256) as { sourceSha256?: unknown; approval?: unknown };
  if (envelope.sourceSha256 !== sourceSha256) throw new Error(generic);
  const approval = descriptionEvaluationApprovalSchema.parse(envelope.approval);
  if (approval.adapterSha256 !== adapterSha256 || approval.aggregate?.maximumCalls !== 315) throw new Error(generic);
  const apiKey = env.CASELINK_FOOD_DESCRIPTION_EVAL_API_KEY;
  if (!apiKey) throw new Error(generic); // No ordinary OPENAI_API_KEY or legacy allowance fallback.
  const batch = Number(args[2]), selected = batches[batch], results: Awaited<ReturnType<typeof runDescriptionEvaluationCase>>[] = [];
  return withFoodDescriptionEvaluationBudget({ approval, apiKey, fetcher }, async budget => {
    const prior = sealedDescriptionEvaluationPriorAccounting(approval);
    if(descriptionEvaluationAccounting(approval.runDirectory).reservedCaseIds.some(id=>!existsSync(join(approval.runDirectory,`${id}-result.json`))))throw new Error(generic);
    for (const id of selected) {
      const item = corpus.cases.find(value => value.id === id)!;
      const path=join(approval.runDirectory,`${id}-result.json`);
      const result=existsSync(path) ? readDescriptionEvaluationEvidence(path) as Awaited<ReturnType<typeof runDescriptionEvaluationCase>> : await runDescriptionEvaluationCase(item,{budget,projectId:approval.projectId,apiKey});
      if(result.id!==id||result.language!==item.language||result.turns.length!==4||result.humanReview!=="pending"||result.modelQualityApproved!==false)throw new Error(generic);
      results.push(result);if(!existsSync(path))writeDescriptionEvaluationEvidence(path,result);
      if (result.criticalFailure) break;
    }
    const recorded = readdirSync(approval.runDirectory).filter(name=>/^description-[a-z0-9_-]+-result\.json$/.test(name)).map(name=>readDescriptionEvaluationEvidence(join(approval.runDirectory,name)) as Awaited<ReturnType<typeof runDescriptionEvaluationCase>>);
    if(recorded.some(result=>!corpus.cases.some(item=>item.id===result.id)||result.turns.length!==4))throw new Error(generic);
    const accounting=descriptionEvaluationAccounting(approval.runDirectory);
    const output = { mode: "live_synthetic", claim: "Synthetic interpretation evidence only; no provider action, request, mandate or family-ready approval.",
      corpusCases: 60, corpusTurns: 240, maximumGenerationCalls: 80, maximumCountRequests: 80, zeroCallGuards: blocked,
      batch, batchIds: selected, results, unrunBatchCases: selected.filter(id => !results.some(result => result.id === id)),
      unrunCorpusCases: corpus.cases.filter(item => !recorded.some(result => result.id === item.id)).map(item => item.id),
      unrunCorpusTurns: (60-recorded.length)*4+recorded.flatMap(result=>result.turns).filter(turn=>turn.status==="unrun_after_failure").length,
      authorityTurnsStillRequiringNativeEvidence:recorded.flatMap(result=>result.turns).filter(turn=>turn.status==="requires_native_evidence").length,
      reservedAttemptsAcrossRun: budget.attempts(), accounting, sourceSha256, adapterSha256, modelQualityApproved: false, humanReviewedCases: 0,
      maximumAggregateGenerationCalls: approval.aggregate!.maximumCalls, maximumAggregateCountRequests: approval.aggregate!.maximumCountRequests,
      aggregateReservedAttempts: prior.pairs + budget.attempts(), aggregateReservedNanoDollars: prior.reservedNanoDollars + accounting.reservedNanoDollars,
      sealedPriorAccounting: prior, aggregateKnownMeasuredNanoDollars: prior.knownMeasuredNanoDollars + accounting.knownMeasuredNanoDollars,
      aggregateBudgetBoundNanoDollars: prior.budgetedNanoDollars + accounting.reservedNanoDollars };
    const savedReport=join(approval.runDirectory,`batch-${batch}-report.json`);if(!existsSync(savedReport))writeDescriptionEvaluationEvidence(savedReport,output);return output;
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void foodDescriptionEvaluationCommand(process.argv.slice(2)).then(result => {
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}).catch(() => { process.stderr.write(generic + "\n"); process.exitCode = 1; });
