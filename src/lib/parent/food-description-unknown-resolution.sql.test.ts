import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { FOOD_DESCRIPTION_FINGERPRINT, runOneFoodDescriptionTurn } from "./food-description-runtime";
import { validateFoodDescriptionSelection } from "./food-description";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
const retained = JSON.parse(readFileSync(new URL("../../../tests/fixtures/parent/food-description-unknown-resolution-response-2026-11-18.json", import.meta.url), "utf8"));
const description = "We need food today, and I checked that we have never applied for SNAP.";
describe.skipIf(!modulePath)("source-bound unknown resolution through the actual owned SQL handoff", () => {
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
    fixture = await createParentSqlFixture(modulePath!, "20261118194631_parent_food_directory_bounded_retry.sql");
    await fixture.admin.query(readFileSync("supabase/migrations/20261118230000_parent_food_description_unknown_resolution.sql", "utf8"));
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
  async function begin(known = false, excluded = false, withoutAssertion = false) {
    const id = (await query("select public.parent_create_food_description($1,$2,'food-description-2026-11-18.v1',true) id", [owner, randomUUID()])).rows[0].id;
    const routingAnswers = { foodForTwoDays: { value: known ? "yes" : "not_sure", confirmedAt: "2026-11-18T14:00:00Z" }, benefitHistory: { value: known ? "applied" : "not_sure", confirmedAt: "2026-11-18T14:00:00Z" } };
    const input = { description: description + (excluded ? " Do not apply for SNAP." : ""), screenLocale: "en", routingAnswers };
    await query("select public.parent_queue_food_description($1,$2,0,$3,$4)", [id, owner, randomUUID(), JSON.stringify(input)]);
    const selection = JSON.parse(retained.attempts[1].message);
    if (known) { selection.needIds = ["snap_pending"]; selection.selections = []; }
    if (withoutAssertion) selection.assertions = [];
    if (excluded) { const text = "Do not apply for SNAP."; selection.exclusions = [{ need: "snap_new", span: { text, start: input.description.indexOf(text), end: input.description.length } }]; }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: "resp_synthetic", status: "completed", usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0, cache_write_tokens_details: { ttl_30m_tokens: 0, ttl_12h_tokens: 0 } }, output_tokens_details: { reasoning_tokens: 0 } },
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(selection) }] }] }));
    await runOneFoodDescriptionTurn({ database: { query: (sql, values) => query(sql, values, "parent_worker") }, apiKey: "synthetic-no-network", projectId: "proj_synthetic", fetcher, now: () => new Date() });
    expect(fetcher).toHaveBeenCalledOnce();
    const value = (await query("select public.parent_food_description_result($1) value", [id])).rows[0].value;
    return { id, value, source: { draftId: id, revision: 1 } };
  }
  function packet() {
    return { intake: fixtureIntake({ needs: ["food_now", "snap_new"], utilityProviders: [] }), mandate: fixtureMandate({ recipientIds: ["philly-food", "snap-pa"],
      mode: "prepare_only", allowedActions: ["research", "prepare"], expiresAt: new Date(Date.now() + 86400000).toISOString() }) };
  }
  async function start(source: unknown, body = packet(), key = randomUUID()) {
    return (await query("select public.parent_start_food_description_request($1,$2,$3,$4) id", [JSON.stringify(source), JSON.stringify(body.intake), JSON.stringify(body.mandate), key])).rows[0].id;
  }
  it("matches TypeScript answers while retaining the original unknown facts, source dates and private helper grants", async () => {
    const { id, value } = await begin();
    const vetted = validateFoodDescriptionSelection({ ...value, now: new Date() });
    expect(vetted).toMatchObject({ proposedAnswers: { foodForTwoDays: "no", benefitHistory: "never" }, needIds: ["food_now", "snap_new"], executionGranted: false });
    const stored = (await fixture.admin.query("select routing_facts,parent_private.food_description_answers(d) answers from parent_private.food_description_drafts d where id=$1", [id])).rows[0];
    expect(stored.answers).toEqual(vetted.proposedAnswers);
    expect(stored.routing_facts).toEqual(value.projection.routingFacts);
    expect(stored.routing_facts.foodForTwoDays.value).toBe("not_sure");
    expect(new Date(stored.routing_facts.foodForTwoDays.confirmedAt).toISOString()).toBe("2026-11-18T14:00:00.000Z");
    expect(new Date(stored.routing_facts.foodForTwoDays.expiresAt).toISOString()).toBe("2026-11-19T14:00:00.000Z");
    for (const role of ["anon", "authenticated", "service_role", "parent_worker"])
      expect((await fixture.admin.query("select has_function_privilege($1,'parent_private.food_description_values(parent_private.food_description_drafts)','execute') allowed", [role])).rows[0].allowed).toBe(false);
  });
  it("accepts the source-derived SNAP handoff once and reconciles only its exact source, body and key", async () => {
    const { id, value, source } = await begin(), body = packet(), key = randomUUID();
    expect(value.selection.needIds).toEqual(["food_now"]); // Retained model omission is not credited as raw nomination accuracy.
    const vetted = validateFoodDescriptionSelection({ ...value, now: new Date() });
    expect((await query("select public.parent_resolve_food_description($1,$2,1,$3,'{}',$4) revision", [id, owner, JSON.stringify(vetted.proposedAnswers), randomUUID()])).rows[0].revision).toBe(1);
    const requestId = await start(source, body, key);
    expect(await start(source, body, key)).toBe(requestId);
    await expect(start(source, body)).rejects.toMatchObject({ code: "PT409" });
    const row = (await fixture.admin.query("select description_source,intake from public.parent_requests where id=$1", [requestId])).rows[0];
    expect(row).toEqual({ description_source: source, intake: body.intake });
    expect((await fixture.admin.query("select count(*)::int n from public.parent_jobs where request_id=$1", [requestId])).rows[0].n).toBe(1);
    expect((await fixture.admin.query("select model_projection,result_selection from parent_private.food_description_calls where draft_id=$1", [id])).rows[0]).toEqual({ model_projection: value.projection, result_selection: value.selection });
  });
  it("keeps definite typed answers authoritative in SQL and refuses a conflicting new application", async () => {
    const { id, value, source } = await begin(true);
    const vetted = validateFoodDescriptionSelection({ ...value, now: new Date() });
    expect(vetted).toMatchObject({ proposedAnswers: { foodForTwoDays: "yes", benefitHistory: "applied" }, needIds: ["snap_pending"], conflicts: ["foodForTwoDays", "benefitHistory"] });
    expect((await fixture.admin.query("select parent_private.food_description_answers(d) answers from parent_private.food_description_drafts d where id=$1", [id])).rows[0].answers).toEqual(vetted.proposedAnswers);
    await expect(start(source)).rejects.toMatchObject({ code: "PT409" });
  });
  it.each(["unresolved", "excluded", "owner", "revision", "source", "program", "wic", "utility", "mandate_expired", "source_expired", "purpose", "duplicate_pending"])("does not expand authority after unknown resolution: %s", async reason => {
    if (reason === "duplicate_pending") {
      const old = packet(); old.intake.needs = ["snap_pending"]; old.mandate.recipientIds = ["snap-pa"];
      await query("select public.parent_start_request($1,$2,$3)", [JSON.stringify(old.intake), JSON.stringify(old.mandate), randomUUID()]);
    }
    const { source } = await begin(false, reason === "excluded", reason === "unresolved"), body = packet();
    if (reason === "owner") owner = randomUUID();
    if (reason === "revision") source.revision++;
    if (reason === "source") source.draftId = randomUUID();
    if (reason === "program") body.mandate.recipientIds = ["wic-pa"];
    if (reason === "wic") body.intake.needs = ["wic_new"];
    if (reason === "utility") body.intake.needs = ["electricity"];
    if (reason === "mandate_expired") body.mandate.expiresAt = "2026-11-17T12:00:00Z";
    if (reason === "source_expired") {
      vi.setSystemTime(new Date("2026-11-19T15:00:01Z"));
      await fixture.admin.query("update parent_private.processing_controls set food_description_approved_until=now()+interval '1 day'");
      await query("select parent_private.parent_record_food_description_health(true,$1,'proj_synthetic')", [FOOD_DESCRIPTION_FINGERPRINT], "parent_worker");
    }
    if (reason === "purpose") await fixture.admin.query("update parent_private.processing_controls set food_description_enabled=false");
    await expect(start(source, body)).rejects.toThrow();
  });
});
