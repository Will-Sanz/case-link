import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { buildFoodDescriptionProjection, carryFoodDescriptionFacts, foodDescriptionContextSchema, foodDescriptionSelectionSchema, foodDescriptionInputSchema, reconcileFoodDescriptionRequests, validateFoodDescriptionSelection, type FoodDescriptionContext } from "../src/lib/parent/food-description";
import { foodAssessmentHandoffSchema, foodAssessmentSchema } from "../src/lib/parent/food-assessment";
import { FOOD_DESCRIPTION_EVALUATION_BINDING, FOOD_DESCRIPTION_FINGERPRINT } from "../src/lib/parent/food-description-runtime";
import { FOOD_DESCRIPTION_CORPUS_SHA, descriptionEvaluationHash } from "./food-description-evaluation-budget";

export const DESCRIPTION_EVALUATION_NOW = "2026-11-18T12:00:00Z";
const owner = "00000000-0000-4000-8000-000000000001", other = "00000000-0000-4000-8000-000000000002";
const object = z.record(z.string(), z.unknown());
const turnSchema = object.and(z.object({ kind: z.string(), modelCalls: z.number().int().min(0).max(1).optional() }));
const caseSchema = z.object({ id: z.string().regex(/^description-[a-z0-9_-]+$/), language: z.enum(["en", "es"]), synthetic: z.literal(true), fixtureOwner: z.literal("owner_a"),
  initialOwnedHistory: z.array(object), turns: z.array(turnSchema).length(4), humanReview: z.literal("pending") }).passthrough();
const corpusSchema = z.object({ caseCount: z.literal(60), turnCount: z.literal(240), maximumModelCalls: z.literal(80), zeroCallGuardCases: z.literal(24),
  cases: z.array(caseSchema).length(60), blockedCases: z.array(z.object({ id: z.string(), language: z.enum(["en", "es"]), description: z.string() }).passthrough()).length(24) }).passthrough();
export type DescriptionEvaluationCase = z.infer<typeof caseSchema>;
const record = (value: unknown) => object.parse(value);
const array = (value: unknown) => z.array(object).parse(value);
const answers = z.object(foodAssessmentSchema.shape).partial().strict();

