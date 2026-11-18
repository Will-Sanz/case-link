import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { buildFoodAccessPlanBody, foodAccessPlanSchema, foodAccessReportSchema, SHARE_FOOD_ACCESS_PROGRAM } from "./food-access";
import { buildFoodAccessAlternatives } from "./food-access-alternatives";
import { buildSupportPlan } from "./planning";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";
import { runOneParentJob } from "./worker-runtime";
import type { SupportRequest } from "./domain";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
describe.skipIf(!modulePath)("owned public food access through the real leased service (no model/provider)", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>;
  const owner = randomUUID(), other = randomUUID(), sessions = new Map([owner, other].map(id => [id, randomUUID()]));
  const source = { objectid: 122, site_name: "Share Food Program Community Fridge & Pantry", address: "2901 W Hunting Park Ave", zip_code: "19129", status: "Active", category_type: "Community Fridge" };
  async function query(role: string, sql: string, values: unknown[] = [], user = owner) {
    await fixture.admin.query(`set role ${role}`);
    try {
      await fixture.admin.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ role, ...(role === "authenticated" ? { sub: user, session_id: sessions.get(user), amr: [{ method: "otp" }] } : {}) })]);
      return await fixture.admin.query(sql, values);
    } finally { await fixture.admin.query("reset role"); }
  }
  beforeAll(async () => {
    fixture = await createParentSqlFixture(modulePath!);
    await fixture.admin.query("update parent_private.processing_controls set enabled=true,approval_reference='isolated public food fixture',approved_until=now()+interval '1 day'");
    for (const user of [owner, other]) {
      await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [user, `${user}@example.invalid`]);
      await fixture.admin.query("insert into auth.sessions(id,user_id,not_after) values($1,$2,now()+interval '1 day')", [sessions.get(user), user]);
      await query("authenticated", "select public.parent_ensure_account()", [], user);
    }
  });
  afterAll(async () => { await fixture?.admin.end(); });
  async function start(combined = false, options: { zip?: string; withCity?: boolean } = {}) {
    await fixture.admin.query("update parent_private.processing_controls set enabled=true,approved_until=now()+interval '1 day'");
    await fixture.admin.query("update public.parent_accounts set status='active' where id=$1", [owner]);
    const active = await query("authenticated", "select id from public.parent_requests where status in ('active','paused')");
    for (const row of active.rows) await query("authenticated", "select public.parent_control_request($1,'cancel')", [row.id]);
    return (await query("authenticated", "select public.parent_start_request($1,$2,$3) id", [
      JSON.stringify(fixtureIntake({ needs: combined ? ["food_now", "snap_new"] : ["food_now"], zip: options.zip ?? "19129", householdSize: null, incomeAmount: null, incomeFrequency: "unknown", utilityProviders: [] })),
      JSON.stringify(fixtureMandate({ mode: "prepare_only", recipientIds: [...(options.withCity ? ["philly-food"] : []),SHARE_FOOD_ACCESS_PROGRAM,...(combined ? ["snap-pa"] : [])], allowedActions: ["research", "prepare"], allowedData: ["household"], expiresAt: new Date(Date.now()+86400000).toISOString() })), randomUUID(),
    ])).rows[0].id as string;
  }
  async function read(id: string): Promise<SupportRequest> {
    return (await fixture.admin.query("select to_jsonb(r) value from public.parent_requests r where id=$1", [id])).rows[0].value;
  }
  async function job(id: string) { return (await fixture.admin.query("select to_jsonb(j) value from public.parent_jobs j where request_id=$1", [id])).rows[0].value; }
  async function report(id: string, result = "no_food", key: string = randomUUID(), change: Record<string, unknown> = {}, user = owner) {
    const request = await read(id), access = request.plan!.routes.find(route => route.need === "food_now")!.foodAccess!;
    const args = { version: request.version, site: access.site.id, hash: access.planHash, key, result, ...change };
    return (await query("authenticated", "select public.parent_report_food_visit($1,$2,$3,$4,$5,$6) value", [id, args.version, args.site, args.hash, args.key, args.result], user)).rows[0].value;
  }
  async function work(options: { directory?: "listed" | "empty" | "unavailable"; beforeDirectoryReply?: () => Promise<void> } = {}) {
    let publicCalls = 0, directoryCalls = 0;
    const result = await runOneParentJob({ database: { query: (sql, values) => query("parent_worker", sql, values) }, continuationOnly: true,
      brokerOrigin: "http://127.0.0.1:3310", brokerSecret: "isolated-synthetic-broker-secret-32-characters", supabaseOrigin: "http://127.0.0.1:55321",
      fetcher: async input => {
        const url = new URL(String(input)); expect(url.origin).toBe("https://services.arcgis.com");
        if (url.searchParams.get("where") === "objectid=122") {
          publicCalls++; return Response.json({ features: [{ attributes: source }] });
        }
        expect(url.searchParams.get("where")).toBe("zip_code='19129' AND status='Active'"); directoryCalls++;
        await options.beforeDirectoryReply?.();
        if (options.directory === "unavailable") throw new Error("synthetic_public_directory_unavailable");
        return Response.json({ features: options.directory === "listed" ? [{ attributes: source }, { attributes: { ...source, objectid: 148, site_name: "East Falls Community Fridge", address: "3507 Midvale Ave.", category_type: "Food Site", website: "https://eastfallscommunityfridge.com/" } }] : [] });
      } });
    return { result, publicCalls, ...(options.directory === undefined ? {} : { directoryCalls }) };
  }
  it("rejects a stale negative directory save after a corrected positive report even without a receipt-wake marker", async () => {
    const id = await start(); await work(); const negative = foodAccessReportSchema.parse(await report(id)), request = await read(id);
    const plan = structuredClone(request.plan)!;
    plan.routes[0].foodAccessAlternatives = buildFoodAccessAlternatives({ request, report: negative, zip: "19129", now: new Date(),
      result: { sites: [], sourceUrl: "https://www.phila.gov/food/", checkedAt: new Date().toISOString(), availability: "city_listed_unconfirmed", moreSitesAvailable: false } });
    const claimed = (await query("parent_worker", "select parent_private.parent_claim_job(300,true,false,false) value")).rows[0].value;
    const positive = await report(id, "received_enough_food");
    await fixture.admin.query("update public.parent_jobs set receipt_wake_lease_token=null where request_id=$1", [id]);
    const before = await read(id);
    await expect(query("parent_worker", "select parent_private.parent_save_job_plan($1,$2,$3,$4,'[]',null,'caselink','route_review_required')", [claimed.jobId, claimed.leaseToken, request.version, JSON.stringify(plan)]))
      .rejects.toMatchObject({ code: "PT409" });
    expect(await read(id)).toEqual(before); expect((await read(id)).plan!.routes[0].foodAccessReport).toEqual(positive);
  });
  it("adds only the guarded finish predicate, preserving the installed saver definition, owner and grants", async () => {
    const migration = readFileSync("supabase/migrations/20261118192225_parent_food_directory_report_binding.sql", "utf8");
    const guard = migration.match(/guard constant text := \$guard\$([\s\S]*?)\$guard\$/)![1];
    const metadata = async () => (await fixture.admin.query("select pg_get_functiondef(p.oid) definition,p.proowner,p.proacl from pg_proc p where p.oid='parent_private.parent_save_job_plan(uuid,uuid,integer,jsonb,jsonb,timestamp with time zone,text,text)'::regprocedure")).rows[0];
    const installed = await metadata(); expect(installed.definition.split(guard)).toHaveLength(2);
    const original = { ...installed, definition: installed.definition.replace(guard, "") };
    await fixture.admin.query(original.definition); expect(await metadata()).toEqual(original);
    await fixture.admin.query(migration); expect(await metadata()).toEqual(installed);
    await expect(fixture.admin.query(migration)).rejects.toThrow("food directory finish guard target changed");
    expect(await metadata()).toEqual(installed);
  });
  it("adds only the existing claim counter to its reply, preserving both current guards, owner and grants", async () => {
    const migration = readFileSync("supabase/migrations/20261118194631_parent_food_directory_bounded_retry.sql", "utf8");
    const anchor = migration.match(/anchor constant text := \$anchor\$([\s\S]*?)\$anchor\$/)![1];
    const replacement = migration.match(/replacement constant text := \$replacement\$([\s\S]*?)\$replacement\$/)![1];
    const metadata = async () => (await fixture.admin.query("select pg_get_functiondef(p.oid) definition,p.proowner,p.proacl from pg_proc p where p.oid='parent_private.parent_claim_job(integer,boolean,boolean,boolean)'::regprocedure")).rows[0];
    const installed = await metadata(), original = { ...installed, definition: installed.definition.replace(replacement, anchor) };
    expect(original.definition).not.toBe(installed.definition); await fixture.admin.query(original.definition);
    expect(await metadata()).toEqual(original); await fixture.admin.query(migration); expect(await metadata()).toEqual(installed);
    await expect(fixture.admin.query(migration)).rejects.toThrow("food directory claim counter target changed"); expect(await metadata()).toEqual(installed);
  });
  it.each(["event", "report_hash", "zip", "version", "source", "need", "expired_zip"])("rejects a directory finish whose %s no longer matches current authority", async kind => {
    const id = await start(); await work(); const negative = foodAccessReportSchema.parse(await report(id)), request = await read(id), plan = structuredClone(request.plan)!;
    const observation = buildFoodAccessAlternatives({ request, report: negative, zip: "19129", now: new Date(), result: null });
    plan.routes[0].foodAccessAlternatives = observation;
    if (kind === "event") observation.sourceReport.eventId = randomUUID();
    if (kind === "report_hash") observation.sourceReport.planHash = "b".repeat(64);
    if (kind === "zip") observation.queriedZip = "19104";
    if (kind === "version") observation.requestVersion++;
    if (kind === "source") Object.assign(observation, { sourceUrl: "https://example.invalid" });
    if (kind === "need") plan.routes[0].need = "snap_new";
    const claimed = (await query("parent_worker", "select parent_private.parent_claim_job(300,true,false,false) value")).rows[0].value;
    if (kind === "expired_zip") await fixture.admin.query("update public.parent_requests set intake_confirmed_at=jsonb_set(intake_confirmed_at,'{zip}','\"2026-01-01T12:00:00Z\"') where id=$1", [id]);
    const before = await read(id);
    await expect(query("parent_worker", "select parent_private.parent_save_job_plan($1,$2,$3,$4,'[]',null,'caselink','route_review_required')", [claimed.jobId, claimed.leaseToken, request.version, JSON.stringify(plan)])).rejects.toMatchObject({ code: "PT409" });
    expect(await read(id)).toEqual(before);
  });
  it.each(["listed", "empty", "unavailable"] as const)("saves %s source-bound observations through the actual report/wake/leased worker", async directory => {
    const id = await start(); await work(); const saved = foodAccessReportSchema.parse(await report(id)), before = await job(id);
    const reservations = (await fixture.admin.query("select count(*)::int n from parent_private.model_call_reservations")).rows[0].n;
    expect(await work({ directory })).toMatchObject({ result: { state: "saved" }, directoryCalls: 1 });
    const current = await read(id), observation = current.plan!.routes[0].foodAccessAlternatives!;
    expect(observation).toMatchObject({ state: directory, sourceReport: saved, requestId: id, requestVersion: current.version, queriedZip: "19129", sourceUrl: "https://www.phila.gov/food/" });
    expect(observation.sites.map(site => site.id)).toEqual(directory === "listed" ? [148] : []);
    expect(current.status).toBe("active"); expect(current.plan!.routes[0].state).toBe("unresolved"); expect((await job(id)).id).toBe(before.id);
    expect((await fixture.admin.query("select count(*)::int n from public.parent_operations where request_id=$1", [id])).rows[0].n).toBe(0);
    expect((await fixture.admin.query("select count(*)::int n from parent_private.model_call_reservations")).rows[0].n).toBe(reservations);
    expect(await report(id, "no_food", saved.reportKey, { hash: saved.planHash })).toEqual(saved);
    // An exact receipt replay is a read; it must not schedule another check.
    expect(await work({ directory })).toMatchObject({ result: { state: "idle" }, directoryCalls: 0 });
    if (directory !== "unavailable") {
      // A later independent worker turn reuses the successful check without renewing its date.
      await fixture.admin.query("update public.parent_jobs set state='queued',run_at=now() where request_id=$1", [id]);
      expect(await work({ directory })).toMatchObject({ result: { state: "saved" }, directoryCalls: 0 });
      expect((await read(id)).plan!.routes[0].foodAccessAlternatives).toEqual(observation);
    }
  });
  it("owns a bounded scheduled retry after a directory outage, then survives restart without another family report", async () => {
    const id = await start(); await work(); const saved = await report(id);
    await work({ directory: "unavailable" }); const pending = await job(id);
    expect(pending).toMatchObject({ state: "waiting", attempts: 2 });
    expect(Date.parse(pending.run_at)).toBeGreaterThanOrEqual(Date.now() + 299000);
    expect((await read(id)).next_actor).toBe("caselink"); expect((await read(id)).next_trigger).toBe("scheduled_follow_up");
    expect((await work({ directory: "listed" })).result).toEqual({ state: "idle" });
    // Advance only this disposable job to its due turn; do not reset its lifetime counter.
    await fixture.admin.query("update public.parent_jobs set run_at=now() where request_id=$1", [id]);
    expect(await work({ directory: "listed" })).toMatchObject({ result: { state: "saved" }, directoryCalls: 1 });
    expect((await read(id)).plan!.routes[0].foodAccessAlternatives).toMatchObject({ state: "listed", sourceReport: saved });
    expect((await job(id)).attempts).toBe(3);
    expect((await fixture.admin.query("select count(*)::int n from public.parent_events where request_id=$1 and evidence ? 'foodAccessReport'", [id])).rows[0].n).toBe(1);
  });
  it("keeps the existing five-attempt transient limit and48-claim lifetime instead of endlessly polling a directory outage", async () => {
    const id = await start(); await work(); await report(id);
    await fixture.admin.query("update public.parent_jobs set attempts=4 where request_id=$1", [id]);
    await work({ directory: "unavailable" });
    expect(await job(id)).toMatchObject({ state: "waiting", attempts: 5, run_at: "infinity" });
    expect((await read(id)).next_actor).toBe("service_operator"); expect((await read(id)).status).toBe("active");
    expect((await work({ directory: "listed" })).result).toEqual({ state: "idle" });
  });
  it.each(["received_enough_food", "some_food_still_needed"])("lets a concurrent corrected %s report wake a new turn before saving observations", async result => {
    const id = await start(); await work(); const old = await report(id); let corrected: unknown;
    expect((await work({ directory: "listed", beforeDirectoryReply: async () => { corrected = await report(id, result); } })).result).toEqual({ state: "saved" });
    const current = await read(id); expect(current.plan!.routes[0].foodAccessReport).toEqual(corrected);
    expect(current.plan!.routes[0].foodAccessAlternatives).toBeUndefined(); expect((await job(id)).state).toBe("queued");
    await work({ directory: "listed" }); const finished = await read(id);
    if (result === "received_enough_food") { expect(finished.status).toBe("closed"); expect(finished.plan!.routes[0].foodAccessAlternatives).toBeUndefined(); }
    else { expect(finished.status).toBe("active"); expect(finished.plan!.routes[0].foodAccessAlternatives!.sourceReport).toEqual(corrected); }
    expect(old).not.toEqual(corrected);
  });
  it.each(["cancel", "pause", "account_hold", "processing_closed", "lease_expiry", "withdraw_household"])("does not finish a directory observation after %s during the read", async kind => {
    const id = await start(); await work(); await report(id);
    const result = await work({ directory: "listed", beforeDirectoryReply: async () => {
      if (kind === "cancel" || kind === "pause") await query("authenticated", "select public.parent_control_request($1,$2)", [id, kind]);
      if (kind === "account_hold") await fixture.admin.query("update public.parent_accounts set status='security_hold' where id=$1", [owner]);
      if (kind === "processing_closed") await fixture.admin.query("update parent_private.processing_controls set enabled=false");
      if (kind === "lease_expiry") await fixture.admin.query("update public.parent_jobs set lease_until=now()-interval '1 second' where request_id=$1", [id]);
      if (kind === "withdraw_household") { const current = await read(id); await query("authenticated", "select public.parent_replace_mandate($1,$2,$3)", [id, JSON.stringify({ ...current.mandate, allowedData: ["income"] }), current.version]); }
    } });
    expect(result.result.state).toBe("failed"); expect((await read(id)).plan!.routes[0].foodAccessAlternatives).toBeUndefined();
  });
  it("actually claims and prepares without a model key, broker call, private facts or provider operation", async () => {
    const id = await start(), completed = await work(), request = await read(id);
    expect(completed).toEqual({ result: { state: "saved" }, publicCalls: 1 });
    expect(request.plan!.routes[0]).toMatchObject({ programId: SHARE_FOOD_ACCESS_PROGRAM, state: "prepared", foodAccess: { requestId: id, requestVersion: 1, site: { stock: "unknown", reservation: "none" } } });
    expect(request.next_actor).toBe("parent"); expect(request.required_actions).toEqual([]);
    expect((await fixture.admin.query("select count(*)::int n from public.parent_operations where request_id=$1", [id])).rows[0].n).toBe(0);
    expect((await job(id)).state).toBe("waiting");
  });
  it.each(["19104", "unknown"])("preserves City discovery for ordinary %s routing instead of defaulting to the distant Share option", async routing => {
    const id=await start(false,{ zip:routing === "unknown" ? "19129" : routing,withCity:true });
    if (routing === "unknown") await fixture.admin.query("update public.parent_requests set intake_confirmed_at=jsonb_set(intake_confirmed_at,'{zip}','\"2026-01-01T12:00:00Z\"') where id=$1",[id]);
    expect((await work()).publicCalls).toBe(0);
    const route=(await read(id)).plan!.routes[0]; expect(route.programId).toBe("philly-food"); expect(route.foodAccess).toBeUndefined();
    expect(route.steps.join(" ")).not.toContain("application fields");
  });
  it("prefers the named19129 Share option for a fresh matching ZIP without imposing a residence eligibility rule",async()=>{
    const id=await start(false,{ withCity:true }); await work(); expect((await read(id)).plan!.routes[0].foodAccess).toBeTruthy();
    const explicit=await start(false,{ zip:"19104" }); await work(); expect((await read(explicit)).plan!.routes[0].foodAccess).toBeTruthy();
  });
  it("does not promote a withdrawn saved ZIP into a Share recommendation or new worker use",async()=>{
    const source=await start(false,{ withCity:true }), original=await read(source);
    const target=(await query("authenticated","select public.parent_start_request_with_reused_zip($1,$2,$3,$4,$5) value",[
      JSON.stringify(original.intake),JSON.stringify(original.mandate),randomUUID(),source,original.version,
    ])).rows[0].value as string;
    await query("authenticated","select public.parent_replace_mandate($1,$2,$3)",[source,JSON.stringify({ ...original.mandate,allowedData:["income"] }),original.version]);
    expect((await work()).result).toEqual({ state:"idle" });
    const current=await read(target); expect(current.plan).toBeNull(); expect(current.intake_reuse?.zip?.invalidated).toBe(true);
    expect(buildSupportPlan(current,new Date()).routes[0].programId).toBe("philly-food");
  });
  it("reports actual public-worker readiness without declaring model readiness, and clears it on shutdown", async () => {
    const id=await start();
    await query("parent_worker","select parent_private.parent_record_worker_health(false,false,true)");
    await work();
    const progress=async()=> (await query("authenticated","select public.parent_request_progress($1) value",[id])).rows[0].value;
    expect(await progress()).toMatchObject({ state:"needs_parent",canContinueAfterClosing:true });
    expect((await fixture.admin.query("select planning_ready from parent_private.worker_health")).rows[0].planning_ready).toBe(false);
    await query("parent_worker","select parent_private.parent_record_worker_health(false,false,false)");
    expect(await progress()).toMatchObject({ state:"service_offline",canContinueAfterClosing:false });
  });
  it("does not infer public capability from old, false-public or expired capability heartbeats",async()=>{
    const id=await start();
    const progress=async()=> (await query("authenticated","select public.parent_request_progress($1) value",[id])).rows[0].value;
    await query("parent_worker","select parent_private.parent_record_worker_health(false,false)");
    expect(await progress()).toMatchObject({ state:"service_offline",canContinueAfterClosing:false });
    await query("parent_worker","select parent_private.parent_record_worker_health(true,true,false)");
    expect(await progress()).toMatchObject({ state:"service_offline",canContinueAfterClosing:false });
    await query("parent_worker","select parent_private.parent_record_worker_health(true,true)");
    expect(await progress()).toMatchObject({ state:"service_offline",canContinueAfterClosing:false });
    await query("parent_worker","select parent_private.parent_record_worker_health(false,false,true)");
    await fixture.admin.query("update parent_private.worker_health set public_food_ready_until=now()-interval '1 second'");
    await query("parent_worker","select parent_private.parent_record_worker_health(true,true)");
    expect(await progress()).toMatchObject({ state:"service_offline",canContinueAfterClosing:false });
  });
  it.each([
    { name:"research only",allowedActions:["research"],allowedData:["household"] },
    { name:"no household routing",allowedActions:["research","prepare"],allowedData:["income"] },
  ])("requires claimable public scope before advertising no-model continuation: $name",async change=>{
    const seed=await start(), original=await read(seed);
    await query("authenticated","select public.parent_control_request($1,'cancel')",[seed]);
    const id=(await query("authenticated","select public.parent_start_request($1,$2,$3) id",[
      JSON.stringify(original.intake),JSON.stringify({ ...original.mandate,allowedActions:change.allowedActions,allowedData:change.allowedData }),randomUUID(),
    ])).rows[0].id as string;
    const progress=async()=> (await query("authenticated","select public.parent_request_progress($1) value",[id])).rows[0].value;
    await query("parent_worker","select parent_private.parent_record_worker_health(false,false,true)");
    expect((await work()).result).toEqual({ state:"idle" });
    expect(await progress()).toMatchObject({ state:"service_offline",canContinueAfterClosing:false });
    await query("parent_worker","select parent_private.parent_record_worker_health(true,true,false)");
    expect(await progress()).toMatchObject({ state:"queued",canContinueAfterClosing:true });
  });
  it.each(["no_food", "some_food_still_needed", "could_not_access", "need_another_way"])("atomically wakes the same version and retains the unmet need after %s", async result => {
    const id = await start(); await work(); const original = await read(id), before = await job(id);
    const saved = foodAccessReportSchema.parse(await report(id, result));
    expect(saved).toMatchObject({ requestId: id, outcome: "unresolved", attribution: "parent_reported" });
    expect(await job(id)).toMatchObject({ id: before.id, state: "queued", request_version: original.version });
    expect((await read(id)).version).toBe(original.version);
    await work(); const current = await read(id);
    expect(current).toMatchObject({ status: "active", version: original.version, next_actor: "service_operator" });
    expect(current.plan!.routes[0]).toMatchObject({ state: "unresolved", foodAccessReport: saved });
    expect(current.plan!.routes[0].limitation).toContain("another usable location has not been confirmed");
    expect(current.required_actions.every(action => action.reason !== "missing_fact")).toBe(true);
  });
  it("closes only after an attributed received-enough report, and exact replay after closure has no new effect", async () => {
    const id = await start(); await work(); const access = (await read(id)).plan!.routes[0].foodAccess!, key = randomUUID();
    const saved = await report(id, "received_enough_food", key); await work();
    expect((await read(id)).status).toBe("closed"); const before = await job(id);
    expect(await report(id, "received_enough_food", key, { version: 1, hash: access.planHash })).toEqual(saved);
    expect(await job(id)).toEqual(before);
    expect((await fixture.admin.query("select count(*)::int n from public.parent_events where request_id=$1 and evidence->'foodAccessReport'->>'reportKey'=$2", [id,key])).rows[0].n).toBe(1);
  });
  it("keeps the latest same-plan unmet report active instead of completing from an earlier mistaken positive",async()=>{
    const id=await start(); await work(); const before=await read(id), access=before.plan!.routes[0].foodAccess!, key=randomUUID();
    const earlier=await report(id,"received_enough_food",key), latest=await report(id,"no_food");
    expect(await report(id,"received_enough_food",key,{ version:before.version,hash:access.planHash })).toEqual(earlier);
    await work(); const current=await read(id);
    expect(current.status).toBe("active"); expect(current.plan!.routes[0]).toMatchObject({ state:"unresolved",foodAccessReport:latest });
    expect((await fixture.admin.query("select count(*)::int n from public.parent_events where request_id=$1 and evidence ? 'foodAccessReport'",[id])).rows[0].n).toBe(2);
  });
  it("rejects manual completed closure after a later typed unmet report",async()=>{
    const id=await start(); await work(); await report(id,"received_enough_food"); await report(id,"could_not_access");
    await expect(query("authenticated","select public.parent_close_request($1,'completed','Synthetic manual completion','parent','Return for support')",[id])).rejects.toMatchObject({ code:"23514" });
    expect((await read(id)).status).toBe("active");
  });
  it("completes after the later typed positive without deleting its earlier failed report",async()=>{
    const id=await start(); await work(); await report(id,"no_food"); const latest=await report(id,"received_enough_food"); await work();
    expect((await read(id))).toMatchObject({ status:"closed",plan:{ routes:[{ foodAccessReport:latest,state:"support_received" }] } });
  });
  it("records a factual correction after automatic completion without reopening work or renewing retention",async()=>{
    const id=await start(); await work(); await report(id,"received_enough_food"); await work();
    const before=await read(id), parked=await job(id), saved=await report(id,"no_food");
    const current=await read(id);
    expect(saved).toMatchObject({ expectedVersion:before.version,outcome:"unresolved",attribution:"parent_reported" });
    expect(current).toMatchObject({ status:"closed",version:before.version,updated_at:before.updated_at,plan:{ routes:[{ state:"unresolved",foodAccessReport:saved }] } });
    expect(await job(id)).toEqual(parked); expect((await work()).result).toEqual({ state:"idle" });
  });
  it("preserves independently verified food received evidence despite a later typed unmet report",async()=>{
    const id=await start(false,{ withCity:true }); await work(); await report(id,"received_enough_food"); await report(id,"no_food");
    const operation=randomUUID();
    await fixture.admin.query(`insert into public.parent_operations(id,request_id,request_version,program_id,need,action,packet,packet_hash,data_categories,idempotency_key,permission_version,state,evidence,executed_at)
      values($1::uuid,$2,1,'philly-food','food_now','submit','{}',encode(sha256(convert_to($1::text,'UTF8')),'hex'),'{household}',$1::text,'synthetic-provider-evidence','support_received','{"source":"provider_api","reference":"Synthetic verified collection"}',now())`,[operation,id]);
    await query("authenticated","select public.parent_close_request($1,'completed','Synthetic verified food collection','parent','Return for support')",[id]);
    expect((await read(id)).status).toBe("closed");
    expect((await fixture.admin.query("select state,evidence from public.parent_operations where id=$1",[operation])).rows[0]).toMatchObject({ state:"support_received",evidence:{ source:"provider_api" } });
  });
  it("rejects a duplicate generic food question for this typed path while preserving legacy food reports",async()=>{
    const id=await start(); await work();
    await expect(query("authenticated","select public.parent_report_outcome($1,'food_now','support_received','Synthetic generic report')",[id])).rejects.toMatchObject({ code:"23514" });
    const legacy=await start(false,{ zip:"19104",withCity:true }); await work();
    await query("authenticated","select public.parent_report_outcome($1,'food_now','support_received','Synthetic legacy collection report')",[legacy]);
    await fixture.admin.query("update public.parent_jobs set state='queued',run_at=now() where request_id=$1",[legacy]);
    await work(); expect((await read(legacy)).status).toBe("closed");
  });
  it("rejects generic positive proof before the first typed plan and ignores older generic proof once the typed journey is current",async()=>{
    const id=await start();
    await expect(query("authenticated","select public.parent_report_outcome($1,'food_now','support_received','Synthetic premature generic report')",[id])).rejects.toMatchObject({ code:"23514" });
    await fixture.admin.query("insert into public.parent_events(request_id,kind,actor,summary,evidence) values($1,'parent.outcome_reported','parent','Synthetic historical generic report','{\"need\":\"food_now\",\"outcome\":\"support_received\",\"attribution\":\"parent_reported\"}')",[id]);
    await work(); expect((await read(id)).status).toBe("active");
    await report(id,"no_food"); await work(); expect((await read(id)).status).toBe("active");
  });
  it("rejects a changed replay/site/plan and wrong household without recording or waking another request", async () => {
    const id = await start(); await work(); const key = randomUUID(); await report(id, "no_food", key);
    const before = await job(id);
    await expect(report(id, "received_enough_food", key)).rejects.toMatchObject({ code: "PT409" });
    for (const change of [{ hash: "f".repeat(64) }, { version: 2 }, { site: "other-site" }])
      await expect(report(id, "no_food", randomUUID(), change)).rejects.toMatchObject({ code: change.site ? "23514" : "PT409" });
    await expect(report(id, "no_food", randomUUID(), {}, other)).rejects.toMatchObject({ code: "42501" });
    expect(await job(id)).toEqual(before);
  });
  it("keeps public mutation and private report reads closed to unrelated roles and invalid leases", async () => {
    const id = await start(); await work(); const access = (await read(id)).plan!.routes[0].foodAccess!;
    for (const role of ["anon", "service_role", "parent_worker", "parent_retention_worker", "parent_storage_broker"])
      await expect(query(role,"select public.parent_report_food_visit($1,1,$2,$3,$4,'no_food')",[id,access.site.id,access.planHash,randomUUID()])).rejects.toMatchObject({ code:"42501" });
    await expect(query("authenticated","select parent_private.parent_get_food_access_report($1,$2)",[randomUUID(),randomUUID()])).rejects.toMatchObject({ code:"42501" });
    await expect(query("parent_worker","select parent_private.parent_get_food_access_report($1,$2)",[randomUUID(),randomUUID()])).rejects.toMatchObject({ code:"42501" });
  });
  it.each(["pause", "cancel", "revoked", "expired", "processing", "account"])("cannot start a new report or future work after %s", async state => {
    const id = await start(); await work();
    if (state === "pause" || state === "cancel") await query("authenticated", "select public.parent_control_request($1,$2)", [id,state]);
    if (state === "revoked") await fixture.admin.query("update public.parent_requests set mandate_revoked_at=now() where id=$1", [id]);
    if (state === "expired") await fixture.admin.query("update public.parent_requests set version=version+1,mandate=jsonb_set(mandate,'{expiresAt}',to_jsonb((now()-interval '1 second')::text)) where id=$1", [id]);
    if (state === "processing") await fixture.admin.query("update parent_private.processing_controls set enabled=false");
    if (state === "account") await fixture.admin.query("update public.parent_accounts set status='security_hold' where id=$1", [owner]);
    const before = await job(id); await expect(report(id)).rejects.toMatchObject({ code: "42501" }); expect(await job(id)).toEqual(before);
  });
  it("records a report during a lease without letting that loaded plan overwrite the wake", async () => {
    const id = await start(); await work(); await report(id, "no_food");
    const claim = (await query("parent_worker", "select parent_private.parent_claim_job(120,true,false,false) value")).rows[0].value;
    const stale = await read(id); await report(id, "received_enough_food");
    await query("parent_worker", "select parent_private.parent_save_job_plan($1,$2,$3,$4,$5,null,'parent','parent_action_completed')", [claim.jobId,claim.leaseToken,stale.version,JSON.stringify(stale.plan),'[]']);
    expect(await job(id)).toMatchObject({ state: "queued", request_version: stale.version, lease_token: null });
    expect((await read(id)).status).toBe("active"); await work(); expect((await read(id)).status).toBe("closed");
  });
  it("continues the public food subpath without closing or executing its combined SNAP sibling", async () => {
    const id = await start(true), request = await read(id);
    const claim = (await query("parent_worker", "select parent_private.parent_claim_job(120) value")).rows[0].value;
    const plan = buildSupportPlan(request,new Date(),{ food_now: SHARE_FOOD_ACCESS_PROGRAM });
    const body = buildFoodAccessPlanBody({ requestId:id,requestVersion:request.version,generatedAt:new Date().toISOString(),sourceReviewCurrent:true });
    plan.routes[0].foodAccess = foodAccessPlanSchema.parse({ ...body, planHash:createHash("sha256").update(JSON.stringify(body)).digest("hex") });
    await query("parent_worker", "select parent_private.parent_save_job_plan($1,$2,$3,$4,'[]',null,'parent','parent_action_completed')", [claim.jobId,claim.leaseToken,request.version,JSON.stringify(plan)]);
    await report(id,"received_enough_food");
    expect((await work()).result).toEqual({ state:"saved" });
    const current = await read(id); expect(current.status).toBe("active"); expect(current.version).toBe(request.version);
    expect(current.plan!.routes.find(route=>route.need==="snap_new")).toEqual(plan.routes.find(route=>route.need==="snap_new"));
    expect((await job(id)).state).toBe("waiting");
  });
});
