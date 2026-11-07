import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { SNAP_APPLICATION_NOTICE_VERSION } from "./constants";
import { fixtureIntake, fixtureMandate, fixtureSnapApplication } from "./test-fixtures";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
const directVersion = "pa600fs-direct-completion-2026-11-05.v1", legacyVersion = "pa600fs-final-content-2026-11-04.v1";
const acts = ["applicant_signature_printed_page_1", "rights_certification_printed_page_5"];
const bytes = Buffer.from("SYNTHETIC_NONPDF_ROUTE_AUTHORITY_ONLY"), digest = createHash("sha256").update(bytes).digest("hex");
type Scope = { owner: string; request: string; version: number; snapshot: string; hash: string; packet: string; acquisition: string; authorization: string; subjects: string[] };

describe.skipIf(!modulePath)("closed SNAP completion method/route authority (SQL logic only)", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>;
  const sessions = new Map<string, string>();
  beforeAll(async () => {
    fixture = await createParentSqlFixture(modulePath!);
    // Fake Vault and non-PDF bytes exercise authorization only, never real encryption/content/agency acceptance.
    for (const sql of ["create schema vault", "create schema extensions", "create table vault.secrets(id uuid primary key default gen_random_uuid(),secret text not null)",
      "create view vault.decrypted_secrets as select id,secret decrypted_secret from vault.secrets",
      "create function vault.create_secret(text) returns uuid language sql as $$insert into vault.secrets(secret) values($1) returning id$$",
      "create function extensions.gen_random_bytes(integer) returns bytea language sql as $$select decode(repeat('ab',$1),'hex')$$"]) await fixture.admin.query(sql);
  });
  afterAll(async () => { await fixture?.admin.end(); });
  async function tx<T>(run: () => Promise<T>) {
    await fixture.admin.query("begin");
    try { const result = await run(); await fixture.admin.query("commit"); return result; }
    catch (error) { await fixture.admin.query("rollback"); throw error; }
  }
  async function role(actor: string, sql: string, values: unknown[] = [], owner?: string) {
    await fixture.admin.query("savepoint actor_call");
    try {
      await fixture.admin.query(`set local role ${actor}`);
      await fixture.admin.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role: actor, sub: owner, session_id: owner && sessions.get(owner), amr: [{ method: "otp" }] })]);
      const result = await fixture.admin.query(sql, values); await fixture.admin.query("reset role"); await fixture.admin.query("release savepoint actor_call"); return result;
    } catch (error) { await fixture.admin.query("rollback to savepoint actor_call"); await fixture.admin.query("release savepoint actor_call"); throw error; }
  }
  const call = (actor: string, sql: string, values: unknown[] = [], owner?: string) => tx(() => role(actor, sql, values, owner));
  const parent = (s: Scope, sql: string, values: unknown[] = []) => call("authenticated", sql, values, s.owner);
  const verified = async (version: string | null) => (await fixture.admin.query("select parent_private.snap_protected_route_verified($1) value", [version])).rows[0].value;
  async function capability(direct = true) {
    // An explicit test-only provider decision, not evidence that Pennsylvania accepts this method.
    await fixture.admin.query(`insert into parent_private.provider_capabilities(program_id,action,enabled,transport_verified,requires_form,permission_version,permission_reference,
      allowed_fields,field_categories,required_acts,verified_until,snap_direct_completion_version,snap_direct_completion_evidence_reference)
      values('snap-pa','submit',true,true,true,'synthetic-route-v1','synthetic provider-route fixture only',array['protectedSnapPacket','incomeAmount'],
        '{"protectedSnapPacket":"household","incomeAmount":"income"}',$1,clock_timestamp()+interval '1 hour',$2,$3)
      on conflict(program_id,action) do update set enabled=true,transport_verified=true,requires_form=true,permission_version=excluded.permission_version,
        permission_reference=excluded.permission_reference,allowed_fields=excluded.allowed_fields,field_categories=excluded.field_categories,required_acts=excluded.required_acts,
        verified_until=excluded.verified_until,snap_direct_completion_version=excluded.snap_direct_completion_version,snap_direct_completion_evidence_reference=excluded.snap_direct_completion_evidence_reference`,
    [acts, direct ? directVersion : null, direct ? "synthetic method decision only; no provider acceptance" : null]);
  }
  async function setup(): Promise<Scope> {
    await capability(); const owner = randomUUID(), session = randomUUID(); sessions.set(owner, session);
    await fixture.admin.query(`update parent_private.processing_controls set enabled=true,approval_reference='synthetic route fixture only',approved_until=clock_timestamp()+interval '1 day',
      snap_details_enabled=true,snap_details_approval_reference='synthetic only',snap_details_approved_until=clock_timestamp()+interval '1 day',snap_details_notice_version=$1,
      snap_protected_enabled=true,snap_protected_approval_reference='synthetic only; no publication',snap_protected_approved_until=clock_timestamp()+interval '1 day',
      snap_protected_policy_version='synthetic-policy-1',snap_protected_retention_policy_version='synthetic-retention-1',snap_protected_max_retention_seconds=300`, [SNAP_APPLICATION_NOTICE_VERSION]);
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [owner, `${owner}@example.invalid`]);
    await fixture.admin.query("insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),clock_timestamp()+interval '1 hour')", [session, owner]);
    const s = { owner } as Scope;
    const request = (await parent(s, "select public.parent_start_request($1,$2,$3) id", [JSON.stringify(fixtureIntake({ needs: ["snap_new"], utilityProviders: [] })), JSON.stringify(fixtureMandate({ recipientIds: ["snap-pa"] })), randomUUID()])).rows[0].id as string;
    const details = fixtureSnapApplication(new Date()), snapshot = (await parent(s, "select public.parent_save_snap_application_details($1,1,$2,$3,$4) id", [request, JSON.stringify(details), SNAP_APPLICATION_NOTICE_VERSION, randomUUID()])).rows[0].id as string;
    const version = (await fixture.admin.query("select version from public.parent_requests where id=$1", [request])).rows[0].version as number;
    const hash = (await fixture.admin.query("select parent_private.snap_application_binding($1,$2)->>'snapshotHash' hash", [request, version])).rows[0].hash as string;
    return { owner, request, version, snapshot, hash, packet: randomUUID(), acquisition: randomUUID(), authorization: "", subjects: details.household!.filter(p => p.requestingSnap).map(p => p.id) };
  }
  const acquire = (s: Scope) => parent(s, "select public.parent_authorize_snap_direct_acquisition($1,$2,$3,$4,$5,'synthetic-policy-1','synthetic-retention-1',$6,true,date_trunc('milliseconds',clock_timestamp()+interval '4 minutes')) value", [s.request, s.version, s.snapshot, s.hash, s.acquisition, s.subjects]);
  async function authorize(s: Scope, direct = true) {
    if (direct) await acquire(s);
    const result = direct
      ? await parent(s, "select public.parent_authorize_snap_direct_packet($1,$2,$3,$4,$5,$6,$7,$8) value", [s.request, s.version, s.snapshot, s.hash, s.packet, digest, bytes.length, s.acquisition])
      : await parent(s, "select public.parent_authorize_snap_final_packet($1,$2,$3,$4,$5,$6,$7,'synthetic-policy-1','synthetic-retention-1',$8,true) value", [s.request, s.version, s.snapshot, s.hash, s.packet, digest, bytes.length, s.subjects]);
    s.authorization = result.rows[0].value.intent.authorizationId;
  }
  const tuple = (s: Scope) => [s.packet, s.request, s.version, s.authorization];
  async function stage(s: Scope, direct = true) {
    return tx(async () => {
      await role("parent_snap_finalizer", "select parent_private.parent_begin_snap_final_packet($1,$2,$3,$4,$5,$6,$7,$8)", [s.authorization, s.request, s.version, s.snapshot, s.hash, digest, bytes.length, s.packet]);
      await role("parent_snap_finalizer", "select parent_private.parent_seal_snap_final_packet($1,$2,$3,$4,decode(repeat('ab',12),'hex'),decode(repeat('ab',16),'hex'),decode(repeat('ab',$5),'hex'))", [...tuple(s), bytes.length]);
      if (direct) return (await role("parent_snap_finalizer", "select parent_private.parent_record_snap_direct_construction($1,$2,$3,$4) value", tuple(s))).rows[0].value;
      return (await fixture.admin.query(`insert into parent_private.snap_final_packet_verifications(packet_id,snapshot_id,snapshot_hash,content_sha256,validator_version,source,baseline_certification_regions,required_personal_acts,verified_at,expires_at)
        select p.id,p.snapshot_id,p.snapshot_hash,p.content_sha256,$2,s.source,$3,$3,clock_timestamp(),p.expires_at from parent_private.snap_final_packets p join public.parent_snap_application_details s on s.id=p.snapshot_id where p.id=$1 returning id`, [s.packet, legacyVersion, acts])).rows[0];
    });
  }
  const prepare = (s: Scope, verificationId: string) => call("parent_snap_finalizer", "select parent_private.parent_prepare_snap_final_operation($1,$2,$3,$4,$5) id", [...tuple(s), verificationId]);
  async function submit(s: Scope, operationId: string, completed: string[] = acts, owner = s.owner) {
    const operation = (await fixture.admin.query("select packet_hash from public.parent_operations where id=$1", [operationId])).rows[0];
    return call("authenticated", "select public.parent_authorize_snap_protected_submission($1,$2,$3,$4,$5,$6,$7)", [s.request, operationId, s.version, operation.packet_hash, s.packet, digest, completed], owner);
  }
  const noActsOrSubmit = async (s: Scope) => (await fixture.admin.query(`select (select count(*)::int from parent_private.personal_act_evidence e join public.parent_operations o on o.id=e.operation_id where o.request_id=$1) acts,
    (select count(*)::int from parent_private.snap_submission_authorizations e join public.parent_operations o on o.id=e.operation_id where o.request_id=$1) submits`, [s.request])).rows[0];

  it("starts with no provider decision and all protected policies disabled/NULL", async () => {
    expect(await verified(directVersion)).toBe(false); expect(await verified(legacyVersion)).toBe(false);
    expect((await fixture.admin.query("select count(*)::int n from parent_private.provider_capabilities where snap_direct_completion_version is not null or snap_direct_completion_evidence_reference is not null")).rows[0].n).toBe(0);
    expect((await fixture.admin.query("select snap_protected_enabled,snap_protected_policy_version,snap_protected_retention_policy_version from parent_private.processing_controls")).rows[0]).toEqual({ snap_protected_enabled: false, snap_protected_policy_version: null, snap_protected_retention_policy_version: null });
  });
  it.each([null, "", "invented-validator"])("rejects unsupported method %s even with a synthetic verified capability", async method => {
    await capability(); expect(await verified(method)).toBe(false);
  });
  it.each(["snap_direct_completion_version=null", "snap_direct_completion_evidence_reference=null", "snap_direct_completion_version='invented'", "snap_direct_completion_evidence_reference=' '", "snap_direct_completion_evidence_reference=repeat('x',2001)"])("requires an exact paired method/evidence record: %s", async assignment => {
    await capability(); await expect(fixture.admin.query(`update parent_private.provider_capabilities set ${assignment} where program_id='snap-pa' and action='submit'`)).rejects.toMatchObject({ code: "23514" }); expect(await verified(directVersion)).toBe(true);
  });
  it.each([["snap-pa", "follow_up"], ["wic-pa", "submit"]])("does not put a direct SNAP method on %s/%s", async (program, action) => {
    await expect(fixture.admin.query(`insert into parent_private.provider_capabilities(program_id,action,permission_version,permission_reference,verified_until,snap_direct_completion_version,snap_direct_completion_evidence_reference)
      values($1,$2,'synthetic','synthetic',now()+interval '1 hour',$3,'synthetic method')`, [program, action, directVersion])).rejects.toMatchObject({ code: "23514" });
  });
  it.each(["enabled=false", "transport_verified=false", "requires_form=false", "verified_until=clock_timestamp()-interval '1 second'", "permission_version=' '", "permission_reference=' '", "allowed_fields='{}'", "field_categories='{}'", "required_acts=null", "required_acts=array['invalid act']", "required_acts=array['same','same']"])("blocks acquisition for an unavailable provider route: %s", async assignment => {
    const s = await setup(); await fixture.admin.query(`update parent_private.provider_capabilities set ${assignment} where program_id='snap-pa' and action='submit'`);
    expect(await verified(directVersion)).toBe(false); expect(await verified(legacyVersion)).toBe(false);
    await expect(acquire(s)).rejects.toMatchObject({ code: "42501", message: "protected SNAP route unavailable" });
    await expect(parent(s, "select public.parent_get_snap_direct_acquisition($1,$2,$3,$4)", [s.request, s.version, s.snapshot, s.hash])).rejects.toMatchObject({ code: "42501" });
  });
  it("does not inherit accepted touchscreen input from generic paper/fax permission", async () => {
    const s = await setup(); await capability(false); expect(await verified(legacyVersion)).toBe(true); expect(await verified(directVersion)).toBe(false);
    await expect(acquire(s)).rejects.toMatchObject({ code: "42501" }); await authorize(s, false); await stage(s, false);
  });
  it("requires direct source-baseline acts but preserves the legacy source-baseline fallback", async () => {
    const s = await setup(); await fixture.admin.query("update parent_private.provider_capabilities set required_acts='{}' where program_id='snap-pa' and action='submit'");
    expect(await verified(directVersion)).toBe(false); expect(await verified(legacyVersion)).toBe(true); await expect(acquire(s)).rejects.toMatchObject({ code: "42501" });
    await authorize(s, false); const receipt = await stage(s, false), id = (await prepare(s, receipt.id)).rows[0].id as string;
    await expect(submit(s, id, [])).rejects.toMatchObject({ code: "23514" }); expect(await noActsOrSubmit(s)).toEqual({ acts: 0, submits: 0 });
    await submit(s, id); expect(await noActsOrSubmit(s)).toEqual({ acts: 2, submits: 1 });
  });
  it.each(["snap_protected_enabled=false", "snap_protected_policy_version=null", "snap_protected_retention_policy_version=null", "snap_protected_max_retention_seconds=null", "snap_details_enabled=false", "enabled=false"])("never lets method acceptance override privacy/source authority: %s", async assignment => {
    const s = await setup(); await fixture.admin.query(`update parent_private.processing_controls set ${assignment}`); await expect(acquire(s)).rejects.toMatchObject({ code: "42501" });
  });
  it("still requires genuine explicit parent Submit and exact personal reports after direct construction", async () => {
    const s = await setup(); await authorize(s); const receipt = await stage(s), operation = (await prepare(s, receipt.verificationId)).rows[0].id as string;
    expect(await noActsOrSubmit(s)).toEqual({ acts: 0, submits: 0 });
    await expect(submit(s, operation, [])).rejects.toMatchObject({ code: "23514" }); await expect(submit(s, operation, acts, randomUUID())).rejects.toMatchObject({ code: "42501" });
    expect(await noActsOrSubmit(s)).toEqual({ acts: 0, submits: 0 }); await submit(s, operation); expect(await noActsOrSubmit(s)).toEqual({ acts: 2, submits: 1 });
    expect((await fixture.admin.query("select bool_and(e.attribution='parent_reported' and e.reference='parent-submit:'||o.id::text and e.protected_packet_id=$1 and e.protected_content_sha256=$2) honest from parent_private.personal_act_evidence e join public.parent_operations o on o.id=e.operation_id where o.id=$3", [s.packet, digest, operation])).rows[0].honest).toBe(true);
  });
  it("does not use an unlinked binary packet with a privileged forged direct receipt", async () => {
    const s = await setup(); await authorize(s, false); const receipt = await stage(s, false);
    await fixture.admin.query("delete from parent_private.snap_final_packet_verifications where id=$1", [receipt.id]);
    await fixture.admin.query(`insert into parent_private.snap_final_packet_verifications(packet_id,snapshot_id,snapshot_hash,content_sha256,validator_version,source,baseline_certification_regions,required_personal_acts,verified_at,expires_at)
      select p.id,p.snapshot_id,p.snapshot_hash,p.content_sha256,$2,s.source,$3,$3,clock_timestamp(),p.expires_at from parent_private.snap_final_packets p join public.parent_snap_application_details s on s.id=p.snapshot_id where p.id=$1`, [s.packet, directVersion, acts]);
    const verification = (await fixture.admin.query("select id from parent_private.snap_final_packet_verifications where packet_id=$1", [s.packet])).rows[0].id as string;
    await expect(prepare(s, verification)).rejects.toMatchObject({ code: "42501" });
  });
  it("blocks generic binary metadata/key access when the actual route becomes unavailable", async () => {
    const s = await setup(); await authorize(s, false); await stage(s, false); await fixture.admin.query("update parent_private.provider_capabilities set transport_verified=false where program_id='snap-pa' and action='submit'");
    await expect(parent(s, "select public.parent_get_snap_final_packet_authorization($1,$2,$3)", [s.request, s.packet, s.version])).rejects.toMatchObject({ code: "42501" });
    await expect(call("parent_snap_finalizer", "select parent_private.parent_read_snap_final_packet($1,$2,$3,$4,$5,$6)", [...tuple(s), s.snapshot, s.hash])).rejects.toMatchObject({ code: "42501" });
  });
  it("rolls key/packet creation back when provider access closes between begin and seal", async () => {
    const s = await setup(); await authorize(s);
    const counts = async () => (await fixture.admin.query("select (select count(*) from vault.secrets) keys,(select count(*) from parent_private.snap_final_packets) packets")).rows[0];
    const before = await counts();
    await expect(tx(async () => {
      await role("parent_snap_finalizer", "select parent_private.parent_begin_snap_final_packet($1,$2,$3,$4,$5,$6,$7,$8)", [s.authorization, s.request, s.version, s.snapshot, s.hash, digest, bytes.length, s.packet]);
      await fixture.admin.query("update parent_private.provider_capabilities set transport_verified=false where program_id='snap-pa' and action='submit'");
      await expect(role("parent_snap_finalizer", "select parent_private.parent_seal_snap_final_packet($1,$2,$3,$4,decode(repeat('ab',12),'hex'),decode(repeat('ab',16),'hex'),decode(repeat('ab',$5),'hex'))", [...tuple(s), bytes.length])).rejects.toMatchObject({ code: "42501" });
      throw new Error("synthetic rollback after route closure");
    })).rejects.toThrow("synthetic rollback after route closure");
    expect(await counts()).toEqual(before);
  });
  it("does not turn an additional required act into a parent-reported baseline act", async () => {
    const s = await setup(); await authorize(s); const receipt = await stage(s);
    await fixture.admin.query("update parent_private.provider_capabilities set required_acts=required_acts||'additional_required_personal_act'::text where program_id='snap-pa' and action='submit'");
    const operation = (await prepare(s, receipt.verificationId)).rows[0].id as string;
    await expect(submit(s, operation)).rejects.toMatchObject({ code: "42501" }); expect(await noActsOrSubmit(s)).toEqual({ acts: 0, submits: 0 });
  });
  it("keeps withdrawal possible after provider and all processing gates close", async () => {
    const s = await setup(); await authorize(s); await fixture.admin.query("update parent_private.provider_capabilities set enabled=false where program_id='snap-pa' and action='submit'");
    await fixture.admin.query("update parent_private.processing_controls set enabled=false,snap_details_enabled=false,snap_protected_enabled=false,snap_protected_policy_version=null,snap_protected_retention_policy_version=null");
    await parent(s, "select public.parent_revoke_snap_direct_acquisition($1,$2)", [s.request, s.acquisition]);
    expect((await fixture.admin.query("select bool_and(revoked_at is not null) revoked from parent_private.snap_final_packet_authorizations where request_id=$1", [s.request])).rows[0].revoked).toBe(true);
  });
  it.each(["authenticated", "anon", "service_role", "parent_worker", "parent_storage_broker", "parent_retention_worker", "parent_snap_finalizer"])("does not grant method-evidence writes or predicate execution to %s", async actor => {
    await expect(call(actor, "select parent_private.snap_protected_route_verified($1)", [directVersion])).rejects.toMatchObject({ code: "42501" });
    await expect(call(actor, "update parent_private.provider_capabilities set snap_direct_completion_version=$1", [directVersion])).rejects.toMatchObject({ code: "42501" });
  });
  describe("continuation-only worker claims", () => {
    const park = () => fixture.admin.query("update public.parent_jobs set state='waiting',run_at='infinity',lease_token=null,lease_until=null");
    async function ready(authorized = true) {
      const scope = await setup(); await authorize(scope); const receipt = await stage(scope);
      const operationId = (await prepare(scope, receipt.verificationId)).rows[0].id as string;
      if (authorized) await submit(scope, operationId);
      return { ...scope, operationId };
    }
    const claim = () => call("parent_worker", "select parent_private.parent_claim_job(300,true) job");
    it("claims exact authorized SNAP work without consuming an older unrelated job", async () => {
      await park(); const unrelated = await setup(), current = await ready();
      await fixture.admin.query("update public.parent_jobs set run_at=now()-interval '1 hour' where request_id=$1", [unrelated.request]);
      const before = (await fixture.admin.query("select state,attempts,run_at from public.parent_jobs where request_id=$1", [unrelated.request])).rows[0];
      expect((await claim()).rows[0].job.request.id).toBe(current.request);
      expect((await fixture.admin.query("select state,attempts,run_at from public.parent_jobs where request_id=$1", [unrelated.request])).rows[0]).toEqual(before);
    });
    it("leaves new unplanned work queued and preserves the original one-argument claim", async () => {
      await park(); const scope = await setup();
      expect((await claim()).rows[0].job).toBeNull();
      expect((await fixture.admin.query("select state,attempts from public.parent_jobs where request_id=$1", [scope.request])).rows[0]).toEqual({ state: "queued", attempts: 0 });
      expect((await call("parent_worker", "select parent_private.parent_claim_job(300) job")).rows[0].job.request.id).toBe(scope.request);
    });
    it.each(["missing Submit", "provider closed", "personal act expired", "mandate revoked"])("does not claim prepared work with %s", async missing => {
      await park(); const scope = await ready(missing !== "missing Submit");
      if (missing === "provider closed") await fixture.admin.query("update parent_private.provider_capabilities set enabled=false where program_id='snap-pa' and action='submit'");
      if (missing === "personal act expired") await fixture.admin.query("update parent_private.personal_act_evidence set expires_at=now()-interval '1 second' where operation_id=$1", [scope.operationId]);
      if (missing === "mandate revoked") await fixture.admin.query("update public.parent_requests set mandate_revoked_at=now() where id=$1", [scope.request]);
      expect((await claim()).rows[0].job).toBeNull();
      expect((await fixture.admin.query("select attempts from public.parent_jobs where request_id=$1", [scope.request])).rows[0].attempts).toBe(0);
    });
    it("claims an expired executing protected attempt for reconciliation and never starts it again", async () => {
      await park(); const scope = await ready(), first = (await call("parent_worker", "select parent_private.parent_claim_job(300) job")).rows[0].job;
      await call("parent_worker", "select parent_private.parent_begin_operation($1,$2,$3)", [scope.operationId, first.jobId, first.leaseToken]);
      await fixture.admin.query("update public.parent_jobs set lease_until=now()-interval '1 second' where id=$1", [first.jobId]);
      const next = (await claim()).rows[0].job;
      expect(next.request.id).toBe(scope.request); expect(next.unknownOperations).toContainEqual(expect.objectContaining({ id: scope.operationId, state: "delivery_unknown" }));
      expect((await fixture.admin.query("select state from public.parent_operations where id=$1", [scope.operationId])).rows[0].state).toBe("delivery_unknown");
    });
    it("rejects a NULL continuation mode", async () => { await expect(call("parent_worker", "select parent_private.parent_claim_job(300,null)")).rejects.toMatchObject({ code: "23514" }); });
    it.each(["anon", "authenticated", "service_role", "parent_storage_broker", "parent_retention_worker", "parent_snap_finalizer"])("does not grant the continuation claim to %s", async actor => {
      await expect(call(actor, "select parent_private.parent_claim_job(300,true)")).rejects.toMatchObject({ code: "42501" });
    });
  });

});
