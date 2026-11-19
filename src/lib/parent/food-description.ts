import { z } from "zod";
import { hasExcludedAssistantInformation } from "./assistant-contract";
import { actionSchema, needSchema, outcomeSchema } from "./domain";
import { assessFoodSupport, foodAssessmentQuestionReasons, foodAssessmentSchema, type FoodAssessmentAnswers, type FoodRecommendation } from "./food-assessment";
import { getProgramsForNeeds, programRoutingIssue, supportsInitialServiceDelivery } from "./programs";

// Passing these guards is not permission to collect prose or call a processor; durable callers have separate closed gates.
export const foodDescriptionNeedSchema = needSchema.extract(["food_now", "snap_new", "snap_pending", "snap_renewal", "snap_problem"]);
const programId = z.enum(["philly-food", "share-community-fridge-19129", "snap-pa", "uesf-benefits"]);
const questionId = z.enum(Object.keys(foodAssessmentQuestionReasons) as (keyof typeof foodAssessmentQuestionReasons)[]);
const timestamp = z.iso.datetime({ offset: true });
const revision = z.number().int().positive().max(2147483647);
const unique = <T,>(values: T[]) => new Set(values).size === values.length;
const reasons: Record<z.infer<typeof foodDescriptionNeedSchema>, FoodRecommendation["reason"]> = {
  food_now: "immediate", snap_new: "new", snap_pending: "pending", snap_renewal: "renewal", snap_problem: "problem",
};

/** Defense in depth, including known English/Spanish exclusions; it cannot certify arbitrary text safe. */
export function hasExcludedFoodDescriptionInformation(value: string): boolean {
  const text = value.normalize("NFKD").replace(/\p{M}|[\u200B-\u200D\u2060\uFEFF]/gu, "");
  return hasExcludedAssistantInformation(text)
    || /\b(?:contrasena|clave|pin|seguro social|numero de cuenta|fecha de nacimiento|password|passcode|signature|firma)\b/i.test(text)
    || /\b(?:pregnan\w*|embaraz\w*|postpartum|posparto|breastfeed\w*|lactan\w*|medical|medic[oa]s?|diagnos\w*|diabet\w*)\b/i.test(text)
    || /\b(?:my name is|me llamo|mi nombre es|my child.{0,30}(?:named|born)|mi hij[oa].{0,30}(?:llama|nacio))\b/i.test(text)
    || /\b(?:full text|texto completo|private.{0,30}document|documento privado)\b/i.test(text)
    || /\b(?:peco|pgw|utility|electricity|water|gas|luz|agua)\b.{0,80}\b(?:account|bill|owe|shutoff|cuenta|factura|debo|corte)\b/i.test(text)
    || /[$€£]\s*\d|\b\d{4}-\d{2}-\d{2}\b/.test(text);
}
export const foodDescriptionInputSchema = z.object({
  description: z.string().max(500).trim().min(1).refine(value => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value) && !hasExcludedFoodDescriptionInformation(value), "parent_food_description_private_input"),
  screenLocale: z.enum(["en", "es"]),
}).strict();
export type FoodDescriptionInput = z.infer<typeof foodDescriptionInputSchema>;
const provenance = {
  source: z.enum(["parent_typed", "family_profile"]), confirmedAt: timestamp, expiresAt: timestamp,
  descriptionUsePermitted: z.boolean().optional(),
};
const descriptionProvenance = { source: z.literal("parent_description"), sourceRevision: revision, sourceAttemptCreatedAt: timestamp, expiresAt: timestamp };
const ordinaryFact = <T extends z.ZodType>(value: T) => z.union([z.object({ value, ...provenance }).strict(), z.object({ value, ...descriptionProvenance }).strict()]);
const factsSchema = z.object({
  foodForTwoDays: ordinaryFact(foodAssessmentSchema.shape.foodForTwoDays).optional(),
  benefitHistory: ordinaryFact(foodAssessmentSchema.shape.benefitHistory).optional(),
  existingIssue: ordinaryFact(foodAssessmentSchema.shape.existingIssue.unwrap()).optional(),
  zip: z.object({ value: z.string().regex(/^\d{5}$/), ...provenance }).strict().optional(),
}).strict();
const historySchema = z.object({
  ownerId: z.uuid(), requestId: z.uuid(), requestVersion: revision,
  requestStatus: z.enum(["active", "paused", "cancelled", "closed"]),
  need: foodDescriptionNeedSchema.exclude(["food_now"]), state: outcomeSchema, current: z.boolean(),
}).strict();
/** Trusted, owned server context, never a public request body. Actual permission/DB checks remain required. */
export const foodDescriptionContextSchema = z.object({
  expectedOwnerId: z.uuid(), ownerId: z.uuid(), expectedRevision: revision, revision,
  catalogVersion: z.string().regex(/^[a-zA-Z0-9._:-]{1,100}$/), capabilityVersion: z.string().regex(/^[a-zA-Z0-9._:-]{1,100}$/),
  facts: factsSchema, history: z.array(historySchema).max(20),
  programIds: z.array(programId).max(4).refine(unique),
  capabilities: z.array(z.object({ programId, enabled: z.boolean(), actions: z.array(actionSchema).max(6).refine(unique) }).strict()).max(4)
    .refine(values => unique(values.map(value => value.programId))),
  excludedNeedIds: z.array(foodDescriptionNeedSchema).max(5).refine(unique),
}).strict();
export type FoodDescriptionContext = z.infer<typeof foodDescriptionContextSchema>;
const spanSchema = z.object({ start: z.number().int().nonnegative().max(499), end: z.number().int().positive().max(500), text: z.string().min(1).max(500) }).strict();
const assertionSchema = z.discriminatedUnion("questionId", [
  z.object({ questionId: z.literal("foodForTwoDays"), value: foodAssessmentSchema.shape.foodForTwoDays, span: spanSchema }).strict(),
  z.object({ questionId: z.literal("benefitHistory"), value: foodAssessmentSchema.shape.benefitHistory, span: spanSchema }).strict(),
  z.object({ questionId: z.literal("existingIssue"), value: foodAssessmentSchema.shape.existingIssue.unwrap(), span: spanSchema }).strict(),
]);
export const foodDescriptionSelectionSchema = z.object({
  needIds: z.array(foodDescriptionNeedSchema).max(5).refine(unique),
  selections: z.array(z.object({ need: foodDescriptionNeedSchema, programId, reason: z.enum(["immediate", "new", "pending", "renewal", "problem"]) }).strict()).max(10)
    .refine(values => unique(values.map(value => `${value.need}:${value.programId}`))),
  assertions: z.array(assertionSchema).max(3).refine(values => unique(values.map(value => value.questionId))),
  exclusions: z.array(z.object({ need: foodDescriptionNeedSchema, span: spanSchema }).strict()).max(5).refine(values => unique(values.map(value => value.need))),
  questionIds: z.array(questionId).max(3).refine(unique),
  outOfScope: z.enum(["wic", "utilities", "other"]).nullable(),
}).strict();

