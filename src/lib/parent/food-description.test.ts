import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assessFoodSupport } from "./food-assessment";
import {
  buildFoodDescriptionProjection, foodDescriptionContextSchema, foodDescriptionInputSchema, foodDescriptionSelectionSchema,
  validateFoodDescriptionSelection, reconcileFoodDescriptionRequests, type FoodDescriptionContext,
} from "./food-description";

type Corpus = { cases: { id: string; language: string; humanReview: string; turns: {
  modelCalls?: number; expected?: { state?: string; answers?: unknown; needIds?: string[] };
  input?: { description: string; screenLocale: string };
  suppliedPreferences?: { excludedNeeds: string[] };
}[] }[]; blockedCases: { id: string; language: string; description: string }[] };
const corpusBytes = readFileSync(new URL("../../../tests/fixtures/parent/food-description-2026-11-18.v3.json", import.meta.url));
const corpus = JSON.parse(corpusBytes.toString()) as Corpus;

const now = new Date("2026-11-18T12:00:00Z"), owner = "00000000-0000-4000-8000-000000000001", other = "00000000-0000-4000-8000-000000000002";
const request = "00000000-0000-4000-8000-000000000101";
const dates = { source: "parent_typed" as const, confirmedAt: "2026-11-18T11:00:00Z", expiresAt: "2026-11-19T11:00:00Z" };
const input = { description: "We have no food for tomorrow. I have never applied for SNAP.", screenLocale: "en" as const };
const context = (overrides: Partial<FoodDescriptionContext> = {}): FoodDescriptionContext => ({
  expectedOwnerId: owner, ownerId: owner, expectedRevision: 1, revision: 1,
  catalogVersion: "synthetic-food-v1", capabilityVersion: "synthetic-capabilities-v1", facts: { zip: { value: "19104", ...dates } },
  history: [], programIds: ["philly-food", "share-community-fridge-19129", "snap-pa", "uesf-benefits"], capabilities: [], excludedNeedIds: [], ...overrides,
});
const span = (description: string, text: string) => ({ start: description.indexOf(text), end: description.indexOf(text) + text.length, text });
const selection = () => ({
  needIds: ["food_now", "snap_new"], selections: [{ need: "food_now", programId: "philly-food", reason: "immediate" }, { need: "snap_new", programId: "snap-pa", reason: "new" }],
  assertions: [
    { questionId: "foodForTwoDays", value: "no", span: span(input.description, "no food for tomorrow") },
    { questionId: "benefitHistory", value: "never", span: span(input.description, "never applied for SNAP") },
  ], exclusions: [], questionIds: [], outOfScope: null,
});
function validate(value: unknown = selection(), current = context(), projected = buildFoodDescriptionProjection(input, context(), now)) {
  return validateFoodDescriptionSelection({ projection: projected, selection: value, currentContext: current, now });
}
afterEach(() => { vi.unstubAllGlobals(); });

