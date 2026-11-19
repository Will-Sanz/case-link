import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { SNAP_APPLICATION_NOTICE_VERSION } from "./constants";
import { SNAP_APPLICATION_SOURCE, SNAP_SPANISH_APPLICATION_SOURCE, SNAP_EN_TEMPLATE_ID, SNAP_ES_TEMPLATE_ID, snapFormPreview } from "./snap-form-source";
import { fixtureIntake, fixtureMandate, fixtureSnapApplication } from "./test-fixtures";

const runtime = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
describe.skipIf(!runtime)("explicit immutable SNAP document sources against PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>;
  const sessions = new Map<string, string>();
  beforeAll(async () => {
    fixture = await createParentSqlFixture(runtime!);
    await fixture.admin.query(`update parent_private.processing_controls set enabled=true, approval_reference='synthetic source selection', approved_until=now()+interval '1 day',
      snap_details_enabled=true,snap_details_approval_reference='synthetic source selection',snap_details_approved_until=now()+interval '1 day',snap_details_notice_version=$1`, [SNAP_APPLICATION_NOTICE_VERSION]);
  });
  afterAll(async () => { await fixture?.admin.end(); });
  async function call(role: string, sql: string, values: unknown[] = [], owner?: string) {
    await fixture.admin.query(`set role ${role}`);
    try {
      await fixture.admin.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ role, sub: owner, session_id: owner && sessions.get(owner), amr: [{ method: "otp" }] })]);
      return await fixture.admin.query(sql, values);
    } finally { await fixture.admin.query("reset role"); }
  }
  async function seed(template: string | null = SNAP_ES_TEMPLATE_ID) {
    const owner = randomUUID(), session = randomUUID(), key = randomUUID(); sessions.set(owner, session);
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [owner, `${owner}@example.invalid`]);
    await fixture.admin.query("insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')", [session, owner]);
    const details = fixtureSnapApplication(new Date()), intake = fixtureIntake({ needs: ["snap_new"], utilityProviders: [], language: "en" });
    const mandate = fixtureMandate({ recipientIds: ["snap-pa"], expiresAt: new Date(Date.now()+86400000).toISOString() });
    const sql = template ? "select public.parent_start_snap_application_source($1,$2,$3,$4,$5,$6) id" : "select public.parent_start_snap_application($1,$2,$3,$4,$5) id";
    const values = [intake, mandate, details, SNAP_APPLICATION_NOTICE_VERSION, key].map(x => typeof x === "object" ? JSON.stringify(x) : x);
    const request = (await call("authenticated", sql, template ? [...values, template] : values, owner)).rows[0].id as string;
    return { owner, key, request, details, intake, mandate };
  }
  const latest = async (request: string) => (await fixture.admin.query("select * from public.parent_snap_application_details where request_id=$1 order by revision desc limit 1", [request])).rows[0];
  const save = (s: Awaited<ReturnType<typeof seed>>, version: number, details: unknown, template: string, key = randomUUID()) => call("authenticated",
    "select public.parent_save_snap_application_source($1,$2,$3,$4,$5,$6) id", [s.request, version, JSON.stringify(details), SNAP_APPLICATION_NOTICE_VERSION, key, template], s.owner);

  it("selects the exact Spanish tuple without changing contact language or initial source dates", async () => {
    const s = await seed(), row = await latest(s.request);
    expect(row.source).toEqual(SNAP_SPANISH_APPLICATION_SOURCE); expect(row.details).toEqual(s.details);
    expect(row.details.language).toBe("en");
    const context = (await call("authenticated", "select public.parent_get_snap_capture_context($1,$2) value", [s.request, row.request_version], s.owner)).rows[0].value;
    expect(context.source).toEqual(SNAP_SPANISH_APPLICATION_SOURCE);
    expect((await fixture.admin.query("select count(*)::int n from parent_private.form_templates where id like '%-es%' and active")).rows[0].n).toBe(0);
  });
  it("keeps legacy initial calls English regardless of the contact preference", async () => {
    const s = await seed(null); expect((await latest(s.request)).source).toEqual(SNAP_APPLICATION_SOURCE);
  });
  it("requires the separately registered exact Spanish preview and never lets the generic ZIP selector choose it",async()=>{
    const s=await seed(),row=await latest(s.request),preview=snapFormPreview(SNAP_ES_TEMPLATE_ID);
    await fixture.admin.query("update public.parent_jobs set state='done' where request_id<>$1",[s.request]);
    const job=(await call("parent_worker","select parent_private.parent_claim_job(120) job")).rows[0].job;
    const read=()=>call("parent_worker","select parent_private.parent_get_snap_application_preparation($1,$2,$3) value",[job.jobId,job.leaseToken,row.request_version]);
    await expect(read()).rejects.toMatchObject({code:"42501"});
    await fixture.admin.query(`insert into parent_private.form_templates(id,version,program_id,needs,content_sha256,object_path,field_map,required_acts,required_fields,personal_fields,source_url,verified_until,active,preparation_only)
      values($1,$2,'snap-pa',array['snap_new'],$3,'synthetic-es-preview.pdf','{}','{}','{}','{}','https://example.invalid/exact-es-source',now()+interval '1 day',true,true)`,[preview.id,preview.version,SNAP_APPLICATION_SOURCE.templateSha256]);
    await expect(read()).rejects.toMatchObject({code:"42501"});
    await fixture.admin.query("update parent_private.form_templates set content_sha256=$1 where id=$2",[SNAP_SPANISH_APPLICATION_SOURCE.templateSha256,preview.id]);
    const state=(await read()).rows[0].value;expect(state.template).toMatchObject({...preview,content_sha256:SNAP_SPANISH_APPLICATION_SOURCE.templateSha256});expect(state.snapshot.source).toEqual(SNAP_SPANISH_APPLICATION_SOURCE);
    expect((await fixture.admin.query("select parent_private.parent_get_form_template('snap-pa','snap_new') value")).rows[0].value).toBeNull();
    await expect(call("parent_worker","select parent_private.parent_register_form_artifact($1,$2,'snap-pa',$3,$4,jsonb_build_object('zip','19104'),$5,'snap_new')",[job.jobId,job.leaseToken,preview.id,preview.version,"b".repeat(64)])).rejects.toMatchObject({code:"42501"});
    const artifact=(await call("parent_worker","select parent_private.parent_register_snap_application_preview($1,$2,$3,$4,$5,$6) value",[job.jobId,job.leaseToken,row.request_version,row.id,state.snapshotHash,"b".repeat(64)])).rows[0].value;
    expect(artifact).toMatchObject({template_id:preview.id,template_version:preview.version,template_hash:SNAP_SPANISH_APPLICATION_SOURCE.templateSha256,snap_snapshot_id:row.id});
    await fixture.admin.query("insert into storage.objects(bucket_id,name,metadata) values('parent-form-artifacts',$1,'{\"size\":1,\"mimetype\":\"application/pdf\"}')",[artifact.object_path]);
    await call("parent_worker","select parent_private.parent_confirm_form_artifact($1,$2,$3,$4)",[job.jobId,job.leaseToken,artifact.id,"b".repeat(64)]);
    const operation=(await call("parent_worker","select parent_private.parent_prepare_snap_application_preview($1,$2,$3,$4,$5) id",[job.jobId,job.leaseToken,row.request_version,artifact.id,randomUUID()])).rows[0].id;
    expect((await fixture.admin.query("select packet from public.parent_operations where id=$1",[operation])).rows[0].packet).toEqual({});
    await save(s,row.request_version,s.details,SNAP_EN_TEMPLATE_ID);expect((await fixture.admin.query("select state from public.parent_operations where id=$1",[operation])).rows[0].state).toBe("invalidated");
    await expect(read()).rejects.toMatchObject({code:"42501"});
  });
  it("makes a source-only correction a new version and preserves facts, provenance and the immutable old source", async () => {
    const s = await seed(SNAP_EN_TEMPLATE_ID), old = await latest(s.request), key = randomUUID();
    await save(s, old.request_version, s.details, SNAP_ES_TEMPLATE_ID, key);
    const current = await latest(s.request);
    expect(current.revision).toBe(old.revision+1); expect(current.request_version).toBe(old.request_version+1);
    expect(current.source).toEqual(SNAP_SPANISH_APPLICATION_SOURCE); expect(current.provenance).toEqual(old.provenance);
    expect(current.details).toEqual(old.details);
    expect((await fixture.admin.query("select source from public.parent_snap_application_details where id=$1", [old.id])).rows[0].source).toEqual(SNAP_APPLICATION_SOURCE);
    const job = (await fixture.admin.query("select request_version,state,lease_token from public.parent_jobs where request_id=$1", [s.request])).rows[0];
    expect(job).toEqual({ request_version: current.request_version, state: "queued", lease_token: null });
    expect((await save(s, old.request_version, s.details, SNAP_ES_TEMPLATE_ID, key)).rows[0].id).toBe(current.id);
    await expect(save(s, old.request_version, s.details, SNAP_EN_TEMPLATE_ID, key)).rejects.toMatchObject({ code: "PT409" });
    await expect(call("authenticated", "select public.parent_get_snap_capture_context($1,$2)", [s.request, old.request_version], s.owner)).rejects.toMatchObject({ code: "42501" });
  });
  it("preserves Spanish on ordinary later corrections and legacy no-choice saves", async () => {
    const s = await seed(), old = await latest(s.request), details = { ...s.details, phone: "2155550198" };
    await call("authenticated", "select public.parent_save_application_with_family_profile('snap_application',$1,$2,$3,$4,$5,null)", [s.request, old.request_version, JSON.stringify(details), SNAP_APPLICATION_NOTICE_VERSION, randomUUID()], s.owner);
    const current = await latest(s.request); expect(current.source).toEqual(SNAP_SPANISH_APPLICATION_SOURCE);
    expect(current.details.phone).toBe("2155550198"); expect(current.provenance["applicant.firstName"]).toEqual(old.provenance["applicant.firstName"]);
  });
  it("restores explicit source selection before a later legacy start in the same transaction",async()=>{
    await fixture.admin.query("begin");try{
      const spanish=await seed(),english=await seed(null);
      expect((await latest(spanish.request)).source).toEqual(SNAP_SPANISH_APPLICATION_SOURCE);expect((await latest(english.request)).source).toEqual(SNAP_APPLICATION_SOURCE);
      expect((await fixture.admin.query("select nullif(current_setting('caselink.snap_document_template',true),'') value")).rows[0].value).toBeNull();
    }finally{await fixture.admin.query("rollback");}
  });
  it("refuses a foreign current owner and grants no direct private source-helper access",async()=>{
    const s=await seed(),foreign=await seed(),row=await latest(s.request);
    await expect(call("authenticated","select public.parent_save_snap_application_source($1,$2,$3,$4,$5,$6)",[s.request,row.request_version,JSON.stringify(s.details),SNAP_APPLICATION_NOTICE_VERSION,randomUUID(),SNAP_EN_TEMPLATE_ID],foreign.owner)).rejects.toMatchObject({code:"42501"});
    await expect(call("authenticated","select parent_private.snap_application_source($1)",[SNAP_ES_TEMPLATE_ID],s.owner)).rejects.toMatchObject({code:"42501"});
    expect((await latest(s.request)).id).toBe(row.id);
  });
  it.each(["anon","parent_worker","service_role","parent_storage_broker","parent_snap_finalizer","parent_retention_worker"])("denies the new write to %s",async role=>{
    await expect(call(role,"select public.parent_start_snap_application_source('{}','{}','{}',$1,$2,$3)",[SNAP_APPLICATION_NOTICE_VERSION,randomUUID(),SNAP_ES_TEMPLATE_ID])).rejects.toMatchObject({code:"42501"});
  });
  it.each(["es", "../../private", "pa-snap-pa600fs-sg-2019-es-wrong", "", null])("rejects an unregistered caller selection %s before writing", async template => {
    const s = await seed(), before = await latest(s.request);
    await expect(save(s, before.request_version, s.details, template as string)).rejects.toMatchObject({ code: "23514" });
    expect((await latest(s.request)).id).toBe(before.id);
  });
});
