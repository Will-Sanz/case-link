import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, openSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {z}from"zod";
import { foodDescriptionInputSchema } from "../src/lib/parent/food-description";
import { descriptionEvaluationAdapterHash, descriptionEvaluationPlan, loadDescriptionEvaluationCorpus } from "./food-description-evaluation-adapter";
import { descriptionEvaluationAccounting, descriptionEvaluationApprovalSchema, descriptionEvaluationHash, readDescriptionEvaluationEvidence, withFoodDescriptionEvaluationBudget, writeDescriptionEvaluationEvidence,
  descriptionEvaluationReconciliationPlanSchema, descriptionEvaluationReconciliationPaths, reconcileFoodDescriptionEvaluation, type DescriptionEvaluationReconciliation } from "./food-description-evaluation-budget";
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
function reconciliation(path: string, env: Record<string, string | undefined>, envelope: { sourceSha256?: unknown }, sourceManifest: ReturnType<typeof descriptionEvaluationSourceManifest>): DescriptionEvaluationReconciliation {
  const plan = descriptionEvaluationReconciliationPlanSchema.parse(privateApproval(path, env.CASELINK_FOOD_DESCRIPTION_EVAL_RECONCILIATION_SHA256));
  if (envelope.sourceSha256 !== "734f5c94f1a35e2773416f449e4489b9eec91e9e2c2189bd84c2d9fc1fec82c7"
    || descriptionEvaluationHash(plan.originalSourceManifest) !== envelope.sourceSha256
    || descriptionEvaluationHash(plan.currentSourceManifest) !== descriptionEvaluationHash(sourceManifest)) throw new Error(generic);
  return { plan, planSha256: env.CASELINK_FOOD_DESCRIPTION_EVAL_RECONCILIATION_SHA256!, configurationSha256: env.CASELINK_FOOD_DESCRIPTION_EVAL_APPROVAL_SHA256! };
}
type CaseResult = Awaited<ReturnType<typeof runDescriptionEvaluationCase>>;
function reconciliationReport(approval: {runDirectory:string;approvalReference:string}, sourceSha256:string) {
  return readDescriptionEvaluationEvidence(descriptionEvaluationReconciliationPaths(approval,sourceSha256).report) as {results:CaseResult[]};
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
  if (args.length === 3 && args[0] === "--reconcile-retained") {
    const envelope = privateApproval(args[1], env.CASELINK_FOOD_DESCRIPTION_EVAL_APPROVAL_SHA256) as {sourceSha256?:unknown;approval?:unknown};
    const approval = descriptionEvaluationApprovalSchema.parse(envelope.approval), recovery = reconciliation(args[2],env,envelope,sourceManifest);
    if(approval.adapterSha256!==adapterSha256)throw new Error(generic);
    const recoveredPlan=descriptionEvaluationReconciliationPlanSchema.parse(recovery.plan);
    const report=await reconcileFoodDescriptionEvaluation({approval,recovery},async budget=>{
      const results:CaseResult[]=[];
      for(const id of [...new Set(recoveredPlan.attempts.map(value=>value.caseId))]){
        const item=corpus.cases.find(value=>value.id===id);if(!item)throw new Error(generic);
        const result=await runDescriptionEvaluationCase(item,{budget,projectId:approval.projectId,apiKey:"retained-response-only"});
        for(const turn of result.turns){
          if(turn.status!=="measured_interpretation")continue;
          const attempt=recoveredPlan.attempts.find(value=>value.caseId===id&&value.turn===turn.turn);if(!attempt)throw new Error(generic);
          const observation=z.object({elapsedMs:z.number().nonnegative(),responseHash:z.string()}).passthrough().parse(readDescriptionEvaluationEvidence(join(approval.runDirectory,`attempt-${String(attempt.attempt).padStart(3,"0")}-observation.json`)));
          turn.localReplayElapsedMs=turn.elapsedMs;turn.elapsedMs=observation.elapsedMs;turn.status="retained_interpretation";turn.responseProvenance="retained_exact_request";turn.responseHash=observation.responseHash;
        }
        results.push(result);
      }
      return results;
    });
    const accounting=descriptionEvaluationAccounting(approval.runDirectory);
    return {...report,accounting,reservedAttemptsAcrossRun:accounting.reservedPairs,aggregateReservedAttempts:3+accounting.reservedPairs,remainingGenerationRequests:80-accounting.reservedPairs};
  }
  if (![3,4].includes(args.length) || args[0] !== "--approved-live" || !/^[0-7]$/.test(args[2])) throw new Error(generic);
  if (env.CASELINK_FOOD_DESCRIPTION_EVAL_NEW_APPROVAL !== "1") throw new Error(generic);
  const envelope = privateApproval(args[1], env.CASELINK_FOOD_DESCRIPTION_EVAL_APPROVAL_SHA256) as { sourceSha256?: unknown; approval?: unknown };
  const recovery=args.length===4?reconciliation(args[3],env,envelope,sourceManifest):undefined;
  if (!recovery&&envelope.sourceSha256 !== sourceSha256) throw new Error(generic);
  const approval = descriptionEvaluationApprovalSchema.parse(envelope.approval);
  if (approval.adapterSha256 !== adapterSha256) throw new Error(generic);
  const apiKey = env.CASELINK_FOOD_DESCRIPTION_EVAL_API_KEY;
  if (!apiKey) throw new Error(generic); // No ordinary OPENAI_API_KEY or legacy allowance fallback.
  const batch = Number(args[2]), selected = batches[batch], results: Awaited<ReturnType<typeof runDescriptionEvaluationCase>>[] = [];
  return withFoodDescriptionEvaluationBudget({ approval, apiKey, fetcher, reconciliation: recovery }, async budget => {
    const retained=recovery?reconciliationReport(approval,sourceSha256).results:[];
    if(descriptionEvaluationAccounting(approval.runDirectory).reservedCaseIds.some(id=>!existsSync(join(approval.runDirectory,`${id}-result.json`))))throw new Error(generic);
    for (const id of selected) {
      const item = corpus.cases.find(value => value.id === id)!;
      const path=join(approval.runDirectory,`${id}-result.json`);
      const result=retained.find(value=>value.id===id)??(existsSync(path) ? readDescriptionEvaluationEvidence(path) as CaseResult : await runDescriptionEvaluationCase(item,{budget,projectId:approval.projectId,apiKey}));
      if(result.id!==id||result.language!==item.language||result.turns.length!==4||result.humanReview!=="pending"||result.modelQualityApproved!==false)throw new Error(generic);
      results.push(result);if(!existsSync(path))writeDescriptionEvaluationEvidence(path,result);
      if (result.criticalFailure) break;
    }
    const recorded = readdirSync(approval.runDirectory).filter(name=>/^description-[a-z0-9_-]+-result\.json$/.test(name)).map(name=>{const result=readDescriptionEvaluationEvidence(join(approval.runDirectory,name)) as CaseResult;return retained.find(value=>value.id===result.id)??result;});
    if(recorded.some(result=>!corpus.cases.some(item=>item.id===result.id)||result.turns.length!==4))throw new Error(generic);
    const output = { mode: "live_synthetic", claim: "Synthetic interpretation evidence only; no provider action, request, mandate or family-ready approval.",
      corpusCases: 60, corpusTurns: 240, maximumGenerationCalls: 80, maximumCountRequests: 80, zeroCallGuards: blocked,
      batch, batchIds: selected, results, unrunBatchCases: selected.filter(id => !results.some(result => result.id === id)),
      unrunCorpusCases: corpus.cases.filter(item => !recorded.some(result => result.id === item.id)).map(item => item.id),
      unrunCorpusTurns: (60-recorded.length)*4+recorded.flatMap(result=>result.turns).filter(turn=>turn.status==="unrun_after_failure").length,
      authorityTurnsStillRequiringNativeEvidence:recorded.flatMap(result=>result.turns).filter(turn=>turn.status==="requires_native_evidence").length,
      reservedAttemptsAcrossRun: budget.attempts(), accounting:descriptionEvaluationAccounting(approval.runDirectory), sourceSha256, adapterSha256, modelQualityApproved: false, humanReviewedCases: 0,
      ...(recovery?{reconciliationPlanSha256:recovery.planSha256,originalHaltRetained:true,aggregateReservedAttempts:3+budget.attempts(),maximumAggregateGenerationCalls:83,maximumAggregateCountRequests:83}: {}) };
    const savedReport=join(approval.runDirectory,`batch-${batch}-report${recovery?`-${sourceSha256}`:""}.json`);if(!existsSync(savedReport))writeDescriptionEvaluationEvidence(savedReport,output);return output;
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void foodDescriptionEvaluationCommand(process.argv.slice(2)).then(result => {
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}).catch(() => { process.stderr.write(generic + "\n"); process.exitCode = 1; });
