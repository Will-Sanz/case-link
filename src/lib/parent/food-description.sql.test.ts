import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { buildFoodDescriptionProjection, validateFoodDescriptionSelection } from "./food-description";
import { FOOD_DESCRIPTION_FINGERPRINT, runOneFoodDescriptionTurn } from "./food-description-runtime";
import { foodDescriptionArchiveSchema } from "./food-description-draft";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
const fingerprint = "a".repeat(64), notice = "food-description-2026-11-18.v1";
const input = { description: "We need food tomorrow and have never applied for SNAP.", screenLocale: "en" };
describe.skipIf(!modulePath)("optional food description actual SQL authority, reservations and rights", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>, owner: string, session: string;
  async function query(sql: string, values: unknown[] = [], role = "authenticated", user = owner, token = session) {
    await fixture.admin.query(`set role ${role}`);
    try {
      await fixture.admin.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user, session_id: token, role, amr: [{ method: "otp" }] })]);
      return await fixture.admin.query(sql, values);
    } finally { await fixture.admin.query("reset role"); }
  }
  async function enable() {
    await fixture.admin.query(`update parent_private.processing_controls set food_description_enabled=true,food_description_approval_reference='synthetic only',food_description_approved_until=now()+interval '1 day',food_description_notice_version=$1,
      food_description_processor_reference='synthetic processor',food_description_evaluation_reference='synthetic gates only, no model evaluation',food_description_evaluation_fingerprint=$2,food_description_retention_reference='synthetic24h48h',food_description_project_budget_reference='synthetic project',food_description_project_id='proj_synthetic',food_description_budget_reference='synthetic feature',food_description_budget_started_at=now()-interval '1 hour',food_description_call_limit=10000,model_budget_started_at=now()-interval '1 hour',model_call_limit=10000`, [notice, fingerprint]);
    await query("select parent_private.parent_record_food_description_health(true,$1,$2)", [fingerprint, "proj_synthetic"], "parent_worker");
  }
  async function create(key = randomUUID(), expectedOwner = owner) { return (await query("select public.parent_create_food_description($1,$2,$3,true) id", [expectedOwner, key, notice])).rows[0].id as string; }
  async function queue(id: string, revision = 0, key = randomUUID(), value = input) { return (await query("select public.parent_queue_food_description($1,$2,$3,$4,$5) revision", [id, owner, revision, key, JSON.stringify(value)])).rows[0].revision; }
  async function read() { return (await query("select public.parent_get_food_descriptions() value")).rows[0].value as { drafts: { id: string; revision: number; state: string; input: unknown; selection: unknown; createdAt: string; contentExpiresAt: string; metadataExpiresAt: string; usage: unknown[] }[] }; }
  async function claim() { return (await query("select parent_private.parent_claim_food_description() value", [], "parent_worker")).rows[0].value as null | { draftId: string; revision: number; leaseToken: string; context: unknown }; }
  async function reserve(c: NonNullable<Awaited<ReturnType<typeof claim>>>) {
    const stored = (await fixture.admin.query("select input,projection from parent_private.food_description_drafts where id=$1", [c.draftId])).rows[0];
    if (stored.projection === null) await query("select parent_private.parent_prepare_food_description($1,$2,$3,$4)", [c.draftId,c.revision,c.leaseToken,JSON.stringify(buildFoodDescriptionProjection(stored.input,c.context,new Date()))], "parent_worker");
    return (await query("select parent_private.parent_reserve_food_description($1,$2,$3) value", [c.draftId, c.revision, c.leaseToken], "parent_worker")).rows[0].value; }
  beforeAll(async () => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-18T15:00:00Z")); fixture = await createParentSqlFixture(modulePath!); });
  afterAll(async () => { await fixture?.admin.end(); vi.useRealTimers(); });
  beforeEach(async () => {
    vi.setSystemTime(new Date("2026-11-18T15:00:00Z"));
    await fixture.admin.query("update parent_private.food_description_drafts set state='cancelled',input=null,context=null,selection=null,payload_hash=null,lease_token=null,lease_until=null");
    owner = randomUUID(); session = randomUUID();
    await fixture.admin.query("update parent_private.processing_controls set enabled=true,approval_reference='synthetic only',approved_until=now()+interval '90 days',existing_accounts_enabled=true,food_description_enabled=false");
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [owner, `${owner}@example.invalid`]);
    await fixture.admin.query("insert into auth.sessions(id,user_id,not_after) values($1,$2,now()+interval '90 days')", [session, owner]);
    await query("select public.parent_ensure_account()");
  });
  it("stays closed despite old assistant readiness and legacy project budget; direct tables/ports are closed", async () => {
    expect((await query("select public.parent_food_description_available() value")).rows[0].value).toBe(false);
    await expect(create()).rejects.toMatchObject({ code: "42501" });
    for (const role of ["authenticated", "anon", "service_role", "parent_worker", "parent_storage_broker", "parent_retention_worker"]) {
      await expect(query("select * from parent_private.food_description_drafts", [], role)).rejects.toMatchObject({ code: "42501" });
      await expect(query("select parent_private.reserve_model_capacity('food_description')", [], role)).rejects.toMatchObject({ code: "42501" });
    }
  });
  it("establishes the owned ID before prose, binds exact bytes/key and original expiry without request or mandate", async () => {
    await enable(); const createKey = randomUUID(), id = await create(createKey); expect(await create(createKey)).toBe(id);
    const original = (await read()).drafts[0]; expect(original).toMatchObject({ id, revision: 0, state: "empty", input: null });
    expect(Date.parse(original.contentExpiresAt) - Date.parse(original.createdAt)).toBe(86400000);
    expect(Date.parse(original.metadataExpiresAt) - Date.parse(original.createdAt)).toBe(172800000);
    const key = randomUUID(); expect(await queue(id, 0, key)).toBe(1); expect(await queue(id, 0, key)).toBe(1);
    await expect(queue(id, 0, key, { ...input, description: "Different description" })).rejects.toMatchObject({ code: "PT409" });
    await expect(queue(id, 0)).rejects.toMatchObject({ code: "PT409" });
    expect((await fixture.admin.query("select count(*)::int n from public.parent_requests r join public.parent_households h on h.id=r.household_id where h.owner_id=$1", [owner])).rows[0].n).toBe(0);
    expect((await read()).drafts[0].contentExpiresAt).toBe(original.contentExpiresAt);
  });
  it("rejects private input, foreign owners and expired sessions before storage", async () => {
    await enable(); await expect(create(randomUUID(), randomUUID())).rejects.toMatchObject({ code: "42501" }); const id = await create();
    for (const value of [{ ...input, description: "my password is example" }, { ...input, description: "I am pregnant" }, { ...input, description: "My SSN is 000-00-0000" }, { ...input, arbitrary: true }, { ...input, description: " need food " }]) await expect(queue(id, 0, randomUUID(), value)).rejects.toMatchObject({ code: "23514" });
    expect((await read()).drafts[0].input).toBeNull();
    await fixture.admin.query("update auth.sessions set not_after=now()-interval '1 second' where id=$1", [session]); await expect(read()).rejects.toMatchObject({ code: "42501" });
  });
  it("reserves once before dispatch; charged lease loss is terminal unknown and never reclaimed", async () => {
    await enable(); const id = await create(); await queue(id); const c = (await claim())!; expect(c.draftId).toBe(id);
    expect(await reserve(c)).toEqual(expect.any(String)); expect(await reserve(c)).toBeNull();
    await fixture.admin.query("update parent_private.food_description_drafts set lease_until=now()-interval '1 second' where id=$1", [id]);
    expect((await read()).drafts[0].state).toBe("unknown"); // Rights remain truthful even without a later worker cleanup turn.
    expect(await claim()).toBeNull(); expect((await read()).drafts[0].state).toBe("unknown"); expect(await claim()).toBeNull();
    expect((await fixture.admin.query("select count(*)::int n from parent_private.model_call_reservations where purpose='food_description'")).rows[0].n).toBeGreaterThan(0);
  });
  it("cancellation and purpose closure stop future uses while exact acknowledgement, export and erase remain available", async () => {
    await enable(); const key = randomUUID(), id = await create(key), qkey = randomUUID(); await queue(id, 0, qkey); const c = (await claim())!; const charge = await reserve(c);
    await fixture.admin.query("update parent_private.processing_controls set food_description_enabled=false,enabled=false");
    expect(await create(key)).toBe(id); expect(await queue(id, 0, qkey)).toBe(1); expect((await read()).drafts[0].input).toEqual(input);
    await expect(query("select parent_private.parent_food_description_current($1,$2,$3)", [id, 1, c.leaseToken], "parent_worker")).rejects.toMatchObject({ code: "42501" });
    await query("select public.parent_cancel_food_description($1,$2)", [id, owner]); expect((await read()).drafts[0]).toMatchObject({ state: "cancelled", input: null, selection: null });
    await query("select parent_private.parent_record_food_description_usage($1,$2)", [charge, JSON.stringify({ complete: false })], "parent_worker"); expect((await read()).drafts[0].usage).toHaveLength(1);
  });
  it("enforces three per account rolling24h; cancellation and feature/global ledgers do not refund", async () => {
    await enable(); const id = await create();
    for (let revision = 0; revision < 3; revision++) { await queue(id, revision, randomUUID(), { ...input, description: `Food support request, edit ${revision}.` }); const c = (await claim())!; expect(await reserve(c)).toEqual(expect.any(String)); await query("select parent_private.parent_fail_food_description($1,$2,$3)", [id, c.revision, c.leaseToken], "parent_worker"); }
    await expect(queue(id, 3)).rejects.toMatchObject({ code: "42501" });
    expect((await query("select public.parent_get_food_descriptions() value")).rows[0].value.available).toBe(false);
    const before = (await fixture.admin.query("select count(*)::int n from parent_private.model_call_reservations where purpose='food_description'")).rows[0].n;
    await query("select public.parent_cancel_food_description($1,$2)", [id, owner]);
    await fixture.admin.query("delete from public.parent_accounts where id=$1", [owner]);
    expect((await fixture.admin.query("select count(*)::int n from parent_private.model_call_reservations where purpose='food_description'")).rows[0].n).toBe(before);
    expect((await fixture.admin.query("select count(*)::int n from auth.users where id=$1", [owner])).rows[0].n).toBe(1);
  });
  it("rechecks current source, owner, consent and revision before reservation and result; account deletion clears content immediately", async () => {
    await enable(); const id = await create(); await queue(id); const c = (await claim())!;
    await queue(id, 1); await expect(reserve(c)).rejects.toMatchObject({ code: "42501" });
    await fixture.admin.query("update public.parent_accounts set status='deletion_requested' where id=$1", [owner]);
    expect((await read()).drafts[0]).toMatchObject({ state: "cancelled", input: null, selection: null });
  });
  it("clears all content/hash/source bindings at24h and owned metadata at48h without refunding anonymous reservations", async () => {
    await enable(); const id = await create(); await queue(id); await reserve((await claim())!);
    vi.setSystemTime(new Date("2026-11-19T15:00:01Z")); expect((await read()).drafts[0]).toMatchObject({ state: "expired", input: null });
    await query("select parent_private.parent_purge_food_descriptions(100)", [], "parent_retention_worker");
    expect((await fixture.admin.query("select input,context,projection,selection,payload_hash from parent_private.food_description_drafts where id=$1", [id])).rows[0]).toEqual({ input: null, context: null, projection: null, selection: null, payload_hash: null });
    expect((await fixture.admin.query("select count(*)::int n from parent_private.food_description_calls where draft_id=$1", [id])).rows[0].n).toBe(1);
    vi.setSystemTime(new Date("2026-11-20T15:00:01Z")); await query("select parent_private.parent_purge_food_descriptions(100)", [], "parent_retention_worker"); expect((await read()).drafts).toEqual([]);
  });
  it("counts existing coordinator/assistant charges before assessment and assessment before either actual legacy reservation port", async () => {
    await enable();
    const household = (await fixture.admin.query("select id from public.parent_households where owner_id=$1", [owner])).rows[0].id;
    const historyRequest = randomUUID(), workRequest = randomUUID(), message = randomUUID(), jobToken = randomUUID(), assistantToken = randomUUID();
    for (const id of [historyRequest, workRequest]) await fixture.admin.query("insert into public.parent_requests(id,household_id,intake,mandate) values($1,$2,$3,$4)", [id, household, JSON.stringify(fixtureIntake()), JSON.stringify(fixtureMandate({ expiresAt: new Date(Date.now()+86400000).toISOString() }))]);
    await fixture.admin.query("insert into parent_private.ai_calls(account_id,request_id) select $1,$2 from generate_series(1,59)", [owner, historyRequest]);
    const id = await create(); await queue(id); const c = (await claim())!; expect(await reserve(c)).toEqual(expect.any(String));
    await fixture.admin.query("insert into public.parent_jobs(request_id,request_version,state,lease_token,lease_until,lease_started_at) values($1,1,'leased',$2,now()+interval '1 minute',now())", [workRequest, jobToken]);
    const job = (await fixture.admin.query("select id from public.parent_jobs where request_id=$1", [workRequest])).rows[0].id;
    await fixture.admin.query("insert into public.parent_assistant_messages(id,request_id,request_version,idempotency_key,question,status,lease_token,lease_until) values($1,$2,1,$3,'What is next?','running',$4,now()+interval '1 minute')", [message, workRequest, randomUUID(), assistantToken]);
    expect((await query("select parent_private.parent_reserve_ai_call($1,$2) value", [job, jobToken], "parent_worker")).rows[0].value).toBe(false);
    expect((await query("select parent_private.parent_reserve_assistant_call($1,$2) value", [message, assistantToken], "parent_worker")).rows[0].value).toBe(false);
    await query("select parent_private.parent_fail_food_description($1,$2,$3)", [id, 1, c.leaseToken], "parent_worker"); await expect(queue(id, 1)).rejects.toMatchObject({ code: "42501" });
  });
  it("keeps each separate approval, actual capability fingerprint and original expiry indispensable", async () => {
    await enable();
    const columns = ["food_description_approval_reference", "food_description_processor_reference", "food_description_evaluation_reference", "food_description_retention_reference", "food_description_project_budget_reference", "food_description_budget_reference"];
    for (const column of columns) {
      await fixture.admin.query(`update parent_private.processing_controls set ${column}=null`);
      expect((await query("select public.parent_food_description_available() value")).rows[0].value).toBe(false); await expect(create()).rejects.toMatchObject({ code: "42501" }); await enable();
    }
    await query("select parent_private.parent_record_food_description_health(true,$1,$2)", ["b".repeat(64), "proj_synthetic"], "parent_worker"); await expect(create()).rejects.toMatchObject({ code: "42501" }); await enable();
    const id = await create(); await queue(id); const c = (await claim())!;
    await fixture.admin.query("update parent_private.worker_health set food_description_fingerprint=$1", ["b".repeat(64)]);
    await expect(reserve(c)).rejects.toMatchObject({ code: "42501" });
  });
  it("respects the new feature cap after owned evidence is deleted and never borrows an old anonymous allowance", async () => {
    await enable(); const id = await create(); await queue(id); expect(await reserve((await claim())!)).toEqual(expect.any(String));
    const count = (await fixture.admin.query("select count(*)::int n from parent_private.model_call_reservations where purpose='food_description'")).rows[0].n;
    await fixture.admin.query("update parent_private.processing_controls set food_description_call_limit=$1", [count]);
    await fixture.admin.query("delete from parent_private.food_description_calls where draft_id=$1", [id]);
    await query("select public.parent_cancel_food_description($1,$2)", [id, owner]);
    await expect(create()).rejects.toMatchObject({ code: "42501" });
    expect((await query("select public.parent_food_description_available() value")).rows[0].value).toBe(false);
  });
  it("SQL rejects the same24 protected corpus descriptions before storage", async () => {
    await enable(); const id = await create();
    const corpus = JSON.parse(readFileSync("tests/fixtures/parent/food-description-2026-11-18.v3.json", "utf8")) as { blockedCases: { id: string; description: string; language: string }[] };
    const admitted: string[] = [];
    for (const item of corpus.blockedCases) if ((await fixture.admin.query("select parent_private.food_description_safe($1) allowed", [JSON.stringify({ description: item.description, screenLocale: item.language })])).rows[0].allowed) admitted.push(item.id);
    expect(admitted).toEqual([]);
    for (const item of corpus.blockedCases) await expect(queue(id, 0, randomUUID(), { description: item.description, screenLocale: item.language })).rejects.toMatchObject({ code: "23514" });
    expect((await read()).drafts[0].input).toBeNull();
  });

  it("composes real SQL ownership/reservation/worker/result/export using one synthetic Responses exchange", async () => {
    await enable();
    await fixture.admin.query("update parent_private.processing_controls set food_description_evaluation_fingerprint=$1", [FOOD_DESCRIPTION_FINGERPRINT]);
    await query("select parent_private.parent_record_food_description_health(true,$1,$2)", [FOOD_DESCRIPTION_FINGERPRINT, "proj_synthetic"], "parent_worker");
    const id = await create(), description = "We have no food for tomorrow. I have never applied for SNAP.";
    await queue(id, 0, randomUUID(), { description, screenLocale: "en" });
    const span = (text: string) => ({ start: description.indexOf(text), end: description.indexOf(text)+text.length, text });
    const selected = { needIds: ["food_now","snap_new"], selections: [], assertions: [
      { questionId: "foodForTwoDays", value: "no", span: span("no food for tomorrow") },
      { questionId: "benefitHistory", value: "never", span: span("never applied for SNAP") },
    ], exclusions: [], questionIds: [], outOfScope: null };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: "resp_synthetic", status: "completed", usage: { input_tokens: 200, output_tokens: 80, total_tokens: 280, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0, cache_write_tokens_details: { ttl_30m_tokens: 0, ttl_12h_tokens: 0 } }, output_tokens_details: { reasoning_tokens: 0 } }, output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(selected, (key, item) => key === "span" ? { text: item.text } : item) }] }] }));
    expect(await runOneFoodDescriptionTurn({ database: { query: (sql, values) => query(sql, values, "parent_worker") }, apiKey: "synthetic-no-provider-connection", projectId: "proj_synthetic", fetcher, now: () => new Date() })).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const archive = foodDescriptionArchiveSchema.parse(await read()), draft = archive.drafts[0];
    expect(draft).toMatchObject({ state: "result", selection: selected, usage: [{ revision: 1, usage: { complete: true, inputTokens: 200, outputTokens: 80 } }] });
    expect(JSON.stringify(draft.projection)).not.toContain(owner); expect(JSON.stringify(draft.projection)).not.toContain(id);
    const result = (await query("select public.parent_food_description_result($1) value", [id])).rows[0].value;
    expect(validateFoodDescriptionSelection({ ...result, now: new Date() })).toMatchObject({ state: "proposal", needIds: ["food_now","snap_new"], executionGranted: false });
    await fixture.admin.query("update parent_private.processing_controls set food_description_enabled=false");
    expect(foodDescriptionArchiveSchema.parse(await read()).drafts[0].selection).toEqual(selected);
    await expect(query("select public.parent_food_description_result($1)", [id])).rejects.toMatchObject({ code: "42501" });
  });

  it("retains older actual benefit progress ahead of20 newer cancelled empty cases in the minimized history", async () => {
    await enable(); const household = (await fixture.admin.query("select id from public.parent_households where owner_id=$1", [owner])).rows[0].id;
    const earlier = randomUUID();
    for (let index = 0; index < 21; index++) await fixture.admin.query("insert into public.parent_requests(id,household_id,intake,mandate,status,created_at) values($1,$2,$3,$4,$5,now()-make_interval(hours=>$6))", [index === 0 ? earlier : randomUUID(), household, JSON.stringify(fixtureIntake({ needs: ["snap_new"] })), JSON.stringify(fixtureMandate({ recipientIds: ["snap-pa"] })), index === 0 ? "closed" : "cancelled", index === 0 ? 24 : 1]);
    await fixture.admin.query("insert into public.parent_events(request_id,kind,actor,summary,evidence) values($1,'parent.outcome_reported','parent','Synthetic historical report',$2)", [earlier, JSON.stringify({ need: "snap_new", outcome: "agency_submitted", attribution: "parent_reported" })]);
    const id = await create(); await queue(id); const context = (await fixture.admin.query("select context from parent_private.food_description_drafts where id=$1", [id])).rows[0].context;
    expect(context.history).toHaveLength(20); expect(context.history).toContainEqual(expect.objectContaining({ requestId: earlier, state: "agency_submitted" }));
  });

  it.each(["project","feature","account3","combined60"])("blocks known-exhausted %s capacity before new prose without revoking a prior reservation", async kind => {
    await enable(); const id = await create(); await queue(id); const c = (await claim())!; expect(await reserve(c)).toEqual(expect.any(String));
    if (kind === "project") await fixture.admin.query("update parent_private.processing_controls set model_call_limit=(select greatest((select count(*) from parent_private.model_call_reservations),(select count(*) from parent_private.ai_calls)+(select count(*) from parent_private.assistant_calls)+(select count(*) from parent_private.food_description_calls)))");
    if (kind === "feature") await fixture.admin.query("update parent_private.processing_controls set food_description_call_limit=(select count(*) from parent_private.model_call_reservations where purpose='food_description')");
    if (kind === "account3") await fixture.admin.query("insert into parent_private.food_description_calls(draft_id,owner_id,revision,project_id) select $1,$2,value,'proj_synthetic' from generate_series(2,3) value", [id,owner]);
    if (kind === "combined60") {
      const household = (await fixture.admin.query("select id from public.parent_households where owner_id=$1",[owner])).rows[0].id, request = randomUUID();
      await fixture.admin.query("insert into public.parent_requests(id,household_id,intake,mandate) values($1,$2,$3,$4)",[request,household,JSON.stringify(fixtureIntake()),JSON.stringify(fixtureMandate())]);
      await fixture.admin.query("insert into parent_private.ai_calls(account_id,request_id) select $1,$2 from generate_series(1,59)",[owner,request]);
      // The newly inserted SNAP-free history leaves this draft's food context unchanged.
    }
    expect((await query("select public.parent_food_description_upload_allowed($1) value",[id])).rows[0].value).toBe(false);
    expect((await query("select public.parent_get_food_descriptions() value")).rows[0].value.available).toBe(false);
    await expect(queue(id,1,randomUUID(),{...input,description:"Known blocked new prose must not be saved."})).rejects.toMatchObject({code:"42501"});
    expect((await read()).drafts[0].input).toEqual(input);
    // Capacity is NOT part of existing authority: the call that consumed the last slot may still finish and be read.
    await query("select parent_private.parent_food_description_current($1,$2,$3)",[id,1,c.leaseToken],"parent_worker");
    const selection={needIds:[],selections:[],assertions:[],exclusions:[],questionIds:[],outOfScope:null};
    await query("select parent_private.parent_finish_food_description($1,$2,$3,$4)",[id,1,c.leaseToken,JSON.stringify(selection)],"parent_worker");
    expect((await query("select public.parent_food_description_result($1) value",[id])).rows[0].value.selection).toEqual(selection);
  });
  it("requires the exact currently approved project in independent private worker health", async () => {
    await enable(); const id=await create(); await queue(id);
    await query("select parent_private.parent_record_food_description_health(true,$1,$2)",[fingerprint,"proj_other"],"parent_worker");
    expect((await query("select public.parent_food_description_available() value")).rows[0].value).toBe(false); expect(await claim()).toBeNull();
    expect((await fixture.admin.query("select count(*)::int n from parent_private.food_description_calls where draft_id=$1",[id])).rows[0].n).toBe(0);
  });

  it.each([
    {correction:"unresolved",source:null,expected:"unresolved"},
    {correction:"withdrawn",source:null,expected:"withdrawn"},
    {correction:"unresolved",source:"parent_reported",expected:"unresolved"},
    {correction:"withdrawn",source:"agency_receipt",expected:"support_received"},
  ])("projects the current parent correction $correction with source=$source as $expected",async({correction,source,expected})=>{
    await enable();
    const request=(await query("select public.parent_start_request($1,$2,$3) id",[
      JSON.stringify(fixtureIntake({needs:["snap_pending"],utilityProviders:[]})),
      JSON.stringify(fixtureMandate({recipientIds:["snap-pa"],allowedActions:["research","prepare","follow_up"],allowedData:["household"],mode:"full",expiresAt:new Date(Date.now()+86400000).toISOString()})),randomUUID(),
    ])).rows[0].id as string;
    if(source){const operation=randomUUID();await fixture.admin.query(`insert into public.parent_operations(id,request_id,request_version,program_id,need,action,packet,packet_hash,data_categories,idempotency_key,permission_version,state,evidence,executed_at)
      values($1::uuid,$2,1,'snap-pa','snap_pending','follow_up','{}',encode(sha256(convert_to($1::text,'UTF8')),'hex'),'{household}',$1::text,'synthetic-receipt-permission','support_received',$3,now())`,[operation,request,JSON.stringify({source,reference:"Synthetic receipt only, no actual provider connection"})]);}
    vi.setSystemTime(new Date("2026-11-18T15:00:01Z"));
    await query("select public.parent_report_outcome($1,'snap_pending','support_received','Synthetic initial parent report')",[request]);
    vi.setSystemTime(new Date("2026-11-18T15:00:02Z"));
    await query("select public.parent_report_outcome($1,'snap_pending',$2,'Synthetic correction of the previous report')",[request,correction]);
    const id=await create();await queue(id);
    const context=(await fixture.admin.query("select context from parent_private.food_description_drafts where id=$1",[id])).rows[0].context;
    expect(context.history).toContainEqual(expect.objectContaining({requestId:request,state:expected}));
    const minimized=buildFoodDescriptionProjection(input,context,new Date());
    expect(minimized.ownedFoodHistory).toContainEqual({need:"snap_pending",state:expected,current:true});
    expect(JSON.stringify(minimized)).not.toContain(request);expect(JSON.stringify(minimized)).not.toContain(owner);
    expect((await fixture.admin.query("select count(*)::int n from public.parent_events where request_id=$1 and kind='parent.outcome_reported'",[request])).rows[0].n).toBe(2);
  });

  it("uses the existing current-program observation order when a late agency observation describes an older status",async()=>{
    await enable();const household=(await fixture.admin.query("select id from public.parent_households where owner_id=$1",[owner])).rows[0].id,request=randomUUID();
    await fixture.admin.query("insert into public.parent_requests(id,household_id,intake,mandate) values($1,$2,$3,$4)",[request,household,JSON.stringify(fixtureIntake({needs:["snap_pending"]})),JSON.stringify(fixtureMandate({recipientIds:["snap-pa"]}))]);
    for(const [state,observedAt,recordedAt] of [["assistance_approved","2026-11-18T15:00:02Z","2026-11-18T15:00:03Z"],["declined","2026-11-18T15:00:01Z","2026-11-18T15:00:04Z"]]){
      const operation=randomUUID();vi.setSystemTime(new Date(recordedAt));
      await fixture.admin.query(`insert into public.parent_operations(id,request_id,request_version,program_id,need,action,packet,packet_hash,data_categories,idempotency_key,permission_version,state,evidence,executed_at)
        values($1::uuid,$2,1,'snap-pa','snap_pending','follow_up','{}',encode(sha256(convert_to($1::text,'UTF8')),'hex'),'{household}',$1::text,'synthetic-receipt-permission',$3,$4,now())`,[operation,request,state,JSON.stringify({source:"agency_receipt",recordedAt,agencyStatus:{observedAt},reference:"Synthetic timed receipt only"})]);
    }
    expect((await fixture.admin.query("select state from parent_private.current_program_operation($1,'snap_pending','snap-pa')",[request])).rows[0].state).toBe("assistance_approved");
    const id=await create();await queue(id);const context=(await fixture.admin.query("select context from parent_private.food_description_drafts where id=$1",[id])).rows[0].context;
    expect(buildFoodDescriptionProjection(input,context,new Date()).ownedFoodHistory).toContainEqual({need:"snap_pending",state:"assistance_approved",current:true});
  });
  it("retains exact cache-write billing subsets in owned exports after cancellation without rewriting or refunding the charge", async () => {
    await enable(); const id = await create(); await queue(id); const charge = await reserve((await claim())!);
    const usage = { complete: true, inputTokens: 12000, outputTokens: 40, cachedInputTokens: 4000, cacheWriteInputTokens: 7000,
      cacheWrite30mInputTokens: 3000, cacheWrite12hInputTokens: 4000, reasoningTokens: 10, responseId: "resp_synthetic", requestId: "req_synthetic" };
    const record = (value: unknown, role = "parent_worker") => query("select parent_private.parent_record_food_description_usage($1,$2)", [charge, JSON.stringify(value)], role);
    for (const value of [null, [], { ...usage, inputTokens: "not a number" }, { ...usage, inputTokens: -1 }, { ...usage, inputTokens: 10000001 }, { ...usage, cacheWriteInputTokens: 7001 }, { ...usage, cachedInputTokens: 5001 }, { ...usage, cacheWrite30mInputTokens: 0.5 },
      { ...usage, cacheWrite12hInputTokens: undefined }, { ...usage, unexpectedTokens: 0 }, { complete: false, cacheWriteInputTokens: 0 }])
      await expect(record(value)).rejects.toMatchObject({ code: "23514" });
    for (const role of ["authenticated", "anon", "service_role", "parent_storage_broker", "parent_retention_worker"])
      await expect(record(usage, role)).rejects.toMatchObject({ code: "42501" });
    await query("select public.parent_cancel_food_description($1,$2)", [id, owner]);
    const reservations = (await fixture.admin.query("select count(*)::int n from parent_private.model_call_reservations")).rows[0].n;
    await record(usage); await record({ ...usage, inputTokens: 13000 });
    const exported = foodDescriptionArchiveSchema.parse((await query("select public.parent_get_food_descriptions() value")).rows[0].value);
    expect(exported.drafts[0].usage[0].usage).toEqual(usage);
    expect((await fixture.admin.query("select count(*)::int n from parent_private.model_call_reservations")).rows[0].n).toBe(reservations);
  });

});
