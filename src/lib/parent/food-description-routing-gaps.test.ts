import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { FOOD_DESCRIPTION_EVALUATION_BINDING, FOOD_DESCRIPTION_FINGERPRINT } from "./food-description-runtime";
import { assessFoodSupport, foodAssessmentHandoffSchema } from "./food-assessment";
import { buildFoodDescriptionProjection, reconcileFoodDescriptionRequests, validateFoodDescriptionSelection, type FoodDescriptionContext } from "./food-description";
const now = new Date("2026-11-18T12:00:00Z"), owner = "00000000-0000-4000-8000-000000000001", request = "00000000-0000-4000-8000-000000000101";
const context = (changes: Partial<FoodDescriptionContext> = {}): FoodDescriptionContext => ({ ownerId: owner, expectedOwnerId: owner, revision: 1, expectedRevision: 1, catalogVersion: "synthetic", capabilityVersion: "synthetic", facts: {}, history: [], programIds: ["philly-food", "snap-pa", "uesf-benefits"], capabilities: [], excludedNeedIds: [], ...changes });
const source = (description: string, text: string) => ({ start: description.indexOf(text), end: description.indexOf(text) + text.length, text });
function result(description: string, assertions: unknown[], current = context(), changes = {}) {
  return validateFoodDescriptionSelection({ projection: buildFoodDescriptionProjection({ description, screenLocale: "en" }, current, now), currentContext: current, now,
    selection: { needIds: [], selections: [], assertions, exclusions: [], questionIds: [], outOfScope: null, ...changes } });
}
describe("truthful current food routing", () => {
  it.each(["yes", "no"])("routes a parent-reported denial as notice/problem help without inventing received benefits (food %s)", foodForTwoDays => {
    const answers = { foodForTwoDays, benefitHistory: "denied", existingIssue: null };
    expect(assessFoodSupport(answers)).toEqual([...(foodForTwoDays === "no" ? [{ need: "food_now", reason: "immediate" }] : []), { need: "snap_problem", reason: "problem" }]);
    expect(foodAssessmentHandoffSchema.parse({ answers, needs: ["snap_problem"] }).answers).toEqual(answers);
    expect(() => foodAssessmentHandoffSchema.parse({ answers: { ...answers, existingIssue: "not_sure" }, needs: ["snap_problem"] })).toThrow();
  });
  it("replaces only prior description-derived pending history with an exact current denial assertion", () => {
    const description = "We have enough food for the week. I have now received a denial notice.", current = context({ facts: {
      benefitHistory: { value: "applied", source: "parent_description", sourceRevision: 1, sourceAttemptCreatedAt: "2026-11-18T11:00:00Z", expiresAt: "2026-11-19T10:00:00Z" } } });
    const assertions = [{ questionId: "foodForTwoDays", value: "yes", span: source(description, "enough food for the week") }, { questionId: "benefitHistory", value: "denied", span: source(description, "received a denial notice") }];
    expect(result(description, assertions, current, { needIds: ["snap_problem"] })).toMatchObject({ needIds: ["snap_problem"], proposedAnswers: { foodForTwoDays: "yes", benefitHistory: "denied", existingIssue: null }, questionIds: [], conflicts: [], executionGranted: false });
    const strong = context({ facts: { benefitHistory: { value: "applied", source: "parent_typed", confirmedAt: "2026-11-18T11:00:00Z", expiresAt: "2026-11-19T10:00:00Z" } } });
    expect(result(description, assertions, strong, { needIds: ["snap_pending"] })).toMatchObject({ proposedAnswers: { benefitHistory: "applied" }, conflicts: ["benefitHistory"] });
  });
  it.each(["active", "paused"] as const)("reuses an owned %s agency-submitted application without inventing a source history answer or grant", requestStatus => {
    const description = "We have food for this week. I think I need a first SNAP application.", current = context({ history: [{ ownerId: owner, requestId: request, requestVersion: 4, requestStatus, need: "snap_pending", state: "agency_submitted", current: true }] });
    const vetted = result(description, [{ questionId: "foodForTwoDays", value: "yes", span: source(description, "food for this week") }], current);
    const value = reconcileFoodDescriptionRequests(vetted, [{ ownerId: owner, requestId: request, requestVersion: 4, requestStatus, needIds: ["snap_pending"], pendingSnapFollowUp: false }], owner);
    expect(value).toMatchObject({ state: "open_existing", needIds: [], questionIds: [], proposedAnswers: { foodForTwoDays: "yes", benefitHistory: "not_sure", existingIssue: null }, existingRequests: [{ requestId: request, needIds: ["snap_pending"] }], executionGranted: false });
    expect(value.assertions).toHaveLength(1); expect(value.originalFacts).toEqual({});
  });
  it.each(["closed", "cancelled", "not_current", "prepared", "checking"])("does not reuse %s history as an active submitted application", kind => {
    const description = "We have enough food.", current = context({ history: [{ ownerId: owner, requestId: request, requestVersion: 4, requestStatus: kind === "closed" || kind === "cancelled" ? kind : "active", need: "snap_pending", state: kind === "prepared" || kind === "checking" ? kind : "agency_submitted", current: kind !== "not_current" }] });
    expect(result(description, [{ questionId: "foodForTwoDays", value: "yes", span: source(description, "enough food") }], current)).toMatchObject({ state: "needs_clarification", questionIds: ["benefitHistory"], existingRequestIds: [] });
  });
  it.each(["yes", "no"])("keeps explicit outside-PA direction manual without an irrelevant SNAP question, retaining genuine food facts (%s)", value => {
    const description = value === "yes" ? "We live outside Pennsylvania and have enough food." : "We live outside Pennsylvania and have no food today.";
    const vetted = result(description, [{ questionId: "foodForTwoDays", value, span: source(description, value === "yes" ? "have enough food" : "have no food today") }], context(), { outOfScope: "outside_pa", needIds: value === "no" ? ["food_now"] : [] });
    expect(vetted).toMatchObject({ state: "manual", questionIds: [], candidates: [], proposedAnswers: { foodForTwoDays: value, benefitHistory: "not_sure" }, proposedUrgency: value === "no" ? "today" : null, executionGranted: false });
  });
  it("preserves genuine supported food alongside an unrelated unsupported need", () => {
    const description = "We have no food today and also need unrelated help.";
    expect(result(description, [{ questionId: "foodForTwoDays", value: "no", span: source(description, "no food today") }], context(), { outOfScope: "other", needIds: ["food_now"] })).toMatchObject({ state: "proposal", questionIds: [], needIds: ["food_now"], candidates: expect.arrayContaining([expect.objectContaining({ need: "food_now" })]), proposedUrgency: "today" });
  });

  it.each(["version", "scope", "cancelled", "owner"])("rejects an unmatched owned application %s at the current-request intersection", kind => {
    const description = "We have enough food.", current = context({ history: [{ ownerId: owner, requestId: request, requestVersion: 4, requestStatus: "active", need: "snap_pending", state: "agency_submitted", current: true }] });
    const vetted = result(description, [{ questionId: "foodForTwoDays", value: "yes", span: source(description, "enough food") }], current);
    const requestSource = { ownerId: kind === "owner" ? "00000000-0000-4000-8000-000000000002" : owner, requestId: request, requestVersion: kind === "version" ? 5 : 4, requestStatus: kind === "cancelled" ? "cancelled" : "active", needIds: [kind === "scope" ? "snap_problem" : "snap_pending"], pendingSnapFollowUp: false };
    expect(() => reconcileFoodDescriptionRequests(vetted, [requestSource], owner)).toThrow("parent_food_description_changed");
  });
  it("keeps a truthful denial problem distinct from the older pending request scope", () => {
    const description = "We have enough food. I received a denial notice.", current = context({ history: [{ ownerId: owner, requestId: request, requestVersion: 4, requestStatus: "active", need: "snap_pending", state: "agency_submitted", current: true }] });
    const vetted = result(description, [{ questionId: "foodForTwoDays", value: "yes", span: source(description, "enough food") }, { questionId: "benefitHistory", value: "denied", span: source(description, "received a denial notice") }], current, { needIds: ["snap_problem"] });
    expect(reconcileFoodDescriptionRequests(vetted, [{ ownerId: owner, requestId: request, requestVersion: 4, requestStatus: "active", needIds: ["snap_pending"], pendingSnapFollowUp: false }], owner)).toMatchObject({ state: "proposal", needIds: ["snap_problem"], existingRequests: [] });
  });

  it.each(["I need to continue my WIC support.", "Necesito continuar con mi apoyo de WIC."])("keeps WIC-only ordinary context manual without food/SNAP questions: %s", description => {
    expect(result(description, [], context(), { outOfScope: "wic" })).toMatchObject({ state: "manual", needIds: [], questionIds: [], candidates: [], proposedAnswers: { foodForTwoDays: "not_sure", benefitHistory: "not_sure", existingIssue: null }, executionGranted: false });
  });
  it("preserves independent ordinary need and typed facts alongside WIC", () => {
    const description = "We have no food today and also need WIC support.";
    expect(result(description, [{ questionId: "foodForTwoDays", value: "no", span: source(description, "no food today") }], context(), { outOfScope: "wic", needIds: ["food_now"] })).toMatchObject({ state: "proposal", needIds: ["food_now"], questionIds: [], proposedUrgency: "today" });
    const typed = context({ facts: { foodForTwoDays: { value: "no", source: "parent_typed", confirmedAt: "2026-11-18T11:00:00Z", expiresAt: "2026-11-19T10:00:00Z" } } });
    expect(result("I need WIC support.", [], typed, { outOfScope: "wic" })).toMatchObject({ needIds: ["food_now"], questionIds: [], proposedUrgency: "today" });
  });
  it("does not ask ordinary facts that cannot enable the explicit outside-PA manual direction", () => {
    expect(result("We need food support outside Pennsylvania.", [], context(), { outOfScope: "outside_pa" })).toMatchObject({ state: "manual", needIds: [], questionIds: [], proposedUrgency: null });
  });

  it.each((["wic", "utilities", "other", "outside_pa"] as const).flatMap(outOfScope => [false, true].flatMap(hasHistory => ["en", "es"].map(language => ({ outOfScope, hasHistory, language })))))("keeps unsupported-only $outOfScope manual in $language with history=$hasHistory", ({ outOfScope, hasHistory, language }) => {
    const current = context({ history: hasHistory ? [{ ownerId: owner, requestId: request, requestVersion: 4, requestStatus: "active", need: "snap_pending", state: "agency_submitted", current: true }] : [] });
    const descriptions = { wic: ["I need to continue my WIC support.", "Necesito continuar con mi apoyo de WIC."], utilities: ["I need help with electricity.", "Necesito ayuda con la electricidad."], other: ["I need help finding a job.", "Necesito ayuda para buscar trabajo."], outside_pa: ["I need support outside Pennsylvania.", "Necesito ayuda fuera de Pensilvania."] };
    const vetted = result(descriptions[outOfScope][language === "en" ? 0 : 1], [], current, { outOfScope });
    expect(reconcileFoodDescriptionRequests(vetted, hasHistory ? [{ ownerId: owner, requestId: request, requestVersion: 4, requestStatus: "active", needIds: ["snap_pending"], pendingSnapFollowUp: false }] : [], owner)).toMatchObject({ state: "manual", needIds: [], questionIds: [], existingRequests: [], proposedAnswers: { foodForTwoDays: "not_sure", benefitHistory: "not_sure" }, executionGranted: false });
  });
  it.each(["wic", "utilities", "other"])("preserves meaningful food without unrequested SNAP work alongside %s", outOfScope => {
    const description = "We have no food today and need other help.", current = context({ history: [{ ownerId: owner, requestId: request, requestVersion: 4, requestStatus: "active", need: "snap_pending", state: "agency_submitted", current: true }] });
    const vetted = result(description, [{ questionId: "foodForTwoDays", value: "no", span: source(description, "no food today") }], current, { outOfScope, needIds: ["food_now"] });
    expect(reconcileFoodDescriptionRequests(vetted, [{ ownerId: owner, requestId: request, requestVersion: 4, requestStatus: "active", needIds: ["snap_pending"], pendingSnapFollowUp: false }], owner)).toMatchObject({ state: "proposal", needIds: ["food_now"], questionIds: [], existingRequests: [], proposedUrgency: "today" });
  });

  it.each((["wic", "utilities", "other", "outside_pa"] as const).flatMap(outOfScope => ["food_yes", "food_unknown", "benefit_unknown"].map(fact => ({ outOfScope, fact }))))("does not turn harmless saved $fact into ordinary intent for $outOfScope", ({ outOfScope, fact }) => {
    const dates = { source: "parent_typed" as const, confirmedAt: "2026-11-18T11:00:00Z", expiresAt: "2026-11-19T10:00:00Z" };
    const current = context({ facts: fact === "benefit_unknown" ? { benefitHistory: { ...dates, value: "not_sure" } } : { foodForTwoDays: { ...dates, value: fact === "food_yes" ? "yes" : "not_sure" } }, history: [{ ownerId: owner, requestId: request, requestVersion: 4, requestStatus: "active", need: "snap_pending", state: "agency_submitted", current: true }] });
    const vetted = result("I need other support.", [], current, { outOfScope });
    expect(reconcileFoodDescriptionRequests(vetted, [{ ownerId: owner, requestId: request, requestVersion: 4, requestStatus: "active", needIds: ["snap_pending"], pendingSnapFollowUp: false }], owner)).toMatchObject({ state: "manual", needIds: [], questionIds: [], existingRequests: [], executionGranted: false });
    expect(vetted.originalFacts).toEqual(current.facts);
  });
  it.each(["wic", "utilities", "other"])("preserves independently known urgent food without reviving a saved SNAP journey for %s", outOfScope => {
    const dates = { source: "parent_typed" as const, confirmedAt: "2026-11-18T11:00:00Z", expiresAt: "2026-11-19T10:00:00Z" }, current = context({ facts: { foodForTwoDays: { ...dates, value: "no" }, benefitHistory: { ...dates, value: "applied" } }, history: [{ ownerId: owner, requestId: request, requestVersion: 4, requestStatus: "active", need: "snap_pending", state: "agency_submitted", current: true }] });
    const vetted = result("I need other support.", [], current, { outOfScope });
    expect(reconcileFoodDescriptionRequests(vetted, [{ ownerId: owner, requestId: request, requestVersion: 4, requestStatus: "active", needIds: ["snap_pending"], pendingSnapFollowUp: false }], owner)).toMatchObject({ state: "proposal", needIds: ["food_now"], questionIds: [], existingRequests: [], proposedUrgency: "today" });
  });

  it.each([false, true].flatMap(knownFood => [false, true].map(local => ({ knownFood, local }))))("keeps outside-PA direction manual after reconciliation with knownFood=$knownFood/local=$local", ({ knownFood, local }) => {
    const description = knownFood ? "We live outside Pennsylvania, have no food today and never applied for SNAP." : "We live outside Pennsylvania and never applied for SNAP.";
    const assertions = [{ questionId: "benefitHistory", value: "never", span: source(description, "never applied for SNAP") }, ...(knownFood ? [{ questionId: "foodForTwoDays", value: "no", span: source(description, "no food today") }] : [])];
    const vetted = result(description, assertions, context(), { outOfScope: "outside_pa", needIds: ["food_now", "snap_new"] });
    expect(reconcileFoodDescriptionRequests(vetted, local ? [{ ownerId: owner, requestId: request, requestVersion: 4, requestStatus: "active", needIds: ["food_now"], pendingSnapFollowUp: false }] : [], owner)).toMatchObject({ state: "manual", needIds: ["food_now", "snap_new"], questionIds: [], candidates: [], selections: [], existingRequests: [], proposedAnswers: { foodForTwoDays: knownFood ? "no" : "not_sure", benefitHistory: "never" }, proposedUrgency: knownFood ? "today" : null, executionGranted: false });
  });
  it("keeps the current-request owner check before outside-PA manual reconciliation", () => {
    const vetted = result("I need help outside Pennsylvania.", [], context(), { outOfScope: "outside_pa" });
    expect(() => reconcileFoodDescriptionRequests(vetted, [{ ownerId: "00000000-0000-4000-8000-000000000002", requestId: request, requestVersion: 4, requestStatus: "active", needIds: ["food_now"], pendingSnapFollowUp: false }], owner)).toThrow("parent_food_description_changed");
  });

  it("binds the source-supply meaning to the exact dispatched instructions rather than treating pickup logistics as a shortage", () => {
    expect(FOOD_DESCRIPTION_EVALUATION_BINDING.request.instructions).toContain("An explicit current need for food or groceries today supports foodForTwoDays:no.");
    expect(FOOD_DESCRIPTION_EVALUATION_BINDING.request.instructions).toContain("Requesting only a food site or pickup time, or unclear timing such as soon, does not establish two-day food supply; do not assert No from that alone.");
    expect(createHash("sha256").update(JSON.stringify(FOOD_DESCRIPTION_EVALUATION_BINDING)).digest("hex")).toBe(FOOD_DESCRIPTION_FINGERPRINT);
  });

  it.each(["wic", "utilities", "other"].flatMap(outOfScope => ["yes", "not_sure"].map(food => ({ outOfScope, food }))))("does not treat a current nonshortage $food assertion as SNAP intent alongside $outOfScope", ({ outOfScope, food }) => {
    const description = food === "yes" ? "We have enough food. I need other support." : "I am not sure about food. I need other support.";
    const current = context({ history: [{ ownerId: owner, requestId: request, requestVersion: 4, requestStatus: "active", need: "snap_pending", state: "agency_submitted", current: true }] });
    const vetted = result(description, [{ questionId: "foodForTwoDays", value: food, span: source(description, food === "yes" ? "have enough food" : "not sure about food") }], current, { outOfScope });
    expect(reconcileFoodDescriptionRequests(vetted, [{ ownerId: owner, requestId: request, requestVersion: 4, requestStatus: "active", needIds: ["snap_pending"], pendingSnapFollowUp: false }], owner)).toMatchObject({ state: "manual", needIds: [], questionIds: [], existingRequests: [], executionGranted: false });
    expect(vetted.assertions).toHaveLength(1);
  });
  it("keeps explicitly current pending-benefit information relevant alongside an unsupported topic", () => {
    const description = "My SNAP application is pending and I also need other support.", current = context({ facts: { foodForTwoDays: { value: "yes", source: "parent_typed", confirmedAt: "2026-11-18T11:00:00Z", expiresAt: "2026-11-19T10:00:00Z" } }, history: [{ ownerId: owner, requestId: request, requestVersion: 4, requestStatus: "active", need: "snap_pending", state: "agency_submitted", current: true }] });
    const vetted = result(description, [{ questionId: "benefitHistory", value: "applied", span: source(description, "SNAP application is pending") }], current, { outOfScope: "wic" });
    expect(reconcileFoodDescriptionRequests(vetted, [{ ownerId: owner, requestId: request, requestVersion: 4, requestStatus: "active", needIds: ["snap_pending"], pendingSnapFollowUp: false }], owner)).toMatchObject({ state: "open_existing", questionIds: [], needIds: [], existingRequests: [{ requestId: request, needIds: ["snap_pending"] }] });
  });

});
