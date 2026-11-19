import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { FOOD_DESCRIPTION_FINGERPRINT, runOneFoodDescriptionTurn } from "./food-description-runtime";
import { validateFoodDescriptionSelection, reconcileFoodDescriptionRequests } from "./food-description";
import type { SupportIntake } from "./domain";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
describe.skipIf(!modulePath)("denial/history/outside-PA routing through real worker SQL", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>, owner: string, session: string;
  async function query(sql: string, values: unknown[] = [], role = "authenticated") {
    await fixture.admin.query(`set role ${role}`);
    try {
      await fixture.admin.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner, session_id: session, role, amr: [{ method: "otp" }] })]);
      return await fixture.admin.query(sql, values);
    } finally { await fixture.admin.query("reset role"); }
  }
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-18T15:00:00Z"));
    fixture = await createParentSqlFixture(modulePath!, "20261119002547_parent_food_description_routing_gaps.sql");
  });
  afterAll(async () => { await fixture?.admin.end(); vi.useRealTimers(); });
  beforeEach(async () => {
    vi.setSystemTime(new Date("2026-11-18T15:00:00Z"));
    owner = randomUUID(); session = randomUUID();
    await fixture.admin.query("update parent_private.food_description_drafts set state='cancelled',input=null,context=null,projection=null,selection=null,payload_hash=null,lease_token=null,lease_until=null");
    await fixture.admin.query(`update parent_private.processing_controls set enabled=true,approval_reference='synthetic only',approved_until=now()+interval '90 days',existing_accounts_enabled=true,
      food_description_enabled=true,food_description_approval_reference='synthetic only',food_description_approved_until=now()+interval '1 day',food_description_notice_version='food-description-2026-11-18.v1',
      food_description_processor_reference='synthetic processor',food_description_evaluation_reference='synthetic guards, no model quality claim',food_description_evaluation_fingerprint=$1,food_description_retention_reference='synthetic24h48h',
      food_description_project_budget_reference='synthetic project',food_description_project_id='proj_synthetic',food_description_budget_reference='synthetic feature',food_description_budget_started_at=now()-interval '1 hour',food_description_call_limit=10000,model_budget_started_at=now()-interval '1 hour',model_call_limit=10000`, [FOOD_DESCRIPTION_FINGERPRINT]);
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [owner, `${owner}@example.invalid`]);
    await fixture.admin.query("insert into auth.sessions(id,user_id,not_after) values($1,$2,now()+interval '90 days')", [session, owner]);
    await query("select public.parent_ensure_account()");
    await query("select parent_private.parent_record_food_description_health(true,$1,'proj_synthetic')", [FOOD_DESCRIPTION_FINGERPRINT], "parent_worker");
  });
  function packet(needs: SupportIntake["needs"] = ["food_now"], recipients = ["philly-food"]) { return { intake: fixtureIntake({ needs, utilityProviders: [] }), mandate: fixtureMandate({ recipientIds: recipients, mode: "prepare_only", allowedActions: ["research", "prepare"], expiresAt: new Date(Date.now() + 86400000).toISOString() }) }; }
  async function queue(id: string, rev: number, description: string, routingAnswers = {}) { return (await query("select public.parent_queue_food_description($1,$2,$3,$4,$5) revision", [id, owner, rev, randomUUID(), JSON.stringify({ description, screenLocale: "en", routingAnswers })])).rows[0].revision; }
  async function begin(description: string, assertions: unknown[], needIds: string[] = [], outOfScope: string | null = null, routingAnswers = {}) {
    const id = (await query("select public.parent_create_food_description($1,$2,'food-description-2026-11-18.v1',true) id", [owner, randomUUID()])).rows[0].id;
    await queue(id, 0, description, routingAnswers); await work(assertions, needIds, outOfScope); return id;
  }
  async function work(assertions: unknown[], needIds: string[], outOfScope: string | null = null) {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: "resp_synthetic", status: "completed", usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0, cache_write_tokens_details: { ttl_30m_tokens: 0, ttl_12h_tokens: 0 } }, output_tokens_details: { reasoning_tokens: 0 } },
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ needIds, selections: [], assertions, exclusions: [], questionIds: [], outOfScope }) }] }] }));
    expect(await runOneFoodDescriptionTurn({ database: { query: (sql, values) => query(sql, values, "parent_worker") }, apiKey: "synthetic-no-network", projectId: "proj_synthetic", fetcher, now: () => new Date() })).toBe(true); expect(fetcher).toHaveBeenCalledOnce();
  }
  async function result(id: string) { const raw = (await query("select public.parent_food_description_result($1) value", [id])).rows[0].value; return { raw, vetted: reconcileFoodDescriptionRequests(validateFoodDescriptionSelection({ ...raw, now: new Date() }), raw.currentRequests, owner) }; }
  async function start(id: string, rev = 1, body = packet(), key = randomUUID()) { return (await query("select public.parent_start_food_description_request($1,$2,$3,$4) id", [JSON.stringify({ draftId: id, revision: rev }), JSON.stringify(body.intake), JSON.stringify(body.mandate), key])).rows[0].id; }
  async function existing() {
    const body = packet(["snap_pending"], ["snap-pa"]), id = (await query("select public.parent_start_request($1,$2,$3) id", [JSON.stringify(body.intake), JSON.stringify(body.mandate), randomUUID()])).rows[0].id;
    await fixture.admin.query("insert into public.parent_operations(request_id,request_version,program_id,need,action,packet,packet_hash,data_categories,idempotency_key,state,evidence) values($1,1,'snap-pa','snap_pending','follow_up','{}',repeat('a',64),'{}',$2,'agency_submitted',jsonb_build_object('source','agency_receipt','reference','synthetic-only','recordedAt',now()))", [id, randomUUID()]);
    return id;
  }
  it("carries an actual prior pending assertion into a truthful denial revision and starts only the existing problem journey with exact receipt", async () => {
    const first = "We have enough food. My SNAP application is pending.";
    const id = await begin(first, [{ questionId: "foodForTwoDays", value: "yes", span: { text: "have enough food" } }, { questionId: "benefitHistory", value: "applied", span: { text: "application is pending" } }], ["snap_pending"]);
    await queue(id, 1, "I have now received a denial notice.");
    await work([{ questionId: "benefitHistory", value: "denied", span: { text: "received a denial notice" } }], ["snap_problem"]);
    const { vetted } = await result(id); expect(vetted).toMatchObject({ state: "proposal", needIds: ["snap_problem"], questionIds: [], conflicts: [], proposedAnswers: { foodForTwoDays: "yes", benefitHistory: "denied", existingIssue: null }, executionGranted: false });
    const body = packet(["snap_problem"], ["snap-pa"]), key = randomUUID(), request = await start(id, 2, body, key);
    expect(await start(id, 2, body, key)).toBe(request);
    await expect(start(id, 2, packet(["snap_new"], ["snap-pa"]))).rejects.toMatchObject({ code: "PT409" });
    expect((await fixture.admin.query("select count(*)::int n from public.parent_operations where request_id=$1", [request])).rows[0].n).toBe(0);
    expect((await fixture.admin.query("select result_selection from parent_private.food_description_calls where draft_id=$1 and revision=1", [id])).rows[0].result_selection.assertions[1].value).toBe("applied");
  });
  it("accepts explicit typed denial in queue/resolve without treating it as receiving or private SNAP application authority", async () => {
    const id = await begin("Please help with my notice.", [], ["snap_problem"], null, { foodForTwoDays: { value: "yes", confirmedAt: "2026-11-18T14:00:00Z" }, benefitHistory: { value: "denied", confirmedAt: "2026-11-18T14:00:00Z" } });
    const { vetted } = await result(id); expect(vetted.proposedAnswers).toEqual({ foodForTwoDays: "yes", benefitHistory: "denied", existingIssue: null });
    expect((await query("select public.parent_resolve_food_description($1,$2,1,$3,'{}',$4) revision", [id, owner, JSON.stringify(vetted.proposedAnswers), randomUUID()])).rows[0].revision).toBe(1);
    await expect(start(id, 1, packet(["snap_new"], ["snap-pa"]))).rejects.toMatchObject({ code: "PT409" });
  });
  it("opens the exact owned application without a fabricated benefit answer and starts uncovered food under a separate named mandate", async () => {
    const old = await existing(), description = "We have no food today. I think I need a first SNAP application.";
    const id = await begin(description, [{ questionId: "foodForTwoDays", value: "no", span: { text: "no food today" } }], ["food_now"]);
    const { vetted } = await result(id); expect(vetted).toMatchObject({ state: "proposal", needIds: ["food_now"], questionIds: [], proposedAnswers: { foodForTwoDays: "no", benefitHistory: "not_sure" }, existingRequests: [{ requestId: old, needIds: ["snap_pending"] }] });
    expect(vetted).not.toHaveProperty("existingRequestSources"); expect(vetted).not.toHaveProperty("existingRequestIds");
    const key = randomUUID(), request = await start(id, 1, packet(), key); expect(request).not.toBe(old); expect(await start(id, 1, packet(), key)).toBe(request);
    await expect(start(id, 1, packet(["snap_pending"], ["snap-pa"]))).rejects.toMatchObject({ code: "PT409" });
    expect((await fixture.admin.query("select intake->'needs' needs,version from public.parent_requests where id=$1", [old])).rows[0]).toEqual({ needs: ["snap_pending"], version: 1 });
  });
  it.each(["cancel", "version", "scope", "source", "missing_food"])("does not bypass required facts/current-source guards after %s", async reason => {
    const old = await existing(), description = reason === "missing_food" ? "I need help with SNAP." : "We have no food today.";
    const id = await begin(description, reason === "missing_food" ? [] : [{ questionId: "foodForTwoDays", value: "no", span: { text: "no food today" } }], ["food_now"]);
    if (reason === "cancel") await query("select public.parent_control_request($1,'cancel')", [old]);
    if (reason === "version") await fixture.admin.query("update public.parent_requests set version=version+1 where id=$1", [old]);
    if (reason === "scope") await fixture.admin.query("update public.parent_requests set intake=jsonb_set(intake,'{needs}','[\"snap_problem\"]') where id=$1", [old]);
    if (reason === "source") await fixture.admin.query("update public.parent_requests set account_changed_at=jsonb_build_object('snap_pending',(now()+interval '1 second')::text) where id=$1", [old]);
    await expect(start(id)).rejects.toThrow();
    expect((await fixture.admin.query("select count(*)::int n from public.parent_requests where description_source->>'draftId'=$1", [id])).rows[0].n).toBe(0);
  });
  it.each(["wic", "utilities", "other"])("starts independently known urgent food alongside unsupported-only %s without asking or starting SNAP", async outOfScope => {
    const id = await begin("I need other support.", [], [], outOfScope, { foodForTwoDays: { value: "no", confirmedAt: "2026-11-18T14:00:00Z" } });
    const { vetted } = await result(id); expect(vetted).toMatchObject({ state: "proposal", needIds: ["food_now"], questionIds: [], existingRequests: [], proposedAnswers: { foodForTwoDays: "no", benefitHistory: "not_sure" } });
    const key = randomUUID(), request = await start(id, 1, packet(), key); expect(await start(id, 1, packet(), key)).toBe(request);
    expect((await fixture.admin.query("select intake->'needs' needs from public.parent_requests where id=$1", [request])).rows[0].needs).toEqual(["food_now"]);
    expect((await fixture.admin.query("select parent_private.food_description_values(d) facts from parent_private.food_description_drafts d where id=$1", [id])).rows[0].facts).not.toHaveProperty("benefitHistory");
    await expect(start(id, 1, packet(["snap_new"], ["snap-pa"]))).rejects.toMatchObject({ code: "PT409" });
  });
  it.each(["applied", "never"].flatMap(benefit => [false, true].map(currentFood => ({ benefit, currentFood }))))("does not turn saved $benefit history into a new SNAP mandate from unsupported-only input (currentFood=$currentFood)", async ({ benefit, currentFood }) => {
    const id = await begin(currentFood ? "We have enough food. I need WIC support." : "I need WIC support.", currentFood ? [{ questionId: "foodForTwoDays", value: "yes", span: { text: "have enough food" } }] : [], [], "wic", { foodForTwoDays: { value: "yes", confirmedAt: "2026-11-18T14:00:00Z" }, benefitHistory: { value: benefit, confirmedAt: "2026-11-18T14:00:00Z" } });
    expect((await result(id)).vetted).toMatchObject({ state: "manual", needIds: [], questionIds: [], existingRequests: [] });
    await expect(start(id, 1, packet([benefit === "applied" ? "snap_pending" : "snap_new"], ["snap-pa"]))).rejects.toMatchObject({ code: "PT409" });
    expect((await fixture.admin.query("select count(*)::int n from public.parent_requests where description_source->>'draftId'=$1", [id])).rows[0].n).toBe(0);
  });
  it.each([false, true])("starts selected food with its own required facts while benefit/issue facts remain unanswered (receiving=$receiving)", async receiving => {
    const description = receiving ? "We have no food today and receive SNAP." : "We have no food today.";
    const id = await begin(description, [{ questionId: "foodForTwoDays", value: "no", span: { text: "no food today" } }, ...(receiving ? [{ questionId: "benefitHistory", value: "receiving", span: { text: "receive SNAP" } }] : [])], ["food_now"]);
    expect((await result(id)).vetted.questionIds).toEqual([receiving ? "existingIssue" : "benefitHistory"]);
    const key = randomUUID(), request = await start(id, 1, packet(), key); expect(await start(id, 1, packet(), key)).toBe(request);
    const stored = (await fixture.admin.query("select parent_private.food_description_values(d) facts from parent_private.food_description_drafts d where id=$1", [id])).rows[0].facts;
    expect(stored).not.toHaveProperty(receiving ? "existingIssue" : "benefitHistory");
    expect((await fixture.admin.query("select intake->'needs' needs from public.parent_requests where id=$1", [request])).rows[0].needs).toEqual(["food_now"]);
    await expect(start(id, 1, packet([receiving ? "snap_problem" : "snap_new"], ["snap-pa"]))).rejects.toMatchObject({ code: "PT409" });
  });
  it("starts only the available SNAP journey while an independent food answer is missing, with exact receipt and no invented food fact", async () => {
    const id = await begin("I want help with my first SNAP application.", [{ questionId: "benefitHistory", value: "never", span: { text: "my first SNAP application" } }], ["snap_new"]);
    expect((await result(id)).vetted).toMatchObject({ state: "needs_clarification", questionIds: ["foodForTwoDays"], proposedAnswers: { foodForTwoDays: "not_sure", benefitHistory: "never" } });
    const body = packet(["snap_new"], ["snap-pa"]), key = randomUUID(), request = await start(id, 1, body, key);
    expect(await start(id, 1, body, key)).toBe(request);
    const stored = (await fixture.admin.query("select routing_facts,parent_private.food_description_values(d) facts from parent_private.food_description_drafts d where id=$1", [id])).rows[0];
    expect(stored.routing_facts).not.toHaveProperty("foodForTwoDays"); expect(stored.facts).not.toHaveProperty("foodForTwoDays");
    expect((await fixture.admin.query("select intake->'needs' needs from public.parent_requests where id=$1", [request])).rows[0].needs).toEqual(["snap_new"]);
    expect((await fixture.admin.query("select count(*)::int n from public.parent_operations where request_id=$1", [request])).rows[0].n).toBe(0);
  });
  it.each(["food_only", "combined"])("keeps missing food facts closed for the selected %s work", async selection => {
    const id = await begin("I want help with my first SNAP application.", [{ questionId: "benefitHistory", value: "never", span: { text: "my first SNAP application" } }], ["snap_new"]);
    await expect(start(id, 1, selection === "food_only" ? packet() : packet(["food_now", "snap_new"], ["philly-food", "snap-pa"]))).rejects.toMatchObject({ code: "PT409" });
    expect((await fixture.admin.query("select count(*)::int n from public.parent_requests where description_source->>'draftId'=$1", [id])).rows[0].n).toBe(0);
  });
  it.each(["yes", "no"])("keeps explicit outside-PA work manual and refuses a new local start (%s)", async food => {
    const text = food === "yes" ? "have enough food" : "have no food today", description = "We live outside Pennsylvania and " + text + ".";
    const id = await begin(description, [{ questionId: "foodForTwoDays", value: food, span: { text } }], food === "no" ? ["food_now"] : [], "outside_pa", { benefitHistory: { value: "not_sure", confirmedAt: "2026-11-18T14:00:00Z" } });
    expect((await result(id)).vetted).toMatchObject({ state: "manual", questionIds: [], candidates: [], outOfScope: "outside_pa", proposedUrgency: food === "no" ? "today" : null });
    await expect(start(id)).rejects.toMatchObject({ code: "PT409" });
  });
});
