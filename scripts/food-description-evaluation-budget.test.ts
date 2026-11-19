import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {spawn}from"node:child_process";
import{once}from"node:events";
import{pathToFileURL}from"node:url";
import{resolve}from"node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFoodDescriptionProjection } from "../src/lib/parent/food-description";
import { FOOD_DESCRIPTION_EVALUATION_BINDING, FOOD_DESCRIPTION_FINGERPRINT, foodDescriptionUsage } from "../src/lib/parent/food-description-runtime";
import { DESCRIPTION_EVAL_LIMITS, FOOD_DESCRIPTION_CORPUS_SHA, descriptionEvaluationAccounting, descriptionEvaluationHash, descriptionEvaluationFileHash, descriptionEvaluationApprovalSchema, sealedDescriptionEvaluationEvidenceHash, sealedDescriptionEvaluationPriorAccounting, foodDescriptionMeasuredNanoDollars, withFoodDescriptionEvaluationBudget } from "./food-description-evaluation-budget";
import { sealedDescriptionEvaluationPriors } from "./food-description-evaluation-test-fixtures";
const roots: string[] = [], now = () => new Date("2026-11-18T16:00:00Z");
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function setup() {
  const root = mkdtempSync(join(tmpdir(), "description-budget-")); roots.push(root);
  const dir = join(root, "approved-run");
  const approval = { purpose: "optional_food_description_synthetic_evaluation_v1", syntheticOnly: true, approvalReference: "SYNTHETIC TEST ONLY",
    approvedUntil: "2026-11-18T23:00:00Z", processorReference: "synthetic", noticeRetentionReference: "synthetic", billingReference: "synthetic",
    projectId: "proj_synthetic", projectMetadataReference: "synthetic Standard global", approvedResponseModelId: "gpt-6.1-sol", region: "global", serviceTier: "default",
    fingerprint: FOOD_DESCRIPTION_FINGERPRINT, corpusSha256: FOOD_DESCRIPTION_CORPUS_SHA, adapterSha256: "a".repeat(64), rateCardDate: "2026-11-18",
    maximumCalls: 80, maximumCountRequests: 80, maximumInputTokens: 8000, maximumOutputTokens: 1500, maximumNanoDollars: 5_000_000_000, runDirectory: dir };
  const context = { expectedOwnerId: "00000000-0000-4000-8000-000000000001", ownerId: "00000000-0000-4000-8000-000000000001", expectedRevision: 1, revision: 1,
    catalogVersion: FOOD_DESCRIPTION_FINGERPRINT, capabilityVersion: "synthetic-v1", facts: {}, history: [], programIds: ["philly-food", "snap-pa"], capabilities: [], excludedNeedIds: [] };
  const projection = buildFoodDescriptionProjection({ description: "Food tomorrow", screenLocale: "en" }, context, now());
  const body = { ...FOOD_DESCRIPTION_EVALUATION_BINDING.request, input: [{ role: "user", content: JSON.stringify(projection) }] };
  const init = { method: "POST", redirect: "error" as const, headers: { "Authorization": "Bearer synthetic", "Content-Type": "application/json", "OpenAI-Project": "proj_synthetic" }, body: JSON.stringify(body) };
  const data = { model: "gpt-6.1-sol", service_tier: "default", status: "completed", id: "resp_synthetic", usage: { input_tokens: 100, output_tokens: 40, total_tokens: 140,
    input_tokens_details: { cached_tokens: 20, cache_write_tokens: 50, cache_write_tokens_details: { ttl_30m_tokens: 20, ttl_12h_tokens: 30 } }, output_tokens_details: { reasoning_tokens: 10 } } };
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => String(url).endsWith("/input_tokens") ? Response.json({ object: "response.input_tokens", input_tokens: 100 }) : Response.json(data));
  return { dir, approval, init, body, data, fetcher, options: { approval, apiKey: "synthetic", now, fetcher } };
}
const endpoint = "https://api.openai.com/v1/responses";
describe("one approved persistent optional-description spending run", () => {
  it("flushes immutable reservation before count and dispatch, counts the exact supported fields, and preserves complete subset cost", async () => {
    const s = setup(), original = s.fetcher.getMockImplementation()!;
    s.fetcher.mockImplementation(async (url, init) => {
      const files = readdirSync(s.dir);
      expect(files).toContain("attempt-001-intent.json"); expect(files).toContain("run.lock");
      const outside=readdirSync(dirname(s.dir));
      const reservation=outside.find(name=>name.endsWith('-attempt-001-intent.json'))!;
      expect(JSON.parse(readFileSync(join(dirname(s.dir),reservation),'utf8'))).toMatchObject({attempt:1,caseId:'description-test-en',turn:1,reservedNanoDollars:55_000_000});
      if (String(url).endsWith("/input_tokens")) {
        expect(outside.some(name=>name.endsWith('-attempt-001-count-dispatch.json'))).toBe(true);
        const counted = JSON.parse(String(init?.body));
        expect(counted).toEqual({ model: s.body.model, input: s.body.input, instructions: s.body.instructions, reasoning: s.body.reasoning, text: s.body.text });
        for (const key of ["store", "max_output_tokens", "service_tier"]) expect(counted).not.toHaveProperty(key);
        expect(files).not.toContain("attempt-001-dispatch.json");
      } else { expect(files).toContain("attempt-001-dispatch.json"); expect(outside.some(name=>name.endsWith('-attempt-001-dispatch.json'))).toBe(true); }
      return original(url, init);
    });
    await withFoodDescriptionEvaluationBudget(s.options, async budget => { await budget.fetch("description-test-en", 1)(endpoint, s.init); expect(budget.attempts()).toBe(1); });
    expect(s.fetcher).toHaveBeenCalledTimes(2);
    const observation = JSON.parse(readFileSync(join(s.dir, "attempt-001-observation.json"), "utf8"));
    expect(observation.measuredNanoDollars).toBe(662000);
    expect(readFileSync(join(s.dir, "approval.json"), "utf8")).not.toContain('Bearer synthetic');
    expect(DESCRIPTION_EVAL_LIMITS.reservationNanoDollars * 80).toBe(4_400_000_000);
    await withFoodDescriptionEvaluationBudget(s.options, async budget => { await expect(budget.fetch("description-test-en", 1)(endpoint, s.init)).rejects.toThrow(); });
    expect(s.fetcher).toHaveBeenCalledTimes(2);
  });
  it.each(["timeout", "count oversized", "count incomplete", "missing usage", "wrong model", "wrong tier", "output oversized", "incomplete"])("keeps %s permanently unknown without retry or refund", async kind => {
    const s = setup();
    if (kind === "timeout") s.fetcher.mockRejectedValue(new Error("synthetic unknown"));
    else if (kind.startsWith("count")) s.fetcher.mockResolvedValue(Response.json(kind === "count oversized" ? { object: "response.input_tokens", input_tokens: 8001 } : { input_tokens: 100 }));
    else {
      const reply = { ...s.data, ...(kind === "wrong model" ? { model: "gpt-6.2-sol" } : kind === "wrong tier" ? { service_tier: "priority" } : kind === "incomplete" ? { status: "incomplete" } : {}),
        usage: kind === "missing usage" ? null : kind === "output oversized" ? { ...s.data.usage, output_tokens: 1501, total_tokens: 1601 } : s.data.usage };
      s.fetcher.mockImplementation(async url => String(url).endsWith("/input_tokens") ? Response.json({ object: "response.input_tokens", input_tokens: 100 }) : Response.json(reply));
    }
    await expect(withFoodDescriptionEvaluationBudget(s.options, budget => budget.fetch("description-test-en", 1)(endpoint, s.init))).rejects.toThrow();
    const calls = s.fetcher.mock.calls.length; expect(readdirSync(s.dir)).toContain("halted.json");
    await expect(withFoodDescriptionEvaluationBudget(s.options, budget => budget.fetch("description-test-en", 1)(endpoint, s.init))).rejects.toThrow();
    expect(s.fetcher).toHaveBeenCalledTimes(calls); expect(JSON.parse(readFileSync(join(s.dir, "attempt-001-intent.json"), "utf8")).reservedNanoDollars).toBe(55_000_000);
  });
  it("rejects current authority/settings/headers before any HTTP or reservation", async () => {
    for (const field of [{ approvedUntil: now().toISOString() }, { fingerprint: "changed" }, { region: "eu" }, { maximumNanoDollars: 0 }, { syntheticOnly: false }]) {
      const s = setup(); await expect(withFoodDescriptionEvaluationBudget({ ...s.options, approval: { ...s.approval, ...field } }, async () => {})).rejects.toThrow(); expect(s.fetcher).not.toHaveBeenCalled();
    }
    for (const change of [{ headers: { ...setup().init.headers, "OpenAI-Project": "proj_other" } }, { body: JSON.stringify({ ...setup().body, max_output_tokens: 1600 }) }, { redirect: "follow" }]) {
      const s = setup(); await expect(withFoodDescriptionEvaluationBudget(s.options, budget => budget.fetch("description-test-en", 1)(endpoint, { ...s.init, ...change } as RequestInit))).rejects.toThrow(); expect(s.fetcher).not.toHaveBeenCalled(); expect(readdirSync(s.dir).some(name => name.includes("intent"))).toBe(false);
    }
  });
  it("holds one exclusive run lock across HTTP, and rejects a changed config or crash-held lock", async () => {
    const s = setup(); let release!: () => void, started!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { started = resolve; });
    const original = s.fetcher.getMockImplementation()!; s.fetcher.mockImplementation(async (url, init) => { if (String(url).endsWith("/input_tokens")) { started(); await waiting; } return original(url, init); });
    const first = withFoodDescriptionEvaluationBudget(s.options, budget => budget.fetch("description-test-en", 1)(endpoint, s.init)); await ready;
    await expect(withFoodDescriptionEvaluationBudget(s.options, async () => {})).rejects.toThrow(); release(); await first;
    await expect(withFoodDescriptionEvaluationBudget({ ...s.options, approval: { ...s.approval, approvalReference: "changed" } }, async () => {})).rejects.toThrow();
    writeFileSync(join(s.dir, "run.lock"), "", { mode: 0o600, flag: "wx" });
    await expect(withFoodDescriptionEvaluationBudget(s.options, async () => {})).rejects.toThrow(); expect(s.fetcher).toHaveBeenCalledTimes(2);
  });
  it("bounds each batch at16 and all restarts at80 reserved generation/count pairs", async () => {
    const s = setup();
    for (let batch = 0; batch < 5; batch++) await withFoodDescriptionEvaluationBudget(s.options, async budget => {
      for (let i = 0; i < 16; i++) await budget.fetch(`description-test-${batch}-${i}-en`, 1)(endpoint, s.init);
      await expect(budget.fetch(`description-test-extra-${batch}-en`, 1)(endpoint, s.init)).rejects.toThrow();
    });
    await withFoodDescriptionEvaluationBudget(s.options, async budget => { expect(budget.attempts()).toBe(80); await expect(budget.fetch("description-last-en", 1)(endpoint, s.init)).rejects.toThrow(); });
    expect(s.fetcher).toHaveBeenCalledTimes(160);
    expect(readdirSync(s.dir).filter(name => name.endsWith("-intent.json"))).toHaveLength(80);
  });
  it("does not double charge cached writes or reasoning and never prices missing usage as zero", () => {
    const s = setup(); expect(foodDescriptionMeasuredNanoDollars(foodDescriptionUsage(s.data))).toBe(662000);
    expect(() => foodDescriptionMeasuredNanoDollars(foodDescriptionUsage({ usage: null }))).toThrow();
  });
  it("does not let a fetch capability escape its exclusive approved run",async()=>{
    const s=setup();const escaped=await withFoodDescriptionEvaluationBudget(s.options,async budget=>budget.fetch("description-test-en",1));
    await expect(escaped(endpoint,s.init)).rejects.toThrow();expect(s.fetcher).not.toHaveBeenCalled();
  });

  it("does not refund the approved budget after its payload directory is deleted or renamed",async()=>{
    const s=setup();await withFoodDescriptionEvaluationBudget(s.options,b=>b.fetch("description-test-en",1)(endpoint,s.init));
    rmSync(s.dir,{recursive:true});
    await expect(withFoodDescriptionEvaluationBudget(s.options,async()=>{})).rejects.toThrow();
    await expect(withFoodDescriptionEvaluationBudget({...s.options,approval:{...s.approval,runDirectory:s.dir+"-new"}},async()=>{})).rejects.toThrow();
    expect(s.fetcher).toHaveBeenCalledTimes(2);
  });

  it.each(['last','all'])("does not refund or redispatch after %s inner attempt files are lost",async kind=>{
    const s=setup();await withFoodDescriptionEvaluationBudget(s.options,async budget=>{await budget.fetch('description-first-en',1)(endpoint,s.init);await budget.fetch('description-last-en',1)(endpoint,s.init);});
    for(const name of readdirSync(s.dir))if(kind==='all'?name.startsWith('attempt-'):name.startsWith('attempt-002-'))rmSync(join(s.dir,name));
    await expect(withFoodDescriptionEvaluationBudget(s.options,b=>b.fetch('description-last-en',1)(endpoint,s.init))).rejects.toThrow();
    expect(s.fetcher).toHaveBeenCalledTimes(4);
    expect(descriptionEvaluationAccounting(s.dir)).toMatchObject({reservedPairs:2,reservedNanoDollars:110_000_000,costComplete:false});
  });

  it.each(['count-dispatch','count','dispatch','observation','response'])("blocks recovery after completed %s evidence is lost",async suffix=>{
    const s=setup();await withFoodDescriptionEvaluationBudget(s.options,b=>b.fetch('description-test-en',1)(endpoint,s.init));
    const path=join(s.dir,`attempt-001-${suffix}.json`);expect(readdirSync(s.dir)).toContain(`attempt-001-${suffix}.json`);rmSync(path);
    await expect(withFoodDescriptionEvaluationBudget(s.options,b=>b.fetch('description-next-en',1)(endpoint,s.init))).rejects.toThrow();
    expect(s.fetcher).toHaveBeenCalledTimes(2);expect(descriptionEvaluationAccounting(s.dir)).toMatchObject({reservedPairs:1,reservedNanoDollars:55_000_000,costComplete:false});
  });

  it('never reports a zero charge or resumes when outside reservation evidence is missing but its inner charge survives',async()=>{
    const s=setup();await withFoodDescriptionEvaluationBudget(s.options,b=>b.fetch('description-test-en',1)(endpoint,s.init));
    const name=readdirSync(dirname(s.dir)).find(file=>file.endsWith('-attempt-001-intent.json'))!;rmSync(join(dirname(s.dir),name));
    expect(()=>descriptionEvaluationAccounting(s.dir)).toThrow();
    await expect(withFoodDescriptionEvaluationBudget(s.options,b=>b.fetch('description-next-en',1)(endpoint,s.init))).rejects.toThrow();expect(s.fetcher).toHaveBeenCalledTimes(2);
  });

  it("holds the final actual filesystem slot against a separate Node process",async()=>{
    const s=setup();for(let batch=0;batch<5;batch++)await withFoodDescriptionEvaluationBudget(s.options,async budget=>{for(let i=0;i<(batch===4?15:16);i++)await budget.fetch(`description-before-${batch}-${i}-en`,1)(endpoint,s.init);});
    const moduleUrl=pathToFileURL(resolve("scripts/food-description-evaluation-budget.ts")).href;
    const code=`const loaded=await import(process.env.TEST_MODULE);const api=loaded.withFoodDescriptionEvaluationBudget?loaded:loaded.default;const release=new Promise(r=>process.once('message',r));await api.withFoodDescriptionEvaluationBudget({approval:JSON.parse(process.env.TEST_APPROVAL),apiKey:'synthetic',now:()=>new Date('2026-11-18T16:00:00Z'),fetcher:async url=>Response.json(String(url).endsWith('/input_tokens')?{object:'response.input_tokens',input_tokens:100}:JSON.parse(process.env.TEST_RESPONSE))},async budget=>{process.send('locked');await release;await budget.fetch('description-final-child-en',1)('https://api.openai.com/v1/responses',JSON.parse(process.env.TEST_INIT));});process.disconnect();`;
    const child=spawn(process.execPath,["--import","tsx","--input-type=module","-e",code],{cwd:process.cwd(),env:{PATH:process.env.PATH,NODE_ENV:"test",TEST_MODULE:moduleUrl,TEST_APPROVAL:JSON.stringify(s.approval),TEST_RESPONSE:JSON.stringify(s.data),TEST_INIT:JSON.stringify(s.init)},stdio:["ignore","ignore","pipe","ipc"]});
    const exited=once(child,"exit");
    try{
      await Promise.race([once(child,"message"),exited.then(()=>{throw new Error("Synthetic child exited before acquiring the lock");})]);await expect(withFoodDescriptionEvaluationBudget(s.options,async()=>{})).rejects.toThrow();child.send("release");
      expect((await exited)[0]).toBe(0);
      await withFoodDescriptionEvaluationBudget(s.options,async budget=>{expect(budget.attempts()).toBe(80);await expect(budget.fetch("description-too-late-en",1)(endpoint,s.init)).rejects.toThrow();});
      expect(s.fetcher).toHaveBeenCalledTimes(158);
    }finally{if(child.exitCode===null)child.kill();}
  },10000);

});

