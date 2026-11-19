import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
describe.skipIf(!modulePath)("preparation-only artifacts against PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>;
  const packet = JSON.stringify({ zip: "19104" });
  beforeAll(async () => {
    fixture = await createParentSqlFixture(modulePath!);
    await fixture.admin.query("update parent_private.processing_controls set enabled=true,approval_reference='isolated draft test',approved_until=now()+interval '1 day'");
    await fixture.admin.query(`insert into parent_private.provider_capabilities(program_id,action,enabled,transport_verified,requires_form,permission_version,permission_reference,allowed_fields,field_categories,required_acts,verified_until)
      values('snap-pa','submit',true,true,true,'synthetic-only','synthetic-only',array['zip'],'{"zip":"household"}',array[]::text[],now()+interval '1 day')`);
  });
  afterAll(async () => { await fixture?.admin.end(); });
  async function worker(sql: string, values: unknown[]) {
    await fixture.admin.query("set role parent_worker");
    try { return await fixture.admin.query(sql, values); }
    finally { await fixture.admin.query("reset role"); }
  }
  async function seed(preparationOnly: boolean, mode: "full" | "prepare_only" = "full") {
    const owner = randomUUID(), session = randomUUID(), household = randomUUID(), request = randomUUID(), template = `draft-${randomUUID()}`;
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [owner, `${owner}@example.invalid`]);
    await fixture.admin.query("insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')", [session, owner]);
    await fixture.admin.query("insert into public.parent_accounts(id) values($1)", [owner]);
    await fixture.admin.query("insert into public.parent_households(id,owner_id) values($1,$2)", [household, owner]);
    await fixture.admin.query("insert into public.parent_requests(id,household_id,intake,mandate) values($1,$2,$3,$4)", [request, household,
      JSON.stringify(fixtureIntake({ needs: ["snap_new"] })), JSON.stringify(fixtureMandate({ mode, recipientIds: ["snap-pa"],
        allowedActions: mode === "prepare_only" ? ["research", "prepare"] : ["research", "prepare", "submit"], expiresAt: new Date(Date.now() + 86400000).toISOString() }))]);
    await fixture.admin.query("insert into public.parent_jobs(request_id,request_version) values($1,1)", [request]);
    const job = (await worker("select parent_private.parent_claim_job(120) job", [])).rows[0].job;
    expect(job.request.id).toBe(request);
    await fixture.admin.query(`insert into parent_private.form_templates(id,version,program_id,needs,content_sha256,object_path,field_map,required_acts,source_url,verified_until,active,preparation_only)
      values($1,'1','snap-pa',array['snap_new'],$2,$3,'{"ZIP":"zip"}',array[]::text[],'https://example.invalid/synthetic-form',now()+interval '1 day',true,$4)`, [template, "a".repeat(64), `${template}.pdf`, preparationOnly]);
    const artifact = (await worker("select parent_private.parent_register_form_artifact($1,$2,'snap-pa',$3,'1',$4,$5,'snap_new') artifact",
      [job.jobId, job.leaseToken, template, packet, "b".repeat(64)])).rows[0].artifact;
    await fixture.admin.query("insert into storage.objects(bucket_id,name,metadata) values('parent-form-artifacts',$1,'{\"size\":1,\"mimetype\":\"application/pdf\"}')", [artifact.object_path]);
    await worker("select parent_private.parent_confirm_form_artifact($1,$2,$3,$4)", [job.jobId, job.leaseToken, artifact.id, "b".repeat(64)]);
    const prepare = (action: string) => worker("select parent_private.parent_prepare_operation($1,$2,1,'snap-pa',$3,$4,array['household'],array[]::uuid[],$5,'snap_new',$6) id",
      [job.jobId, job.leaseToken, action, packet, randomUUID(), artifact.id]);
    return { job, request, template, artifact, prepare, owner, session };
  }
  it.each(["full", "prepare_only"] as const)("stores a truthful immutable draft under %s permission without a submission", async (mode) => {
    const { artifact, prepare, request } = await seed(true, mode);
    expect(artifact.preparation_only).toBe(true);
    await prepare("prepare");
    expect((await fixture.admin.query("select action,state,executed_at from public.parent_operations where request_id=$1", [request])).rows)
      .toEqual([{ action: "prepare", state: "prepared", executed_at: null }]);
    await expect(fixture.admin.query("update public.parent_form_artifacts set preparation_only=false where id=$1", [artifact.id])).rejects.toThrow("immutable");
  });
  it("rejects draft submission even with an otherwise enabled provider contract", async () => {
    const { prepare } = await seed(true);
    await expect(prepare("submit")).rejects.toThrow("incomplete preparation draft");
  });
  it.each([true, false])("enforces preparation permission on direct insertion only for incomplete drafts (draft: %s)", async (preparationOnly) => {
    const { request, artifact } = await seed(preparationOnly);
    await fixture.admin.query("update public.parent_requests set mandate=jsonb_set(mandate,'{allowedActions}','[\"submit\"]'),version=version+1 where id=$1", [request]);
    const insert = fixture.admin.query(`insert into public.parent_form_artifacts(request_id,request_version,need,program_id,template_id,template_version,template_hash,form_input_digest,content_sha256,object_path,expires_at)
      select request_id,request_version,need,program_id,template_id,template_version,template_hash,form_input_digest,content_sha256,$2,expires_at
      from public.parent_form_artifacts where id=$1 returning preparation_only`, [artifact.id, `${randomUUID()}.pdf`]);
    if (preparationOnly) await expect(insert).rejects.toThrow("preparation is outside the current mandate");
    else expect((await insert).rows[0].preparation_only).toBe(false);
    expect((await fixture.admin.query("select count(*)::int count from public.parent_form_artifacts where request_id=$1", [request])).rows[0].count).toBe(preparationOnly ? 1 : 2);
  });
  it("keeps the artifact restricted when its source template is later reclassified", async () => {
    const { template, prepare } = await seed(true);
    await fixture.admin.query("update parent_private.form_templates set preparation_only=false where id=$1", [template]);
    await expect(prepare("submit")).rejects.toThrow("incomplete preparation draft");
  });
  it("blocks legacy or bypassed operation dispatch as well as initial preparation", async () => {
    const { request, artifact, job } = await seed(true);
    const id = randomUUID();
    await fixture.admin.query(`insert into public.parent_operations(id,request_id,request_version,need,program_id,action,packet,packet_hash,data_categories,document_ids,idempotency_key,permission_version,artifact_id)
      values($1,$2,1,'snap_new','snap-pa','submit',$3,encode(sha256(convert_to($3::jsonb::text,'UTF8')),'hex'),array['household'],array[]::uuid[],$4,'synthetic-only',$5)`, [id, request, packet, randomUUID(), artifact.id]);
    await expect(worker("select parent_private.parent_begin_operation($1,$2,$3)", [id, job.jobId, job.leaseToken])).rejects.toThrow("incomplete preparation draft");
    expect((await fixture.admin.query("select state,executed_at from public.parent_operations where id=$1", [id])).rows[0]).toEqual({ state: "prepared", executed_at: null });
  });
  it("dispatches an ordinary verified new-SNAP form only after the exact parent Submit", async () => {
    const { prepare, job, artifact, owner, session, request } = await seed(false);
    expect(artifact.preparation_only).toBe(false);
    const id = (await prepare("submit")).rows[0].id;
    await expect(worker("select parent_private.parent_begin_operation($1,$2,$3)", [id, job.jobId, job.leaseToken])).rejects.toThrow("parent must choose Submit");
    const hash = (await fixture.admin.query("select packet_hash from public.parent_operations where id=$1", [id])).rows[0].packet_hash;
    await fixture.admin.query("set role authenticated");
    try {
      await fixture.admin.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner, session_id: session, role: "authenticated", amr: [{ method: "otp" }] })]);
      await fixture.admin.query("select public.parent_authorize_snap_submission($1,$2,1,$3,$4,$5)", [request, id, hash, artifact.id, artifact.content_sha256]);
    } finally { await fixture.admin.query("reset role"); }
    expect((await worker("select parent_private.parent_begin_operation($1,$2,$3) operation", [id, job.jobId, job.leaseToken])).rows[0].operation.artifact.id).toBe(artifact.id);
  });
});