describe("unwired optional food-description contract", () => {
  it.each(corpus.blockedCases)("rejects $id before any projection or dispatch without echoing rejected text", item => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const value = { description: item.description, screenLocale: item.language };
    expect(foodDescriptionInputSchema.safeParse(value).success).toBe(false);
    expect(() => buildFoodDescriptionProjection(value, context(), now)).toThrow("parent_food_description_private_input");
    const error = (() => { try { foodDescriptionInputSchema.parse(value); } catch (error) { return String(error); } })();
    expect(error).not.toContain(item.description); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["", " ", "a".repeat(501), "food\u0000help"])("rejects empty, oversized or control-character descriptions %#", description => {
    expect(foodDescriptionInputSchema.safeParse({ ...input, description }).success).toBe(false);
  });
  it("rejects private fields, anonymous data and arbitrary output fields", () => {
    expect(foodDescriptionInputSchema.safeParse({ ...input, accountNumber: "PRIVATE-CANARY" }).success).toBe(false);
    expect(foodDescriptionInputSchema.safeParse({ ...input, screenLocale: "fr" }).success).toBe(false);
    for (const change of [{ confidence: .99 }, { permission: true }, { url: "https://example.org" }, { needIds: ["wic_new"] }, { questionIds: ["income"] }])
      expect(foodDescriptionSelectionSchema.safeParse({ ...selection(), ...change }).success).toBe(false);
  });
  it("minimizes owned context and keeps original dates without confirming availability or permission", () => {
    const current = context({ history: [{ ownerId: owner, requestId: request, requestVersion: 4, requestStatus: "active", need: "snap_pending", state: "agency_submitted", current: true }],
      capabilities: [{ programId: "snap-pa", enabled: true, actions: ["submit", "prepare"] }] });
    const value = buildFoodDescriptionProjection(input, current, now), serialized = JSON.stringify(value);
    expect(serialized).not.toContain(owner); expect(serialized).not.toContain(request); expect(serialized).not.toContain("requestStatus");
    expect(value.routingFacts.zip).toEqual(current.facts.zip);
    expect(value.ownedFoodHistory).toEqual([{ need: "snap_pending", state: "agency_submitted", current: true }]);
    expect(value.candidates.find(value => value.need === "snap_pending" && value.programId === "snap-pa")?.actions).toEqual(["prepare"]);
    expect(value.candidates.find(value => value.need === "snap_new" && value.programId === "snap-pa")?.actions).toEqual(["prepare", "submit"]);
  });
  it("omits expired, future and unpermitted profile facts rather than refreshing their dates", () => {
    const current = context({ facts: { zip: { value: "19129", ...dates, source: "family_profile", descriptionUsePermitted: false },
      foodForTwoDays: { value: "yes", ...dates, expiresAt: now.toISOString() },
      benefitHistory: { value: "never", ...dates, confirmedAt: "2026-11-19T00:00:00Z" } } });
    expect(buildFoodDescriptionProjection(input, current, now).routingFacts).toEqual({});
    const permitted = context({ facts: { zip: { ...current.facts.zip!, descriptionUsePermitted: true } } });
    expect(buildFoodDescriptionProjection(input, permitted, now).routingFacts.zip).toEqual(permitted.facts.zip);
    expect(current.facts.zip?.confirmedAt).toBe(dates.confirmedAt);
  });
  it("anchors clear enum interpretations and recomputes complementary proposals without creating a grant", () => {
    const result = validate();
    expect(result).toMatchObject({ state: "proposal", needIds: ["food_now", "snap_new"], questionIds: [], proposedUrgency: "today", executionGranted: false });
    expect(result.proposedAnswers).toEqual({ foodForTwoDays: "no", benefitHistory: "never", existingIssue: null });
    expect(result.originalFacts).toEqual(context().facts);
    // The model cannot suppress a clear, permitted independent need by omitting its recommendation.
    expect(validate({ ...selection(), needIds: ["snap_new"], selections: [selection().selections[1]] }).needIds).toEqual(["food_now", "snap_new"]);
  });
  it("anchors Spanish source spans without changing their text or inventing another question", () => {
    const value = { description: "No tenemos comida para mañana. Nunca he solicitado SNAP.", screenLocale: "es" };
    const projected = buildFoodDescriptionProjection(value, context(), now);
    const result = validate({ ...selection(), assertions: [
      { questionId: "foodForTwoDays", value: "no", span: span(value.description, "No tenemos comida para mañana") },
      { questionId: "benefitHistory", value: "never", span: span(value.description, "Nunca he solicitado SNAP") },
    ] }, context(), projected);
    expect(result.needIds).toEqual(["food_now", "snap_new"]); expect(result.questionIds).toEqual([]);
    expect(result.assertions[0].span.text).toBe("No tenemos comida para mañana");
  });
  it.each([
    { assertions: [{ ...selection().assertions[0], span: { start: 0, end: 2, text: "no" } }] },
    { assertions: [{ ...selection().assertions[0], span: { start: 0, end: 500, text: input.description } }] },
    { assertions: [{ ...selection().assertions[0], value: "yesplease" }] },
    { assertions: [selection().assertions[0], selection().assertions[0]] },
    { selections: [{ need: "snap_new", programId: "wic-pa", reason: "new" }] },
    { selections: [{ need: "snap_new", programId: "philly-food", reason: "new" }] },
    { selections: [{ need: "snap_new", programId: "snap-pa", reason: "renewal" }] },
    { questionIds: ["foodForTwoDays"] },
  ])("rejects fabricated spans, values, routes, reasons and repeated known questions %#", change => {
    expect(() => validate({ ...selection(), ...change })).toThrow();
  });
  it("keeps explicit facts and their dates when prose conflicts, rather than replacing them", () => {
    const current = context({ facts: { ...context().facts, foodForTwoDays: { value: "yes", ...dates } } });
    const projected = buildFoodDescriptionProjection(input, current, now);
    const result = validate({ ...selection(), needIds: ["snap_new"], selections: [selection().selections[1]] }, current, projected);
    expect(result.proposedAnswers.foodForTwoDays).toBe("yes"); expect(result.needIds).toEqual(["snap_new"]);
    expect(result.conflicts).toEqual(["foodForTwoDays"]); expect(result.originalFacts.foodForTwoDays).toEqual(current.facts.foodForTwoDays);
    expect(result.proposedUrgency).toBeNull();
  });
  it.each(["en", "es"] as const)("keeps soon/pronto unresolved and uses only vetted missing questions in %s", screenLocale => {
    const value = { description: screenLocale === "en" ? "We need food soon." : "Necesitamos comida pronto.", screenLocale };
    const projected = buildFoodDescriptionProjection(value, context(), now);
    const result = validate({ needIds: ["food_now"], selections: [], assertions: [], exclusions: [], questionIds: [], outOfScope: null }, context(), projected);
    expect(result).toMatchObject({ questionIds: ["foodForTwoDays", "benefitHistory"], proposedUrgency: null, requiresTypedTiming: true });
  });
  it("does not ask an explicitly answered Not sure again or convert it into No", () => {
    const current = context({ facts: { ...context().facts, foodForTwoDays: { value: "not_sure", ...dates }, benefitHistory: { value: "not_sure", ...dates } } });
    const result = validate({ needIds: ["food_now"], selections: [], assertions: [], exclusions: [], questionIds: [], outOfScope: null }, current, buildFoodDescriptionProjection(input, current, now));
    expect(result).toMatchObject({ proposedAnswers: { foodForTwoDays: "not_sure" }, questionIds: [], proposedUrgency: null });
  });
  it("keeps a separately current issue fact while asking for missing benefit history", () => {
    const current = context({ facts: { ...context().facts, foodForTwoDays: { value: "yes", ...dates }, existingIssue: { value: "card", ...dates } } });
    const result = validate({ needIds: [], selections: [], assertions: [], exclusions: [], questionIds: [], outOfScope: null }, current, buildFoodDescriptionProjection(input, current, now));
    expect(result.questionIds).toEqual(["benefitHistory"]); expect(result.proposedAnswers.existingIssue).toBeNull();
    expect(result.originalFacts.existingIssue).toEqual(current.facts.existingIssue);
  });
  it.each(["owner", "revision", "history", "source", "capability", "facts"])("rejects a stale %s response before exposing an interpreted result", kind => {
    const current = context();
    if (kind === "owner") current.ownerId = other;
    if (kind === "revision") current.revision = 2;
    if (kind === "history") current.history = [{ ownerId: owner, requestId: request, requestVersion: 1, requestStatus: "active", need: "snap_pending", state: "agency_submitted", current: true }];
    if (kind === "source") current.catalogVersion = "changed";
    if (kind === "capability") current.capabilityVersion = "changed";
    if (kind === "facts") current.facts.zip = { value: "19129", ...dates };
    expect(() => validate(selection(), current)).toThrow("parent_food_description_changed");
  });
  it("rejects other-household history and unknown context fields before projection", () => {
    expect(() => buildFoodDescriptionProjection(input, context({ history: [{ ownerId: other, requestId: request, requestVersion: 1, requestStatus: "active", need: "snap_pending", state: "agency_submitted", current: true }] }), now)).toThrow("parent_food_description_changed");
    expect(foodDescriptionContextSchema.safeParse({ ...context(), familyName: "PRIVATE-CANARY" }).success).toBe(false);
  });
  it.each(["active", "paused", "cancelled", "closed"] as const)("blocks a duplicate submitted SNAP application while keeping %s history immutable", requestStatus => {
    const current = context({ history: [{ ownerId: owner, requestId: request, requestVersion: 3, requestStatus, need: "snap_pending", state: "agency_submitted", current: true }] });
    const result = validate(selection(), current, buildFoodDescriptionProjection(input, current, now));
    expect(result.duplicateApplicationBlocked).toBe(true); expect(result.needIds).not.toContain("snap_new");
    expect(result.existingRequestIds).toEqual(["active", "paused"].includes(requestStatus) ? [request] : []);
    expect(current.history[0].requestStatus).toBe(requestStatus); expect(result.executionGranted).toBe(false);
  });
  it("opens current owned work even when the model omits its known pending-application recommendation", () => {
    const current = context({ facts: { ...context().facts, foodForTwoDays: { value: "yes", ...dates }, benefitHistory: { value: "applied", ...dates } },
      history: [{ ownerId: owner, requestId: request, requestVersion: 3, requestStatus: "active", need: "snap_pending", state: "agency_submitted", current: true }] });
    const result = validate({ needIds: [], selections: [], assertions: [], exclusions: [], questionIds: [], outOfScope: null }, current, buildFoodDescriptionProjection(input, current, now));
    expect(result).toMatchObject({ state: "open_existing", needIds: ["snap_pending"], existingRequestIds: [request], questionIds: [], executionGranted: false });
  });
  it("honors a bounded parent exclusion while preserving independent urgent food", () => {
    const current = context({ excludedNeedIds: ["snap_new", "snap_pending", "snap_renewal", "snap_problem"] });
    const result = validate({ ...selection(), needIds: ["food_now"], selections: [selection().selections[0]] }, current, buildFoodDescriptionProjection(input, current, now));
    expect(result.needIds).toEqual(["food_now"]); expect(result.questionIds).toEqual([]);
  });
  it("keeps out-of-area and stale source routes as manual options without an eligibility rejection", () => {
    const current = context({ facts: { zip: { value: "94103", ...dates } } });
    const projected = buildFoodDescriptionProjection(input, current, now); expect(projected.candidates).toEqual([]);
    const result = validate({ ...selection(), selections: [] }, current, projected);
    expect(result.state).toBe("manual"); expect(result.executionGranted).toBe(false);
    expect(buildFoodDescriptionProjection(input, context({ facts: {} }), new Date("2027-01-01T00:00:00Z")).candidates).toEqual([]);
  });
});