it.each([false, true])("never reconstructs a missing inner approval on any restart (aggregate=%s)", async aggregate => {
  const s = setup(), options = aggregate ? { ...s.options, approval: { ...s.approval, aggregate: { maximumCalls: 87, maximumCountRequests: 87, maximumNanoDollars: 5_000_000_000, priorRuns: await sealedDescriptionEvaluationPriors(s.approval, s.init) } } } : s.options;
  await withFoodDescriptionEvaluationBudget(options, async () => {});
  rmSync(join(s.dir, "approval.json"));
  await expect(withFoodDescriptionEvaluationBudget(options, budget => budget.fetch("description-test-en", 1)(endpoint, s.init))).rejects.toThrow();
  expect(s.fetcher).not.toHaveBeenCalled(); expect(readdirSync(s.dir)).not.toContain("approval.json");
});

it.each(["inner approval", "outside anchor", "halt", "configuration", "project", "unknown usage", "duplicate prior", "successor half", "changed receipt"])("blocks sealed predecessor %s before another endpoint", async kind => {
  const s = setup(), priorRuns = await sealedDescriptionEvaluationPriors(s.approval, s.init), ref = priorRuns[0];
  const original = JSON.parse(readFileSync(join(ref.runDirectory, "approval.json"), "utf8"));
  const prefix = join(dirname(ref.runDirectory), `.food-description-evaluation-${descriptionEvaluationHash(original.approvalReference)}`);
  if (kind === "inner approval") rmSync(join(ref.runDirectory, "approval.json"));
  if (kind === "outside anchor") rmSync(`${prefix}.json`);
  if (kind === "halt") rmSync(`${prefix}-halted.json`);
  if (kind === "configuration") rmSync(ref.configurationPath);
  if (kind === "project") {
    original.projectId = "proj_other";
    writeFileSync(join(ref.runDirectory, "approval.json"), JSON.stringify(original)); writeFileSync(`${prefix}.json`, JSON.stringify(original));
    writeFileSync(ref.configurationPath, JSON.stringify({ approval: original })); ref.configurationSha256 = descriptionEvaluationFileHash(ref.configurationPath); ref.evidenceSha256 = sealedDescriptionEvaluationEvidenceHash(ref.runDirectory);
  }
  if (kind === "unknown usage") { rmSync(join(ref.runDirectory, "attempt-001-response.json")); ref.evidenceSha256 = sealedDescriptionEvaluationEvidenceHash(ref.runDirectory); }
  if (kind === "duplicate prior") priorRuns[1] = { ...ref, reservedPairs: 4 };
  if (kind === "successor half") { writeFileSync(join(ref.runDirectory, "reconciliation-halted.json"), JSON.stringify({ state: "sealed" }), { mode: 0o600 }); ref.evidenceSha256 = sealedDescriptionEvaluationEvidenceHash(ref.runDirectory); }
  if (kind === "changed receipt") writeFileSync(join(ref.runDirectory, "attempt-001-count.json"), '{}');
  await expect(withFoodDescriptionEvaluationBudget({ ...s.options, approval: { ...s.approval, aggregate: { maximumCalls: 87, maximumCountRequests: 87, maximumNanoDollars: 5_000_000_000, priorRuns } } }, budget => budget.fetch("description-test-en", 1)(endpoint, s.init))).rejects.toThrow();
  expect(s.fetcher).not.toHaveBeenCalled();
});

