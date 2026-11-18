import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { SHARE_FOOD_ACCESS_PROGRAM } from "./food-access";
import { buildSupportPlan } from "./planning";
import { fixtureIntake, fixtureMandate, fixtureSnapApplication } from "./test-fixtures";
import { runOneParentJob, type WorkerRuntimeOptions } from "./worker-runtime";
import { SNAP_APPLICATION_SOURCE } from "./snap-application-fields";
import { SNAP_PREVIEW_TEMPLATE_ID, SNAP_PREVIEW_TEMPLATE_VERSION } from "./snap-application-snapshot";
import type { SupportRequest } from "./domain";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
describe.skipIf(!modulePath)("combined public food and one SNAP journey through the real leased service", () => {
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
  async function start(combined = false, options: { zip?: string; withCity?: boolean; privateSnap?:boolean; benefitRecipient?:boolean; benefitProgram?:"snap-pa"|"uesf-benefits"; journey?: "snap_new"|"snap_renewal"|"snap_pending"|"snap_problem" } = {}) {
    await fixture.admin.query("update parent_private.processing_controls set enabled=true,approved_until=now()+interval '1 day'");
    await fixture.admin.query("update public.parent_accounts set status='active' where id=$1", [owner]);
    const active = await query("authenticated", "select id from public.parent_requests where status in ('active','paused')");
    for (const row of active.rows) await query("authenticated", "select public.parent_control_request($1,'cancel')", [row.id]);
    return (await query("authenticated", "select public.parent_start_request($1,$2,$3) id", [
      JSON.stringify(fixtureIntake({ needs: combined ? ["food_now", options.journey ?? "snap_new"] : ["food_now"], zip: options.zip ?? "19129", householdSize: null, incomeAmount: null, incomeFrequency: "unknown", utilityProviders: [] })),
      JSON.stringify(fixtureMandate({ mode: "prepare_only", recipientIds: [...(options.withCity ? ["philly-food"] : []),SHARE_FOOD_ACCESS_PROGRAM,...(combined && options.benefitRecipient!==false ? [options.benefitProgram ?? "snap-pa"] : [])], allowedActions: ["research", "prepare"], allowedData: options.privateSnap ? ["household","income"] : ["household"], expiresAt: new Date(Date.now()+86400000).toISOString() })), randomUUID(),
    ])).rows[0].id as string;
  }
  async function read(id: string): Promise<SupportRequest> {
    return (await fixture.admin.query("select to_jsonb(r) value from public.parent_requests r where id=$1", [id])).rows[0].value;
  }
  async function job(id: string) { return (await fixture.admin.query("select to_jsonb(j) value from public.parent_jobs j where request_id=$1", [id])).rows[0].value; }
  async function report(id: string, result = "no_food", key = randomUUID(), change: Record<string, unknown> = {}, user = owner) {
    const request = await read(id), access = request.plan!.routes.find(route => route.need === "food_now")!.foodAccess!;
    const args = { version: request.version, site: access.site.id, hash: access.planHash, key, result, ...change };
    return (await query("authenticated", "select public.parent_report_food_visit($1,$2,$3,$4,$5,$6) value", [id, args.version, args.site, args.hash, args.key, args.result], user)).rows[0].value;
  }
  async function work(options: { beforePublicReply?:()=>Promise<void>; cityConflict?:boolean; planning?:boolean; modelOutage?:boolean }={}) {
    let publicCalls = 0;
    const result = await runOneParentJob({ database: { query: (sql, values) => query("parent_worker", sql, values) }, continuationOnly: !options.planning,
      ...(options.planning ? { apiKey:"synthetic-not-a-real-key",coordinate:async (input:Parameters<NonNullable<WorkerRuntimeOptions["coordinate"]>>[0])=>{
        await input.beforeCall?.();if(options.modelOutage)throw new Error("synthetic_model_unavailable");return { plan:buildSupportPlan(input.request,new Date()),requiredActions:[],modelCalls:1,inputTokens:0,outputTokens:0 };
      } } : {}),
      brokerOrigin: "http://127.0.0.1:3310", brokerSecret: "isolated-synthetic-broker-secret-32-characters", supabaseOrigin: "http://127.0.0.1:55321",
      fetcher: async input => {
        const url = new URL(String(input)); expect(url.origin).toBe("https://services.arcgis.com");
        expect(url.searchParams.get("where")).toBe("objectid=122"); publicCalls++;
        await options.beforePublicReply?.();
        return Response.json({ features: [{ attributes: options.cityConflict ? { ...source,category_type:"School Meal Site" } : source }] });
      } });
    return { result, publicCalls };
  }
  it.each(["snap_new","snap_renewal","snap_pending","snap_problem"] as const)("prepares immediate food alongside %s without model, private broker, documents or a second job",async journey=>{
    const id=await start(true,{ journey });
    const before=await read(id), result=await work(), current=await read(id);
    expect(result).toEqual({ result:{ state:"saved" },publicCalls:1 });
    expect(current.plan!.routes.map(route=>route.need)).toEqual(["food_now",journey]);
    expect(current.plan!.routes[0]).toMatchObject({ state:"prepared",foodAccess:{ requestId:id,requestVersion:before.version } });
    expect(current.plan!.routes[1]).toMatchObject({ state:"checking",nextActor:"caselink" });
    expect(current.plan!.routes[1].summary).toContain("service");
    expect(current.version).toBe(before.version);expect(current.status).toBe("active");
    expect((await fixture.admin.query("select count(*)::int n from public.parent_jobs where request_id=$1",[id])).rows[0].n).toBe(1);
    expect((await fixture.admin.query("select count(*)::int n from public.parent_operations where request_id=$1",[id])).rows[0].n).toBe(0);
    expect((await fixture.admin.query("select count(*)::int n from parent_private.ai_calls where request_id=$1",[id])).rows[0].n).toBe(0);
  });
  it.each(["19104","unknown"])("preserves the ordinary City food path for mixed %s routing",async zip=>{
    const id=await start(true,{ zip:zip==="unknown" ? "19129" : zip,withCity:true });
    if(zip==="unknown")await fixture.admin.query("update public.parent_requests set intake_confirmed_at=jsonb_set(intake_confirmed_at,'{zip}','\"2026-01-01T12:00:00Z\"') where id=$1",[id]);
    expect(await work()).toEqual({ result:{ state:"saved" },publicCalls:0 });
    const route=(await read(id)).plan!.routes[0];expect(route.programId).toBe("philly-food");expect(route.foodAccess).toBeUndefined();
  });
  it("preserves current private SNAP snapshots, facts and necessary questions through worker restart without broker access",async()=>{
    const id=await start(true,{ privateSnap:true });
    const notice="snap-application-details-2026-11-03.v1";
    await fixture.admin.query("update parent_private.processing_controls set snap_details_enabled=true,snap_details_approval_reference='isolated mixed SNAP purpose',snap_details_approved_until=now()+interval '1 day',snap_details_notice_version=$1",[notice]);
    const details={ ...fixtureSnapApplication(new Date()),zip:"19129",householdSize:1 };
    await query("authenticated","select public.parent_save_snap_application_details($1,1,$2,$3,$4)",[id,JSON.stringify(details),notice,randomUUID()]);
    await query("authenticated","select public.parent_answer_facts($1,$2,2)",[id,JSON.stringify([{ need:"snap_new",field:"income",value:{ amount:345,frequency:"monthly" } }])]);
    const action={ id:"snap-own-step",need:"snap_new",reason:"personal_step",title:"Synthetic required SNAP step",explanation:"Private SNAP canary" };
    await fixture.admin.query("update public.parent_requests set required_actions=$2 where id=$1",[id,JSON.stringify([action])]);
    const before=await read(id), snapshot=(await fixture.admin.query("select to_jsonb(s) value from public.parent_snap_application_details s where request_id=$1",[id])).rows;
    await fixture.admin.query("update parent_private.processing_controls set snap_details_enabled=false");
    expect((await work()).result).toEqual({ state:"saved" });
    let current=await read(id);expect(current.facts).toEqual(before.facts);expect(current.required_actions).toContainEqual(action);
    expect(JSON.stringify(current.plan!.routes[0])).not.toMatch(/Private Canary|1 Synthetic Street|"(?:income|incomeAmount|incomeFrequency)"\s*:|:\s*(?:345|"345")(?=[,}])/);
    const snap=current.plan!.routes[1];
    await fixture.admin.query("update public.parent_jobs set state='queued',run_at=now() where request_id=$1",[id]);
    expect((await work()).result).toEqual({ state:"saved" });current=await read(id);
    expect(current.plan!.routes[1]).toEqual(snap);expect(current.facts).toEqual(before.facts);expect(current.version).toBe(before.version);
    expect((await fixture.admin.query("select to_jsonb(s) value from public.parent_snap_application_details s where request_id=$1",[id])).rows).toEqual(snapshot);
    expect((await fixture.admin.query("select count(*)::int n from parent_private.ai_calls where request_id=$1",[id])).rows[0].n).toBe(0);
  });
  it("keeps SNAP open after a food success and preserves it after a mistaken-success correction",async()=>{
    const id=await start(true,{ journey:"snap_pending" });await work();const before=await read(id), snap=before.plan!.routes[1];
    const positive=await report(id,"received_enough_food");await work();
    expect((await read(id))).toMatchObject({ status:"active",version:before.version });
    expect((await read(id)).plan!.routes[1]).toEqual(snap);
    const negative=await report(id,"no_food");
    expect((await query("authenticated","select public.parent_report_food_visit($1,$2,$3,$4,$5,$6) value",[id,positive.expectedVersion,positive.siteId,positive.planHash,positive.reportKey,positive.result])).rows[0].value).toEqual(positive);
    expect((await work()).result).toEqual({ state:"saved" });
    expect((await read(id))).toMatchObject({ status:"active",plan:{ routes:[{ state:"unresolved",foodAccessReport:negative },snap] } });
    expect((await fixture.admin.query("select count(*)::int n from public.parent_events where request_id=$1 and evidence ? 'foodAccessReport'",[id])).rows[0].n).toBe(2);
    expect(positive.outcome).toBe("support_received");
  });
  it("closes only after food and SNAP each have their own current attributed received report",async()=>{
    const id=await start(true,{ journey:"snap_pending" });await work();await report(id,"received_enough_food");await work();expect((await read(id)).status).toBe("active");
    await query("authenticated","select public.parent_report_outcome($1,'snap_pending','support_received','Synthetic family report of benefits received')",[id]);
    expect((await read(id)).status).toBe("closed");expect((await job(id)).state).toBe("cancelled");
    expect((await work()).result).toEqual({ state:"idle" });
  });
  it("retains the latest report recorded while a mixed turn holds the lease and wakes that same job",async()=>{
    const id=await start(true,{ journey:"snap_pending" });await work();const version=(await read(id)).version;
    await fixture.admin.query("update public.parent_jobs set state='queued',run_at=now() where request_id=$1",[id]);
    let latest:unknown;await work({ beforePublicReply:async()=>{ latest=await report(id,"no_food"); } });
    expect(await job(id)).toMatchObject({ state:"queued",request_version:version,lease_token:null });
    expect((await read(id)).plan!.routes[0].foodAccessReport).toEqual(latest);
    await work();expect((await read(id)).plan!.routes[0]).toMatchObject({ state:"unresolved",foodAccessReport:latest });
  });
  it.each(["pause","cancel","revoked"])("cannot claim mixed work or add a food report after %s",async control=>{
    const id=await start(true);await work();
    if(control==="revoked")await fixture.admin.query("update public.parent_requests set mandate_revoked_at=now() where id=$1",[id]);
    else await query("authenticated","select public.parent_control_request($1,$2)",[id,control]);
    const before=await read(id);expect(await work()).toEqual({ result:{ state:"idle" },publicCalls:0 });
    await query("parent_worker","select parent_private.parent_record_worker_health(true,true,true)");
    expect(await work({ planning:true })).toEqual({ result:{ state:"idle" },publicCalls:0 });
    await expect(report(id,"no_food")).rejects.toMatchObject({ code:"42501" });expect(await read(id)).toEqual(before);
  });
  it("cannot overwrite a corrected shared request version with an earlier food plan",async()=>{
    const id=await start(true);await work();const before=await read(id), old=before.plan!.routes[0].foodAccess!;
    await query("authenticated","select public.parent_replace_mandate($1,$2,$3)",[id,JSON.stringify(before.mandate),before.version]);
    await expect(query("authenticated","select public.parent_report_food_visit($1,$2,$3,$4,$5,'no_food')",[id,before.version,old.site.id,old.planHash,randomUUID()])).rejects.toMatchObject({ code:"PT409" });
    await work();expect((await read(id)).plan!.routes[0].foodAccess!.requestVersion).toBe(before.version+1);
  });
  it("uses specific public capability for eligible mixed claims and leaves private readiness unclaimed",async()=>{
    const id=await start(true);const progress=async()=> (await query("authenticated","select public.parent_request_progress($1) value",[id])).rows[0].value;
    await query("parent_worker","select parent_private.parent_record_worker_health(true,true,false)");expect(await progress()).toMatchObject({ state:"service_offline",canContinueAfterClosing:false });
    await query("parent_worker","select parent_private.parent_record_worker_health(false,false,true)");expect(await progress()).toMatchObject({ state:"queued",canContinueAfterClosing:true });
    await work();expect((await read(id)).required_actions).toContainEqual(expect.objectContaining({ need:"snap_new",reason:"execution_issue",resolver:"operator" }));
    expect((await fixture.admin.query("select planning_ready from parent_private.worker_health")).rows[0].planning_ready).toBe(false);
  });
  it("surfaces the ready public collection step while retaining the separate benefit retry",async()=>{
    const id=await start(true);
    await query("parent_worker","select parent_private.parent_record_worker_health(true,true,true)");await work({ planning:true,modelOutage:true });
    const current=await read(id), progress=(await query("authenticated","select public.parent_request_progress($1) value",[id])).rows[0].value;
    expect(current.plan!.routes[0]).toMatchObject({ state:"prepared",nextActor:"parent" });
    expect(current.next_run_at).toBeTruthy();expect((await job(id)).state).toBe("waiting");
    expect(current.next_actor).toBe("parent");expect(progress).toMatchObject({ state:"needs_parent",canContinueAfterClosing:true });
  });
  it("prepares public food despite an exhausted project model budget without reserving another call",async()=>{
    const id=await start(true), controls=(await fixture.admin.query("select model_call_limit,model_budget_started_at from parent_private.processing_controls")).rows[0];
    await fixture.admin.query("insert into parent_private.model_call_reservations default values");
    const before=(await fixture.admin.query("select count(*)::int n from parent_private.model_call_reservations")).rows[0].n;
    try {
      await fixture.admin.query("update parent_private.processing_controls set model_budget_started_at=now()-interval '1 minute',model_call_limit=1");
      expect((await work({ planning:true })).result).toEqual({ state:"saved" });
      expect((await read(id)).plan!.routes[0].foodAccess).toBeTruthy();
      expect((await fixture.admin.query("select count(*)::int n from parent_private.ai_calls where request_id=$1",[id])).rows[0].n).toBe(0);
      expect((await fixture.admin.query("select count(*)::int n from parent_private.model_call_reservations")).rows[0].n).toBe(before);
    } finally { await fixture.admin.query("update parent_private.processing_controls set model_call_limit=$1,model_budget_started_at=$2",[controls.model_call_limit,controls.model_budget_started_at]); }
  });
  it("parks a known unavailable benefit driver without spending claims on timed polling",async()=>{
    const id=await start(true);await work();const before=await job(id);
    expect((await read(id)).next_run_at).toBeNull();expect(before.run_at).toBe("infinity");
    for(let index=0;index<8;index++){
      await query("parent_worker","select parent_private.parent_record_worker_health(false,false,true)");
      expect((await work()).result).toEqual({ state:"idle" });
    }
    expect((await job(id)).attempts).toBe(before.attempts);
  });
  it.each(["snap_renewal","snap_pending","snap_problem"] as const)("resumes authorized UESF %s planning without adding SNAP as a recipient",async journey=>{
    const id=await start(true,{ journey,benefitProgram:"uesf-benefits" });await work();const before=await job(id);
    await query("parent_worker","select parent_private.parent_record_worker_health(true,true,true)");
    expect((await work({ planning:true })).result).toEqual({ state:"saved" });
    const current=await read(id);expect(current.mandate.recipientIds).toEqual([SHARE_FOOD_ACCESS_PROGRAM,"uesf-benefits"]);
    expect(current.plan!.routes[1].programId).toBe("uesf-benefits");expect((await job(id))).toMatchObject({ id:before.id,attempts:before.attempts+1 });
  });
  it.each([false,true])("finishes current attributed mixed reports after the last bounded claim without resetting it: transientModelFailure=%s",async planning=>{
    const id=await start(true,{ journey:"snap_pending" });await fixture.admin.query("update public.parent_jobs set attempts=47 where request_id=$1",[id]);
    await query("parent_worker","select parent_private.parent_record_worker_health(true,true,true)");
    await work(planning ? { planning:true,modelOutage:true } : {});
    expect((await job(id))).toMatchObject({ attempts:48,run_at:"infinity" });
    await report(id,"received_enough_food");
    const progress=(await query("authenticated","select public.parent_request_progress($1) value",[id])).rows[0].value;
    expect(progress.canContinueAfterClosing).toBe(false);expect(progress.state).not.toBe("queued");
    await query("authenticated","select public.parent_report_outcome($1,'snap_pending','support_received','Synthetic actual benefits received report')",[id]);
    expect((await read(id)).status).toBe("closed");expect((await job(id))).toMatchObject({ state:"cancelled",attempts:48 });
    expect((await work()).result).toEqual({ state:"idle" });
  });
  it.each(["request","account","project"])("does not spend claims or reservations on parked %s budget waits despite fresh heartbeats",async limit=>{
    const older=await start(),id=await start(true,{ journey:"snap_pending" });
    const controls=(await fixture.admin.query("select model_call_limit,model_budget_started_at from parent_private.processing_controls")).rows[0];
    const inserted=limit==="project" ? [] : (await fixture.admin.query("insert into parent_private.ai_calls(account_id,request_id) select $1,$2 from generate_series(1,$3::int) returning id",[owner,limit==="request" ? id : older,limit==="request" ? 12 : 60])).rows.map(row=>row.id);
    if(limit==="project"){
      await fixture.admin.query("insert into parent_private.model_call_reservations default values");
      await fixture.admin.query("update parent_private.processing_controls set model_budget_started_at=now()-interval '1 minute',model_call_limit=1");
    }
    try {
      await query("parent_worker","select parent_private.parent_record_worker_health(true,true,true)");await work({ planning:true });
      const before=await job(id),calls=(await fixture.admin.query("select count(*)::int n from parent_private.ai_calls where request_id=$1",[id])).rows[0].n;
      const reservations=(await fixture.admin.query("select count(*)::int n from parent_private.model_call_reservations")).rows[0].n;
      expect(before.run_at).toBe("infinity");
      for(let index=0;index<8;index++){
        await query("parent_worker","select parent_private.parent_record_worker_health(true,true,true)");
        expect((await work({ planning:true })).result).toEqual({ state:"idle" });
      }
      expect((await job(id)).attempts).toBe(before.attempts);
      expect((await fixture.admin.query("select count(*)::int n from parent_private.ai_calls where request_id=$1",[id])).rows[0].n).toBe(calls);
      expect((await fixture.admin.query("select count(*)::int n from parent_private.model_call_reservations")).rows[0].n).toBe(reservations);
      if(limit==="project"){
        await fixture.admin.query("update parent_private.processing_controls set model_call_limit=100");
        expect((await work({ planning:true })).result).toEqual({ state:"saved" });
        expect((await job(id))).toMatchObject({ id:before.id,attempts:before.attempts+1 });
      }
    } finally {
      if(inserted.length)await fixture.admin.query("delete from parent_private.ai_calls where id=any($1::bigint[])",[inserted]);
      await fixture.admin.query("update parent_private.processing_controls set model_call_limit=$1,model_budget_started_at=$2",[controls.model_call_limit,controls.model_budget_started_at]);
    }
  });
  it("resumes the same parked job only after private SNAP purpose and exact source availability actually return",async()=>{
    const id=await start(true,{ privateSnap:true }),notice="snap-application-details-2026-11-03.v1";
    await fixture.admin.query("update parent_private.processing_controls set snap_details_enabled=true,snap_details_approval_reference='isolated mixed purpose',snap_details_approved_until=now()+interval '1 day',snap_details_notice_version=$1",[notice]);
    await query("authenticated","select public.parent_save_snap_application_details($1,1,$2,$3,$4)",[id,JSON.stringify({ ...fixtureSnapApplication(new Date()),zip:"19129" }),notice,randomUUID()]);
    await work();const before=await job(id);
    await fixture.admin.query("update parent_private.processing_controls set snap_details_enabled=false");
    for(let index=0;index<4;index++){
      await query("parent_worker","select parent_private.parent_record_worker_health(true,true,true)");
      expect((await work({ planning:true })).result).toEqual({ state:"idle" });
    }
    await fixture.admin.query("update parent_private.processing_controls set snap_details_enabled=true");
    expect((await work({ planning:true })).result).toEqual({ state:"idle" });
    await fixture.admin.query(`insert into parent_private.form_templates(id,version,program_id,needs,content_sha256,object_path,field_map,required_acts,required_fields,personal_fields,source_url,verified_until,active,preparation_only)
      values($1,$2,'snap-pa',array['snap_new'],$3,'snap-preview-source.pdf','{}',array[]::text[],array[]::text[],array[]::text[],'https://example.invalid/reviewed-source',now()+interval '1 day',false,true)`,[SNAP_PREVIEW_TEMPLATE_ID,SNAP_PREVIEW_TEMPLATE_VERSION,SNAP_APPLICATION_SOURCE.templateSha256]);
    expect((await work({ planning:true })).result).toEqual({ state:"idle" });expect((await job(id)).attempts).toBe(before.attempts);
    await fixture.admin.query("update parent_private.form_templates set active=true,content_sha256=$2 where id=$1",[SNAP_PREVIEW_TEMPLATE_ID,"c".repeat(64)]);
    expect((await work({ planning:true })).result).toEqual({ state:"idle" });
    await fixture.admin.query("update parent_private.form_templates set content_sha256=$2 where id=$1",[SNAP_PREVIEW_TEMPLATE_ID,SNAP_APPLICATION_SOURCE.templateSha256]);
    expect((await work({ planning:true })).result).toEqual({ state:"saved" });
    expect((await job(id))).toMatchObject({ id:before.id,attempts:before.attempts+1 });
    expect((await read(id)).version).toBe(before.request_version);
  });
  it("parks a full model turn's closed private purpose without repeated attempts, and still records genuine outcomes",async()=>{
    const id=await start(true,{ privateSnap:true }),notice="snap-application-details-2026-11-03.v1";
    await fixture.admin.query("update parent_private.processing_controls set snap_details_enabled=true,snap_details_approval_reference='isolated mixed purpose',snap_details_approved_until=now()+interval '1 day',snap_details_notice_version=$1",[notice]);
    await query("authenticated","select public.parent_save_snap_application_details($1,1,$2,$3,$4)",[id,JSON.stringify({ ...fixtureSnapApplication(new Date()),zip:"19129" }),notice,randomUUID()]);
    await fixture.admin.query("update parent_private.processing_controls set snap_details_enabled=false");
    await query("parent_worker","select parent_private.parent_record_worker_health(true,true,true)");
    expect((await work({ planning:true })).result).toEqual({ state:"saved" });const before=await job(id);
    expect(before.run_at).toBe("infinity");expect((await read(id)).required_actions).toContainEqual(expect.objectContaining({ field:"benefit_service_wait",resolver:"operator" }));
    for(let index=0;index<8;index++){
      await query("parent_worker","select parent_private.parent_record_worker_health(true,true,true)");
      expect((await work({ planning:true })).result).toEqual({ state:"idle" });
    }
    expect((await job(id)).attempts).toBe(before.attempts);
    await report(id,"received_enough_food");
    expect((await query("authenticated","select public.parent_request_progress($1) value",[id])).rows[0].value.canContinueAfterClosing).toBe(false);
    await query("authenticated","select public.parent_report_outcome($1,'snap_new','support_received','Synthetic genuine family report of benefits received')",[id]);
    expect((await read(id)).status).toBe("closed");expect((await job(id))).toMatchObject({ state:"cancelled",attempts:before.attempts });
  });
  it("preserves the food-only three worker turns and the legacy single-SNAP generic-report lifecycle",async()=>{
    const food=await start();await work();await report(food,"no_food");await work();await report(food,"received_enough_food");
    expect((await read(food)).status).toBe("active");expect((await work()).result).toEqual({ state:"saved" });
    expect((await read(food)).status).toBe("closed");expect((await job(food)).attempts).toBe(3);
    const original=await read(food),snap=(await query("authenticated","select public.parent_start_request($1,$2,$3) id",[
      JSON.stringify({ ...original.intake,needs:["snap_pending"] }),JSON.stringify({ ...original.mandate,recipientIds:["snap-pa"] }),randomUUID(),
    ])).rows[0].id as string;
    await query("authenticated","select public.parent_report_outcome($1,'snap_pending','support_received','Synthetic legacy single-SNAP family report')",[snap]);
    expect((await read(snap)).status).toBe("active");expect((await job(snap)).state).toBe("queued");
  });
  it("does food work while retaining a genuinely missing SNAP-recipient permission",async()=>{
    const id=await start(true,{ benefitRecipient:false });await work();const current=await read(id);
    expect(current.plan!.routes[0].foodAccess).toBeTruthy();expect(current.plan!.routes[1]).toMatchObject({ programId:"",nextActor:"parent" });
    expect(current.required_actions).toContainEqual(expect.objectContaining({ need:"snap_new",reason:"expanded_permission" }));
  });
  it("does not use public-only readiness to promise a blocked protected SNAP continuation after food is received",async()=>{
    const id=await start(true);await work();await report(id,"received_enough_food");
    const required=[{ id:"protected-snap-service",need:"snap_new",reason:"execution_issue",resolver:"operator",field:"protected_snap_service_wait",title:"Prepared SNAP work is waiting",explanation:"Synthetic protected service wait" }];
    await fixture.admin.query("update public.parent_requests set required_actions=$2 where id=$1",[id,JSON.stringify(required)]);
    await query("parent_worker","select parent_private.parent_record_worker_health(false,false,true)");
    const progress=async()=> (await query("authenticated","select public.parent_request_progress($1) value",[id])).rows[0].value;
    expect(await progress()).toMatchObject({ state:"service_offline",canContinueAfterClosing:false });
    await fixture.admin.query("update public.parent_requests set required_actions=required_actions||$2::jsonb where id=$1",[id,JSON.stringify([{ id:"snap-personal",need:"snap_new",reason:"personal_step",field:"snap_final_submit",title:"A genuine SNAP step",explanation:"Synthetic necessary personal step" }])]);
    expect(await progress()).toMatchObject({ state:"needs_parent",canContinueAfterClosing:false });
  });
  it.each([["food_now","wic_new"],["food_now","electricity"],["food_now","snap_new","snap_pending"],["food_now","food_now"]].map(needs=>({ needs })))("keeps model-free claim scope bounded for $needs",async({ needs })=>{
    const id=await start(true);
    expect((await fixture.admin.query(`select parent_private.public_food_access_claimable(jsonb_populate_record(null::public.parent_requests,
      to_jsonb(r)||jsonb_build_object('intake',jsonb_set(r.intake,'{needs}',$2::jsonb)))) value from public.parent_requests r where id=$1`,[id,JSON.stringify(needs)])).rows[0].value).toBe(false);
  });
  it("keeps an independently recorded SNAP receipt when the food source conflicts",async()=>{
    const id=await start(true,{ journey:"snap_pending" });await work();const operation=randomUUID();
    await fixture.admin.query(`insert into public.parent_operations(id,request_id,request_version,program_id,need,action,packet,packet_hash,data_categories,idempotency_key,permission_version,state,evidence,executed_at)
      values($1::uuid,$2,1,'snap-pa','snap_pending','follow_up','{}',encode(sha256(convert_to($1::text,'UTF8')),'hex'),'{household}',$1::text,'synthetic-receipt-permission','assistance_approved','{"source":"agency_receipt","reference":"Synthetic approval receipt"}',now())`,[operation,id]);
    const before=(await fixture.admin.query("select to_jsonb(o) value from public.parent_operations o where id=$1",[operation])).rows[0].value;
    await fixture.admin.query("update public.parent_jobs set state='queued',run_at=now() where request_id=$1",[id]);
    await work({ cityConflict:true });const current=await read(id);
    expect(current).toMatchObject({ status:"active",plan:{ routes:[{ state:"unresolved",foodAccess:{ blockedReason:"source_conflict" } },{ state:"assistance_approved" }] } });
    expect((await fixture.admin.query("select to_jsonb(o) value from public.parent_operations o where id=$1",[operation])).rows[0].value).toEqual(before);
  });
  it("excludes a second claim and resumes the same expired lease without a second job or operation",async()=>{
    const id=await start(true), claimed=(await query("parent_worker","select parent_private.parent_claim_job(120,true,false,false) value")).rows[0].value;
    expect(claimed.request.id).toBe(id);
    expect((await query("parent_worker","select parent_private.parent_claim_job(120,true,false,false) value")).rows[0].value).toBeNull();
    await fixture.admin.query("update public.parent_jobs set lease_until=now()-interval '1 second' where request_id=$1",[id]);
    expect((await work()).result).toEqual({ state:"saved" });expect((await job(id))).toMatchObject({ id:claimed.jobId,attempts:2,state:"waiting" });
    expect((await fixture.admin.query("select count(*)::int n from public.parent_operations where request_id=$1",[id])).rows[0].n).toBe(0);
  });
  it("rejects a stale save when the family cancels during the mixed public check",async()=>{
    const id=await start(true);
    expect((await work({ beforePublicReply:async()=>{ await query("authenticated","select public.parent_control_request($1,'cancel')",[id]); } })).result.state).toBe("failed");
    expect((await read(id))).toMatchObject({ status:"cancelled",plan:null });expect((await job(id)).state).toBe("cancelled");
  });
  it("changes only the six reviewed functions while retaining owner, grants, lease and legacy definitions",async()=>{
    const isolated=await createParentSqlFixture(modulePath!,"20261118050422_parent_public_food_access.sql");
    const definitions=async()=> (await isolated.admin.query(`select p.oid,p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,p.proowner owner,p.proacl::text acl
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','parent_private') and p.prokind='f' order by p.oid`)).rows;
    try {
      const before=await definitions();
      await isolated.admin.query("do $review$ begin execute $patch$"+readFileSync("supabase/migrations/20261118080328_parent_public_food_snap_continuation.sql","utf8")+"$patch$;end $review$");
      const after=await definitions(),originals=new Map(before.map(row=>[row.signature,row]));
      const changed=after.filter(row=>originals.has(row.signature) && JSON.stringify(row)!==JSON.stringify(originals.get(row.signature)));
      expect(changed.map(row=>row.signature).sort()).toEqual([
        "parent_private.public_food_access_claimable(parent_requests)","parent_private.parent_claim_job(integer,boolean,boolean,boolean)",
        "parent_private.parent_save_job_plan(uuid,uuid,integer,jsonb,jsonb,timestamp with time zone,text,text)","parent_private.request_progress(uuid)",
        "parent_report_food_visit(uuid,integer,text,text,uuid,text)","parent_report_outcome(uuid,text,text,text)",
      ].sort());
      for(const row of after.filter(row=>originals.has(row.signature)))expect({ ...row,definition:originals.get(row.signature)!.definition }).toEqual(originals.get(row.signature));
      const added=after.filter(row=>!originals.has(row.signature));expect(added.map(row=>row.signature).sort()).toEqual([
        "parent_private.mixed_food_snap_planning_ready(parent_requests)","parent_private.finish_received_food_snap_request(uuid)",
        "parent_private.mixed_food_snap_continuation_ready(parent_requests)",
      ].sort());
      for(const row of added)for(const role of ["anon","authenticated","service_role","parent_worker","parent_storage_broker","parent_retention_worker"])
        expect((await isolated.admin.query("select has_function_privilege($1,$2,'execute') allowed",[role,row.signature])).rows[0].allowed).toBe(false);
    } finally { await isolated.admin.end(); }
  });
});
