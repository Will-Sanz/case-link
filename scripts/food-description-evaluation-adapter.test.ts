import { describe, expect, it } from "vitest";
import { buildFoodDescriptionProjection, foodDescriptionInputSchema } from "../src/lib/parent/food-description";
import { applyDescriptionEvaluationAnswers, descriptionEvaluationAdapterHash, descriptionEvaluationContext, descriptionEvaluationInput, descriptionEvaluationPlan, loadDescriptionEvaluationCorpus } from "./food-description-evaluation-adapter";
import { FOOD_DESCRIPTION_EVALUATION_BINDING } from "../src/lib/parent/food-description-runtime";
import { descriptionEvaluationHash } from "./food-description-evaluation-budget";
const corpus = loadDescriptionEvaluationCorpus();
describe("hash-pinned actual description DTO adapter, without model or network", () => {
  it("changes only the two explicit unknown-history question oracles, retaining their archived expectations", () => {
    const rows = descriptionEvaluationPlan(corpus).cases;
    const changed = rows.filter(item => JSON.stringify(item.turns[0].archived.questionIds) !== JSON.stringify(item.turns[0].current.questionIds));
    expect(changed.map(item => item.id)).toEqual(["description-ambiguity-3-en", "description-ambiguity-3-es"]);
    for (const item of changed) {
      expect(item.turns[0].archived.questionIds).toEqual(["foodForTwoDays", "benefitHistory"]);
      expect(item.turns[0].current.questionIds).toEqual(["foodForTwoDays"]);
      expect(item.turns[0].differences).toContain("The description explicitly supplies unknown SNAP history; honor that Not sure answer without asking the same benefit question again.");
    }
  });
  it("preserves all60/240/80/24 rows and both language denominators", () => {
    const plan=descriptionEvaluationPlan(corpus); expect(plan.caseCount).toBe(60);expect(plan.turnCount).toBe(240);expect(plan.maximumModelCalls).toBe(80);expect(plan.zeroCallGuardCases).toBe(24);
    expect(plan.cases.flatMap(item=>item.turns)).toHaveLength(240);expect(plan.cases.flatMap(item=>item.turns).reduce((n,t)=>n+t.maximumModelCalls,0)).toBe(80);
    expect(plan.languageCounts).toEqual({en:30,es:30});expect(descriptionEvaluationAdapterHash()).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each(corpus.cases)("minimizes the actual input for $id and never primes it with expected output", item => {
    const input=descriptionEvaluationInput(item,0),context=descriptionEvaluationContext(item),projection=buildFoodDescriptionProjection(input,context,new Date("2026-11-18T12:00:00Z"));
    expect(Object.keys(input).sort()).toEqual(["description","screenLocale"]);expect(context.facts).not.toHaveProperty("zip");expect(projection.routingFacts).not.toHaveProperty("zip");
    expect(JSON.stringify(projection)).not.toContain(context.ownerId);expect(JSON.stringify(projection)).not.toContain("expected");
    for(const h of context.history)expect(JSON.stringify(projection)).not.toContain(h.requestId);
    expect(projection.ownedFoodHistory.every(h=>Object.keys(h).sort().join() === "current,need,state")).toBe(true);
  });
  it.each(corpus.blockedCases)("blocks $id before count or generation", item => {
    expect(foodDescriptionInputSchema.safeParse({description:item.description,screenLocale:item.language}).success).toBe(false);
  });
  it("marks all incompatible archived targets explicitly and adapts26 terminal choices without compound creation", () => {
    const rows=descriptionEvaluationPlan(corpus).cases.flatMap(item=>item.turns);
    expect(rows.filter(row=>row.turn===1&&row.differences.length)).toHaveLength(60);
    const terminals=rows.filter(row=>row.kind==="typed_handoff");expect(terminals).toHaveLength(26);
    for(const row of terminals)expect((row.current.handoff as {needs:string[]}).needs).toHaveLength(1);
    expect(rows.filter(row=>row.turn===1&&row.archived.state==="outside_supported_geography").every(row=>row.current.state==="manual"&&row.current.outOfScope==="other")).toBe(true);
    expect(rows.filter(row=>row.turn===1&&row.archived.state==="open_existing").every(row=>Array.isArray(row.current.existingRequests))).toBe(true);
    expect(rows.filter(row=>row.kind==="change_state_and_revalidate")).toHaveLength(40);
  });
  it("binds all80 exact planned projections and retains all60 terminal targets with explicit current changes",()=>{
    const rows=descriptionEvaluationPlan(corpus).cases.flatMap(item=>item.turns),modelTurns=rows.filter(row=>row.maximumModelCalls===1);
    expect(modelTurns).toHaveLength(80);
    for(const row of modelTurns){expect(row.projection).toBeDefined();expect(row.requestSha256).toBe(descriptionEvaluationHash({...FOOD_DESCRIPTION_EVALUATION_BINDING.request,input:[{role:"user",content:JSON.stringify(row.projection)}]}));}
    const terminals=rows.filter(row=>row.turn===4);expect(terminals).toHaveLength(60);
    for(const row of terminals)expect(row.archived.target).toBeTypeOf("string");
    const changed=terminals.filter(row=>row.archived.target!==row.current.target);expect(changed).toHaveLength(2);
    for(const row of changed){expect(row.current.target).toBe("https://www.feedingamerica.org/need-help-find-food");expect(row.differences).not.toHaveLength(0);}
  });
  it("keeps only actual supplied typed values, original dates and no expectation-driven new facts", () => {
    const item=corpus.cases[0],before=descriptionEvaluationContext(item),after=applyDescriptionEvaluationAnswers(before,{benefitHistory:"applied"});
    expect(before.facts).toEqual({});expect(after.facts.benefitHistory?.value).toBe("applied");expect(after.revision).toBe(2);
    expect(applyDescriptionEvaluationAnswers(after,{benefitHistory:"applied"})).toEqual(after);
  });
});