it("retains all7 sealed prior pairs and admits only the final87th aggregate reservation across restart", async () => {
  const s = setup(), priorRuns = await sealedDescriptionEvaluationPriors(s.approval, s.init);
  const approval = { ...s.approval, aggregate: { maximumCalls: 87, maximumCountRequests: 87, maximumNanoDollars: 5_000_000_000, priorRuns } }, options = { ...s.options, approval };
  await withFoodDescriptionEvaluationBudget(options, budget => budget.fetch('description-first-en', 1)(endpoint, s.init));
  const prefix = join(dirname(s.dir), `.food-description-evaluation-${descriptionEvaluationHash(approval.approvalReference)}`);
  // The real80-step test above covers durability; seed complete synthetic history so this checks the new terminal cap without another fsync benchmark.
  for (let attempt = 2; attempt < 80; attempt++) {
    const tag = `attempt-${String(attempt).padStart(3, '0')}`;
    for (const suffix of ['intent', 'count-dispatch', 'count', 'dispatch', 'observation', 'response']) {
      const original = readFileSync(join(s.dir, `attempt-001-${suffix}.json`));
      const bytes = suffix === 'intent' ? JSON.stringify({ ...JSON.parse(original.toString()), attempt, caseId: `description-seeded-${attempt}-en` }) : original;
      writeFileSync(join(s.dir, `${tag}-${suffix}.json`), bytes, { mode: 0o600, flag: 'wx' });
      if (suffix !== 'response') writeFileSync(`${prefix}-${tag}-${suffix}.json`, bytes, { mode: 0o600, flag: 'wx' });
    }
  }
  await withFoodDescriptionEvaluationBudget(options, budget => budget.fetch('description-final-en', 1)(endpoint, s.init));
  const accounting = descriptionEvaluationAccounting(s.dir);
  expect(accounting).toMatchObject({ reservedPairs: 80, costComplete: true, countHttpAttemptMarkers: 80, generationHttpAttemptMarkers: 80 });
  expect(accounting.reservedPairs + priorRuns.reduce((total, ref) => total + ref.reservedPairs, 0)).toBe(87);
  expect(accounting.reservedNanoDollars + 7 * 55_000_000).toBe(4_785_000_000);
  const calls = s.fetcher.mock.calls.length;
  await expect(withFoodDescriptionEvaluationBudget(options, budget => budget.fetch('description-forbidden-88-en', 1)(endpoint, s.init))).rejects.toThrow();
  expect(s.fetcher).toHaveBeenCalledTimes(calls); expect(calls).toBe(4);
});

it("preserves all13 prior reservations but uses complete measured charges to admit the final93rd pair", async () => {
  const s = setup(), priorRuns = await sealedDescriptionEvaluationPriors(s.approval, s.init, true);
  const before = priorRuns.map(ref => sealedDescriptionEvaluationEvidenceHash(ref.runDirectory));
  const approval = { ...s.approval, aggregate: { maximumCalls: 93, maximumCountRequests: 93, maximumNanoDollars: 5_000_000_000, priorRuns } }, options = { ...s.options, approval };
  await withFoodDescriptionEvaluationBudget(options, budget => budget.fetch('description-first-en', 1)(endpoint, s.init));
  const prefix = join(dirname(s.dir), `.food-description-evaluation-${descriptionEvaluationHash(approval.approvalReference)}`);
  for (let attempt = 2; attempt < 80; attempt++) {
    const tag = `attempt-${String(attempt).padStart(3, '0')}`;
    for (const suffix of ['intent', 'count-dispatch', 'count', 'dispatch', 'observation', 'response']) {
      const original = readFileSync(join(s.dir, `attempt-001-${suffix}.json`));
      const bytes = suffix === 'intent' ? JSON.stringify({ ...JSON.parse(original.toString()), attempt, caseId: `description-seeded-${attempt}-en` }) : original;
      writeFileSync(join(s.dir, `${tag}-${suffix}.json`), bytes, { mode: 0o600, flag: 'wx' });
      if (suffix !== 'response') writeFileSync(`${prefix}-${tag}-${suffix}.json`, bytes, { mode: 0o600, flag: 'wx' });
    }
  }
  await withFoodDescriptionEvaluationBudget(options, budget => budget.fetch('description-final-en', 1)(endpoint, s.init));
  expect(descriptionEvaluationAccounting(s.dir)).toMatchObject({reservedPairs:80,reservedNanoDollars:4_400_000_000,costComplete:true});
  expect(priorRuns.map(ref=>descriptionEvaluationAccounting(ref.runDirectory).reservedPairs)).toEqual([3,4,6]);
  expect(priorRuns.map(ref=>sealedDescriptionEvaluationEvidenceHash(ref.runDirectory))).toEqual(before);
  expect(sealedDescriptionEvaluationPriorAccounting(descriptionEvaluationApprovalSchema.parse(approval))).toEqual({pairs:13,reservedNanoDollars:715_000_000,knownMeasuredNanoDollars:7_800_000,budgetedNanoDollars:7_800_000});
  await expect(withFoodDescriptionEvaluationBudget(options,budget=>budget.fetch('description-forbidden-94-en',1)(endpoint,s.init))).rejects.toThrow();
  expect(s.fetcher).toHaveBeenCalledTimes(4);
});