function currentFacts(facts: FoodDescriptionContext["facts"], now: Date) {
  return Object.fromEntries(Object.entries(facts).filter(([, fact]) => {
    const suppliedAt = Date.parse(fact.source === "parent_description" ? fact.sourceAttemptCreatedAt : fact.confirmedAt);
    return suppliedAt <= now.getTime() && Date.parse(fact.expiresAt) > now.getTime() && (fact.source !== "parent_description" || Date.parse(fact.expiresAt) <= suppliedAt + 86400000)
      && (fact.source !== "family_profile" || fact.descriptionUsePermitted === true);
  })) as FoodDescriptionContext["facts"];
}
function checkedContext(value: unknown, now: Date) {
  const context = foodDescriptionContextSchema.parse(value);
  if (!Number.isFinite(now.getTime()) || context.ownerId !== context.expectedOwnerId || context.revision !== context.expectedRevision
    || context.history.some(item => item.ownerId !== context.ownerId)) throw new Error("parent_food_description_changed");
  return context;
}

/** Only this minimized value may eventually become model input; no IDs, raw history, URLs or private profile fields. */
export function buildFoodDescriptionProjection(input: unknown, trustedContext: unknown, now: Date) {
  const description = foodDescriptionInputSchema.parse(input), context = checkedContext(trustedContext, now);
  const facts = currentFacts(context.facts, now), zip = facts.zip?.value;
  const candidates = foodDescriptionNeedSchema.options.flatMap(need => getProgramsForNeeds([need])
    .filter(program => context.programIds.includes(program.id as z.infer<typeof programId>) && !programRoutingIssue(program, zip, now))
    .map(program => ({ need, programId: program.id as z.infer<typeof programId>, sourceCheckedAt: program.sourceCheckedAt,
      actions: context.capabilities.filter(capability => capability.programId === program.id && capability.enabled)
        .flatMap(capability => capability.actions).filter(action => supportsInitialServiceDelivery(need, action)).sort() })));
  return {
    ...description, revision: context.revision, catalogVersion: context.catalogVersion, capabilityVersion: context.capabilityVersion,
    routingFacts: facts,
    ownedFoodHistory: context.history.filter(item => item.current).map(({ need, state, current }) => ({ need, state, current }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    candidates, questionReasons: foodAssessmentQuestionReasons, excludedNeedIds: context.excludedNeedIds,
  };
}
export type FoodDescriptionProjection = ReturnType<typeof buildFoodDescriptionProjection>;
export const foodDescriptionProjectionSchema = foodDescriptionInputSchema.extend({
  revision, catalogVersion: foodDescriptionContextSchema.shape.catalogVersion, capabilityVersion: foodDescriptionContextSchema.shape.capabilityVersion,
  routingFacts: factsSchema,
  ownedFoodHistory: z.array(z.object({ need: foodDescriptionNeedSchema.exclude(["food_now"]), state: outcomeSchema, current: z.boolean() }).strict()).max(20),
  candidates: z.array(z.object({ need: foodDescriptionNeedSchema, programId, sourceCheckedAt: z.iso.date(), actions: z.array(actionSchema).max(6) }).strict()).max(20),
  questionReasons: z.object({ foodForTwoDays: z.literal(foodAssessmentQuestionReasons.foodForTwoDays), benefitHistory: z.literal(foodAssessmentQuestionReasons.benefitHistory), existingIssue: z.literal(foodAssessmentQuestionReasons.existingIssue) }).strict(),
  excludedNeedIds: z.array(foodDescriptionNeedSchema).max(5).refine(unique),
}).strict();

/** Only validated assertions from this same immutable source attempt may join a later draft revision. */
export function carryFoodDescriptionFacts(input: { projection: FoodDescriptionProjection; selection: unknown; facts: FoodDescriptionContext["facts"];
  sourceAttemptCreatedAt: string; contentExpiresAt: string; now: Date }): FoodDescriptionContext["facts"] {
  const projection = foodDescriptionProjectionSchema.parse(input.projection), selection = foodDescriptionSelectionSchema.parse(input.selection);
  const facts = currentFacts(factsSchema.parse(input.facts), input.now), suppliedAt = Date.parse(timestamp.parse(input.sourceAttemptCreatedAt));
  const expiresAt = Math.min(Date.parse(timestamp.parse(input.contentExpiresAt)), suppliedAt + 86400000);
  if (suppliedAt > input.now.getTime() || expiresAt <= input.now.getTime()) return facts;
  for (const assertion of selection.assertions) {
    const { questionId: field, span } = assertion, original = projection.routingFacts[field], current = facts[field];
    if (span.end <= span.start || span.end > projection.description.length || projection.description.slice(span.start, span.end) !== span.text) throw new Error("parent_food_description_unverified_selection");
    if (projection.description.indexOf(span.text) !== projection.description.lastIndexOf(span.text)) continue;
    if (original && original.source !== "parent_description" && original.value !== "not_sure") continue;
    if (current && current.source !== "parent_description" && current.value !== "not_sure" || current?.value === assertion.value) continue;
    Object.assign(facts, { [field]: { value: assertion.value, source: "parent_description", sourceRevision: projection.revision,
      sourceAttemptCreatedAt: input.sourceAttemptCreatedAt, expiresAt: new Date(expiresAt).toISOString() } });
  }
  if (facts.benefitHistory?.value !== "receiving") delete facts.existingIssue;
  return facts;
}


/** Span checks anchor an interpretation, not its semantic quality. That requires the still-unapproved measured evaluation. */
export function validateFoodDescriptionSelection(input: {
  projection: FoodDescriptionProjection; selection: unknown; currentContext: unknown; now: Date;
}) {
  const { now } = input, projection = foodDescriptionProjectionSchema.parse(input.projection), context = checkedContext(input.currentContext, now);
  const current = buildFoodDescriptionProjection({ description: projection.description, screenLocale: projection.screenLocale }, context, now);
  if (JSON.stringify(projection) !== JSON.stringify(current)) throw new Error("parent_food_description_changed");
  const selection = foodDescriptionSelectionSchema.parse(input.selection);
  const invalid = () => { throw new Error("parent_food_description_unverified_selection"); };
  for (const { span } of [...selection.assertions, ...selection.exclusions])
    if (span.end <= span.start || span.end > projection.description.length || projection.description.slice(span.start, span.end) !== span.text) invalid();
  const facts = { ...current.routingFacts }, conflicts: (keyof FoodAssessmentAnswers)[] = [];
  const values: Partial<FoodAssessmentAnswers> = Object.fromEntries(Object.entries(facts).filter(([field]) => field !== "zip").map(([field, fact]) => [field, fact.value]));
  for (const assertion of selection.assertions) {
    const field = assertion.questionId;
    if (values[field] !== undefined && values[field] !== "not_sure" && facts[field]?.source !== "parent_description") {
      if (values[field] !== assertion.value) conflicts.push(field);
    } else Object.assign(values, { [field]: assertion.value });
  }
  if (values.benefitHistory !== "receiving" && selection.assertions.some(value => value.questionId === "existingIssue")) invalid();
  const excludedNeedIds = [...new Set([...context.excludedNeedIds, ...selection.exclusions.map(value => value.need)])];
  const answers: FoodAssessmentAnswers = { foodForTwoDays: values.foodForTwoDays ?? "not_sure",
    benefitHistory: values.benefitHistory ?? "not_sure", existingIssue: values.benefitHistory === "receiving" ? values.existingIssue ?? "not_sure" : null };
  const benefitWanted = foodDescriptionNeedSchema.options.some(need => need !== "food_now" && !excludedNeedIds.includes(need))
    && (values.benefitHistory !== undefined || selection.needIds.some(need => need !== "food_now") || selection.questionIds.includes("benefitHistory"));
  const history = context.history.filter(item => item.current), active = history.filter(item => ["active", "paused"].includes(item.requestStatus));
  const applicationHistory = history.filter(item => item.need !== "snap_problem");
  const duplicateBlocked = applicationHistory.some(item => !["checking", "prepared", "withdrawn"].includes(item.state)) || active.some(item => ["snap_new", "snap_pending"].includes(item.need));
  const proposedBenefit = assessFoodSupport(answers).find(item => item.need !== "food_now")?.need;
  const existingRequestIds = benefitWanted ? [...new Set(active.filter(item => item.need === proposedBenefit
    || proposedBenefit === "snap_new" && applicationHistory.some(receipt => receipt.requestId === item.requestId && !["checking", "prepared", "withdrawn"].includes(receipt.state))).map(item => item.requestId))] : [];
  const allowedNeeds = assessFoodSupport(answers).map(value => value.need).filter(need => !excludedNeedIds.includes(need) && !(need === "snap_new" && duplicateBlocked));
  const needIds = allowedNeeds.filter(need => need !== "food_now" || values.foodForTwoDays !== undefined || selection.needIds.includes(need));
  // An existing application takes precedence over a requested duplicate; never revive its prior permission.
  if (selection.needIds.some(need => !allowedNeeds.includes(need) && !(need === "snap_new" && duplicateBlocked))) invalid();
  for (const item of selection.selections)
    if (!selection.needIds.includes(item.need) || item.reason !== reasons[item.need]
      || !current.candidates.some(candidate => candidate.need === item.need && candidate.programId === item.programId)) invalid();
  const questions: z.infer<typeof questionId>[] = [];
  if (!existingRequestIds.length) {
    if (values.foodForTwoDays === undefined && !excludedNeedIds.includes("food_now")) questions.push("foodForTwoDays");
    if (values.benefitHistory === undefined && foodDescriptionNeedSchema.options.some(need => need !== "food_now" && !excludedNeedIds.includes(need))) questions.push("benefitHistory");
    if (values.benefitHistory === "receiving" && values.existingIssue === undefined) questions.push("existingIssue");
    if (selection.needIds.includes("snap_new") && duplicateBlocked && !questions.includes("benefitHistory")) questions.push("benefitHistory");
  }
  if (selection.questionIds.some(id => !questions.includes(id))) invalid();
  const candidates = current.candidates.filter(candidate => needIds.includes(candidate.need));
  return {
    state: existingRequestIds.length ? "open_existing" as const : questions.length ? "needs_clarification" as const : candidates.length ? "proposal" as const : "manual" as const,
    proposedAnswers: answers, originalFacts: facts, assertions: selection.assertions, conflicts,
    needIds, candidates, selections: selection.selections.filter(item => needIds.includes(item.need)),
    questionIds: questions, existingRequestIds, excludedNeedIds, outOfScope: selection.outOfScope,
    proposedUrgency: answers.foodForTwoDays === "no" ? "today" as const : null,
    requiresTypedTiming: answers.foodForTwoDays !== "no", duplicateApplicationBlocked: duplicateBlocked,
    executionGranted: false as const,
  };
}

/** Owned operational coverage stays outside the minimized model input and never resumes or expands a mandate. */
export const foodDescriptionCurrentRequestsSchema = z.array(z.object({
  ownerId: z.uuid(), requestId: z.uuid(), requestVersion: revision, requestStatus: z.enum(["active", "paused", "cancelled", "closed"]),
  needIds: z.array(foodDescriptionNeedSchema).min(1).max(5).refine(unique), pendingSnapFollowUp: z.boolean(),
}).strict().refine(value => !value.pendingSnapFollowUp || ["active", "paused"].includes(value.requestStatus) && value.needIds.some(need => need === "snap_new" || need === "snap_renewal"))).max(14).refine(values => unique(values.map(value => value.requestId)));
export function reconcileFoodDescriptionRequests(result: ReturnType<typeof validateFoodDescriptionSelection>, currentRequests: unknown, ownerId: string) {
  const requests = foodDescriptionCurrentRequestsSchema.parse(currentRequests);
  if (requests.some(request => request.ownerId !== ownerId)) throw new Error("parent_food_description_changed");
  const { existingRequestIds, ...validated } = result;
  const benefitWanted = foodDescriptionNeedSchema.options.some(need => need !== "food_now" && !result.excludedNeedIds.includes(need))
    && (result.needIds.some(need => need !== "food_now") || result.proposedAnswers.benefitHistory !== "not_sure" || result.questionIds.includes("benefitHistory") || existingRequestIds.length > 0);
  const foodWanted = result.needIds.includes("food_now") || result.questionIds.includes("foodForTwoDays");
  const blockedNew = result.proposedAnswers.benefitHistory === "never" && result.duplicateApplicationBlocked && !result.excludedNeedIds.includes("snap_new");
  const covers = (request: typeof requests[number], need: z.infer<typeof foodDescriptionNeedSchema>) => request.needIds.includes(need)
    || need === "snap_pending" && request.pendingSnapFollowUp;
  const existingRequests = requests.map(request => ({ requestId: request.requestId, needIds: request.needIds.filter(need => need === "food_now" ? foodWanted && !result.excludedNeedIds.includes(need)
    : benefitWanted && (!result.excludedNeedIds.includes(need) && (result.needIds.includes(need) || blockedNew && existingRequestIds.includes(request.requestId))
      || result.needIds.includes("snap_pending") && request.pendingSnapFollowUp && ["snap_new", "snap_renewal"].includes(need))) })).filter(request => request.needIds.length);
  const foodCovered = existingRequests.some(request => request.needIds.includes("food_now"));
  const benefitCovered = result.needIds.some(need => need !== "food_now" && requests.some(request => covers(request, need))) || blockedNew && existingRequests.some(request => request.needIds.some(need => need !== "food_now"));
  const needIds = result.needIds.filter(need => !requests.some(request => covers(request, need)));
  const questionIds = result.questionIds.filter(id => id === "foodForTwoDays" ? !foodCovered : !benefitCovered);
  if (benefitCovered && !result.needIds.includes("food_now") && !result.originalFacts.foodForTwoDays && !result.assertions.some(value => value.questionId === "foodForTwoDays")) {
    const index = questionIds.indexOf("foodForTwoDays"); if (index >= 0) questionIds.splice(index, 1);
  }
  // An uncovered food question retains the compatible provisional need; it does not select a program or grant execution.
  if (questionIds.includes("foodForTwoDays") && !needIds.includes("food_now")) needIds.unshift("food_now");
  if (needIds.includes("food_now") && !result.originalFacts.foodForTwoDays && !result.assertions.some(value => value.questionId === "foodForTwoDays") && !questionIds.includes("foodForTwoDays")) questionIds.unshift("foodForTwoDays");
  const candidates = result.candidates.filter(candidate => needIds.includes(candidate.need));
  return { ...validated, needIds, candidates, selections: result.selections.filter(selection => needIds.includes(selection.need)), questionIds, existingRequests,
    state: questionIds.length ? "needs_clarification" as const : candidates.length ? "proposal" as const : needIds.length ? "manual" as const : existingRequests.length ? "open_existing" as const : "manual" as const };
}
