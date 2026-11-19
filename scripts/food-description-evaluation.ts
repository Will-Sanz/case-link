import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {isDeepStrictEqual}from"node:util";
import { z } from "zod";
import { buildFoodDescriptionProjection, foodDescriptionSelectionSchema, validateFoodDescriptionSelection, type FoodDescriptionContext } from "../src/lib/parent/food-description";
import { assessFoodSupport, foodAssessmentHandoffSchema, foodAssessmentSchema } from "../src/lib/parent/food-assessment";
import { readyFoodDescriptionNeeds } from "../src/lib/parent/food-description-view";
import { runOneFoodDescriptionTurn } from "../src/lib/parent/food-description-runtime";
import { DESCRIPTION_EVALUATION_NOW, applyDescriptionEvaluationAnswers, carryDescriptionEvaluationFacts, descriptionEvaluationContext, descriptionEvaluationCurrentRequests, descriptionEvaluationInput, descriptionEvaluationOracle, descriptionEvaluationPlannedProjection, descriptionEvaluationResult,
  revalidateDescriptionEvaluationChange, type DescriptionEvaluationCase, type DescriptionEvaluationResult } from "./food-description-evaluation-adapter";
import { descriptionEvaluationHash,type DescriptionEvaluationBudget } from "./food-description-evaluation-budget";

const object = z.record(z.string(), z.unknown());
export const DESCRIPTION_EVALUATION_SOURCE_PATHS = ["scripts/food-description-evaluation-budget.ts", "scripts/food-description-evaluation-adapter.ts", "scripts/food-description-evaluation.ts", "scripts/run-food-description-evaluation.ts",
  "src/lib/parent/food-description-runtime.ts", "src/lib/parent/food-description.ts", "src/lib/parent/food-description-view.ts", "src/lib/parent/food-assessment.ts", "src/lib/parent/programs.ts", "src/lib/parent/domain.ts", "src/lib/parent/http.ts", "src/lib/parent/assistant-contract.ts", "src/lib/privacy/no-pii.ts", "src/lib/parent/food-access.ts", "src/features/parent/food-sites.tsx", "tests/fixtures/parent/food-description-2026-11-18.v17-adapter.json", "tests/fixtures/parent/food-description-source-facts-2026-11-18.v1.json", "package-lock.json"];