it.each(['unsealed third','nested reference','missing aggregate','missing response','false charge','invalid usage','renewed deadline','changed project','earlier mutation','duplicate prior','wrong count','expanded maximum'])("blocks93 history %s before any new endpoint",async kind=>{
  const s=setup(),priorRuns=await sealedDescriptionEvaluationPriors(s.approval,s.init,true),ref=priorRuns[2];
  const approval={...s.approval,aggregate:{maximumCalls:93,maximumCountRequests:93,maximumNanoDollars:5_000_000_000,priorRuns}};
  const config=JSON.parse(readFileSync(ref.configurationPath,'utf8')),prior=config.approval;
  const prefix=join(dirname(ref.runDirectory),`.food-description-evaluation-${descriptionEvaluationHash(prior.approvalReference)}`);
  if(kind==='unsealed third'){rmSync(join(ref.runDirectory,'halted.json'));rmSync(`${prefix}-halted.json`);}
  if(kind==='nested reference')prior.aggregate.priorRuns[0].evidenceSha256='f'.repeat(64);
  if(kind==='missing aggregate')delete prior.aggregate;
  if(kind==='missing response')rmSync(join(ref.runDirectory,'attempt-001-response.json'));
  if(kind==='false charge'||kind==='invalid usage'){
    const path=join(ref.runDirectory,'attempt-001-observation.json'),observation=JSON.parse(readFileSync(path,'utf8'));
    if(kind==='false charge')observation.measuredNanoDollars=0;
    else{const responsePath=join(ref.runDirectory,'attempt-001-response.json'),response=JSON.parse(readFileSync(responsePath,'utf8'));response.usage.input_tokens_details.cached_tokens=101;writeFileSync(responsePath,JSON.stringify(response));observation.responseHash=descriptionEvaluationHash(response);}
    for(const p of [path,`${prefix}-attempt-001-observation.json`])writeFileSync(p,JSON.stringify(observation));
  }
  if(kind==='renewed deadline')approval.approvedUntil='2026-11-18T23:59:59Z';
  if(kind==='changed project')approval.projectId='proj_other';
  if(kind==='earlier mutation')writeFileSync(join(priorRuns[0].runDirectory,'late-result.json'),'{}',{mode:0o600});
  if(kind==='nested reference'||kind==='missing aggregate'){
    for(const p of [join(ref.runDirectory,'approval.json'),`${prefix}.json`])writeFileSync(p,JSON.stringify(prior));
    writeFileSync(ref.configurationPath,JSON.stringify(config));ref.configurationSha256=descriptionEvaluationFileHash(ref.configurationPath);
  }
  ref.evidenceSha256=sealedDescriptionEvaluationEvidenceHash(ref.runDirectory);
  if(kind==='duplicate prior')priorRuns[2]={...priorRuns[0],reservedPairs:6};
  if(kind==='wrong count')ref.reservedPairs=4;
  if(kind==='expanded maximum')approval.aggregate.maximumCalls=94;
  await expect(withFoodDescriptionEvaluationBudget({...s.options,approval},budget=>budget.fetch('description-new-en',1)(endpoint,s.init))).rejects.toThrow();
  expect(s.fetcher).not.toHaveBeenCalled();
});

it.each([3,4]as const)("still enforces the original5 dollars when%s complete prior histories exceed the planned headroom",async histories=>{
  const s=setup(),priorRuns=await sealedDescriptionEvaluationPriors(s.approval,s.init,histories===4?4:true,true),pairs=histories===4?20:13,allowed=histories===4?70:77;
  const maximum=histories===4?100:93,approval={...s.approval,aggregate:{maximumCalls:maximum,maximumCountRequests:maximum,maximumNanoDollars:5_000_000_000,priorRuns}},options={...s.options,approval};
  expect(sealedDescriptionEvaluationPriorAccounting(descriptionEvaluationApprovalSchema.parse(approval))).toMatchObject({pairs,knownMeasuredNanoDollars:pairs*55_000_000,budgetedNanoDollars:pairs*55_000_000});
  await withFoodDescriptionEvaluationBudget(options,budget=>budget.fetch('description-first-en',1)(endpoint,s.init));
  const prefix=join(dirname(s.dir),`.food-description-evaluation-${descriptionEvaluationHash(approval.approvalReference)}`);
  for(let attempt=2;attempt<=allowed;attempt++)for(const suffix of ['intent','count-dispatch','count','dispatch','observation','response']){
    const original=readFileSync(join(s.dir,`attempt-001-${suffix}.json`));
    const bytes=suffix==='intent'?JSON.stringify({...JSON.parse(original.toString()),attempt,caseId:`description-seeded-${attempt}-en`}):original;
    const stem=`attempt-${String(attempt).padStart(3,'0')}`;writeFileSync(join(s.dir,`${stem}-${suffix}.json`),bytes,{mode:0o600,flag:'wx'});
    if(suffix!=='response')writeFileSync(`${prefix}-${stem}-${suffix}.json`,bytes,{mode:0o600,flag:'wx'});
  }
  await expect(withFoodDescriptionEvaluationBudget(options,budget=>budget.fetch('description-cap-en',1)(endpoint,s.init))).rejects.toThrow();
  expect(descriptionEvaluationAccounting(s.dir)).toMatchObject({reservedPairs:allowed,reservedNanoDollars:allowed*55_000_000,costComplete:true});
  expect(s.fetcher).toHaveBeenCalledTimes(2);
});

it.each([93,100,120,133,172]as const)("refuses pre-existing quality results in a fresh%s run without changing the sealed histories",async maximum=>{
  const s=setup(),priorRuns=await sealedDescriptionEvaluationPriors(s.approval,s.init,maximum===172?7:maximum===133?6:maximum===120?5:maximum===100?4:true);
  const before=priorRuns.map(ref=>sealedDescriptionEvaluationEvidenceHash(ref.runDirectory));
  const approval={...s.approval,...(maximum>=120?{rateCardDate:'2026-11-19',approvedUntil:'2026-11-19T04:59:59Z'}:{}),aggregate:{maximumCalls:maximum,maximumCountRequests:maximum,maximumNanoDollars:5_000_000_000,priorRuns}};
  mkdirSync(s.dir,{mode:0o700});writeFileSync(join(s.dir,'description-urgent-1-en-result.json'),'{"synthetic":"retained quality from another source"}',{mode:0o600});
  await expect(withFoodDescriptionEvaluationBudget({...s.options,approval,...(maximum>=120?{now:()=>new Date('2026-11-19T00:30:00Z')}:{})},async()=>{})).rejects.toThrow();
  expect(s.fetcher).not.toHaveBeenCalled();expect(priorRuns.map(ref=>sealedDescriptionEvaluationEvidenceHash(ref.runDirectory))).toEqual(before);
});

