import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { fixtureIntake, fixtureMandate, fixtureSnapApplication } from "./test-fixtures";
import { SNAP_APPLICATION_NOTICE_VERSION } from "./constants";
import { SNAP_PREVIEW_TEMPLATE_ID, SNAP_PREVIEW_TEMPLATE_VERSION, snapApplicationLeaves } from "./snap-application-snapshot";
import { SNAP_APPLICATION_SOURCE } from "./snap-application-fields";
const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
describe.skipIf(!modulePath)("leased private SNAP previews against PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>;
  const owners = new Map<string, string>();
  beforeAll(async () => {
    fixture = await createParentSqlFixture(modulePath!);
    await fixture.admin.query(`update parent_private.processing_controls set enabled=true,approval_reference='isolated preview test',approved_until=now()+interval '1 day',
      snap_details_enabled=true,snap_details_approval_reference='isolated preview purpose',snap_details_approved_until=now()+interval '1 day',snap_details_notice_version=$1`, [SNAP_APPLICATION_NOTICE_VERSION]);
    await fixture.admin.query(`insert into parent_private.form_templates(id,version,program_id,needs,content_sha256,object_path,field_map,required_acts,required_fields,personal_fields,source_url,verified_until,active,preparation_only)
      values($1,$2,'snap-pa',array['snap_new'],$3,'snap-preview-source.pdf','{}',array[]::text[],array[]::text[],array[]::text[],'https://example.invalid/reviewed-source',now()+interval '1 day',true,true)`,
      [SNAP_PREVIEW_TEMPLATE_ID, SNAP_PREVIEW_TEMPLATE_VERSION, SNAP_APPLICATION_SOURCE.templateSha256]);
  });
  afterAll(async () => { await fixture?.admin.end(); });
  async function query(role: string, sql: string, values: unknown[] = [], owner?: string) {
    await fixture.admin.query(`set role ${role}`);
    try {
      await fixture.admin.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ role, sub: owner, session_id: owner && owners.get(owner), amr: [{ method: "otp" }] })]);
      return await fixture.admin.query(sql, values);
    } finally { await fixture.admin.query("reset role"); }
  }
  async function seed() {
    const owner = randomUUID(), session = randomUUID(); owners.set(owner, session);
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [owner, `${owner}@example.invalid`]);
    await fixture.admin.query("insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')", [session, owner]);
    const now = new Date((await fixture.admin.query("select now() at")).rows[0].at);
    const details = fixtureSnapApplication(now);
    await fixture.admin.query("update public.parent_jobs set state='done'");
    const request = (await query("authenticated", "select public.parent_start_snap_application($1,$2,$3,$4,$5) id", [
      JSON.stringify(fixtureIntake({ needs: ["snap_new"], householdSize: 1, utilityProviders: [] })),
      JSON.stringify(fixtureMandate({ recipientIds: ["snap-pa"], allowedActions: ["research", "prepare"], mode: "prepare_only", expiresAt: new Date(Date.now() + 86400000).toISOString() })),
      JSON.stringify(details), SNAP_APPLICATION_NOTICE_VERSION, randomUUID()], owner)).rows[0].id;
    const job = (await query("parent_worker", "select parent_private.parent_claim_job(120) job")).rows[0].job;
    expect(job.request.id).toBe(request);
    const read = () => query("parent_worker", "select parent_private.parent_get_snap_application_preparation($1,$2,2) value", [job.jobId, job.leaseToken]);
    const state = (await read()).rows[0].value;
    const register = (snapshot = state.snapshot.id, hash = state.snapshotHash) => query("parent_worker",
      "select parent_private.parent_register_snap_application_preview($1,$2,2,$3,$4,$5) value", [job.jobId, job.leaseToken, snapshot, hash, "b".repeat(64)]);
    const stored = async () => {
      const artifact = (await register()).rows[0].value;
      await fixture.admin.query("insert into storage.objects(bucket_id,name,metadata) values('parent-form-artifacts',$1,'{\"size\":1,\"mimetype\":\"application/pdf\"}')", [artifact.object_path]);
      await query("parent_worker", "select parent_private.parent_confirm_form_artifact($1,$2,$3,$4)", [job.jobId, job.leaseToken, artifact.id, "b".repeat(64)]);
      return artifact;
    };
    return { owner, request, job, details, state, read, register, stored };
  }
  it("returns exact private evidence only to a current lease, outside the claim/model projection", async () => {
    const s = await seed();
    expect(s.state.snapshot.details).toEqual(s.details); expect(s.state.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(s.job)).not.toContain("Private Canary"); expect(JSON.stringify(s.job)).not.toContain(s.state.snapshot.id);
    await expect(query("parent_worker", "select * from public.parent_snap_application_details")).rejects.toMatchObject({ code: "42501" });
    await expect(query("parent_worker", "select parent_private.snap_application_binding($1,2)", [s.request])).rejects.toMatchObject({ code: "42501" });
    await expect(query("parent_storage_broker", "select parent_private.parent_get_snap_application_preparation($1,$2,2)", [s.job.jobId, s.job.leaseToken])).rejects.toMatchObject({ code: "42501" });
    await expect(query("authenticated", "select parent_private.parent_get_snap_application_preparation($1,$2,2)", [s.job.jobId, s.job.leaseToken], s.owner)).rejects.toMatchObject({ code: "42501" });
    await expect(query("parent_worker", "select parent_private.parent_get_snap_application_preparation($1,$2,1)", [s.job.jobId, s.job.leaseToken])).rejects.toMatchObject({ code: "42501" });
    await expect(query("parent_worker", "select parent_private.parent_get_snap_application_preparation($1,$2,2)", [s.job.jobId, randomUUID()])).rejects.toMatchObject({ code: "42501" });
  });
  it("binds registration, stored reuse, packet digest and ordinary operation data scope", async () => {
    const s = await seed(), artifact = await s.stored();
    expect(artifact).toMatchObject({ snap_snapshot_id: s.state.snapshot.id, snap_snapshot_hash: s.state.snapshotHash, preparation_only: true });
    expect((await s.read()).rows[0].value.artifact.id).toBe(artifact.id);
    const generic = await query("parent_worker", "select parent_private.parent_get_form_artifact($1,$2,'snap-pa','snap_new',$3,$4,jsonb_build_object('zip','19104')) value", [s.job.jobId, s.job.leaseToken, SNAP_PREVIEW_TEMPLATE_ID, SNAP_PREVIEW_TEMPLATE_VERSION]);
    expect(generic.rows[0].value).toBeNull();
    await expect(query("parent_worker", "select parent_private.parent_prepare_operation($1,$2,2,'snap-pa','prepare',jsonb_build_object('zip','19104'),array['household'],array[]::uuid[],$3,'snap_new',$4)", [s.job.jobId, s.job.leaseToken, randomUUID(), artifact.id])).rejects.toMatchObject({ code: "42501" });
    const operation = (await query("parent_worker", "select parent_private.parent_prepare_snap_application_preview($1,$2,2,$3,$4) id", [s.job.jobId, s.job.leaseToken, artifact.id, randomUUID()])).rows[0].id;
    const packet = (await fixture.admin.query("select packet from public.parent_operations where id=$1", [operation])).rows[0].packet;
    expect(packet).toEqual({});
    await expect(query("parent_worker", "select parent_private.parent_prepare_operation($1,$2,2,'snap-pa','prepare','{}',array['household','income'],array[]::uuid[],$3,'snap_new',$4)", [s.job.jobId, s.job.leaseToken, randomUUID(), artifact.id])).rejects.toMatchObject({ code: "23514" });
    await expect(query("parent_worker", "select parent_private.parent_begin_operation($1,$2,$3)", [operation, s.job.jobId, s.job.leaseToken])).rejects.toMatchObject({ code: "42501" });
    await expect(fixture.admin.query("update public.parent_form_artifacts set snap_snapshot_hash=$2 where id=$1", [artifact.id, "a".repeat(64)])).rejects.toMatchObject({ code: "23514" });
  });
  it("rejects generic registration of the new identity and mismatched private bindings", async () => {
    const s = await seed();
    await expect(query("parent_worker", "select parent_private.parent_register_form_artifact($1,$2,'snap-pa',$3,$4,jsonb_build_object('zip','19104'),$5,'snap_new')", [s.job.jobId, s.job.leaseToken, SNAP_PREVIEW_TEMPLATE_ID, SNAP_PREVIEW_TEMPLATE_VERSION, "b".repeat(64)])).rejects.toMatchObject({ code: "42501" });
    await expect(s.register(randomUUID())).rejects.toMatchObject({ code: "42501" });
    await expect(s.register(s.state.snapshot.id, "a".repeat(64))).rejects.toMatchObject({ code: "42501" });
  });
  it.each(["purpose", "permission", "template", "lease"])("rechecks %s at read, reuse and registration", async kind => {
    const s = await seed(), artifact = await s.stored(), pending = (await s.register()).rows[0].value;
    await fixture.admin.query("insert into storage.objects(bucket_id,name) values('parent-form-artifacts',$1)", [pending.object_path]);
    if (kind === "purpose") await fixture.admin.query("update parent_private.processing_controls set snap_details_enabled=false");
    if (kind === "permission") await fixture.admin.query("update public.parent_requests set mandate=jsonb_set(mandate,'{allowedData}','[\"household\"]'),version=version+1 where id=$1", [s.request]);
    if (kind === "template") await fixture.admin.query("update parent_private.form_templates set preparation_only=false where id=$1", [SNAP_PREVIEW_TEMPLATE_ID]);
    if (kind === "lease") await fixture.admin.query("update public.parent_jobs set lease_until=now()-interval '1 second' where id=$1", [s.job.jobId]);
    try {
      await expect(s.read()).rejects.toMatchObject({ code: "42501" });
      await expect(s.register()).rejects.toMatchObject({ code: "42501" });
      await expect(query("parent_storage_broker", "select parent_private.parent_authorize_storage($1,$2,'parent-form-artifacts',$3,'download')", [s.job.jobId, s.job.leaseToken, artifact.object_path])).rejects.toMatchObject({ code: "42501" });
      await expect(query("parent_worker", "select parent_private.parent_confirm_form_artifact($1,$2,$3,$4)", [s.job.jobId, s.job.leaseToken, pending.id, "b".repeat(64)])).rejects.toMatchObject({ code: "42501" });
      await expect(query("parent_worker", "select parent_private.parent_prepare_operation($1,$2,2,'snap-pa','prepare',jsonb_build_object('zip','19104'),array['household','income'],array[]::uuid[],$3,'snap_new',$4)", [s.job.jobId, s.job.leaseToken, randomUUID(), artifact.id])).rejects.toMatchObject({ code: "42501" });
    } finally {
      await fixture.admin.query("update parent_private.processing_controls set snap_details_enabled=true");
      await fixture.admin.query("update parent_private.form_templates set preparation_only=true where id=$1", [SNAP_PREVIEW_TEMPLATE_ID]);
    }
  });
  it("invalidates an unsuperseded-version binding when an identical new snapshot revision is saved", async () => {
    const s = await seed(), artifact = await s.stored();
    await query("authenticated", "select public.parent_save_snap_application_details($1,2,$2,$3,$4)", [s.request, JSON.stringify(s.details), SNAP_APPLICATION_NOTICE_VERSION, randomUUID()], s.owner);
    const state = (await s.read()).rows[0].value;
    expect(state.snapshot.id).not.toBe(s.state.snapshot.id); expect(state.artifact).toBeNull();
    expect(state.snapshot.provenance).toEqual(s.state.snapshot.provenance);
    await expect(s.register()).rejects.toMatchObject({ code: "42501" });
    await expect(query("parent_storage_broker", "select parent_private.parent_authorize_storage($1,$2,'parent-form-artifacts',$3,'download')", [s.job.jobId, s.job.leaseToken, artifact.object_path])).rejects.toMatchObject({ code: "42501" });
  });
  it.each(["old evidence", "old income month", "past expected income"])("does not register or reuse %s despite a current source review", async kind => {
    const s = await seed(), details = structuredClone(s.details), previous = s.state.snapshot;
    if (kind === "old income month") details.income!.month = "2026-01";
    if (kind === "past expected income") {
      const today = (await fixture.admin.query("select to_char(now() at time zone 'America/New_York','YYYY-MM-DD') agency_date")).rows[0].agency_date;
      const yesterday = new Date(`${today}T12:00:00Z`); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      details.income = { month: s.details.income!.month, hasIncome: true, entries: [{ id: randomUUID(), personId: details.household![0].id, source: "Work", amount: 20, frequency: "weekly", status: "expected", date: yesterday.toISOString().slice(0, 10) }] };
    }
    const provenance = Object.fromEntries(Object.keys(snapApplicationLeaves(details)).map(path => [path, {
      ...previous.provenance["county"], ...(path.startsWith("income.") ? { period: details.income!.month } : {}),
    }]));
    if (kind === "old evidence") provenance["address.street"] = { ...provenance["address.street"], asOf: "2026-01-01" };
    await fixture.admin.query(`insert into public.parent_snap_application_details(id,request_id,revision,base_version,request_version,details,provenance,source,notice_version,idempotency_key)
      select $1,request_id,revision+1,base_version,request_version,$2,$3,source,notice_version,$4 from public.parent_snap_application_details where id=$5`,
      [randomUUID(), JSON.stringify(details), JSON.stringify(provenance), randomUUID(), previous.id]);
    const state = (await s.read()).rows[0].value;
    expect(state.artifact).toBeNull();
    await expect(s.register(state.snapshot.id, state.snapshotHash)).rejects.toMatchObject({ code: "42501" });
  });
  it("ages real roster answers while preserving derived count and fixed SELF metadata without a new question", async () => {
    const s = await seed(), snapshot = structuredClone(s.state.snapshot), self = snapshot.details.household[0].id;
    for (const path of ["householdSize", `household.${self}.relationship`])
      snapshot.provenance[path] = { source: "parent", confirmedAt: "2026-01-01T12:00:00Z", asOf: "2026-01-01" };
    const current = async () => (await fixture.admin.query("select parent_private.snap_snapshot_provenance_current($1) value", [JSON.stringify(snapshot)])).rows[0].value;
    expect(await current()).toBe(true);
    snapshot.provenance[`household.${self}.firstName`] = { source: "parent", confirmedAt: "2026-01-01T12:00:00Z", asOf: "2026-01-01" };
    expect(await current()).toBe(false);
    snapshot.provenance[`household.${self}.firstName`] = s.state.snapshot.provenance[`household.${self}.firstName`];
    snapshot.details.householdSize = 2; expect(await current()).toBe(false);
  });
  it("stops upload/confirmation and stale lease use after a private correction", async () => {
    const s = await seed(), artifact = (await s.register()).rows[0].value;
    await query("authenticated", "select public.parent_save_snap_application_details($1,2,$2,$3,$4)", [s.request, JSON.stringify({ ...s.details, county: "Updated county" }), SNAP_APPLICATION_NOTICE_VERSION, randomUUID()], s.owner);
    await expect(s.read()).rejects.toMatchObject({ code: "42501" });
    await expect(query("parent_worker", "select parent_private.parent_prepare_snap_application_preview($1,$2,2,$3,$4)", [s.job.jobId, s.job.leaseToken, artifact.id, randomUUID()])).rejects.toMatchObject({ code: "42501" });
    await expect(query("parent_storage_broker", "select parent_private.parent_authorize_storage($1,$2,'parent-form-artifacts',$3,'upload')", [s.job.jobId, s.job.leaseToken, artifact.object_path])).rejects.toMatchObject({ code: "42501" });
    await expect(query("parent_worker", "select parent_private.parent_confirm_form_artifact($1,$2,$3,$4)", [s.job.jobId, s.job.leaseToken, artifact.id, "b".repeat(64)])).rejects.toMatchObject({ code: "42501" });
    const next = (await query("parent_worker", "select parent_private.parent_claim_job(120) job")).rows[0].job;
    await expect(query("parent_worker", "select parent_private.parent_register_snap_application_preview($1,$2,3,$3,$4,$5)", [next.jobId, next.leaseToken, s.state.snapshot.id, s.state.snapshotHash, "b".repeat(64)])).rejects.toMatchObject({ code: "42501" });
  });
  it("rebinds unchanged answers under a new current request version without refreshing evidence", async () => {
    const s = await seed(); await s.stored();
    await query("authenticated", "select public.parent_replace_mandate($1,$2,2)", [s.request, JSON.stringify(fixtureMandate({ recipientIds: ["snap-pa"], allowedActions: ["research", "prepare"], mode: "prepare_only", expiresAt: new Date(Date.now() + 86400000).toISOString() }))], s.owner);
    const next = (await query("parent_worker", "select parent_private.parent_claim_job(120) job")).rows[0].job;
    const state = (await query("parent_worker", "select parent_private.parent_get_snap_application_preparation($1,$2,3) value", [next.jobId, next.leaseToken])).rows[0].value;
    expect(state.snapshot).toEqual(s.state.snapshot); expect(state.snapshotHash).toBe(s.state.snapshotHash);
    expect(state.artifact).toBeNull();
  });
  it("records an explicit stale-leaf answer once, preserving siblings and binding the exact confirmation list to replay", async () => {
    const s = await seed(), previous = s.state.snapshot;
    const provenance = structuredClone(previous.provenance);
    provenance["address.street"] = { source: "parent", confirmedAt: "2026-01-01T12:00:00Z", asOf: "2026-01-01" };
    await fixture.admin.query(`insert into public.parent_snap_application_details(id,request_id,revision,base_version,request_version,details,provenance,source,notice_version,idempotency_key)
      select $1,request_id,revision+1,base_version,request_version,details,$2,source,notice_version,$3 from public.parent_snap_application_details where id=$4`,
      [randomUUID(), JSON.stringify(provenance), randomUUID(), previous.id]);
    const key = randomUUID(), args = [s.request, JSON.stringify(s.details), SNAP_APPLICATION_NOTICE_VERSION, key, ["address.street"]];
    const sql = "select public.parent_reaffirm_snap_application_details($1,2,$2,$3,$4,$5) id";
    const id = (await query("authenticated", sql, args, s.owner)).rows[0].id;
    const read = () => fixture.admin.query("select * from public.parent_snap_application_details where id=$1", [id]);
    const original = (await read()).rows[0];
    expect(original.confirmed_paths).toEqual(["address.street"]); expect(original.request_version).toBe(3);
    expect({ ...original.provenance, "address.street": provenance["address.street"] }).toEqual(provenance);
    expect(original.provenance["address.street"].asOf).not.toBe("2026-01-01");
    expect((await query("authenticated", sql, args, s.owner)).rows[0].id).toBe(id); expect((await read()).rows[0]).toEqual(original);
    await expect(query("authenticated", "select public.parent_save_snap_application_details($1,2,$2,$3,$4)", args.slice(0, 4), s.owner)).rejects.toMatchObject({ code: "40001" });
    await expect(query("authenticated", sql, [...args.slice(0, 4), ["zip"]], s.owner)).rejects.toMatchObject({ code: "40001" });
    await expect(query("authenticated", "select public.parent_reaffirm_snap_application_details($1,3,$2,$3,$4,$5)", [s.request, JSON.stringify(s.details), SNAP_APPLICATION_NOTICE_VERSION, randomUUID(), ["address.street"]], s.owner)).rejects.toMatchObject({ code: "23514" });
  });
  it.each(["zip", "ssn", "household.11111111-1111-4111-8111-111111111111.id", "unknown.field"])("rejects a fresh, protected or unknown reaffirmation path: %s", async path => {
    const s = await seed();
    await expect(query("authenticated", "select public.parent_reaffirm_snap_application_details($1,2,$2,$3,$4,$5)",
      [s.request, JSON.stringify(s.details), SNAP_APPLICATION_NOTICE_VERSION, randomUUID(), [path]], s.owner)).rejects.toMatchObject({ code: "23514" });
  });
  it.each(["old month", "past expected payment"])("does not turn %s into current income by reaffirmation", async kind => {
    const s = await seed(), previous = s.state.snapshot, details = structuredClone(s.details);
    let path = "income.month";
    if (kind === "old month") details.income!.month = "2026-01";
    else {
      const today = (await fixture.admin.query("select to_char(now() at time zone 'America/New_York','YYYY-MM-DD') agency_date")).rows[0].agency_date;
      const yesterday = new Date(`${today}T12:00:00Z`); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const id = randomUUID(); path = `income.entries.${id}.amount`;
      details.income = { month: s.details.income!.month, hasIncome: true, entries: [{ id, personId: details.household![0].id, source: "Work", amount: 20, frequency: "weekly", status: "expected", date: yesterday.toISOString().slice(0, 10) }] };
    }
    const provenance = Object.fromEntries(Object.keys(snapApplicationLeaves(details)).map(key => [key, {
      ...previous.provenance["county"], ...(key.startsWith("income.") ? { period: details.income!.month } : {}),
    }]));
    provenance[path] = { ...provenance[path], confirmedAt: "2026-01-01T12:00:00Z", asOf: "2026-01-01" };
    await fixture.admin.query(`insert into public.parent_snap_application_details(id,request_id,revision,base_version,request_version,details,provenance,source,notice_version,idempotency_key)
      select $1,request_id,revision+1,base_version,request_version,$2,$3,source,notice_version,$4 from public.parent_snap_application_details where id=$5`,
      [randomUUID(), JSON.stringify(details), JSON.stringify(provenance), randomUUID(), previous.id]);
    await expect(query("authenticated", "select public.parent_reaffirm_snap_application_details($1,2,$2,$3,$4,$5)",
      [s.request, JSON.stringify(details), SNAP_APPLICATION_NOTICE_VERSION, randomUUID(), [path]], s.owner)).rejects.toMatchObject({ code: "23514" });
  });
  it("keeps existing artifact retention and account-owned deletion working while collection is closed", async () => {
    const s = await seed(), artifact = await s.stored();
    await query("authenticated", "select public.parent_control_request($1,'cancel')", [s.request], s.owner);
    await fixture.admin.query("update public.parent_requests set updated_at=now()-interval '91 days' where id=$1", [s.request]);
    await fixture.admin.query("update parent_private.processing_controls set snap_details_enabled=false");
    try {
      const files = (await query("parent_retention_worker", "select parent_private.parent_claim_cleanup(100) batch")).rows[0].batch;
      expect(files.artifacts.map((a: { id: string }) => a.id)).toContain(artifact.id);
      await fixture.admin.query("delete from storage.objects where name=$1", [artifact.object_path]);
      await query("parent_retention_worker", "select parent_private.parent_finish_cleanup($1,$2,array[]::uuid[],array[]::uuid[],$3)", [files.batchId, files.leaseToken, [artifact.id]]);
      const requests = (await query("parent_retention_worker", "select parent_private.parent_claim_cleanup(100) batch")).rows[0].batch;
      expect(requests.requestIds).toContain(s.request);
      await query("parent_retention_worker", "select parent_private.parent_finish_cleanup($1,$2,array[]::uuid[],array[]::uuid[],array[]::uuid[])", [requests.batchId, requests.leaseToken]);
      expect((await fixture.admin.query("select id from public.parent_snap_application_details where request_id=$1", [s.request])).rows).toEqual([]);
      expect((await fixture.admin.query("select id from public.parent_form_artifacts where id=$1", [artifact.id])).rows).toEqual([]);
      expect((await fixture.admin.query("select id from auth.users where id=$1", [s.owner])).rows).toHaveLength(1);
    } finally { await fixture.admin.query("update parent_private.processing_controls set snap_details_enabled=true"); }
  });
});