export function loadDescriptionEvaluationCorpus(path = "tests/fixtures/parent/food-description-2026-11-18.v3.json") {
  const bytes = readFileSync(path);
  if (createHash("sha256").update(bytes).digest("hex") !== FOOD_DESCRIPTION_CORPUS_SHA) throw new Error("description_evaluation_corpus_changed");
  const corpus = corpusSchema.parse(JSON.parse(bytes.toString("utf8")));
  if (new Set(corpus.cases.map(item => item.id)).size !== 60 || corpus.cases.filter(item => item.language === "en").length !== 30
    || corpus.cases.reduce((n, item) => n + item.turns.reduce((a, turn) => a + (turn.modelCalls ?? 0), 0), 0) !== 80) throw new Error("description_evaluation_denominator_changed");
  return corpus;
}
function history(values: unknown): FoodDescriptionContext["history"] {
  return array(values).map(value => foodDescriptionContextSchema.shape.history.element.parse({ ownerId: owner, requestId: value.requestId, requestVersion: value.requestVersion ?? 1,
    requestStatus: value.requestStatus, need: value.need, state: value.state ?? value.operationState, current: value.current ?? true }));
}
/** This mirrors the existing three-field queue port; ZIP/profile material is not sent by this purpose. */
function routingFacts(values: unknown): FoodDescriptionContext["facts"] {
  const supplied = record(values), result: FoodDescriptionContext["facts"] = {};
  for (const field of ["foodForTwoDays", "benefitHistory", "existingIssue"] as const) {
    if (!supplied[field]) continue;
    const value = record(supplied[field]), confirmedAt = z.iso.datetime({ offset: true }).parse(value.confirmedAt);
    const expiresAt = new Date(Math.min(Date.parse(confirmedAt) + 86400000, Date.parse(DESCRIPTION_EVALUATION_NOW) + 86400000)).toISOString();
    Object.assign(result, { [field]: { value: value.value, source: "parent_typed", confirmedAt, expiresAt } });
  }
  return foodDescriptionContextSchema.shape.facts.parse(result);
}
export function descriptionEvaluationContext(item: DescriptionEvaluationCase): FoodDescriptionContext {
  const input = record(item.turns[0].input);
  return foodDescriptionContextSchema.parse({ expectedOwnerId: owner, ownerId: owner, expectedRevision: 1, revision: 1, catalogVersion: FOOD_DESCRIPTION_FINGERPRINT,
    capabilityVersion: "synthetic-description-evaluation.v6", facts: routingFacts(input.explicitRoutingFacts), history: history(item.initialOwnedHistory),
    programIds: ["philly-food", "share-community-fridge-19129", "snap-pa", "uesf-benefits"], capabilities: [], excludedNeedIds: [] });
}
export function descriptionEvaluationInput(item: DescriptionEvaluationCase, index: number) {
  const turn = item.turns[index];
  return foodDescriptionInputSchema.parse(index === 0 ? { description: record(turn.input).description, screenLocale: item.language } : { description: turn.description, screenLocale: item.language });
}
export function descriptionEvaluationCurrentRequests(context: FoodDescriptionContext) {
  return context.history.filter(value => context.ownerId===context.expectedOwnerId && value.ownerId===context.ownerId && value.current && ["active", "paused"].includes(value.requestStatus)).map(value => ({ ownerId: value.ownerId, requestId: value.requestId,
    requestVersion: value.requestVersion, requestStatus: value.requestStatus, needIds: [value.need], pendingSnapFollowUp: false }));
}
export function descriptionEvaluationResult(projection: ReturnType<typeof buildFoodDescriptionProjection>, selection: unknown, context: FoodDescriptionContext) {
  return reconcileFoodDescriptionRequests(validateFoodDescriptionSelection({ projection, selection, currentContext: context, now: new Date(DESCRIPTION_EVALUATION_NOW) }), descriptionEvaluationCurrentRequests(context), context.ownerId);
}
export type DescriptionEvaluationResult = ReturnType<typeof descriptionEvaluationResult>;