it("counts the exact3/4/6/7 histories once and preserves20 old reservations before100 total pairs",async()=>{
  const s=setup(),priorRuns=await sealedDescriptionEvaluationPriors(s.approval,s.init,4);
  const approval={...s.approval,aggregate:{maximumCalls:100,maximumCountRequests:100,maximumNanoDollars:5_000_000_000,priorRuns}},options={...s.options,approval};
  const before=priorRuns.map(ref=>sealedDescriptionEvaluationEvidenceHash(ref.runDirectory));
  await withFoodDescriptionEvaluationBudget(options,budget=>budget.fetch('description-first-en',1)(endpoint,s.init));
  expect(sealedDescriptionEvaluationPriorAccounting(descriptionEvaluationApprovalSchema.parse(approval))).toEqual({pairs:20,reservedNanoDollars:1_100_000_000,knownMeasuredNanoDollars:12_000_000,budgetedNanoDollars:12_000_000});
  const prefix=join(dirname(s.dir),`.food-description-evaluation-${descriptionEvaluationHash(approval.approvalReference)}`);
  for(let attempt=2;attempt<80;attempt++)for(const suffix of ['intent','count-dispatch','count','dispatch','observation','response']){
    const original=readFileSync(join(s.dir,`attempt-001-${suffix}.json`)),bytes=suffix==='intent'?JSON.stringify({...JSON.parse(original.toString()),attempt,caseId:`description-seeded-${attempt}-en`}):original;
    const stem=`attempt-${String(attempt).padStart(3,'0')}`;writeFileSync(join(s.dir,`${stem}-${suffix}.json`),bytes,{mode:0o600,flag:'wx'});if(suffix!=='response')writeFileSync(`${prefix}-${stem}-${suffix}.json`,bytes,{mode:0o600,flag:'wx'});
  }
  await withFoodDescriptionEvaluationBudget(options,budget=>budget.fetch('description-final-en',1)(endpoint,s.init));
  expect(descriptionEvaluationAccounting(s.dir)).toMatchObject({reservedPairs:80,reservedNanoDollars:4_400_000_000,costComplete:true});
  await expect(withFoodDescriptionEvaluationBudget(options,budget=>budget.fetch('description-forbidden-101-en',1)(endpoint,s.init))).rejects.toThrow();
  expect(s.fetcher).toHaveBeenCalledTimes(4);expect(priorRuns.map(ref=>sealedDescriptionEvaluationEvidenceHash(ref.runDirectory))).toEqual(before);
});

it.each(['wrong nested reference','wrong fourth aggregate','unsealed fourth','missing response','false charge','renewed fourth expiry','duplicate fourth'])("blocks100 %s before any new endpoint",async kind=>{
  const s=setup(),priorRuns=await sealedDescriptionEvaluationPriors(s.approval,s.init,4),ref=priorRuns[3];
  const approval={...s.approval,aggregate:{maximumCalls:100,maximumCountRequests:100,maximumNanoDollars:5_000_000_000,priorRuns}};
  const config=JSON.parse(readFileSync(ref.configurationPath,'utf8')),prior=config.approval,prefix=join(dirname(ref.runDirectory),`.food-description-evaluation-${descriptionEvaluationHash(prior.approvalReference)}`);
  if(kind==='wrong nested reference')prior.aggregate.priorRuns[2].evidenceSha256='f'.repeat(64);
  if(kind==='wrong fourth aggregate')prior.aggregate={...prior.aggregate,maximumCalls:87,maximumCountRequests:87,priorRuns:prior.aggregate.priorRuns.slice(0,2)};
  if(kind==='unsealed fourth'){rmSync(join(ref.runDirectory,'halted.json'));rmSync(`${prefix}-halted.json`);}
  if(kind==='missing response')rmSync(join(ref.runDirectory,'attempt-001-response.json'));
  if(kind==='false charge')for(const p of [join(ref.runDirectory,'attempt-001-observation.json'),`${prefix}-attempt-001-observation.json`]){const observation=JSON.parse(readFileSync(p,'utf8'));observation.measuredNanoDollars=0;writeFileSync(p,JSON.stringify(observation));}
  if(kind==='renewed fourth expiry')prior.approvedUntil='2026-11-18T23:59:59Z';
  if(['wrong nested reference','wrong fourth aggregate','renewed fourth expiry'].includes(kind)){
    for(const p of [join(ref.runDirectory,'approval.json'),`${prefix}.json`])writeFileSync(p,JSON.stringify(prior));
    writeFileSync(ref.configurationPath,JSON.stringify(config));ref.configurationSha256=descriptionEvaluationFileHash(ref.configurationPath);
  }
  ref.evidenceSha256=sealedDescriptionEvaluationEvidenceHash(ref.runDirectory);
  if(kind==='duplicate fourth')priorRuns[3]={...priorRuns[2],reservedPairs:7};
  await expect(withFoodDescriptionEvaluationBudget({...s.options,approval},budget=>budget.fetch('description-new-en',1)(endpoint,s.init))).rejects.toThrow();
  expect(s.fetcher).not.toHaveBeenCalled();
});

it("starts the new120 window without rewriting any expired prior approval or reservation",async()=>{
  const s=setup(),priorRuns=await sealedDescriptionEvaluationPriors(s.approval,s.init,5);
  const before=priorRuns.map(ref=>sealedDescriptionEvaluationEvidenceHash(ref.runDirectory));
  const approval={...s.approval,rateCardDate:"2026-11-19",approvedUntil:"2026-11-19T04:59:59Z",aggregate:{maximumCalls:120,maximumCountRequests:120,maximumNanoDollars:5_000_000_000,priorRuns}};
  const options={...s.options,approval,now:()=>new Date("2026-11-19T00:30:00Z")};
  await withFoodDescriptionEvaluationBudget(options,budget=>budget.fetch('description-first-en',1)(endpoint,s.init));
  const prefix=join(dirname(s.dir),`.food-description-evaluation-${descriptionEvaluationHash(approval.approvalReference)}`);
  for(let attempt=2;attempt<80;attempt++)for(const suffix of ['intent','count-dispatch','count','dispatch','observation','response']){
    const original=readFileSync(join(s.dir,`attempt-001-${suffix}.json`)),bytes=suffix==='intent'?JSON.stringify({...JSON.parse(original.toString()),attempt,caseId:`description-seeded-${attempt}-en`}):original;
    const stem=`attempt-${String(attempt).padStart(3,'0')}`;writeFileSync(join(s.dir,`${stem}-${suffix}.json`),bytes,{mode:0o600,flag:'wx'});if(suffix!=='response')writeFileSync(`${prefix}-${stem}-${suffix}.json`,bytes,{mode:0o600,flag:'wx'});
  }
  await withFoodDescriptionEvaluationBudget(options,budget=>budget.fetch('description-final-en',1)(endpoint,s.init));
  expect(descriptionEvaluationAccounting(s.dir)).toMatchObject({reservedPairs:80,reservedNanoDollars:4_400_000_000,costComplete:true});
  await expect(withFoodDescriptionEvaluationBudget(options,budget=>budget.fetch('description-forbidden-121-en',1)(endpoint,s.init))).rejects.toThrow();
  expect(sealedDescriptionEvaluationPriorAccounting(descriptionEvaluationApprovalSchema.parse(approval))).toEqual({pairs:40,reservedNanoDollars:2_200_000_000,knownMeasuredNanoDollars:24_000_000,budgetedNanoDollars:24_000_000});
  expect(priorRuns.map(ref=>sealedDescriptionEvaluationEvidenceHash(ref.runDirectory))).toEqual(before);
  for(const ref of priorRuns)expect(JSON.parse(readFileSync(join(ref.runDirectory,'approval.json'),'utf8'))).toMatchObject({rateCardDate:'2026-11-18',approvedUntil:'2026-11-18T23:59:59Z'});
  await expect(withFoodDescriptionEvaluationBudget({...options,now:()=>new Date('2026-11-19T04:59:59Z')},async()=>{})).rejects.toThrow();
  expect(s.fetcher).toHaveBeenCalledTimes(4);
});

it("pins the120 card and bounded window before any durable or endpoint action",async()=>{
  const s=setup(),priorRuns=await sealedDescriptionEvaluationPriors(s.approval,s.init,5);
  const approval={...s.approval,rateCardDate:'2026-11-19',approvedUntil:'2026-11-19T04:59:59Z',aggregate:{maximumCalls:120,maximumCountRequests:120,maximumNanoDollars:5_000_000_000,priorRuns}};
  const files=readdirSync(dirname(s.dir)).sort();
  for(const changed of [{rateCardDate:'2026-11-18'},{rateCardDate:'2026-11-20'},{approvedUntil:'2026-11-19T05:00:00Z'},{approvedUntil:'2026-11-20T04:59:59Z'},{maximumNanoDollars:5_000_000_001}])
    await expect(withFoodDescriptionEvaluationBudget({...s.options,approval:{...approval,...changed},now:()=>new Date('2026-11-19T00:30:00Z')},async()=>{})).rejects.toThrow();
  for(const date of ['2026-11-18T23:59:58Z','2026-11-19T04:59:59Z','2026-11-20T00:30:00Z'])
    await expect(withFoodDescriptionEvaluationBudget({...s.options,approval,now:()=>new Date(date)},async()=>{})).rejects.toThrow();
  expect(readdirSync(dirname(s.dir)).sort()).toEqual(files);expect(s.fetcher).not.toHaveBeenCalled();
});

