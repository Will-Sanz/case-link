import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { FOOD_DESCRIPTION_FINGERPRINT, runOneFoodDescriptionTurn } from "./food-description-runtime";
import { validateFoodDescriptionSelection } from "./food-description";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
describe.skipIf(!modulePath)("migration37 source carry through actual worker and owned SQL handoff, before selected-route migration38", () => {
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
    fixture = await createParentSqlFixture(modulePath!, "20261118235507_parent_food_description_source_fact_carry.sql");
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
  const originalText = "🙂 Café. There is enough food for two days. This would be my first SNAP application.";
  const originalAssertions = [{ questionId: "foodForTwoDays", value: "yes", span: { text: "enough food for two days" } }, { questionId: "benefitHistory", value: "never", span: { text: "my first SNAP application" } }];
  async function create(description = originalText, routingAnswers = {}) {
    const id = (await query("select public.parent_create_food_description($1,$2,'food-description-2026-11-18.v1',true) id", [owner, randomUUID()])).rows[0].id;
    await queue(id, 0, description, routingAnswers);
    return id;
  }
  async function queue(id: string, revision: number, description: string, routingAnswers = {}) {
    return (await query("select public.parent_queue_food_description($1,$2,$3,$4,$5) revision", [id, owner, revision, randomUUID(), JSON.stringify({ description, screenLocale: "en", routingAnswers })])).rows[0].revision;
  }
  async function work(assertions = originalAssertions, needIds = ["snap_new"]) {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: "resp_synthetic", status: "completed", usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0, cache_write_tokens_details: { ttl_30m_tokens: 0, ttl_12h_tokens: 0 } }, output_tokens_details: { reasoning_tokens: 0 } },
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ needIds, selections: [], assertions, exclusions: [], questionIds: [], outOfScope: null }) }] }] }));
    expect(await runOneFoodDescriptionTurn({ database: { query: (sql, values) => query(sql, values, "parent_worker") }, apiKey: "synthetic-no-network", projectId: "proj_synthetic", fetcher, now: () => new Date() })).toBe(true);
    expect(fetcher).toHaveBeenCalledOnce();
  }
  async function result(id: string) { return (await query("select public.parent_food_description_result($1) value", [id])).rows[0].value; }
  async function facts(id: string) { return (await fixture.admin.query("select routing_facts,parent_private.food_description_answers(d) answers,content_expires_at from parent_private.food_description_drafts d where id=$1", [id])).rows[0]; }
  async function resolve(id: string, rev: number, answers: unknown, fields: string[] = []) { return (await query("select public.parent_resolve_food_description($1,$2,$3,$4,$5,$6) revision", [id, owner, rev, JSON.stringify(answers), fields, randomUUID()])).rows[0].revision; }
  it("retains earlier clear food through edited benefit text with immutable attempt date, original expiry, emoji source and exact historical receipt", async () => {
    const id = await create(); await work(); const old = await result(id), first = validateFoodDescriptionSelection({ ...old, now: new Date() });
    expect(first.proposedAnswers).toEqual({ foodForTwoDays: "yes", benefitHistory: "never", existingIssue: null });
    expect(await resolve(id, 1, first.proposedAnswers)).toBe(1);
    const attempt = (await fixture.admin.query("select created_at,model_projection,result_selection from parent_private.food_description_calls where draft_id=$1", [id])).rows[0];
    const edited = "I checked: I already submitted a SNAP application and am waiting.";
    expect(await queue(id, 1, edited)).toBe(2);
    const carried = await facts(id);
    expect(carried.routing_facts.foodForTwoDays).toMatchObject({ value: "yes", source: "parent_description", sourceRevision: 1 });
    expect(new Date(carried.routing_facts.foodForTwoDays.sourceAttemptCreatedAt).toISOString()).toBe(new Date(attempt.created_at).toISOString());
    expect(new Date(carried.routing_facts.foodForTwoDays.expiresAt).toISOString()).toBe(new Date(carried.content_expires_at).toISOString());
    expect(carried.routing_facts.foodForTwoDays).not.toHaveProperty("confirmedAt");
    await work([{ questionId: "benefitHistory", value: "applied", span: { text: "already submitted a SNAP application" } }], ["snap_pending"]);
    const current = await result(id), vetted = validateFoodDescriptionSelection({ ...current, now: new Date() });
    expect(vetted).toMatchObject({ proposedAnswers: { foodForTwoDays: "yes", benefitHistory: "applied" }, needIds: ["snap_pending"], questionIds: [], conflicts: [], executionGranted: false });
    expect((await facts(id)).answers).toEqual(vetted.proposedAnswers);
    const intake = fixtureIntake({ needs: ["snap_pending"], utilityProviders: [] }), mandate = fixtureMandate({ recipientIds: ["snap-pa"], mode: "prepare_only", allowedActions: ["research", "prepare"], expiresAt: new Date(Date.now() + 86400000).toISOString() }), key = randomUUID();
    const start = () => query("select public.parent_start_food_description_request($1,$2,$3,$4) id", [JSON.stringify({ draftId: id, revision: 2 }), JSON.stringify(intake), JSON.stringify(mandate), key]);
    const request = (await start()).rows[0].id; expect((await start()).rows[0].id).toBe(request);
    expect((await fixture.admin.query("select model_projection,result_selection from parent_private.food_description_calls where draft_id=$1 and revision=1", [id])).rows[0]).toEqual({ model_projection: attempt.model_projection, result_selection: attempt.result_selection });
    expect((await fixture.admin.query("select count(*)::int n from public.parent_jobs where request_id=$1", [request])).rows[0].n).toBe(1);
  });
  it.each([false, true])("carries a clear assertion over an unchanged old typed Not sure through edit and actual start (cached answers %s)", async cached => {
    const oldAnswer = { benefitHistory: { value: "not_sure", confirmedAt: "2026-11-18T14:00:00Z" } };
    const id = await create(originalText, oldAnswer); await work();
    expect(await queue(id, 1, "We still have food for this week.", cached ? oldAnswer : {})).toBe(2);
    expect((await facts(id)).routing_facts.benefitHistory).toMatchObject({ value: "never", source: "parent_description", sourceRevision: 1 });
    await work([{ questionId: "foodForTwoDays", value: "yes", span: { text: "food for this week" } }], ["snap_new"]);
    const vetted = validateFoodDescriptionSelection({ ...await result(id), now: new Date() });
    expect(vetted).toMatchObject({ needIds: ["snap_new"], proposedAnswers: { foodForTwoDays: "yes", benefitHistory: "never" }, questionIds: [], conflicts: [] });
    const intake = fixtureIntake({ needs: ["snap_new"], utilityProviders: [] }), mandate = fixtureMandate({ recipientIds: ["snap-pa"], mode: "prepare_only", allowedActions: ["research", "prepare"], expiresAt: new Date(Date.now() + 86400000).toISOString() });
    expect((await query("select public.parent_start_food_description_request($1,$2,$3,$4) id", [JSON.stringify({ draftId: id, revision: 2 }), JSON.stringify(intake), JSON.stringify(mandate), randomUUID()])).rows[0].id).toMatch(/^[a-f0-9-]{36}$/);
    await queue(id, 2, "I still need help with that application.", oldAnswer);
    expect((await facts(id)).routing_facts.benefitHistory).toMatchObject({ value: "never", source: "parent_description", sourceRevision: 1 });
  });
  it("preserves a genuinely new typed Not sure correction in an edited queue input", async () => {
    const id = await create(originalText, { benefitHistory: { value: "not_sure", confirmedAt: "2026-11-18T14:00:00Z" } }); await work();
    await queue(id, 1, "We still have food for this week.", { benefitHistory: { value: "not_sure", confirmedAt: "2026-11-18T15:00:00Z" } });
    expect((await facts(id)).routing_facts.benefitHistory).toMatchObject({ value: "not_sure", source: "parent_typed" });
  });
  it("honors an actual Not sure clarification even when the test clock preserves the old typed timestamp exactly", async () => {
    const id = await create(originalText, { benefitHistory: { value: "not_sure", confirmedAt: "2026-11-18T15:00:00Z" } }); await work();
    const value = validateFoodDescriptionSelection({ ...await result(id), now: new Date() });
    expect(await resolve(id, 1, { ...value.proposedAnswers, benefitHistory: "not_sure" }, ["benefitHistory"])).toBe(2);
    expect((await facts(id)).answers.benefitHistory).toBe("not_sure");
    await queue(id, 2, "We still have enough food for the week.");
    expect((await facts(id)).routing_facts.benefitHistory).toMatchObject({ value: "not_sure", source: "parent_typed" });
  });
  it("keeps explicit current Not sure corrections and materializes their original source before unrelated deterministic clarification", async () => {
    const id = await create(); await work(); await queue(id, 1, "I am not sure whether there is enough food.");
    await work([{ questionId: "foodForTwoDays", value: "not_sure", span: { text: "not sure whether there is enough food" } }], ["food_now", "snap_new"]);
    const value = validateFoodDescriptionSelection({ ...await result(id), now: new Date() });
    expect(value.proposedAnswers.foodForTwoDays).toBe("not_sure"); expect(value.conflicts).toEqual([]);
    expect(await resolve(id, 2, { ...value.proposedAnswers, benefitHistory: "applied" }, ["benefitHistory"])).toBe(3);
    const revised = await facts(id); expect(revised.routing_facts.foodForTwoDays).toMatchObject({ value: "not_sure", source: "parent_description", sourceRevision: 2 });
    expect(revised.routing_facts.benefitHistory.source).toBe("parent_typed");
    await queue(id, 3, "We are still waiting for that application.");
    const final = await facts(id); expect(final.routing_facts.foodForTwoDays).toEqual(revised.routing_facts.foodForTwoDays);
  });
  it("promotes equal actually typed answers but never refreshes an already typed source", async () => {
    const id = await create(); await work(); await queue(id, 1, "We still need application help."); await work([], ["snap_new"]);
    const value = validateFoodDescriptionSelection({ ...await result(id), now: new Date() });
    expect(await resolve(id, 2, value.proposedAnswers, ["foodForTwoDays"])).toBe(3);
    const promoted = (await facts(id)).routing_facts.foodForTwoDays; expect(promoted.source).toBe("parent_typed"); expect(promoted).not.toHaveProperty("sourceRevision");
    expect(await resolve(id, 3, value.proposedAnswers, ["foodForTwoDays"])).toBe(3);
    expect((await facts(id)).routing_facts.foodForTwoDays).toEqual(promoted);
  });
  it("does not resurrect an originally typed-shadowed assertion after that source expires", async () => {
    const id = await create(originalText, { foodForTwoDays: { value: "no", confirmedAt: "2026-11-17T16:00:00Z" } }); await work(originalAssertions, ["food_now", "snap_new"]);
    vi.setSystemTime(new Date("2026-11-18T16:00:01Z"));
    await query("select parent_private.parent_record_food_description_health(true,$1,'proj_synthetic')", [FOOD_DESCRIPTION_FINGERPRINT], "parent_worker");
    await queue(id, 1, "I am waiting for application help.");
    expect((await facts(id)).routing_facts.foodForTwoDays).toBeUndefined();
  });
  it("rejects unchanged charged prose before materializing derived facts, including after a deterministic clarification", async () => {
    const id = await create(); await work(); await expect(queue(id, 1, originalText)).rejects.toMatchObject({ code: "PT409" });
    const value = validateFoodDescriptionSelection({ ...await result(id), now: new Date() });
    expect(await resolve(id, 1, { ...value.proposedAnswers, benefitHistory: "applied" }, ["benefitHistory"])).toBe(2);
    // A genuine explicit answer changes interpretation context once; the next immutable charged context is then the duplicate baseline.
    await queue(id, 2, originalText); await work([], ["snap_pending"]);
    await expect(queue(id, 3, originalText)).rejects.toMatchObject({ code: "PT409" });
    expect((await fixture.admin.query("select count(*)::int n from parent_private.food_description_calls where draft_id=$1", [id])).rows[0].n).toBe(2);
  });
  it("retains source origin through a zero-call revision and promotes an equal queue answer without refreshing other facts", async () => {
    const id = await create(); await work(); const first = validateFoodDescriptionSelection({ ...await result(id), now: new Date() });
    expect(await resolve(id, 1, { ...first.proposedAnswers, benefitHistory: "applied" }, ["benefitHistory"])).toBe(2);
    const prior = (await facts(id)).routing_facts.foodForTwoDays;
    expect(prior).toMatchObject({ source: "parent_description", sourceRevision: 1, value: "yes" });
    await queue(id, 2, "I am still waiting for SNAP.", { foodForTwoDays: { value: "yes", confirmedAt: "2026-11-18T14:45:00Z" } });
    const current = (await facts(id)).routing_facts;
    expect(current.foodForTwoDays).toMatchObject({ source: "parent_typed", value: "yes" });
    expect(new Date(current.foodForTwoDays.confirmedAt).toISOString()).toBe("2026-11-18T14:45:00.000Z");
    expect(current.benefitHistory.source).toBe("parent_typed");
    expect((await fixture.admin.query("select count(*)::int n from parent_private.food_description_calls where draft_id=$1", [id])).rows[0].n).toBe(1);
  });
  it("keeps all new source helpers closed to every application role", async () => {
    for (const role of ["anon", "authenticated", "service_role", "parent_worker", "parent_retention_worker", "parent_storage_broker", "parent_snap_finalizer", "parent_utility_protected"])
      expect((await fixture.admin.query("select has_function_privilege($1,'parent_private.food_description_carry_facts(parent_private.food_description_drafts)','execute') allowed", [role])).rows[0].allowed).toBe(false);
  });
  it("skips legacy source results whose immutable source attempt content is absent instead of inventing dates", async () => {
    const id = await create(); await work();
    await fixture.admin.query("update parent_private.food_description_calls set model_projection=null,result_selection=null where draft_id=$1", [id]);
    await queue(id, 1, "I already submitted a SNAP application and am waiting.");
    expect((await facts(id)).routing_facts).toEqual({});
  });
  it.each(["owner", "cancelled", "expired", "purpose"])("does not carry or dispatch after %s closure", async reason => {
    const id = await create(); await work();
    if (reason === "owner") owner = randomUUID();
    if (reason === "cancelled") await query("select public.parent_cancel_food_description($1,$2)", [id, owner]);
    if (reason === "expired") vi.setSystemTime(new Date("2026-11-19T15:00:01Z"));
    if (reason === "purpose") await fixture.admin.query("update parent_private.processing_controls set food_description_enabled=false");
    await expect(queue(id, 1, "I already applied and am waiting.")).rejects.toThrow();
    expect((await fixture.admin.query("select count(*)::int n from parent_private.food_description_calls where draft_id=$1", [id])).rows[0].n).toBe(1);
  });
  it.each(["en", "es"] as const)("retains the historical migration37 SNAP-only denial before migration38 allows independent readiness (%s)", async language => {
    const description = language === "en" ? "I now want help with my first SNAP application as well as food today." : "Ahora también quiero ayuda con mi primera solicitud de SNAP, además de comida para hoy.";
    const quote = language === "en" ? "first SNAP application" : "primera solicitud de SNAP";
    const id = (await query("select public.parent_create_food_description($1,$2,'food-description-2026-11-18.v1',true) id", [owner, randomUUID()])).rows[0].id;
    await query("select public.parent_queue_food_description($1,$2,0,$3,$4)", [id, owner, randomUUID(), JSON.stringify({ description, screenLocale: language })]);
    await work([{ questionId: "benefitHistory", value: "never", span: { text: quote } }], ["food_now", "snap_new"]);
    const vetted = validateFoodDescriptionSelection({ ...await result(id), now: new Date() });
    expect(vetted).toMatchObject({ state: "needs_clarification", questionIds: ["foodForTwoDays"], proposedAnswers: { foodForTwoDays: "not_sure", benefitHistory: "never" } });
    expect((await facts(id)).routing_facts).not.toHaveProperty("foodForTwoDays");
    const before = (await fixture.admin.query("select count(*)::int n from public.parent_requests")).rows[0].n;
    const intake = fixtureIntake({ needs: ["snap_new"], utilityProviders: [] });
    const mandate = fixtureMandate({ recipientIds: ["snap-pa"], mode: "prepare_only", allowedActions: ["research", "prepare"], expiresAt: new Date(Date.now() + 86400000).toISOString() });
    await expect(query("select public.parent_start_food_description_request($1,$2,$3,$4) id", [JSON.stringify({ draftId: id, revision: 1 }), JSON.stringify(intake), JSON.stringify(mandate), randomUUID()])).rejects.toThrow("description routing changed");
    expect((await fixture.admin.query("select count(*)::int n from public.parent_requests")).rows[0].n).toBe(before);
  });

});