/** Expected output is never used to construct a projection or a model assertion. */
export function descriptionEvaluationOracle(item: DescriptionEvaluationCase, index: number) {
  const archived = record(item.turns[index].expected ?? item.turns[index]), current = { ...archived }, differences: string[] = [];
  if (/^description-(new_snap-(1|3)|renewal-3|pending-3|benefit_problem-3|owned_history-3)-(en|es)$/.test(item.id) && index < 3) {
    current.excludedNeedIds = [];
    differences.push("These descriptions report food inventory and benefit intent without declining food help; enough food is not an opt-out, including after a later correction.");
  }
  if (index === 0) {
    differences.push("Archived ZIP stays at the typed handoff boundary; it is absent from the actual model DTO.");
    if (["description-ambiguity-3-en", "description-ambiguity-3-es"].includes(item.id)) {
      current.questionIds = ["foodForTwoDays"];
      differences.push("The description explicitly supplies unknown SNAP history; honor that Not sure answer without asking the same benefit question again.");
    }
    if (["description-urgent-2-en", "description-urgent-2-es"].includes(item.id)) {
      current.state = "proposal"; current.questionIds = [];
      differences.push("The description explicitly supplies unknown SNAP history alongside current food need; preserve Not sure without repeating that answered benefit question.");
    }
    if (item.id.startsWith("description-choice_and_scope-3-")) {
      current.state = "needs_clarification"; current.questionIds = ["foodForTwoDays"]; current.urgency = null;
      differences.push("Wanting a food site today does not establish the household's two-day food supply; retain the necessary food question without inventing a shortage.");
    }
    if (z.array(z.unknown()).parse(current.questionIds).includes("foodForTwoDays") && !z.array(z.string()).parse(current.needIds).includes("food_now")) {
      current.needIds = ["food_now", ...z.array(z.string()).parse(current.needIds)];
      current.allowedProgramIdsByNeed = { ...record(current.allowedProgramIdsByNeed ?? {}), food_now: [] };
      differences.push("An unanswered food question retains compatible provisional food help; unknown supply is not No, urgency, a program action or a raw-model nomination success.");
    }
    if (z.array(z.unknown()).parse(record(item.turns[0].input).excludedNeeds).length) differences.push("Archived excludedNeeds is not a public queue input; source-anchored exclusions and the explicit terminal choice remain authoritative.");
    if (archived.state === "outside_supported_geography") {
      current.state = "manual"; current.outOfScope = "outside_pa";
      differences.push("Current strict selection uses manual/outside_pa for explicit unsupported geography, not an invented state or eligibility finding.");
    }
  }
  if (archived.state === "open_existing" && index < 2) {
    current.needIds = []; current.existingRequests = descriptionEvaluationCurrentRequests(descriptionEvaluationContext(item)).map(({ requestId, needIds }) => ({ requestId, needIds }));
    differences.push("Covered SNAP moves from proposed needIds into owned existingRequests; no new/resumed mandate.");
  }
  if (index === 1 && /^description-owned_history-(1|3)-/.test(item.id)) {
    current.answers = { ...record(current.answers), benefitHistory: "not_sure" };
    differences.push("The owned submitted request supplies routing coverage, not a parent-provided history assertion; no supplied answer or clear initial source establishes applied.");
  }
  if ((index === 0 || item.turns[index].modelCalls === 1) && archived.allowedProgramIdsByNeed) {
    const input = descriptionEvaluationInput(item, index), projected = buildFoodDescriptionProjection(input, descriptionEvaluationContext(item), new Date(DESCRIPTION_EVALUATION_NOW));
    const allowed = record(current.allowedProgramIdsByNeed);
    current.allowedProgramIdsByNeed = Object.fromEntries(Object.keys(allowed).map(need => [need, projected.candidates.filter(candidate => candidate.need === need).map(candidate => candidate.programId)]));
    if (descriptionEvaluationHash(current.allowedProgramIdsByNeed) !== descriptionEvaluationHash(allowed)) differences.push("The actual reviewed catalog includes the public Share access route; this is a grounded proposal only, with no stock/reservation/eligibility claim.");
  }
  if (item.turns[index].kind === "typed_handoff") {
    const handoff = record(item.turns[index].handoff);
    current.handoff = foodAssessmentHandoffSchema.parse({ needs: [handoff.need], answers: handoff.answers });
    current.complementaryStartSupported=true;
    differences.push("Explicit singular archived choice maps to needs:[choice]; complementary starts are now supported, while this chosen single terminal leaves the other need unstarted under its own mandate.");
  }
  if (["description-untrusted_and_sources-3-en", "description-untrusted_and_sources-3-es"].includes(item.id) && index >= 2) {
    const truthful = { foodForTwoDays: "yes", benefitHistory: "denied", existingIssue: null };
    if (index === 2) current.answers = truthful;
    else current.handoff = foodAssessmentHandoffSchema.parse({ needs: ["snap_problem"], answers: truthful });
    differences.push("A parent-reported denial notice routes to the existing SNAP problem journey without inventing received benefits or an agency-verified decision.");
  }
  if(item.turns[index].kind==="manual_exit"&&current.target==="https://www.feedingamerica.org/find-your-local-foodbank"){
    current.target="https://www.feedingamerica.org/need-help-find-food";differences.push("Use the actual existing FoodSites public fallback URL; discovery is not an allocation, reservation or program action.");
  }
  if (item.turns[index].kind === "change_state_and_revalidate" && record(item.turns[index].changes).routing) {
    current.modelResultUsable = true; current.requiredTypedFields = ["zip"];
    differences.push("ZIP is not model context in this purpose; expiry is checked at the actual typed handoff/start, not by pretending the model projection changed.");
  }
  if (item.turns[index].kind === "edit_description_and_interpret_revision") {
    const typed=applyDescriptionEvaluationAnswers(descriptionEvaluationContext(item),item.turns[1].suppliedAnswers??{});
    current.resultRevision=typed.revision+1;
    if(current.resultRevision!==archived.resultRevision)differences.push("Actual zero-call clarification already advanced the owned revision; the explicit edit advances that current revision again without renewing its original deadline.");
  }
  if (index === 2 && item.id.startsWith("description-pending-3-")) {
    current.state = "manual";
    differences.push("Enough food, benefits in use and no current issue leave no proposed new action; My support remains the declared exit.");
  }
  if (index === 2 && item.id.startsWith("description-owned_history-3-")) {
    current.state = "open_existing"; current.needIds = [];
    current.existingRequests = descriptionEvaluationCurrentRequests(descriptionEvaluationContext(item)).map(({ requestId, needIds }) => ({ requestId, needIds }));
    differences.push("The corrected pending intent is already covered by the same owned active application; open that request without a duplicate proposal or resumed mandate.");
  }
  if (item.id.startsWith("description-choice_and_scope-3-") && index > 0) {
    if (current.answers) current.answers = { ...record(current.answers), foodForTwoDays: "not_sure" };
    if ("urgency" in current) current.urgency = null;
    if (index === 1) { current.remainingQuestionIds = ["foodForTwoDays"]; current.requiresTypedTiming = true; }
    if (index === 2) { current.state = "needs_clarification"; current.questionIds = ["foodForTwoDays"]; }
    if (index === 3) {
      const handoff = record(current.handoff);
      current.handoff = foodAssessmentHandoffSchema.parse({ ...handoff, answers: { ...record(handoff.answers), foodForTwoDays: "not_sure" } });
      current.partialHandoff = true; current.remainingQuestionIds = ["foodForTwoDays"];
      current.nativeActionEvidence = "The selected SNAP-only path does not require food inventory. UI/API and embedded SQL readiness are checked separately; this schema check creates no request, mandate or provider action.";
    }
    differences.push("No supplied answer or later source establishes two-day food supply; retain its question for food work while the independently ready chosen SNAP-only path uses unknown inventory, without a fabricated typed Not sure.");
  }
  return { archived, current, differences };
}
/** Fixed synthetic attempt time, not a fabricated real-parent confirmation. Actual SQL uses immutable call.created_at. */
export function carryDescriptionEvaluationFacts(context: FoodDescriptionContext, projection: ReturnType<typeof buildFoodDescriptionProjection>, selection: unknown): FoodDescriptionContext {
  return foodDescriptionContextSchema.parse({ ...context, facts: carryFoodDescriptionFacts({ facts: context.facts, projection, selection,
    sourceAttemptCreatedAt: DESCRIPTION_EVALUATION_NOW, contentExpiresAt: "2026-11-19T12:00:00.000Z", now: new Date(DESCRIPTION_EVALUATION_NOW) }) });
}
// Immutable input annotations are source files, rehashed by the dispatch manifest; parse them once rather than rebuilding the corpus for every budget check.
const sourceAnnotations = z.object({ version: z.literal("food-description-input-source-facts.v1"), cases: z.array(z.object({ id: z.string(), descriptionSha256: z.string().regex(/^[a-f0-9]{64}$/),
    assertions: z.array(z.object({ questionId: z.enum(["foodForTwoDays", "benefitHistory", "existingIssue"]), value: z.string(), text: z.string().min(1).max(500) }).strict()).max(3) }).strict()).length(20) }).strict()
    .parse(JSON.parse(readFileSync("tests/fixtures/parent/food-description-source-facts-2026-11-18.v1.json", "utf8")));