it.each(['missing fifth','wrong nested reference','wrong fifth aggregate','unsealed fifth','missing response','false charge','changed old expiry','changed old card','duplicate fifth'])("blocks120 %s without a new endpoint or old-ledger refund",async kind=>{
  const s=setup(),priorRuns=await sealedDescriptionEvaluationPriors(s.approval,s.init,5),ref=priorRuns[4];
  const approval={...s.approval,rateCardDate:'2026-11-19',approvedUntil:'2026-11-19T04:59:59Z',aggregate:{maximumCalls:120,maximumCountRequests:120,maximumNanoDollars:5_000_000_000,priorRuns}};
  const config=JSON.parse(readFileSync(ref.configurationPath,'utf8')),prior=config.approval,prefix=join(dirname(ref.runDirectory),`.food-description-evaluation-${descriptionEvaluationHash(prior.approvalReference)}`);
  if(kind==='wrong nested reference')prior.aggregate.priorRuns[3].evidenceSha256='f'.repeat(64);
  if(kind==='wrong fifth aggregate')prior.aggregate={...prior.aggregate,maximumCalls:93,maximumCountRequests:93,priorRuns:prior.aggregate.priorRuns.slice(0,3)};
  if(kind==='unsealed fifth'){rmSync(join(ref.runDirectory,'halted.json'));rmSync(`${prefix}-halted.json`);}
  if(kind==='missing response')rmSync(join(ref.runDirectory,'attempt-001-response.json'));
  if(kind==='false charge')for(const p of [join(ref.runDirectory,'attempt-001-observation.json'),`${prefix}-attempt-001-observation.json`]){const observed=JSON.parse(readFileSync(p,'utf8'));observed.measuredNanoDollars=0;writeFileSync(p,JSON.stringify(observed));}
  if(kind==='changed old expiry')prior.approvedUntil='2026-11-19T04:59:59Z';
  if(kind==='changed old card')prior.rateCardDate='2026-11-19';
  if(['wrong nested reference','wrong fifth aggregate','changed old expiry','changed old card'].includes(kind)){
    for(const p of [join(ref.runDirectory,'approval.json'),`${prefix}.json`])writeFileSync(p,JSON.stringify(prior));
    writeFileSync(ref.configurationPath,JSON.stringify(config));ref.configurationSha256=descriptionEvaluationFileHash(ref.configurationPath);
  }
  ref.evidenceSha256=sealedDescriptionEvaluationEvidenceHash(ref.runDirectory);
  if(kind==='missing fifth')priorRuns.pop();
  if(kind==='duplicate fifth')priorRuns[4]={...priorRuns[3],reservedPairs:20};
  await expect(withFoodDescriptionEvaluationBudget({...s.options,approval,now:()=>new Date('2026-11-19T00:30:00Z')},budget=>budget.fetch('description-new-en',1)(endpoint,s.init))).rejects.toThrow();
  expect(s.fetcher).not.toHaveBeenCalled();
});

it("keeps the original5 ceiling when all40 prior charges consume their full reservations",async()=>{
  const s=setup(),priorRuns=await sealedDescriptionEvaluationPriors(s.approval,s.init,5,true);
  const approval={...s.approval,rateCardDate:'2026-11-19',approvedUntil:'2026-11-19T04:59:59Z',aggregate:{maximumCalls:120,maximumCountRequests:120,maximumNanoDollars:5_000_000_000,priorRuns}},options={...s.options,approval,now:()=>new Date('2026-11-19T00:30:00Z')};
  expect(sealedDescriptionEvaluationPriorAccounting(descriptionEvaluationApprovalSchema.parse(approval))).toMatchObject({pairs:40,knownMeasuredNanoDollars:2_200_000_000,reservedNanoDollars:2_200_000_000});
  await withFoodDescriptionEvaluationBudget(options,budget=>budget.fetch('description-first-en',1)(endpoint,s.init));
  const prefix=join(dirname(s.dir),`.food-description-evaluation-${descriptionEvaluationHash(approval.approvalReference)}`);
  for(let attempt=2;attempt<=50;attempt++)for(const suffix of ['intent','count-dispatch','count','dispatch','observation','response']){
    const original=readFileSync(join(s.dir,`attempt-001-${suffix}.json`)),bytes=suffix==='intent'?JSON.stringify({...JSON.parse(original.toString()),attempt,caseId:`description-seeded-${attempt}-en`}):original;
    const stem=`attempt-${String(attempt).padStart(3,'0')}`;writeFileSync(join(s.dir,`${stem}-${suffix}.json`),bytes,{mode:0o600,flag:'wx'});if(suffix!=='response')writeFileSync(`${prefix}-${stem}-${suffix}.json`,bytes,{mode:0o600,flag:'wx'});
  }
  await expect(withFoodDescriptionEvaluationBudget(options,budget=>budget.fetch('description-no-extra-dollar-en',1)(endpoint,s.init))).rejects.toThrow();
  expect(descriptionEvaluationAccounting(s.dir)).toMatchObject({reservedPairs:50,reservedNanoDollars:2_750_000_000,costComplete:true});expect(s.fetcher).toHaveBeenCalledTimes(2);
});


it("accepts only the exact133 continuation shape without resetting the original cap",()=>{
  const s=setup(),counts=[3,4,6,7,20,13];
  const priorRuns=counts.map((reservedPairs,index)=>({runDirectory:join(dirname(s.dir),`shape-prior-${index}`),configurationPath:join(dirname(s.dir),`shape-${index}.json`),configurationSha256:'a'.repeat(64),evidenceSha256:'b'.repeat(64),reservedPairs}));
  const approval={...s.approval,rateCardDate:'2026-11-19',approvedUntil:'2026-11-19T04:59:59Z',aggregate:{maximumCalls:133,maximumCountRequests:133,maximumNanoDollars:5_000_000_000,priorRuns}};
  expect(descriptionEvaluationApprovalSchema.parse(approval)).toMatchObject({maximumCalls:80,maximumCountRequests:80,maximumNanoDollars:5_000_000_000,aggregate:{maximumCalls:133,maximumCountRequests:133}});
  for(const maximum of [132,134])expect(descriptionEvaluationApprovalSchema.safeParse({...approval,aggregate:{...approval.aggregate,maximumCalls:maximum,maximumCountRequests:maximum}}).success).toBe(false);
  expect(descriptionEvaluationApprovalSchema.safeParse({...approval,maximumNanoDollars:5_000_000_001}).success).toBe(false);
});


it("retains all53 sealed charges and admits only the final133rd aggregate pair",async()=>{
  const s=setup(),priorRuns=await sealedDescriptionEvaluationPriors(s.approval,s.init,6);
  const before=priorRuns.map(ref=>sealedDescriptionEvaluationEvidenceHash(ref.runDirectory));
  const approval={...s.approval,rateCardDate:'2026-11-19',approvedUntil:'2026-11-19T04:59:59Z',aggregate:{maximumCalls:133,maximumCountRequests:133,maximumNanoDollars:5_000_000_000,priorRuns}},options={...s.options,approval,now:()=>new Date('2026-11-19T00:30:00Z')};
  await withFoodDescriptionEvaluationBudget(options,budget=>budget.fetch('description-first-en',1)(endpoint,s.init));
  const prefix=join(dirname(s.dir),`.food-description-evaluation-${descriptionEvaluationHash(approval.approvalReference)}`);
  for(let attempt=2;attempt<80;attempt++)for(const suffix of ['intent','count-dispatch','count','dispatch','observation','response']){
    const original=readFileSync(join(s.dir,`attempt-001-${suffix}.json`)),bytes=suffix==='intent'?JSON.stringify({...JSON.parse(original.toString()),attempt,caseId:`description-seeded-${attempt}-en`}):original;
    const stem=`attempt-${String(attempt).padStart(3,'0')}`;writeFileSync(join(s.dir,`${stem}-${suffix}.json`),bytes,{mode:0o600,flag:'wx'});if(suffix!=='response')writeFileSync(`${prefix}-${stem}-${suffix}.json`,bytes,{mode:0o600,flag:'wx'});
  }
  await withFoodDescriptionEvaluationBudget(options,budget=>budget.fetch('description-final-en',1)(endpoint,s.init));
  expect(descriptionEvaluationAccounting(s.dir)).toMatchObject({reservedPairs:80,reservedNanoDollars:4_400_000_000,costComplete:true});
  expect(sealedDescriptionEvaluationPriorAccounting(descriptionEvaluationApprovalSchema.parse(approval))).toEqual({pairs:53,reservedNanoDollars:2_915_000_000,knownMeasuredNanoDollars:31_800_000,budgetedNanoDollars:31_800_000});
  await expect(withFoodDescriptionEvaluationBudget(options,budget=>budget.fetch('description-forbidden-134-en',1)(endpoint,s.init))).rejects.toThrow();
  expect(s.fetcher).toHaveBeenCalledTimes(4);expect(priorRuns.map(ref=>sealedDescriptionEvaluationEvidenceHash(ref.runDirectory))).toEqual(before);
  for(const [index,ref]of priorRuns.entries())expect(JSON.parse(readFileSync(join(ref.runDirectory,'approval.json'),'utf8'))).toMatchObject(index<5?{rateCardDate:'2026-11-18',approvedUntil:'2026-11-18T23:59:59Z'}:{rateCardDate:'2026-11-19',approvedUntil:'2026-11-19T04:59:59Z',aggregate:{maximumCalls:120}});
});

