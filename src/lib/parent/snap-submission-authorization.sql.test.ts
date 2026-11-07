import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
const permission = "synthetic-snap-final-v1";
const contentHash = "b".repeat(64);
type Job = { jobId: string; leaseToken: string; request: { id: string; version: number } };
type Prepared = { owner: string; verifier: string; job: Job; id: string; artifact: string; template: string; hash: string };
type Role = "authenticated" | "anon" | "service_role" | "parent_worker" | "parent_retention_worker" | "parent_storage_broker";

describe.skipIf(!modulePath)("exact parent SNAP Submit authorization against PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>;
  const sessions = new Map<string, string>();

  async function query(role: Role, sql: string, values: unknown[] = [], user?: string) {
    await fixture.admin.query(`set role ${role}`);
    try {
      await fixture.admin.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({
        role, sub: user, session_id: user && sessions.get(user), amr: [{ method: "otp" }],
      })]);
      return await fixture.admin.query(sql, values);
    } finally { await fixture.admin.query("reset role"); }
  }
  async function user() {
    const id = randomUUID(), session = randomUUID(); sessions.set(id, session);
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [id, `${id}@example.invalid`]);
    await fixture.admin.query("insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')", [session, id]);
    return id;
  }
  beforeAll(async () => { fixture = await createParentSqlFixture(modulePath!); });
  afterAll(async () => { await fixture?.admin.end(); });

  async function prepared(options: { need?: string; program?: string; action?: string; acts?: string[]; completeActs?: boolean; preview?: boolean; maxAttempts?: number; noArtifact?: boolean } = {}): Promise<Prepared> {
    const owner = await user(), verifier = await user();
    const need = options.need ?? "snap_new", program = options.program ?? "snap-pa", action = options.action ?? "submit";
    const acts = options.acts ?? ["signature", "certification"];
    await fixture.admin.query("update parent_private.processing_controls set enabled=true,approval_reference='isolated synthetic final Submit test',approved_until=now()+interval '1 day',existing_accounts_enabled=false");
    await fixture.admin.query("update public.parent_jobs set state='done'");
    await fixture.admin.query(`insert into parent_private.provider_capabilities(program_id,action,enabled,transport_verified,requires_form,permission_version,permission_reference,allowed_fields,field_categories,required_acts,verified_until)
      values($1,$2,true,true,$3,$4,'synthetic final-form contract, no provider connected',array['householdSize'],'{"householdSize":"household"}',$5,now()+interval '1 day')
      on conflict(program_id,action) do update set enabled=true,transport_verified=true,requires_form=excluded.requires_form,permission_version=excluded.permission_version,required_acts=excluded.required_acts,verified_until=excluded.verified_until`,
    [program, action, !options.noArtifact, permission, acts]);
    await query("authenticated", "select public.parent_start_request($1,$2,$3)", [
      JSON.stringify(fixtureIntake({ needs: [need] as ReturnType<typeof fixtureIntake>["needs"], utilityProviders: [] })),
      JSON.stringify(fixtureMandate({ recipientIds: [program], maxAttempts: options.maxAttempts ?? 12, expiresAt: new Date(Date.now() + 86400000).toISOString() })), randomUUID(),
    ], owner);
    const job = (await query("parent_worker", "select parent_private.parent_claim_job(120) job")).rows[0].job as Job;
    const template = `synthetic-final-${randomUUID()}`;
    let artifact: string | null = null;
    if (!options.noArtifact) {
      await fixture.admin.query(`insert into parent_private.form_templates(id,version,program_id,needs,content_sha256,object_path,field_map,required_acts,source_url,verified_until,active,preparation_only)
        values($1,'1',$2,$3,$4,$5,'{"Size":"householdSize"}',$6,'https://example.invalid/synthetic-final-form',now()+interval '1 day',true,$7)`,
      [template, program, [need], "a".repeat(64), `${template}.pdf`, acts, options.preview ?? false]);
      const registered = (await query("parent_worker", "select parent_private.parent_register_form_artifact($1,$2,$3,$4,'1','{\"householdSize\":3}',$5,$6) artifact",
        [job.jobId, job.leaseToken, program, template, contentHash, need])).rows[0].artifact;
      artifact = registered.id;
      // This is a SQL-only synthetic artifact: no real PDF, signature or provider acceptance is claimed.
      await fixture.admin.query("insert into storage.objects(bucket_id,name,metadata) values('parent-form-artifacts',$1,'{\"size\":1,\"mimetype\":\"application/pdf\"}')", [registered.object_path]);
      await query("parent_worker", "select parent_private.parent_confirm_form_artifact($1,$2,$3,$4)", [job.jobId, job.leaseToken, artifact, contentHash]);
    }
    let id: string;
    if (options.preview) {
      // Deliberately create a forged executable row so dispatch and the public RPC must independently reject it.
      id = (await fixture.admin.query(`insert into public.parent_operations(request_id,request_version,need,program_id,action,packet,packet_hash,data_categories,idempotency_key,permission_version,artifact_id)
        values($1,1,$2,$3,$4,'{"householdSize":3}',encode(sha256(convert_to('{"householdSize":3}'::jsonb::text,'UTF8')),'hex'),array['household'],$5,$6,$7) returning id`,
      [job.request.id, need, program, action, randomUUID(), permission, artifact])).rows[0].id;
    } else {
      id = (await query("parent_worker", "select parent_private.parent_prepare_operation($1,$2,1,$3,$4,'{\"householdSize\":3}',array['household'],array[]::uuid[],$5,$6,$7) id",
        [job.jobId, job.leaseToken, program, action, randomUUID(), need, artifact])).rows[0].id;
    }
    const hash = (await fixture.admin.query("select packet_hash from public.parent_operations where id=$1", [id])).rows[0].packet_hash;
    await fixture.admin.query(`insert into parent_private.trusted_memberships(user_id,request_id,operation_id,program_id,role,allowed_fields,can_verify_personal_acts,purpose,permission_reference,expires_at)
      values($1,$2,$3,$4,'partner',array['householdSize'],true,'Synthetic personal-act fixture','synthetic verifier authority',now()+interval '1 hour')`, [verifier, job.request.id, id, program]);
    if (options.completeActs !== false && !options.preview)
      for (const act of acts) await query("authenticated", "select public.parent_record_personal_act($1,$2,$3,now())", [id, act, `synthetic-${act}-${randomUUID()}`], verifier);
    return { owner, verifier, job, id, artifact: artifact!, template, hash };
  }
  function authorize(s: Prepared, overrides: Record<string, unknown> = {}, actor = s.owner, role: Role = "authenticated") {
    const input = { request: s.job.request.id, operation: s.id, version: 1, hash: s.hash, artifact: s.artifact, content: contentHash, ...overrides };
    return query(role, "select public.parent_authorize_snap_submission($1,$2,$3,$4,$5,$6) id",
      [input.request, input.operation, input.version, input.hash, input.artifact, input.content], actor);
  }
  function begin(s: Prepared, token = s.job.leaseToken) {
    return query("parent_worker", "select parent_private.parent_begin_operation($1,$2,$3) operation", [s.id, s.job.jobId, token]);
  }
  async function authorizations(s: Prepared) {
    return (await fixture.admin.query("select operation_id,authorized_by,authorized_at::text,wake_lease_token from parent_private.snap_submission_authorizations where operation_id=$1", [s.id])).rows;
  }
  async function projection(s: Prepared) {
    return (await query("parent_worker", "select parent_private.parent_get_operations($1,$2) operations", [s.job.jobId, s.job.leaseToken])).rows[0].operations.find((operation: { id: string }) => operation.id === s.id);
  }
  async function history(s: Prepared, state: "sent" | "delivery_unknown") {
    await fixture.admin.query(`insert into public.parent_operations(request_id,request_version,need,program_id,action,packet,packet_hash,data_categories,idempotency_key,permission_version,state,executed_at)
      select request_id,request_version,need,program_id,'share',packet,packet_hash,data_categories,$2,permission_version,$3,now() from public.parent_operations where id=$1`, [s.id, randomUUID(), state]);
  }
  function waitWithOlderPlan(s: Prepared) {
    return query("parent_worker", "select parent_private.parent_save_job_plan($1,$2,1,$3,$4,null,'parent','parent_action_completed')", [
      s.job.jobId, s.job.leaseToken,
      JSON.stringify({ version: 1, routes: [{ need: "snap_new", programId: "snap-pa", state: "prepared" }] }),
      JSON.stringify([{ reason: "snap_submit", resolver: "parent", resolved: false }]),
    ]);
  }
  function fail(s: Prepared) {
    return query("parent_worker", "select parent_private.parent_fail_job($1,$2,'configuration_unavailable')", [s.job.jobId, s.job.leaseToken]);
  }
  async function jobState(s: Prepared) {
    return (await fixture.admin.query("select state,attempts,run_at<=now() due,lease_token,last_error from public.parent_jobs where id=$1", [s.job.jobId])).rows[0];
  }
  async function authorizationEvents(s: Prepared) {
    return (await fixture.admin.query("select count(*)::int count from public.parent_events where request_id=$1 and kind='snap_submission.authorized'", [s.job.request.id])).rows[0].count;
  }

  it("freezes the exact application before review, then independently blocks dispatch until its owner's Submit", async () => {
    const s = await prepared();
    expect(await projection(s)).toMatchObject({ state: "prepared", personalActsComplete: true, snapSubmissionAuthorized: false });
    await expect(begin(s)).rejects.toThrow(/parent must choose Submit/);
    expect(await authorizations(s)).toEqual([]);
    expect((await authorize(s)).rows[0].id).toBe(s.id);
    expect(await projection(s)).toMatchObject({ state: "prepared", personalActsComplete: true, snapSubmissionAuthorized: true });
    expect((await begin(s)).rows[0].operation).toMatchObject({ operationId: s.id, packetHash: s.hash, artifact: { id: s.artifact, content_sha256: contentHash } });
    const recorded = await authorizations(s);
    expect((await authorize(s)).rows[0].id).toBe(s.id);
    expect(await authorizations(s)).toEqual(recorded);
    await expect(begin(s)).rejects.toMatchObject({ code: "42501" });
  });

  it("resumes waiting work once without renewing the mandate, personal acts, authorization time or audit on replay", async () => {
    const s = await prepared();
    const before = (await fixture.admin.query("select version,mandate from public.parent_requests where id=$1", [s.job.request.id])).rows[0];
    const acts = (await fixture.admin.query("select * from parent_private.personal_act_evidence where operation_id=$1 order by act", [s.id])).rows;
    await fixture.admin.query("update public.parent_jobs set state='waiting',run_at='infinity',lease_token=null,lease_until=null where id=$1", [s.job.jobId]);
    await authorize(s);
    expect((await fixture.admin.query("select state,run_at<=now() due from public.parent_jobs where id=$1", [s.job.jobId])).rows[0]).toEqual({ state: "queued", due: true });
    const recorded = await authorizations(s);
    await fixture.admin.query("update public.parent_jobs set state='waiting',run_at='infinity' where id=$1", [s.job.jobId]);
    await expect(authorize(s)).rejects.toThrow("SNAP submission continuation unavailable");
    expect(await authorizations(s)).toEqual(recorded);
    expect((await fixture.admin.query("select state from public.parent_jobs where id=$1", [s.job.jobId])).rows[0].state).toBe("waiting");
    expect((await fixture.admin.query("select version,mandate from public.parent_requests where id=$1", [s.job.request.id])).rows[0]).toEqual(before);
    expect((await fixture.admin.query("select * from parent_private.personal_act_evidence where operation_id=$1 order by act", [s.id])).rows).toEqual(acts);
    expect((await fixture.admin.query("select count(*)::int count from public.parent_events where request_id=$1 and kind='snap_submission.authorized'", [s.job.request.id])).rows[0].count).toBe(1);
  });

  it("does not reject a queued replay solely because its transaction began before the queue timestamp", async () => {
    const s = await prepared(); await authorize(s); const before = await authorizations(s);
    await fixture.admin.query("begin");
    try {
      // Model the committed queue timestamp observed after waiting on the other Submit's request lock.
      await fixture.admin.query("update public.parent_jobs set state='queued',run_at=greatest(clock_timestamp(),now()+interval '1 microsecond') where id=$1", [s.job.jobId]);
      expect((await fixture.admin.query("select run_at>now() later_than_transaction from public.parent_jobs where id=$1", [s.job.jobId])).rows[0].later_than_transaction).toBe(true);
      expect((await authorize(s)).rows[0].id).toBe(s.id);
      expect(await authorizations(s)).toEqual(before);
    } finally { await fixture.admin.query("rollback"); }
  });

  it("queues an eligible failed job on first Submit without resetting worker attempts", async () => {
    const s = await prepared(); await fail(s);
    expect(await jobState(s)).toMatchObject({ state: "failed", attempts: 1 });
    await authorize(s);
    expect(await jobState(s)).toMatchObject({ state: "queued", attempts: 1, due: true, lease_token: null, last_error: null });
    const job = (await query("parent_worker", "select parent_private.parent_claim_job(120) job")).rows[0].job as Job;
    expect(await jobState(s)).toMatchObject({ state: "leased", attempts: 2 });
    expect((await begin({ ...s, job })).rows[0].operation.operationId).toBe(s.id);
  });

  it("preserves a Submit received before worker failure once, without looping or refreshing a later failed replay", async () => {
    const s = await prepared(); await authorize(s); const before = await authorizations(s);
    await fail(s);
    expect(await jobState(s)).toMatchObject({ state: "queued", attempts: 1, due: true, lease_token: null });
    const job = (await query("parent_worker", "select parent_private.parent_claim_job(120) job")).rows[0].job as Job;
    const later = { ...s, job };
    await fail(later);
    expect(await jobState(later)).toMatchObject({ state: "failed", attempts: 2 });
    await expect(authorize(later)).rejects.toThrow("SNAP submission continuation unavailable");
    expect(await jobState(later)).toMatchObject({ state: "failed", attempts: 2 });
    expect(await authorizations(s)).toEqual(before);
    expect(await authorizationEvents(s)).toBe(1);
  });

  it.each(["queued", "waiting", "failed", "leased"])("does not acknowledge a new Submit on an exhausted %s job", async state => {
    const s = await prepared();
    await fixture.admin.query("update public.parent_jobs set state=$2,attempts=48 where id=$1", [s.job.jobId, state]);
    const before = await jobState(s);
    await expect(authorize(s)).rejects.toThrow("SNAP submission continuation unavailable");
    expect(await authorizations(s)).toEqual([]);
    expect(await authorizationEvents(s)).toBe(0);
    expect(await jobState(s)).toEqual(before);
    expect((await query("parent_worker", "select parent_private.parent_claim_job(120) job")).rows[0].job).toBeNull();
  });

  it.each(["done", "cancelled", "missing_job", "wrong_job_version", "invalid_lease", "overlong_live_lease"])("rejects first Submit for %s without an authorization or audit", async kind => {
    const s = await prepared();
    if (kind === "done" || kind === "cancelled") await fixture.admin.query("update public.parent_jobs set state=$2 where id=$1", [s.job.jobId, kind]);
    if (kind === "missing_job") await fixture.admin.query("delete from public.parent_jobs where id=$1", [s.job.jobId]);
    if (kind === "wrong_job_version") await fixture.admin.query("update public.parent_jobs set request_version=2 where id=$1", [s.job.jobId]);
    if (kind === "invalid_lease") await fixture.admin.query("update public.parent_jobs set lease_token=null where id=$1", [s.job.jobId]);
    if (kind === "overlong_live_lease") await fixture.admin.query("update public.parent_jobs set lease_started_at=now()-interval '16 minutes' where id=$1", [s.job.jobId]);
    await expect(authorize(s)).rejects.toThrow("SNAP submission continuation unavailable");
    expect(await authorizations(s)).toEqual([]);
    expect(await authorizationEvents(s)).toBe(0);
  });

  it.each(["queued", "waiting", "failed", "expired_lease"])("can use the remaining worker claim after Submit on %s at attempt 47", async state => {
    const s = await prepared();
    if (state === "expired_lease") await fixture.admin.query("update public.parent_jobs set attempts=47,lease_until=now()-interval '1 second' where id=$1", [s.job.jobId]);
    else await fixture.admin.query("update public.parent_jobs set state=$2,attempts=47,run_at='infinity' where id=$1", [s.job.jobId, state]);
    await authorize(s); const before = await authorizations(s);
    const job = (await query("parent_worker", "select parent_private.parent_claim_job(120) job")).rows[0].job as Job;
    expect(job.request.id).toBe(s.job.request.id);
    expect(await jobState(s)).toMatchObject({ state: "leased", attempts: 48 });
    const finalLease = { ...s, job };
    expect((await authorize(finalLease)).rows[0].id).toBe(s.id);
    expect(await authorizations(s)).toEqual(before);
    expect((await begin(finalLease)).rows[0].operation.operationId).toBe(s.id);
    await fixture.admin.query("update public.parent_jobs set state='done' where id=$1", [s.job.jobId]);
    expect((await authorize(finalLease)).rows[0].id).toBe(s.id);
    expect(await jobState(s)).toMatchObject({ state: "done", attempts: 48 });
    expect(await authorizationEvents(s)).toBe(1);
  });

  it.each(["wait", "fail"])("does not manufacture another worker claim after the final authorized lease chooses %s", async result => {
    const s = await prepared();
    await fixture.admin.query("update public.parent_jobs set state='waiting',attempts=47,run_at='infinity' where id=$1", [s.job.jobId]);
    await authorize(s); const before = await authorizations(s);
    const job = (await query("parent_worker", "select parent_private.parent_claim_job(120) job")).rows[0].job as Job;
    const finalLease = { ...s, job };
    if (result === "wait") await waitWithOlderPlan(finalLease); else await fail(finalLease);
    expect(await jobState(s)).toMatchObject({ state: result === "wait" ? "waiting" : "failed", attempts: 48 });
    await expect(authorize(finalLease)).rejects.toThrow("SNAP submission continuation unavailable");
    expect((await query("parent_worker", "select parent_private.parent_claim_job(120) job")).rows[0].job).toBeNull();
    expect(await authorizations(s)).toEqual(before);
    expect(await authorizationEvents(s)).toBe(1);
  });

  it.each(["wait", "fail"])("reserves the last available continuation when a live lease at attempt 47 chooses %s after Submit", async result => {
    const s = await prepared();
    await fixture.admin.query("update public.parent_jobs set attempts=47 where id=$1", [s.job.jobId]);
    await authorize(s);
    if (result === "wait") await waitWithOlderPlan(s); else await fail(s);
    expect(await jobState(s)).toMatchObject({ state: "queued", attempts: 47, due: true });
    const job = (await query("parent_worker", "select parent_private.parent_claim_job(120) job")).rows[0].job as Job;
    expect(await jobState(s)).toMatchObject({ state: "leased", attempts: 48 });
    expect((await begin({ ...s, job })).rows[0].operation.operationId).toBe(s.id);
  });

  it("keeps an unknown-delivery failure out of automatic continuation", async () => {
    const s = await prepared();
    await query("parent_worker", "select parent_private.parent_fail_job($1,$2,'delivery_unknown')", [s.job.jobId, s.job.leaseToken]);
    await expect(authorize(s)).rejects.toThrow("unknown delivery requires reconciliation");
    expect(await authorizations(s)).toEqual([]);
    const other = await prepared(); await authorize(other);
    await query("parent_worker", "select parent_private.parent_fail_job($1,$2,'delivery_unknown')", [other.job.jobId, other.job.leaseToken]);
    expect(await jobState(other)).toMatchObject({ state: "failed", last_error: "delivery_unknown" });
  });

  it.each(["submit_first", "worker_waits_first"])("cannot lose Submit when %s, and does not requeue a later lease", async order => {
    const s = await prepared();
    if (order === "submit_first") {
      await authorize(s);
      expect((await authorizations(s))[0].wake_lease_token).toBe(s.job.leaseToken);
      // Heartbeat changes and clock ties do not identify a lease; its unique token does.
      await fixture.admin.query("update public.parent_jobs set updated_at=now(),lease_until=now()+interval '120 seconds' where id=$1", [s.job.jobId]);
      await waitWithOlderPlan(s);
    } else {
      await waitWithOlderPlan(s);
      await authorize(s);
      expect((await authorizations(s))[0].wake_lease_token).toBeNull();
    }
    expect((await fixture.admin.query("select state,run_at<=now() due,lease_token from public.parent_jobs where id=$1", [s.job.jobId])).rows[0]).toEqual({ state: "queued", due: true, lease_token: null });
    const job = (await query("parent_worker", "select parent_private.parent_claim_job(120) job")).rows[0].job as Job;
    expect(job.leaseToken).not.toBe(s.job.leaseToken);
    const later = { ...s, job };
    expect((await projection(later)).snapSubmissionAuthorized).toBe(true);
    const before = await authorizations(s);
    await authorize(later);
    expect(await authorizations(s)).toEqual(before);
    await waitWithOlderPlan(later);
    expect((await fixture.admin.query("select state,run_at::text from public.parent_jobs where id=$1", [s.job.jobId])).rows[0]).toEqual({ state: "waiting", run_at: "infinity" });
  });

  it.each(["unknown_delivery", "operation_started", "processing_closed", "request_version_changed"])("does not force a leased continuation after %s", async kind => {
    const s = await prepared(); await authorize(s);
    if (kind === "unknown_delivery") await history(s, "delivery_unknown");
    if (kind === "operation_started") await begin(s);
    if (kind === "processing_closed") await fixture.admin.query("update parent_private.processing_controls set enabled=false");
    if (kind === "request_version_changed") await query("authenticated", "select public.parent_correct_request($1,$2,1)", [s.job.request.id, JSON.stringify(fixtureIntake({ needs: ["snap_new"], utilityProviders: [] }))], s.owner);
    if (kind === "unknown_delivery" || kind === "operation_started") await waitWithOlderPlan(s);
    else await fixture.admin.query("update public.parent_jobs set state='waiting',run_at='infinity',lease_token=null,lease_until=null where id=$1", [s.job.jobId]);
    expect((await fixture.admin.query("select state,run_at::text from public.parent_jobs where id=$1", [s.job.jobId])).rows[0]).toEqual({ state: "waiting", run_at: "infinity" });
  });

  it.each([
    ["request", randomUUID()], ["operation", randomUUID()], ["version", 2], ["version", null],
    ["hash", "c".repeat(64)], ["hash", null], ["hash", "malformed"],
    ["artifact", randomUUID()], ["artifact", null], ["content", "c".repeat(64)], ["content", null], ["content", "malformed"],
  ])("rejects a mismatched or missing %s binding: %s", async (field, value) => {
    const s = await prepared();
    await expect(authorize(s, { [field as string]: value })).rejects.toMatchObject({ code: "42501" });
    expect(await authorizations(s)).toEqual([]);
  });

  it.each(["other_parent", "trusted_verifier", "school_staff", "expired_session", "missing_session", "unverified_email", "banned_account", "closed_account", "deleted_account"])("denies %s as the final submitting parent", async kind => {
    const s = await prepared();
    let actor = s.owner;
    if (kind === "other_parent" || kind === "school_staff") actor = await user();
    if (kind === "other_parent") await query("authenticated", "select public.parent_ensure_account()", [], actor);
    if (kind === "trusted_verifier") actor = s.verifier;
    if (kind === "school_staff") await fixture.admin.query("insert into public.app_users(id,email,role,is_active) values($1,'staff@example.invalid','admin',true)", [actor]);
    if (kind === "expired_session") await fixture.admin.query("update auth.sessions set not_after=now()-interval '1 second' where id=$1", [sessions.get(actor)]);
    if (kind === "missing_session") sessions.delete(actor);
    if (kind === "unverified_email") await fixture.admin.query("update auth.users set email_confirmed_at=null where id=$1", [actor]);
    if (kind === "banned_account") await fixture.admin.query("update auth.users set banned_until=now()+interval '1 day' where id=$1", [actor]);
    if (kind === "closed_account") await fixture.admin.query("update public.parent_accounts set status='disabled' where id=$1", [actor]);
    if (kind === "deleted_account") await fixture.admin.query("insert into parent_private.deletion_tombstones(subject_hash) values(encode(sha256(convert_to('parent-account:'||$1::text,'UTF8')),'hex'))", [actor]);
    await expect(authorize(s, {}, actor)).rejects.toMatchObject({ code: "42501" });
    expect(await authorizations(s)).toEqual([]);
  });

  it.each<Role>(["anon", "service_role", "parent_worker", "parent_retention_worker", "parent_storage_broker"])("keeps %s outside the parent RPC and private ledger", async role => {
    const s = await prepared();
    await expect(authorize(s, {}, s.owner, role)).rejects.toMatchObject({ code: "42501" });
    await expect(query(role, "insert into parent_private.snap_submission_authorizations(operation_id,authorized_by) values($1,$2)", [s.id, s.owner], s.owner)).rejects.toMatchObject({ code: "42501" });
    await expect(query(role, "select * from parent_private.snap_submission_authorizations", [], s.owner)).rejects.toMatchObject({ code: "42501" });
    await expect(query(role, "select parent_private.snap_submission_authorized($1)", [s.id], s.owner)).rejects.toMatchObject({ code: "42501" });
  });

  it("denies authenticated direct ledger writes, updates, deletes, reads and private helper calls", async () => {
    const s = await prepared(); await authorize(s);
    for (const sql of [
      "insert into parent_private.snap_submission_authorizations(operation_id) values($1)",
      "update parent_private.snap_submission_authorizations set authorized_at=now() where operation_id=$1",
      "delete from parent_private.snap_submission_authorizations where operation_id=$1",
      "select * from parent_private.snap_submission_authorizations where operation_id=$1",
      "select parent_private.snap_submission_authorized($1)",
    ]) await expect(query("authenticated", sql, [s.id], s.owner)).rejects.toMatchObject({ code: "42501" });
    expect(await authorizations(s)).toHaveLength(1);
  });

  it.each(["missing", "expired", "wrong_packet", "one_of_two"])("does not manufacture %s personal certification or signature evidence", async kind => {
    const s = await prepared({ completeActs: kind !== "missing" && kind !== "one_of_two" });
    if (kind === "expired") await fixture.admin.query("update parent_private.personal_act_evidence set expires_at=now()-interval '1 second' where operation_id=$1", [s.id]);
    if (kind === "wrong_packet") await fixture.admin.query("update parent_private.personal_act_evidence set packet_hash=$2 where operation_id=$1", [s.id, "c".repeat(64)]);
    if (kind === "one_of_two") await query("authenticated", "select public.parent_record_personal_act($1,'signature','synthetic-signature-only',now())", [s.id], s.verifier);
    const before = (await fixture.admin.query("select * from parent_private.personal_act_evidence where operation_id=$1", [s.id])).rows;
    expect((await projection(s)).personalActsComplete).toBe(false);
    await expect(authorize(s)).rejects.toMatchObject({ code: "42501" });
    expect(await authorizations(s)).toEqual([]);
    expect((await fixture.admin.query("select * from parent_private.personal_act_evidence where operation_id=$1", [s.id])).rows).toEqual(before);
  });

  it.each(["disabled", "unverified_transport", "expired", "changed_version", "changed_required_acts", "unresolved_required_acts", "unresolved_form_contract"])("denies %s provider permission, including an authorization replay", async kind => {
    const s = await prepared(); await authorize(s); const before = await authorizations(s);
    const change = { disabled: "enabled=false", unverified_transport: "transport_verified=false", expired: "verified_until=now()-interval '1 second'", changed_version: "permission_version='synthetic-changed-v2'", changed_required_acts: "required_acts=array['signature','certification','identity']", unresolved_required_acts: "required_acts=null", unresolved_form_contract: "requires_form=null" }[kind]!;
    await fixture.admin.query(`update parent_private.provider_capabilities set ${change} where program_id='snap-pa' and action='submit'`);
    await expect(authorize(s)).rejects.toMatchObject({ code: "42501" });
    await expect(begin(s)).rejects.toMatchObject({ code: "42501" });
    expect(await authorizations(s)).toEqual(before);
  });

  it.each(["inactive_source", "expired_source", "changed_source", "deleted_artifact", "preview", "preview_flag_later_changed", "missing_artifact"])("denies a %s final artifact", async kind => {
    const s = await prepared({ preview: kind.startsWith("preview"), noArtifact: kind === "missing_artifact" });
    if (kind === "inactive_source") await fixture.admin.query("update parent_private.form_templates set active=false where id=$1", [s.template]);
    if (kind === "expired_source") await fixture.admin.query("update parent_private.form_templates set verified_until=now()-interval '1 second' where id=$1", [s.template]);
    if (kind === "changed_source") await fixture.admin.query("update parent_private.form_templates set content_sha256=$2 where id=$1", [s.template, "c".repeat(64)]);
    if (kind === "deleted_artifact") await fixture.admin.query("update public.parent_form_artifacts set status='deleted' where id=$1", [s.artifact]);
    if (kind === "preview_flag_later_changed") await fixture.admin.query("update parent_private.form_templates set preparation_only=false where id=$1", [s.template]);
    await expect(authorize(s)).rejects.toMatchObject({ code: "42501" });
    await expect(begin(s)).rejects.toMatchObject({ code: "42501" });
    expect(await authorizations(s)).toEqual([]);
  });

  it("rejects an expired final artifact even if a privileged fixture forged a prepared operation", async () => {
    const s = await prepared(), artifact = randomUUID(), id = randomUUID();
    await fixture.admin.query(`insert into public.parent_form_artifacts
      select (jsonb_populate_record(null::public.parent_form_artifacts,to_jsonb(f)||jsonb_build_object('id',$2::uuid,'object_path',$3::text,'expires_at',now()-interval '1 second'))).*
      from public.parent_form_artifacts f where id=$1`, [s.artifact, artifact, `${s.job.request.id}/${artifact}.pdf`]);
    await fixture.admin.query(`with removed as (delete from public.parent_operations where id=$1 returning *) insert into public.parent_operations
      select (jsonb_populate_record(null::public.parent_operations,to_jsonb(o)||jsonb_build_object('id',$2::uuid,'artifact_id',$3::uuid,'idempotency_key',$4::text))).*
      from removed o`, [s.id, id, artifact, randomUUID()]);
    const forged = { ...s, id, artifact };
    await expect(authorize(forged)).rejects.toThrow("form artifact no longer matches the exact operation");
    await expect(begin(forged)).rejects.toThrow("form artifact no longer matches the exact operation");
    expect(await authorizations(forged)).toEqual([]);
  });

  it.each(["processing_closed", "processing_expired", "mandate_expired", "mandate_revoked", "parent_paused", "parent_cancelled", "correction"])("rechecks %s after the parent chose Submit", async kind => {
    const s = await prepared(); await authorize(s); const before = await authorizations(s);
    if (kind === "processing_closed") await fixture.admin.query("update parent_private.processing_controls set enabled=false");
    if (kind === "processing_expired") await fixture.admin.query("update parent_private.processing_controls set approved_until=now()-interval '1 second'");
    if (kind === "mandate_expired") {
      // Rebuild only this isolated fixture's mandate snapshot to exercise time expiry without changing its version.
      await fixture.admin.query("delete from public.parent_mandates where request_id=$1", [s.job.request.id]);
      await fixture.admin.query("update public.parent_requests set mandate=jsonb_set(mandate,'{expiresAt}',to_jsonb((now()-interval '1 second')::text)) where id=$1", [s.job.request.id]);
    }
    if (kind === "mandate_revoked") await fixture.admin.query("update public.parent_requests set mandate_revoked_at=now() where id=$1", [s.job.request.id]);
    if (kind === "parent_paused" || kind === "parent_cancelled") await query("authenticated", "select public.parent_control_request($1,$2)", [s.job.request.id, kind === "parent_paused" ? "pause" : "cancel"], s.owner);
    if (kind === "correction") await query("authenticated", "select public.parent_correct_request($1,$2,1)", [s.job.request.id, JSON.stringify(fixtureIntake({ needs: ["snap_new"], utilityProviders: [], householdSize: 4 }))], s.owner);
    await expect(authorize(s)).rejects.toMatchObject({ code: "42501" });
    await expect(begin(s)).rejects.toMatchObject({ code: "42501" });
    expect(await authorizations(s)).toEqual(before);
  });

  it("requires a new exact authorization after correction and cannot transfer the old click to a new artifact", async () => {
    const s = await prepared(); await authorize(s);
    await query("authenticated", "select public.parent_correct_request($1,$2,1)", [s.job.request.id, JSON.stringify(fixtureIntake({ needs: ["snap_new"], utilityProviders: [] }))], s.owner);
    const job = (await query("parent_worker", "select parent_private.parent_claim_job(120) job")).rows[0].job as Job;
    const artifact = (await query("parent_worker", "select parent_private.parent_register_form_artifact($1,$2,'snap-pa',$3,'1','{\"householdSize\":3}',$4,'snap_new') artifact", [job.jobId, job.leaseToken, s.template, contentHash])).rows[0].artifact;
    await fixture.admin.query("insert into storage.objects(bucket_id,name,metadata) values('parent-form-artifacts',$1,'{\"size\":1,\"mimetype\":\"application/pdf\"}')", [artifact.object_path]);
    await query("parent_worker", "select parent_private.parent_confirm_form_artifact($1,$2,$3,$4)", [job.jobId, job.leaseToken, artifact.id, contentHash]);
    const id = (await query("parent_worker", "select parent_private.parent_prepare_operation($1,$2,2,'snap-pa','submit','{\"householdSize\":3}',array['household'],array[]::uuid[],$3,'snap_new',$4) id", [job.jobId, job.leaseToken, randomUUID(), artifact.id])).rows[0].id;
    for (const act of ["signature", "certification"]) await fixture.admin.query("insert into parent_private.personal_act_evidence(operation_id,act,packet_hash,reference,verified_by,verified_at,expires_at) values($1,$2,$3,$4,$5,now(),now()+interval '1 hour')", [id, act, s.hash, `synthetic-corrected-${act}`, s.verifier]);
    const corrected = { ...s, id, artifact: artifact.id, job };
    expect(await projection(corrected)).toMatchObject({ snapSubmissionAuthorized: false, personalActsComplete: true });
    await expect(begin(corrected)).rejects.toThrow(/parent must choose Submit/);
    await expect(authorize(corrected)).rejects.toMatchObject({ code: "42501" });
    expect((await authorize(corrected, { version: 2 })).rows[0].id).toBe(id);
    expect((await begin(corrected)).rows[0].operation.operationId).toBe(id);
    expect(await authorizations(s)).toHaveLength(1);
  });

  it.each(["before_click", "after_click"])("retains unknown-delivery protection %s", async when => {
    const s = await prepared();
    if (when === "after_click") await authorize(s);
    await history(s, "delivery_unknown");
    if (when === "before_click") await expect(authorize(s)).rejects.toMatchObject({ code: "23514" });
    else {
      await expect(authorize(s)).rejects.toMatchObject({ code: "23514" });
      await expect(begin(s)).rejects.toMatchObject({ code: "23514" });
    }
  });

  it.each(["before_click", "after_click"])("retains service-attempt limits %s", async when => {
    const s = await prepared({ maxAttempts: 1 });
    if (when === "after_click") await authorize(s);
    await history(s, "sent");
    if (when === "before_click") await expect(authorize(s)).rejects.toMatchObject({ code: "23514" });
    else {
      await expect(authorize(s)).rejects.toMatchObject({ code: "23514" });
      await expect(begin(s)).rejects.toMatchObject({ code: "23514" });
    }
  });

  it("does not let the explicit click repair an expired or wrong worker lease", async () => {
    const s = await prepared(); await authorize(s);
    await expect(begin(s, randomUUID())).rejects.toMatchObject({ code: "42501" });
    await fixture.admin.query("update public.parent_jobs set lease_until=now()-interval '1 second' where id=$1", [s.job.jobId]);
    await expect(begin(s)).rejects.toMatchObject({ code: "42501" });
  });

  it("requires the final click even when the verified route has no personal acts", async () => {
    const s = await prepared({ acts: [] });
    await expect(begin(s)).rejects.toThrow(/parent must choose Submit/);
    await authorize(s);
    expect((await begin(s)).rows[0].operation.operationId).toBe(s.id);
    expect((await fixture.admin.query("select * from parent_private.personal_act_evidence where operation_id=$1", [s.id])).rows).toEqual([]);
  });

  it.each(["account_hold", "signature_expired"])("rechecks %s at dispatch without renewing the earlier Submit", async kind => {
    const s = await prepared(); await authorize(s); const before = await authorizations(s);
    if (kind === "account_hold") await fixture.admin.query("update public.parent_accounts set status='security_hold' where id=$1", [s.owner]);
    else await fixture.admin.query("update parent_private.personal_act_evidence set expires_at=now()-interval '1 second' where operation_id=$1 and act='signature'", [s.id]);
    await expect(begin(s)).rejects.toMatchObject({ code: "42501" });
    await expect(authorize(s)).rejects.toMatchObject({ code: "42501" });
    expect(await authorizations(s)).toEqual(before);
  });

  it("retains the exact Submit while a genuinely required act is renewed for the unchanged packet", async () => {
    const s = await prepared(); await authorize(s); const before = await authorizations(s);
    await fixture.admin.query("update parent_private.personal_act_evidence set expires_at=now()-interval '1 second' where operation_id=$1 and act='signature'", [s.id]);
    await expect(begin(s)).rejects.toMatchObject({ code: "42501" });
    await query("authenticated", "select public.parent_record_personal_act($1,'signature','synthetic-renewed-signature',now())", [s.id], s.verifier);
    expect((await begin(s)).rows[0].operation.operationId).toBe(s.id);
    expect(await authorizations(s)).toEqual(before);
  });

  it.each([
    ["snap_new", "snap-pa", "follow_up"], ["electricity", "peco-cap", "share"],
  ])("adds no routine final click for %s/%s/%s", async (need, program, action) => {
    const s = await prepared({ need, program, action });
    expect((await begin(s)).rows[0].operation.operationId).toBe(s.id);
    expect(await authorizations(s)).toEqual([]);
    await expect(authorize(s)).rejects.toMatchObject({ code: "42501" });
  });

  it.each([["snap_renewal", "snap-pa", "submit"], ["wic_new", "wic-pa", "share"]])(
    "rejects the unverified initial journey %s/%s/%s before preparing an operation",
    async (need, program, action) => {
      await expect(prepared({ need, program, action })).rejects.toMatchObject({ code: "42501" });
    },
  );

  it("cannot avoid the new-SNAP decision by switching to another compatible program", async () => {
    const s = await prepared({ program: "uesf-benefits" });
    await expect(begin(s)).rejects.toThrow(/parent must choose Submit/);
    await authorize(s);
    expect((await begin(s)).rows[0].operation.operationId).toBe(s.id);
  });

  it("cascades the private authorization with request retention without deleting the shared identity", async () => {
    const s = await prepared(); await authorize(s);
    await fixture.admin.query("delete from public.parent_requests where id=$1", [s.job.request.id]);
    expect(await authorizations(s)).toEqual([]);
    expect((await fixture.admin.query("select id from auth.users where id=$1", [s.owner])).rows).toHaveLength(1);
  });
});