export function descriptionEvaluationSourceManifest() { return DESCRIPTION_EVALUATION_SOURCE_PATHS.map(path => ({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") })); }
export function descriptionEvaluationBatches(cases: DescriptionEvaluationCase[]) {
  const smoke = ["urgent-1", "new_snap-2", "ambiguity-3", "owned_history-1"].flatMap(id => ["en", "es"].map(language => `description-${id}-${language}`));
  if (smoke.some(id => !cases.some(item => item.id === id))) throw new Error("description_evaluation_smoke_changed");
  const rest = cases.filter(item => !smoke.includes(item.id)).map(item => item.id);
  return [smoke, ...Array.from({ length: Math.ceil(rest.length / 8) }, (_, index) => rest.slice(index * 8, index * 8 + 8))];
}
type Interpretation = {projection: ReturnType<typeof buildFoodDescriptionProjection>;selection:z.infer<typeof foodDescriptionSelectionSchema>;result:DescriptionEvaluationResult;usage:unknown;elapsedMs:number;sourceProjection: ReturnType<typeof buildFoodDescriptionProjection>};
export async function interpretDescriptionEvaluationTurn(item: DescriptionEvaluationCase, index: number, context: FoodDescriptionContext, budget: DescriptionEvaluationBudget, projectId: string, apiKey: string):Promise<Interpretation> {
  const started=performance.now();
  const input = descriptionEvaluationInput(item, index), projection = buildFoodDescriptionProjection(input, context, new Date(DESCRIPTION_EVALUATION_NOW));
  if(descriptionEvaluationHash(projection)!==descriptionEvaluationHash(descriptionEvaluationPlannedProjection(item,index)))throw new Error("description_evaluation_unplanned_input");
  const draftId = randomUUID(), leaseToken = randomUUID(), charge = randomUUID();
  let claimed = false, reserved = false, selected: unknown, usage: unknown;
  // Synthetic port only: actual native SQL/Auth/global account caps have separate required evidence.
  const database = { query: async (sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> => {
    if (sql.includes("parent_claim_food_description")) { if (claimed) return { rows: [{ value: null }] }; claimed = true; return { rows: [{ value: { projectId, draftId, revision: context.revision, leaseToken, input, context, dispatchUntil: "2026-11-18T12:15:00Z" } }] }; }
    if (sql.includes("parent_prepare_food_description")) { if (values?.[3] !== JSON.stringify(projection)) throw new Error("description_evaluation_projection_drift"); return { rows: [] }; }
    if (sql.includes("parent_reserve_food_description")) { if (reserved) throw new Error("description_evaluation_duplicate_reservation"); reserved = true; return { rows: [{ value: charge }] }; }
    if (sql.includes("parent_food_description_current")) return { rows: [{ value: context }] };
    if (sql.includes("parent_record_food_description_usage")) { usage = JSON.parse(String(values?.[1])); return { rows: [] }; }
    if (sql.includes("parent_finish_food_description")) { selected = JSON.parse(String(values?.[3])); return { rows: [] }; }
    if (sql.includes("parent_fail_food_description")) return { rows: [] };
    throw new Error("description_evaluation_unexpected_database_port");
  } };
  const fetcher: typeof fetch = (url, init) => { if (!reserved) throw new Error("description_evaluation_reserve_before_dispatch"); return budget.fetch(item.id, index + 1)(url, init); };
  await runOneFoodDescriptionTurn({ database, apiKey, projectId, fetcher, now: () => new Date(DESCRIPTION_EVALUATION_NOW) });
  if (selected === undefined) { budget.halt(); throw new Error("description_evaluation_model_stage_failed"); }
  const selection = foodDescriptionSelectionSchema.parse(selected), result = descriptionEvaluationResult(projection, selection, context);
  return { projection, selection, result, usage, elapsedMs:performance.now()-started, sourceProjection: projection };
}
function checksFor(result: DescriptionEvaluationResult, expected: Record<string, unknown>) {
  const checks: { code: string; passed: boolean; severity: "critical" | "quality"; basis?: "vetted_result" }[] = [];
  for (const [field, actual] of [["state", result.state], ["needIds", result.needIds], ["excludedNeedIds", result.excludedNeedIds], ["questionIds", result.questionIds], ["answers", result.proposedAnswers], ["urgency", result.proposedUrgency]] as const)
    if (field in expected) checks.push({ code: field, passed: isDeepStrictEqual(actual,expected[field]), severity: ["needIds", "excludedNeedIds", "urgency", "answers"].includes(field) || field === "questionIds" && Array.isArray(actual) && actual.some(id=>!Array.isArray(expected[field]) || !(expected[field] as unknown[]).includes(id)) ? "critical" : "quality", basis:"vetted_result" });
  checks.push({ code: "no_execution_granted", passed: result.executionGranted === false, severity: "critical", basis:"vetted_result" });
  if (expected.allowedProgramIdsByNeed) {
    const allowed = object.parse(expected.allowedProgramIdsByNeed);
    checks.push({ code: "selected_programs_grounded", passed: result.selections.every(selection => Array.isArray(allowed[selection.need]) && (allowed[selection.need] as unknown[]).includes(selection.programId)), severity: "critical", basis:"vetted_result" });
  }
  if (expected.existingRequests) checks.push({ code: "existing_owned_requests", passed: isDeepStrictEqual(result.existingRequests,expected.existingRequests), severity: "critical", basis:"vetted_result" });
  if ("outOfScope" in expected) checks.push({ code: "out_of_scope", passed: result.outOfScope === expected.outOfScope, severity: "critical", basis:"vetted_result" });
  return checks;
}
export async function runDescriptionEvaluationCase(item: DescriptionEvaluationCase, options: { budget: DescriptionEvaluationBudget; projectId: string; apiKey: string }) {
  let context = descriptionEvaluationContext(item), model: Interpretation | null = null;
  let availableOwnedRequests=descriptionEvaluationCurrentRequests(context);
  let failed = false;
  const turns: Record<string, unknown>[] = [];
  for (let index = 0; index < item.turns.length; index++) {
    const turn = item.turns[index], oracle = descriptionEvaluationOracle(item, index);
    if (failed) { turns.push({ turn: index + 1, kind: turn.kind, status: "unrun_after_failure", ...oracle }); continue; }
    try {
      if (turn.modelCalls === 1) {
        let latePriorRejected: boolean | null = null;
        if (index > 0) {
          if (model) context = carryDescriptionEvaluationFacts(context, model.sourceProjection, model.selection);
          context = { ...context, revision: context.revision + 1, expectedRevision: context.revision + 1 };
          if (model) { try { validateFoodDescriptionSelection({projection:model.projection,selection:model.selection,currentContext:context,now:new Date(DESCRIPTION_EVALUATION_NOW)});latePriorRejected=false; } catch {latePriorRejected=true;} }
        }
        model = await interpretDescriptionEvaluationTurn(item, index, context, options.budget, options.projectId, options.apiKey);
        const checks = checksFor(model.result, oracle.current);
        if(model.result.duplicateApplicationBlocked)checks.push({code:"model_did_not_propose_duplicate_new_application",passed:!model.selection.needIds.includes("snap_new"),severity:"critical"});
        if(latePriorRejected!==null)checks.push({code:"late_prior_revision_rejected",passed:latePriorRejected,severity:"critical"});
        if("resultRevision" in oracle.current)checks.push({code:"resultRevision",passed:context.revision===oracle.current.resultRevision,severity:"critical"});
        turns.push({ turn: index + 1, kind: turn.kind, status: "measured_interpretation", rawModelNominationAccuracy:"unmeasured", revision:context.revision, latePriorRejected, projection: model.projection, selection: model.selection, result: model.result, usage: model.usage, elapsedMs:model.elapsedMs,
          familyEffort:{basis:"Routing observation only; ready selected paths do not require questions for other work.",observedFamilyEffort:false,unresolvedRoutingQuestionCount:model.result.questionIds.length,expectedUnresolvedRoutingQuestionCount:Array.isArray(oracle.current.questionIds)?oracle.current.questionIds.length:null,readyNeedIds:readyFoodDescriptionNeeds(model.result),reusedRoutingFactCount:Object.keys(model.projection.routingFacts).length,questionReasons:model.result.questionIds.map(id=>({id,reason:model!.projection.questionReasons[id]})),operatorWork:"Human quality/comprehension review still pending; native authority evidence is separate."},checks, ...oracle });
      } else if (["answer_vetted_questions", "continue_without_repeating_known_answers", "continue_existing_request_without_new_questions"].includes(turn.kind)) {
        if (!model) throw new Error("description_evaluation_missing_model_result");
        const suppliedAnswers = object.parse(turn.suppliedAnswers ?? {});
        const sourceFacts = Object.keys(suppliedAnswers).length ? carryDescriptionEvaluationFacts(context, model.sourceProjection, model.selection) : context;
        let next = applyDescriptionEvaluationAnswers(sourceFacts, suppliedAnswers);
        if (next.revision === context.revision) next = context;
        // Clear only the obsolete issue assertion when a supplied actual typed benefit answer changes its meaning.
        const actualAnswers = foodAssessmentSchema.parse({ ...model.result.proposedAnswers, ...object.parse(turn.suppliedAnswers ?? {}) });
        if (actualAnswers.benefitHistory !== "receiving") actualAnswers.existingIssue = null;
        const changed = next.revision !== context.revision; const previous:Interpretation=model;
        const selection: z.infer<typeof foodDescriptionSelectionSchema> = changed ? { ...previous.selection, needIds: assessFoodSupport(actualAnswers).map(value => value.need).filter(need => !previous.selection.exclusions.some(exclusion => exclusion.need === need)), selections: [], questionIds: [],
          assertions: previous.selection.assertions.filter(assertion => !next.facts[assertion.questionId] && (assertion.questionId !== "existingIssue" || actualAnswers.benefitHistory === "receiving")) } : previous.selection;
        const projection = buildFoodDescriptionProjection(descriptionEvaluationInput(item, 0), next, new Date(DESCRIPTION_EVALUATION_NOW));
        const result = descriptionEvaluationResult(projection, selection, next);
        model = { ...previous, projection, selection, result }; context = next;
        const expected = { ...oracle.current, questionIds: oracle.current.remainingQuestionIds };
        turns.push({ turn: index + 1, kind: turn.kind, status: "deterministic_typed_answers", result, checks: checksFor(result, expected), ...oracle });
      } else if (turn.kind === "change_state_and_revalidate") {
        if (!model) throw new Error("description_evaluation_missing_model_result");
        const actual = revalidateDescriptionEvaluationChange(item, model.projection, model.selection, context);
        if("availableOwnedRequests" in actual&&actual.availableOwnedRequests)availableOwnedRequests=actual.availableOwnedRequests;
        if(actual.status==="typed_reassessment_required"){
          const next=applyDescriptionEvaluationAnswers(context,actual.supplied,String(actual.confirmedAt));
          const supplied=foodAssessmentSchema.parse({...model.result.proposedAnswers,...actual.supplied}),previous:Interpretation=model;
          if(supplied.benefitHistory!=="receiving")supplied.existingIssue=null;
          const selection:z.infer<typeof foodDescriptionSelectionSchema>={...previous.selection,needIds:assessFoodSupport(supplied).map(value=>value.need).filter(need=>!previous.selection.exclusions.some(exclusion=>exclusion.need===need)),selections:[],questionIds:[],assertions:previous.selection.assertions.filter(assertion=>!next.facts[assertion.questionId]&&(assertion.questionId!=="existingIssue"||supplied.benefitHistory==="receiving"))};
          const projection=buildFoodDescriptionProjection(descriptionEvaluationInput(item,0),next,new Date(DESCRIPTION_EVALUATION_NOW));model={...previous,projection,selection,result:descriptionEvaluationResult(projection,selection,next)};context=next;
        }
        const checks=actual.status==="requires_native_evidence"?[]:actual.status==="typed_reassessment_required"
          ?checksFor(model.result,{...oracle.current,needIds:oracle.current.needs})
          :[{code:"old_result_rejected",passed:actual.status==="old_result_rejected",severity:"critical" as const}];
        turns.push({ turn: index + 1, kind: turn.kind, status: actual.status, actual, checks, ...(actual.status==="typed_reassessment_required"?{result:model.result}:{}), ...oracle });
      } else if (turn.kind === "typed_handoff") {
        if (!model) throw new Error("description_evaluation_missing_model_result");
        const handoff = object.parse(turn.handoff), actual = foodAssessmentHandoffSchema.parse({ needs: [handoff.need], answers: model.result.proposedAnswers });
        const checks: { code: string; passed: boolean; severity: "critical" | "quality" }[] = [
          { code: "terminal_answers", passed: isDeepStrictEqual(actual, oracle.current.handoff), severity: "quality" },
          { code: "only_ready_uncovered_need", passed: readyFoodDescriptionNeeds(model.result).includes(actual.needs[0]), severity: "critical" },
        ];
        if (oracle.current.partialHandoff === true) checks.push({ code: "partial_handoff_preserves_pending_food", passed: model.result.state === "needs_clarification"
          && isDeepStrictEqual(model.result.questionIds, oracle.current.remainingQuestionIds) && actual.needs.every(need => need !== "food_now"), severity: "critical" });
        turns.push({ turn: index + 1, kind: turn.kind, status: "typed_handoff_schema_checked", actual, pendingQuestionIds: model.result.questionIds,
          noRequestOrMandateCreated: true, checks, ...oracle });
      } else if (["manual_exit", "open_existing_request"].includes(turn.kind)) {
        const target = z.string().parse(oracle.current.target);
        const allowed = target === "/get-support" || target === "https://www.phila.gov/food/" || target === "/my-support" || target === "https://www.feedingamerica.org/need-help-find-food" || /^\/support\/[0-9a-f-]{36}$/.test(target) && availableOwnedRequests.some(request=>target===`/support/${request.requestId}`);
        turns.push({ turn: index + 1, kind: turn.kind, status: "fixed_manual_target_checked", target, checks:[{code:"fixed_owned_or_public_target",passed:allowed,severity:"critical"}], noProviderCalls: true, noRequestOrMandateCreated: true, ...oracle });
      } else throw new Error("description_evaluation_unknown_turn");
    } catch {
      failed = true; options.budget.halt(); turns.push({ turn: index + 1, kind: turn.kind, status: "failed_or_unknown", ...oracle });
    }
    const last=turns[turns.length-1];if(Array.isArray(last.checks)&&last.checks.some(check=>!check.passed&&check.severity==="critical")){failed=true;options.budget.halt();}
  }
  const transcripts:(Record<string,unknown>&{oracleCoverage:{automaticallyCheckedFields:string[];retainedUnmeasuredFields:string[];remainingEvidence:string}})[]=turns.map(turn=>{
    const current=object.parse(turn.current),codes=new Set(Array.isArray(turn.checks)?turn.checks.map(check=>check.code):[]);
    const mapped:Record<string,string>={no_execution_granted:"executionGranted",selected_programs_grounded:"allowedProgramIdsByNeed",existing_owned_requests:"existingRequests",out_of_scope:"outOfScope",old_result_rejected:"oldResultUsable",partial_handoff_preserves_pending_food:"remainingQuestionIds",terminal_answers:"handoff",fixed_owned_or_public_target:"target"};
    const checked=new Set([...codes].map(code=>mapped[code]??(code==="questionIds"&&"remainingQuestionIds" in current?"remainingQuestionIds":code)));
    return{...turn,oracleCoverage:{automaticallyCheckedFields:Object.keys(current).filter(field=>checked.has(field)),retainedUnmeasuredFields:Object.keys(current).filter(field=>!checked.has(field)),remainingEvidence:"Native authority/start/provider proof and human semantic/bilingual review remain separate; retained unmeasured fields are not passes."}};
  });
  return { id: item.id, language: item.language, turns:transcripts, criticalFailure:failed, qualityFailures:turns.flatMap(turn=>Array.isArray(turn.checks)?turn.checks:[]).filter(check=>check.severity==="quality"&&!check.passed).length, humanReview: "pending", modelQualityApproved: false };
}