it("pins133 to the same current window and original5 before any new durable action",async()=>{
  const s=setup(),priorRuns=await sealedDescriptionEvaluationPriors(s.approval,s.init,6),before=readdirSync(dirname(s.dir)).sort();
  const approval={...s.approval,rateCardDate:'2026-11-19',approvedUntil:'2026-11-19T04:59:59Z',aggregate:{maximumCalls:133,maximumCountRequests:133,maximumNanoDollars:5_000_000_000,priorRuns}};
  for(const changed of [{rateCardDate:'2026-11-18'},{rateCardDate:'2026-11-20'},{approvedUntil:'2026-11-19T05:00:00Z'},{approvedUntil:'2026-11-20T04:59:59Z'},{maximumNanoDollars:5_000_000_001}])
    await expect(withFoodDescriptionEvaluationBudget({...s.options,approval:{...approval,...changed},now:()=>new Date('2026-11-19T00:30:00Z')},async()=>{})).rejects.toThrow();
  for(const date of ['2026-11-18T23:59:58Z','2026-11-19T04:59:59Z','2026-11-20T00:30:00Z'])
    await expect(withFoodDescriptionEvaluationBudget({...s.options,approval,now:()=>new Date(date)},async()=>{})).rejects.toThrow();
  expect(readdirSync(dirname(s.dir)).sort()).toEqual(before);expect(s.fetcher).not.toHaveBeenCalled();
});

it.each(['missing sixth','wrong nested reference','wrong sixth aggregate','unsealed sixth','missing response','false charge','unknown usage','changed sixth expiry','changed sixth card','duplicate sixth','wrong sixth count'])("blocks133 %s before any new endpoint or refund",async kind=>{
  const s=setup(),priorRuns=await sealedDescriptionEvaluationPriors(s.approval,s.init,6),ref=priorRuns[5];
  const approval={...s.approval,rateCardDate:'2026-11-19',approvedUntil:'2026-11-19T04:59:59Z',aggregate:{maximumCalls:133,maximumCountRequests:133,maximumNanoDollars:5_000_000_000,priorRuns}};
  const config=JSON.parse(readFileSync(ref.configurationPath,'utf8')),prior=config.approval,prefix=join(dirname(ref.runDirectory),`.food-description-evaluation-${descriptionEvaluationHash(prior.approvalReference)}`);
  if(kind==='wrong nested reference')prior.aggregate.priorRuns[4].evidenceSha256='f'.repeat(64);
  if(kind==='wrong sixth aggregate')prior.aggregate={...prior.aggregate,maximumCalls:100,maximumCountRequests:100,priorRuns:prior.aggregate.priorRuns.slice(0,4)};
  if(kind==='unsealed sixth'){rmSync(join(ref.runDirectory,'halted.json'));rmSync(`${prefix}-halted.json`);}
  if(kind==='missing response')rmSync(join(ref.runDirectory,'attempt-001-response.json'));
  if(kind==='false charge'||kind==='unknown usage')for(const path of [join(ref.runDirectory,'attempt-001-observation.json'),`${prefix}-attempt-001-observation.json`]){
    const observation=JSON.parse(readFileSync(path,'utf8'));if(kind==='false charge')observation.measuredNanoDollars=0;else observation.usage={complete:false};writeFileSync(path,JSON.stringify(observation));
  }
  if(kind==='changed sixth expiry')prior.approvedUntil='2026-11-19T05:00:00Z';
  if(kind==='changed sixth card')prior.rateCardDate='2026-11-18';
  if(['wrong nested reference','wrong sixth aggregate','changed sixth expiry','changed sixth card'].includes(kind)){
    for(const path of [join(ref.runDirectory,'approval.json'),`${prefix}.json`])writeFileSync(path,JSON.stringify(prior));
    writeFileSync(ref.configurationPath,JSON.stringify(config));ref.configurationSha256=descriptionEvaluationFileHash(ref.configurationPath);
  }
  ref.evidenceSha256=sealedDescriptionEvaluationEvidenceHash(ref.runDirectory);
  if(kind==='missing sixth')priorRuns.pop();
  if(kind==='duplicate sixth')priorRuns[5]={...priorRuns[4],reservedPairs:13};
  if(kind==='wrong sixth count')priorRuns[5]={...ref,reservedPairs:20};
  await expect(withFoodDescriptionEvaluationBudget({...s.options,approval,now:()=>new Date('2026-11-19T00:30:00Z')},budget=>budget.fetch('description-new-en',1)(endpoint,s.init))).rejects.toThrow();
  expect(s.fetcher).not.toHaveBeenCalled();expect(descriptionEvaluationAccounting(ref.runDirectory).reservedPairs).toBe(13);
});

it("retains the original5 ceiling when all53 prior charges used their reservations",async()=>{
  const s=setup(),priorRuns=await sealedDescriptionEvaluationPriors(s.approval,s.init,6,true);
  const approval={...s.approval,rateCardDate:'2026-11-19',approvedUntil:'2026-11-19T04:59:59Z',aggregate:{maximumCalls:133,maximumCountRequests:133,maximumNanoDollars:5_000_000_000,priorRuns}},options={...s.options,approval,now:()=>new Date('2026-11-19T00:30:00Z')};
  expect(sealedDescriptionEvaluationPriorAccounting(descriptionEvaluationApprovalSchema.parse(approval))).toMatchObject({pairs:53,knownMeasuredNanoDollars:2_915_000_000,reservedNanoDollars:2_915_000_000});
  await withFoodDescriptionEvaluationBudget(options,budget=>budget.fetch('description-first-en',1)(endpoint,s.init));
  const prefix=join(dirname(s.dir),`.food-description-evaluation-${descriptionEvaluationHash(approval.approvalReference)}`);
  for(let attempt=2;attempt<=37;attempt++)for(const suffix of ['intent','count-dispatch','count','dispatch','observation','response']){
    const original=readFileSync(join(s.dir,`attempt-001-${suffix}.json`)),bytes=suffix==='intent'?JSON.stringify({...JSON.parse(original.toString()),attempt,caseId:`description-seeded-${attempt}-en`}):original;
    const stem=`attempt-${String(attempt).padStart(3,'0')}`;writeFileSync(join(s.dir,`${stem}-${suffix}.json`),bytes,{mode:0o600,flag:'wx'});if(suffix!=='response')writeFileSync(`${prefix}-${stem}-${suffix}.json`,bytes,{mode:0o600,flag:'wx'});
  }
  await expect(withFoodDescriptionEvaluationBudget(options,budget=>budget.fetch('description-no-extra-dollar-en',1)(endpoint,s.init))).rejects.toThrow();
  expect(descriptionEvaluationAccounting(s.dir)).toMatchObject({reservedPairs:37,reservedNanoDollars:2_035_000_000,costComplete:true});expect(s.fetcher).toHaveBeenCalledTimes(2);
});