const annotatedCaseIds = loadDescriptionEvaluationCorpus().cases.filter(value => value.turns.slice(1).some(turn => turn.modelCalls === 1)).map(value => value.id);
if (new Set(sourceAnnotations.cases.map(value => value.id)).size !== 20 || sourceAnnotations.cases.some(value => !annotatedCaseIds.includes(value.id))) throw new Error("description_evaluation_source_annotations_changed");
function plannedSourceAssertions(item: DescriptionEvaluationCase) {
  const source = sourceAnnotations.cases.find(value => value.id === item.id), description = descriptionEvaluationInput(item, 0).description;
  if (!source || source.descriptionSha256 !== createHash("sha256").update(description).digest("hex")) throw new Error("description_evaluation_source_annotations_changed");
  return foodDescriptionSelectionSchema.parse({ needIds: [], selections: [], exclusions: [], questionIds: [], outOfScope: null,
    assertions: source.assertions.map(({ text, ...assertion }) => {
      const start = description.indexOf(text);
      if (start < 0 || start !== description.lastIndexOf(text)) throw new Error("description_evaluation_source_annotations_changed");
      return { ...assertion, span: { start, end: start + text.length, text } };
    }) });
}
export function descriptionEvaluationPlannedProjection(item:DescriptionEvaluationCase,index:number){
  let context=descriptionEvaluationContext(item);
  if(index>0){
    const original=buildFoodDescriptionProjection(descriptionEvaluationInput(item,0),context,new Date(DESCRIPTION_EVALUATION_NOW)), supplied=record(item.turns[1].suppliedAnswers??{});
    let selection=plannedSourceAssertions(item);
    const sourceFacts=Object.keys(supplied).length?carryDescriptionEvaluationFacts(context,original,selection):context, next=applyDescriptionEvaluationAnswers(sourceFacts,supplied);
    if(next.revision!==context.revision){context=next;selection={...selection,assertions:selection.assertions.filter(assertion=>!context.facts[assertion.questionId])};}
    context=carryDescriptionEvaluationFacts(context,original,selection);context={...context,revision:context.revision+1,expectedRevision:context.revision+1};
  }
  return buildFoodDescriptionProjection(descriptionEvaluationInput(item,index),context,new Date(DESCRIPTION_EVALUATION_NOW));
}
export function descriptionEvaluationPlan(corpus = loadDescriptionEvaluationCorpus()) {
  const cases = corpus.cases.map(item => ({ id: item.id, language: item.language, turns: item.turns.map((turn, index) => ({ turn: index + 1, kind: turn.kind,
    maximumModelCalls: turn.modelCalls ?? 0, ...descriptionEvaluationOracle(item, index),
    ...(turn.modelCalls===1?{projection:descriptionEvaluationPlannedProjection(item,index),requestSha256:descriptionEvaluationHash({...FOOD_DESCRIPTION_EVALUATION_BINDING.request,input:[{role:"user",content:JSON.stringify(descriptionEvaluationPlannedProjection(item,index))}]})}:{}),
    authorityBoundary: turn.kind === "change_state_and_revalidate" && ["processing", "draft", "identity", "routing", "history"].some(key => key in record(turn.changes)) ? "actual SQL/Auth/start proof required separately; never a model quality pass" : null })) }));
  return { version:"food-description-evaluation-wrapper-2026-11-18.v7", corpusSha256: FOOD_DESCRIPTION_CORPUS_SHA, cases, caseCount: 60, turnCount: 240, maximumModelCalls: 80, zeroCallGuardCases: 24,
    languageCounts: { en: 30, es: 30 }, modelFingerprint: FOOD_DESCRIPTION_FINGERPRINT, logicalNow: DESCRIPTION_EVALUATION_NOW };
}
export function descriptionEvaluationAdapterHash() {
  const plan=descriptionEvaluationPlan(),saved=JSON.parse(readFileSync("tests/fixtures/parent/food-description-2026-11-18.v19-adapter.json","utf8"));
  if(descriptionEvaluationHash(saved)!==descriptionEvaluationHash(plan))throw new Error("description_evaluation_adapter_changed");
  return descriptionEvaluationHash(plan);
}