describe("reviewed expected-behavior corpus, not measured model quality", () => {
  it.each(corpus.cases)("admits the reviewed minimized synthetic input for $id without a model call", item => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const value = item.turns[0].input!;
    expect(foodDescriptionInputSchema.safeParse({ description: value.description, screenLocale: value.screenLocale }).success).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("preserves the frozen60/240/80 denominator, bilingual strata and24 zero-call guards", () => {
    expect(createHash("sha256").update(corpusBytes).digest("hex"))
      .toBe("6ea3e44b253e66bc26720507c355d6b3da030bfd2d85e59b282feb9607570a19");
    expect(corpus.cases).toHaveLength(60); expect(corpus.blockedCases).toHaveLength(24);
    expect(corpus.cases.reduce((total, value) => total + value.turns.length, 0)).toBe(240);
    expect(corpus.cases.reduce((sum, value) => sum + value.turns.reduce((total, turn) => total + (turn.modelCalls ?? 0), 0), 0)).toBe(80);
    expect(corpus.cases.filter(value => value.language === "en")).toHaveLength(30);
    expect(corpus.cases.filter(value => value.language === "es")).toHaveLength(30);
    expect(corpus.cases.every(value => value.humanReview === "pending")).toBe(true);
  });
  it("checks all56 ordinary typed-answer oracles with the existing deterministic branch", () => {
    let checked = 0;
    for (const item of corpus.cases) {
      const turn = item.turns[1];
      if (!turn.suppliedPreferences || !turn.expected?.answers || turn.expected.state === "open_existing") continue;
      const excluded = turn.suppliedPreferences.excludedNeeds;
      expect(assessFoodSupport(turn.expected.answers).map(value => value.need).filter(need => !excluded.includes(need)), item.id).toEqual(turn.expected.needIds);
      checked++;
    }
    expect(checked).toBe(56);
  });
});

it("keeps server-owned request coverage out of the model projection and rejects foreign or duplicated scope records",()=>{
  const current=context(),projection=buildFoodDescriptionProjection(input,current,now),validated=validateFoodDescriptionSelection({projection,selection:selection(),currentContext:current,now});
  const existing={ownerId:owner,requestId:request,requestVersion:2,requestStatus:"active",needIds:["food_now"],pendingSnapFollowUp:false};
  const result=reconcileFoodDescriptionRequests(validated,[existing],owner);
  expect(result).toMatchObject({state:"proposal",needIds:["snap_new"],existingRequests:[{requestId:request,needIds:["food_now"]}]});
  expect(JSON.stringify(projection)).not.toContain(request);
  expect(()=>reconcileFoodDescriptionRequests(validated,[{...existing,ownerId:other}],owner)).toThrow("parent_food_description_changed");
  expect(()=>reconcileFoodDescriptionRequests(validated,[existing,existing],owner)).toThrow();
});

it("retains a distinct card-problem need when current owned permission covers renewal only", () => {
  const current = context({ facts: { zip: { value: "19129", ...dates }, foodForTwoDays: { value: "yes", ...dates },
    benefitHistory: { value: "receiving", ...dates }, existingIssue: { value: "card", ...dates } } });
  const described = { description: "My SNAP card is not working.", screenLocale: "en" as const };
  const projection = buildFoodDescriptionProjection(described, current, now);
  const selected = { needIds: ["snap_problem"], selections: [{ need: "snap_problem", programId: "snap-pa", reason: "problem" }], assertions: [], exclusions: [], questionIds: [], outOfScope: null };
  const result = validateFoodDescriptionSelection({ projection, selection: selected, currentContext: current, now });
  expect(result.needIds).toEqual(["snap_problem"]);
  const reconciled = reconcileFoodDescriptionRequests(result, [{ ownerId: owner, requestId: request, requestVersion: 1,
    requestStatus: "active", needIds: ["snap_renewal"], pendingSnapFollowUp: false }], owner);
  expect(reconciled.needIds).toEqual(["snap_problem"]);
  expect(reconciled.state).toBe("proposal");
});

it.each(["snap_renewal","snap_problem"] as const)("covers only the exact %s journey and leaves a distinct other journey under its own mandate", need=>{
  const issue=need==="snap_renewal"?"renewal":"card",otherNeed=need==="snap_renewal"?"snap_problem":"snap_renewal";
  const current=context({facts:{foodForTwoDays:{value:"yes",...dates},benefitHistory:{value:"receiving",...dates},existingIssue:{value:issue,...dates}}});
  const projected=buildFoodDescriptionProjection(input,current,now),selected={needIds:[need],selections:[],assertions:[],exclusions:[],questionIds:[],outOfScope:null};
  const validated=validateFoodDescriptionSelection({projection:projected,selection:selected,currentContext:current,now});
  const prior={ownerId:owner,requestId:request,requestVersion:1,requestStatus:"active",needIds:[otherNeed],pendingSnapFollowUp:false};
  expect(reconcileFoodDescriptionRequests(validated,[prior],owner)).toMatchObject({state:"proposal",needIds:[need],existingRequests:[]});
  expect(reconcileFoodDescriptionRequests(validated,[{...prior,needIds:[need]}],owner)).toMatchObject({state:"open_existing",needIds:[],existingRequests:[{requestId:request,needIds:[need]}]});
});
it.each([false,true])("requires server-confirmed pending follow-up scope before reusing a prior new application (%s)",pendingSnapFollowUp=>{
  const current=context({facts:{benefitHistory:{value:"applied",...dates}}});
  const validated=validateFoodDescriptionSelection({projection:buildFoodDescriptionProjection(input,current,now),selection:{needIds:["snap_pending"],selections:[],assertions:[],exclusions:[],questionIds:[],outOfScope:null},currentContext:current,now});
  const prior={ownerId:owner,requestId:request,requestVersion:1,requestStatus:"active",needIds:["snap_new"],pendingSnapFollowUp};
  const value=reconcileFoodDescriptionRequests(validated,[prior],owner);
  expect(value.needIds).toEqual(pendingSnapFollowUp?[]:["food_now","snap_pending"]);expect(value.state).toBe(pendingSnapFollowUp?"open_existing":"needs_clarification");
  expect(value.existingRequests).toEqual(pendingSnapFollowUp?[{requestId:request,needIds:["snap_new"]}]:[]);
});
it("asks an actually unknown benefit fact despite an unrelated active renewal and preserves exclusions",()=>{
  const current=context({facts:{foodForTwoDays:{value:"no",...dates}},excludedNeedIds:["snap_renewal"],history:[{ownerId:owner,requestId:request,requestVersion:1,requestStatus:"active",need:"snap_renewal",state:"prepared",current:true}]});
  const validated=validateFoodDescriptionSelection({projection:buildFoodDescriptionProjection(input,current,now),selection:{needIds:["food_now"],selections:[],assertions:[],exclusions:[],questionIds:["benefitHistory"],outOfScope:null},currentContext:current,now});
  expect(reconcileFoodDescriptionRequests(validated,[{ownerId:owner,requestId:request,requestVersion:1,requestStatus:"active",needIds:["snap_renewal"],pendingSnapFollowUp:false}],owner)).toMatchObject({needIds:["food_now"],questionIds:["benefitHistory"],existingRequests:[]});
});
it("does not mistake a declined card-problem case for an existing application",()=>{
  const current=context({history:[{ownerId:owner,requestId:request,requestVersion:1,requestStatus:"active",need:"snap_problem",state:"declined",current:true}]});
  const validated=validate(selection(),current,buildFoodDescriptionProjection(input,current,now));
  expect(validated).toMatchObject({needIds:["food_now","snap_new"],duplicateApplicationBlocked:false});
});