it("accepts only the exact172 continuation shape without resetting the original cap",()=>{
  const s=setup(),counts=[3,4,6,7,20,13,39];
  const priorRuns=counts.map((reservedPairs,index)=>({runDirectory:join(dirname(s.dir),`shape-prior-${index}`),configurationPath:join(dirname(s.dir),`shape-${index}.json`),configurationSha256:'a'.repeat(64),evidenceSha256:'b'.repeat(64),reservedPairs}));
  const approval={...s.approval,rateCardDate:'2026-11-19',approvedUntil:'2026-11-19T04:59:59Z',aggregate:{maximumCalls:172,maximumCountRequests:172,maximumNanoDollars:5_000_000_000,priorRuns}};
  expect(descriptionEvaluationApprovalSchema.parse(approval)).toMatchObject({maximumCalls:80,maximumCountRequests:80,maximumNanoDollars:5_000_000_000,aggregate:{maximumCalls:172,maximumCountRequests:172}});
  for(const maximum of [171,173])expect(descriptionEvaluationApprovalSchema.safeParse({...approval,aggregate:{...approval.aggregate,maximumCalls:maximum,maximumCountRequests:maximum}}).success).toBe(false);
  expect(descriptionEvaluationApprovalSchema.safeParse({...approval,maximumNanoDollars:5_000_000_001}).success).toBe(false);
});


it("retains all92 sealed charges and admits only the final172nd aggregate pair",async()=>{
  const s=setup(),priorRuns=await sealedDescriptionEvaluationPriors(s.approval,s.init,7);
  const before=priorRuns.map(ref=>sealedDescriptionEvaluationEvidenceHash(ref.runDirectory));
  const approval={...s.approval,rateCardDate:'2026-11-19',approvedUntil:'2026-11-19T04:59:59Z',aggregate:{maximumCalls:172,maximumCountRequests:172,maximumNanoDollars:5_000_000_000,priorRuns}},options={...s.options,approval,now:()=>new Date('2026-11-19T00:30:00Z')};
  await withFoodDescriptionEvaluationBudget(options,budget=>budget.fetch('description-first-en',1)(endpoint,s.init));
  const prefix=join(dirname(s.dir),`.food-description-evaluation-${descriptionEvaluationHash(approval.approvalReference)}`);
  for(let attempt=2;attempt<80;attempt++)for(const suffix of ['intent','count-dispatch','count','dispatch','observation','response']){
    const original=readFileSync(join(s.dir,`attempt-001-${suffix}.json`)),bytes=suffix==='intent'?JSON.stringify({...JSON.parse(original.toString()),attempt,caseId:`description-seeded-${attempt}-en`}):original;
    const stem=`attempt-${String(attempt).padStart(3,'0')}`;writeFileSync(join(s.dir,`${stem}-${suffix}.json`),bytes,{mode:0o600,flag:'wx'});if(suffix!=='response')writeFileSync(`${prefix}-${stem}-${suffix}.json`,bytes,{mode:0o600,flag:'wx'});
  }
  await withFoodDescriptionEvaluationBudget(options,budget=>budget.fetch('description-final-en',1)(endpoint,s.init));
  expect(descriptionEvaluationAccounting(s.dir)).toMatchObject({reservedPairs:80,reservedNanoDollars:4_400_000_000,costComplete:true});
  expect(sealedDescriptionEvaluationPriorAccounting(descriptionEvaluationApprovalSchema.parse(approval))).toEqual({pairs:92,reservedNanoDollars:5_060_000_000,knownMeasuredNanoDollars:55_200_000,budgetedNanoDollars:55_200_000});
  await expect(withFoodDescriptionEvaluationBudget(options,budget=>budget.fetch('description-forbidden-173-en',1)(endpoint,s.init))).rejects.toThrow();
  expect(s.fetcher).toHaveBeenCalledTimes(4);expect(priorRuns.map(ref=>sealedDescriptionEvaluationEvidenceHash(ref.runDirectory))).toEqual(before);
  for(const [index,ref]of priorRuns.entries())expect(JSON.parse(readFileSync(join(ref.runDirectory,'approval.json'),'utf8'))).toMatchObject(index<5?{rateCardDate:'2026-11-18',approvedUntil:'2026-11-18T23:59:59Z'}:{rateCardDate:'2026-11-19',approvedUntil:'2026-11-19T04:59:59Z',aggregate:{maximumCalls:index===5?120:133}});
});

it("pins172 to the same current window and original5 before any new durable action",async()=>{
  const s=setup(),priorRuns=await sealedDescriptionEvaluationPriors(s.approval,s.init,7),before=readdirSync(dirname(s.dir)).sort();
  const approval={...s.approval,rateCardDate:'2026-11-19',approvedUntil:'2026-11-19T04:59:59Z',aggregate:{maximumCalls:172,maximumCountRequests:172,maximumNanoDollars:5_000_000_000,priorRuns}};
  for(const changed of [{rateCardDate:'2026-11-18'},{rateCardDate:'2026-11-20'},{approvedUntil:'2026-11-19T05:00:00Z'},{approvedUntil:'2026-11-20T04:59:59Z'},{maximumNanoDollars:5_000_000_001}])
    await expect(withFoodDescriptionEvaluationBudget({...s.options,approval:{...approval,...changed},now:()=>new Date('2026-11-19T00:30:00Z')},async()=>{})).rejects.toThrow();
  for(const date of ['2026-11-18T23:59:58Z','2026-11-19T04:59:59Z','2026-11-20T00:30:00Z'])
    await expect(withFoodDescriptionEvaluationBudget({...s.options,approval,now:()=>new Date(date)},async()=>{})).rejects.toThrow();
  expect(readdirSync(dirname(s.dir)).sort()).toEqual(before);expect(s.fetcher).not.toHaveBeenCalled();
});

it.each(['missing seventh','wrong nested reference','wrong seventh aggregate','unsealed seventh','missing response','false charge','unknown usage','changed seventh expiry','changed seventh card','duplicate seventh','wrong seventh count'])("blocks172 %s before any new endpoint or refund",async kind=>{
  const s=setup(),priorRuns=await sealedDescriptionEvaluationPriors(s.approval,s.init,7),ref=priorRuns[6];
  const approval={...s.approval,rateCardDate:'2026-11-19',approvedUntil:'2026-11-19T04:59:59Z',aggregate:{maximumCalls:172,maximumCountRequests:172,maximumNanoDollars:5_000_000_000,priorRuns}};
  const config=JSON.parse(readFileSync(ref.configurationPath,'utf8')),prior=config.approval,prefix=join(dirname(ref.runDirectory),`.food-description-evaluation-${descriptionEvaluationHash(prior.approvalReference)}`);
  if(kind==='wrong nested reference')prior.aggregate.priorRuns[5].evidenceSha256='f'.repeat(64);
  if(kind==='wrong seventh aggregate')prior.aggregate={...prior.aggregate,maximumCalls:100,maximumCountRequests:100,priorRuns:prior.aggregate.priorRuns.slice(0,4)};
  if(kind==='unsealed seventh'){rmSync(join(ref.runDirectory,'halted.json'));rmSync(`${prefix}-halted.json`);}
  if(kind==='missing response')rmSync(join(ref.runDirectory,'attempt-001-response.json'));
  if(kind==='false charge'||kind==='unknown usage')for(const path of [join(ref.runDirectory,'attempt-001-observation.json'),`${prefix}-attempt-001-observation.json`]){
    const observation=JSON.parse(readFileSync(path,'utf8'));if(kind==='false charge')observation.measuredNanoDollars=0;else observation.usage={complete:false};writeFileSync(path,JSON.stringify(observation));
  }
  if(kind==='changed seventh expiry')prior.approvedUntil='2026-11-19T05:00:00Z';
  if(kind==='changed seventh card')prior.rateCardDate='2026-11-18';
  if(['wrong nested reference','wrong seventh aggregate','changed seventh expiry','changed seventh card'].includes(kind)){
    for(const path of [join(ref.runDirectory,'approval.json'),`${prefix}.json`])writeFileSync(path,JSON.stringify(prior));
    writeFileSync(ref.configurationPath,JSON.stringify(config));ref.configurationSha256=descriptionEvaluationFileHash(ref.configurationPath);
  }
  ref.evidenceSha256=sealedDescriptionEvaluationEvidenceHash(ref.runDirectory);
  if(kind==='missing seventh')priorRuns.pop();
  if(kind==='duplicate seventh')priorRuns[6]={...priorRuns[5],reservedPairs:39};
  if(kind==='wrong seventh count')priorRuns[6]={...ref,reservedPairs:20};
  await expect(withFoodDescriptionEvaluationBudget({...s.options,approval,now:()=>new Date('2026-11-19T00:30:00Z')},budget=>budget.fetch('description-new-en',1)(endpoint,s.init))).rejects.toThrow();
  expect(s.fetcher).not.toHaveBeenCalled();expect(descriptionEvaluationAccounting(ref.runDirectory).reservedPairs).toBe(39);
});