export function applyDescriptionEvaluationAnswers(context: FoodDescriptionContext, supplied: unknown, confirmedAt=DESCRIPTION_EVALUATION_NOW): FoodDescriptionContext {
  if(!Number.isFinite(Date.parse(confirmedAt))||Date.parse(confirmedAt)>Date.parse(DESCRIPTION_EVALUATION_NOW))throw new Error("description_evaluation_invalid_fact_time");
  const values = answers.parse(supplied), next = structuredClone(context);
  for (const [field, value] of Object.entries(values)) {
    if (value === null || next.facts[field as keyof typeof next.facts]?.value === value && next.facts[field as keyof typeof next.facts]?.source !== "parent_description") continue;
    Object.assign(next.facts, { [field]: { value, source: "parent_typed", confirmedAt, expiresAt: new Date(Math.min(Date.parse(confirmedAt)+86400000,Date.parse(DESCRIPTION_EVALUATION_NOW)+86400000)).toISOString() } });
  }
  if (values.benefitHistory && values.benefitHistory !== "receiving") delete next.facts.existingIssue;
  if (JSON.stringify(next.facts) !== JSON.stringify(context.facts)) next.revision = next.expectedRevision = context.revision + 1;
  return foodDescriptionContextSchema.parse(next);
}
/** These are actual pure guard calls; SQL-only gates are reported as not measured by this runner. */
export function revalidateDescriptionEvaluationChange(item: DescriptionEvaluationCase, projection: ReturnType<typeof buildFoodDescriptionProjection>, selection: unknown, context: FoodDescriptionContext) {
  const changes = record(item.turns[2].changes), next = structuredClone(context), boundary = ["processing", "draft", "routing"].find(key => key in changes);
  if (boundary) return { status: "requires_native_evidence" as const, boundary, archived: item.turns[2].expected };
  if (changes.identity) {
    const identity = record(changes.identity);
    if (identity.accountActive === false) return { status: "requires_native_evidence" as const, boundary: "account", archived: item.turns[2].expected };
    next.ownerId = identity.owner === "owner_a" ? owner : other;
  }
  if (changes.catalog) next.catalogVersion = String(record(changes.catalog).version);
  if (changes.capabilities) next.capabilityVersion = String(record(changes.capabilities).version);
  if (changes.history) {
    next.history = history(changes.history);
    const current = buildFoodDescriptionProjection({ description: projection.description, screenLocale: projection.screenLocale }, next, new Date(DESCRIPTION_EVALUATION_NOW));
    // Reusing an unchanged interpretation never reuses a cancelled request's execution scope.
    if (descriptionEvaluationHash(current) === descriptionEvaluationHash(projection)) return { status: "requires_native_evidence" as const, boundary: "request_scope", availableOwnedRequests: descriptionEvaluationCurrentRequests(next), archived: item.turns[2].expected };
  }
  if (changes.routingFacts) {
    const facts = record(changes.routingFacts), supplied=answers.parse(Object.fromEntries(["foodForTwoDays","benefitHistory","existingIssue"].filter(key=>key in facts).map(key=>[key,facts[key]])));
    return { status: "typed_reassessment_required" as const, supplied, confirmedAt:facts.confirmedAt, archived: item.turns[2].expected };
  }
  try { validateFoodDescriptionSelection({ projection, selection, currentContext: next, now: new Date(DESCRIPTION_EVALUATION_NOW) }); return { status: "stale_guard_failed" as const, archived: item.turns[2].expected }; }
  catch { return { status: "old_result_rejected" as const, availableOwnedRequests:descriptionEvaluationCurrentRequests(next), archived: item.turns[2].expected }; }
}
