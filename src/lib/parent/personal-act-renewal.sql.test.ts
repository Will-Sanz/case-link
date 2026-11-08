import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
const permission = "synthetic-personal-act-v1";

describe.skipIf(!modulePath)("genuine exact-packet personal-act renewal", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>;
  const owner = randomUUID(), verifier = randomUUID(), unscoped = randomUUID();
  const sessions = new Map([owner, verifier, unscoped].map((id) => [id, randomUUID()]));
  type Job = { jobId: string; leaseToken: string; request: { id: string; version: number } };

  async function query(role: "authenticated" | "parent_worker", sql: string, values: unknown[] = [], user = owner) {
    await fixture.admin.query(`set role ${role}`);
    try {
      await fixture.admin.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify(role === "authenticated"
          ? { sub: user, session_id: sessions.get(user), role, amr: [{ method: "otp" }] }
          : { role }),
      ]);
      return await fixture.admin.query(sql, values);
    } finally {
      await fixture.admin.query("reset role");
    }
  }

  beforeAll(async () => {
    fixture = await createParentSqlFixture(modulePath!);
    await fixture.admin.query(
      "update parent_private.processing_controls set enabled=true,approval_reference='isolated synthetic personal-act renewal test',approved_until=now()+interval '1 day'",
    );
    for (const user of [owner, verifier, unscoped]) {
      await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [user, `${user}@example.invalid`]);
      await fixture.admin.query("insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')", [sessions.get(user), user]);
    }
    await fixture.admin.query(
      "insert into parent_private.provider_capabilities(program_id,action,enabled,transport_verified,requires_form,permission_version,permission_reference,allowed_fields,field_categories,required_acts,verified_until) values('peco-cap','share',true,true,false,$1,'isolated synthetic fixture',array['householdSize'],'{\"householdSize\":\"household\"}',array['identity'],now()+interval '1 day')",
      [permission],
    );
  });
  afterAll(async () => { await fixture?.admin.end(); });

  async function claim(): Promise<Job> {
    return (await query("parent_worker", "select parent_private.parent_claim_job(120) job")).rows[0].job;
  }

  async function prepared(withForm = false) {
    const active = await query("authenticated", "select id from public.parent_requests where status in ('active','paused')");
    for (const row of active.rows)
      await query("authenticated", "select public.parent_control_request($1,'cancel')", [row.id]);
    await fixture.admin.query("update parent_private.provider_capabilities set enabled=true,transport_verified=true,requires_form=$2,required_acts=array['identity'],permission_version=$1,verified_until=now()+interval '1 day' where program_id='peco-cap' and action='share'", [permission, withForm]);
    await query("authenticated", "select public.parent_start_request($1,$2,$3)", [
      JSON.stringify(fixtureIntake({ needs: ["electricity"] })),
      JSON.stringify(fixtureMandate({ recipientIds: ["peco-cap"], expiresAt: new Date(Date.now() + 86400000).toISOString() })),
      randomUUID(),
    ]);
    const job = await claim();
    let artifact: string | null = null;
    const template = `synthetic-${randomUUID()}`;
    if (withForm) {
      await fixture.admin.query("insert into parent_private.form_templates(id,version,program_id,needs,content_sha256,object_path,field_map,required_acts,source_url,verified_until,active) values($1,'1','peco-cap',array['electricity'],$2,$3,'{\"Size\":\"householdSize\"}',array['identity'],'https://example.invalid/synthetic-form',now()+interval '1 day',true)", [template, "a".repeat(64), `${template}.pdf`]);
      const registered = (await query("parent_worker", "select parent_private.parent_register_form_artifact($1,$2,'peco-cap',$3,'1','{\"householdSize\":3}',$4,'electricity') artifact", [job.jobId, job.leaseToken, template, "b".repeat(64)])).rows[0].artifact;
      artifact = registered.id;
      await fixture.admin.query("insert into storage.objects(bucket_id,name,metadata) values('parent-form-artifacts',$1,'{\"size\":1,\"mimetype\":\"application/pdf\"}')", [registered.object_path]);
      await query("parent_worker", "select parent_private.parent_confirm_form_artifact($1,$2,$3,$4)", [job.jobId, job.leaseToken, artifact, "b".repeat(64)]);
    }
    const id = (await query("parent_worker",
      "select parent_private.parent_prepare_operation($1,$2,1,'peco-cap','share','{\"householdSize\":3}',array['household'],array[]::uuid[],$3,'electricity',$4) id",
      [job.jobId, job.leaseToken, randomUUID(), artifact],
    )).rows[0].id as string;
    await fixture.admin.query(
      "insert into parent_private.trusted_memberships(user_id,request_id,operation_id,program_id,role,allowed_fields,can_verify_personal_acts,purpose,permission_reference,expires_at) values($1,$2,$3,'peco-cap','partner',array['householdSize'],true,'Synthetic exact-packet verification','synthetic verifier authority',now()+interval '1 hour')",
      [verifier, job.request.id, id],
    );
    return { job, id, template };
  }

  function record(id: string, reference: string | null, observedAt?: string | null, user = verifier, act = "identity") {
    return query("authenticated",
      "select public.parent_record_personal_act($1,$2,$3," + (observedAt === undefined ? "now()" : "$4::timestamptz") + ")",
      observedAt === undefined ? [id, act, reference] : [id, act, reference, observedAt], user,
    );
  }

  async function evidence(id: string) {
    return (await fixture.admin.query(
      "select reference,verified_at::text observed,expires_at::text expires,verified_by from parent_private.personal_act_evidence where operation_id=$1 order by verified_at,reference",
      [id],
    )).rows;
  }

  async function waiting(job: Job) {
    await fixture.admin.query("update public.parent_jobs set state='waiting',run_at='infinity',lease_token=null,lease_until=null where id=$1", [job.jobId]);
  }

  function begin(job: Job, id: string) {
    return query("parent_worker", "select parent_private.parent_begin_operation($1,$2,$3) operation", [id, job.jobId, job.leaseToken]);
  }

  it("retains expired provenance and resumes the unchanged packet after a genuinely newer verification", async () => {
    const { job, id } = await prepared();
    await record(id, "synthetic-original");
    await fixture.admin.query("update parent_private.personal_act_evidence set expires_at=now()-interval '1 second' where operation_id=$1", [id]);
    const before = await evidence(id);
    expect((await query("parent_worker", "select parent_private.parent_get_operations($1,$2) operations", [job.jobId, job.leaseToken])).rows[0].operations[0].personalActsComplete).toBe(false);
    await waiting(job);
    await record(id, "synthetic-renewed");
    const resumed = await claim();
    expect(resumed.request.id).toBe(job.request.id);
    expect((await query("parent_worker", "select parent_private.parent_get_operations($1,$2) operations", [resumed.jobId, resumed.leaseToken])).rows[0].operations[0].personalActsComplete).toBe(true);
    const after = await evidence(id);
    expect(after).toHaveLength(2);
    expect(after[0]).toEqual(before[0]);
    expect(after[1].reference).toBe("synthetic-renewed");
    expect(Date.parse(after[1].observed)).toBeGreaterThan(Date.parse(before[0].observed));
    expect(after[1].verified_by).toBe(verifier);
    const events = (await fixture.admin.query("select count(*)::integer count from public.parent_events where request_id=$1 and kind='personal_act.verified'", [job.request.id])).rows[0].count;
    await record(id, "synthetic-original", before[0].observed);
    expect(await evidence(id)).toEqual(after);
    expect((await fixture.admin.query("select count(*)::integer count from public.parent_events where request_id=$1 and kind='personal_act.verified'", [job.request.id])).rows[0].count).toBe(events);
    expect((await begin(resumed, id)).rows[0].operation.packet).toEqual({ householdSize: 3 });
  });

  it.each(["current", "expired"])("treats an exact %s retry as a no-op without refreshing expiry, queue or audit", async (state) => {
    const { job, id } = await prepared();
    await record(id, "synthetic-exact-retry");
    if (state === "expired")
      await fixture.admin.query("update parent_private.personal_act_evidence set expires_at=now()-interval '1 second' where operation_id=$1", [id]);
    const before = await evidence(id);
    await waiting(job);
    const events = (await fixture.admin.query("select count(*)::integer count from public.parent_events where request_id=$1 and kind='personal_act.verified'", [job.request.id])).rows[0].count;
    await record(id, "synthetic-exact-retry", before[0].observed);
    expect(await evidence(id)).toEqual(before);
    expect((await fixture.admin.query("select state from public.parent_jobs where id=$1", [job.jobId])).rows[0].state).toBe("waiting");
    expect((await fixture.admin.query("select count(*)::integer count from public.parent_events where request_id=$1 and kind='personal_act.verified'", [job.request.id])).rows[0].count).toBe(events);
  });

  it.each(["reused_reference", "same_observed_time", "older_observed_time"])("rejects %s instead of presenting it as new verification", async (state) => {
    const { id } = await prepared();
    await record(id, "synthetic-first");
    const before = await evidence(id);
    const older = (await fixture.admin.query("select created_at::text observed from public.parent_operations where id=$1", [id])).rows[0].observed;
    await expect(record(id, state === "reused_reference" ? "synthetic-first" : "synthetic-new",
      state === "reused_reference" ? undefined : state === "same_observed_time" ? before[0].observed : older))
      .rejects.toThrow();
    expect(await evidence(id)).toEqual(before);
  });

  it("anchors the validity deadline to the observed act rather than its later recording time", async () => {
    const { id } = await prepared();
    await fixture.admin.query("update parent_private.trusted_memberships set expires_at=now()+interval '2 days' where operation_id=$1", [id]);
    const observed = (await fixture.admin.query("select created_at::text observed from public.parent_operations where id=$1", [id])).rows[0].observed;
    await record(id, "synthetic-observed-deadline", observed);
    expect((await fixture.admin.query("select expires_at=verified_at+interval '24 hours' anchored from parent_private.personal_act_evidence where operation_id=$1", [id])).rows[0].anchored).toBe(true);
  });

  it("caps evidence at the current verifier membership deadline", async () => {
    const { id } = await prepared();
    await record(id, "synthetic-membership-deadline");
    expect((await fixture.admin.query("select e.expires_at=m.expires_at capped from parent_private.personal_act_evidence e join parent_private.trusted_memberships m on m.operation_id=e.operation_id and m.user_id=e.verified_by where e.operation_id=$1", [id])).rows[0].capped).toBe(true);
  });

  it.each(["parent", "unscoped", "expired_membership", "inactive_membership", "changed_permission", "disabled_provider", "unrequired_act", "cancelled", "changed_version", "stale_packet_source"])(
    "denies %s verification rather than widening exact-packet authority", async (state) => {
      const { job, id } = await prepared();
      if (state === "expired_membership") await fixture.admin.query("update parent_private.trusted_memberships set expires_at=now()-interval '1 second' where operation_id=$1", [id]);
      if (state === "inactive_membership") await fixture.admin.query("update parent_private.trusted_memberships set active=false where operation_id=$1", [id]);
      if (state === "changed_permission") await fixture.admin.query("update parent_private.provider_capabilities set permission_version='synthetic-new-version' where program_id='peco-cap' and action='share'");
      if (state === "disabled_provider") await fixture.admin.query("update parent_private.provider_capabilities set enabled=false where program_id='peco-cap' and action='share'");
      if (state === "unrequired_act") await fixture.admin.query("update parent_private.provider_capabilities set required_acts='{}' where program_id='peco-cap' and action='share'");
      if (state === "stale_packet_source") await fixture.admin.query("update public.parent_requests set intake_confirmed_at=jsonb_set(intake_confirmed_at,'{householdSize}','\"2026-01-01T00:00:00Z\"') where id=$1", [job.request.id]);
      if (state === "cancelled") await query("authenticated", "select public.parent_control_request($1,'cancel')", [job.request.id]);
      if (state === "changed_version") {
        const mandate = (await query("authenticated", "select mandate from public.parent_requests where id=$1", [job.request.id])).rows[0].mandate;
        await query("authenticated", "select public.parent_replace_mandate($1,$2,1)", [job.request.id, JSON.stringify(mandate)]);
      }
      await expect(record(id, "synthetic-denied", undefined, state === "parent" ? owner : state === "unscoped" ? unscoped : verifier))
        .rejects.toMatchObject({ code: "42501" });
      expect(await evidence(id)).toEqual([]);
    },
  );

  it.each(["retired", "expired"])("does not verify a personal act for an %s form template", async (state) => {
    const { id, template } = await prepared(true);
    if (state === "retired") await fixture.admin.query("update parent_private.form_templates set active=false where id=$1", [template]);
    else await fixture.admin.query("update parent_private.form_templates set verified_until=now()-interval '1 second' where id=$1", [template]);
    await expect(record(id, "synthetic-unusable-form")).rejects.toMatchObject({ code: "42501" });
    expect(await evidence(id)).toEqual([]);
  });

  it("denies verification while parent processing is closed", async () => {
    const { id } = await prepared();
    await fixture.admin.query("update parent_private.processing_controls set enabled=false");
    try {
      await expect(record(id, "synthetic-closed-processing")).rejects.toMatchObject({ code: "42501" });
      expect(await evidence(id)).toEqual([]);
    } finally {
      await fixture.admin.query("update parent_private.processing_controls set enabled=true");
    }
  });

  it("keeps evidence storage private from direct parent and worker writes", async () => {
    const { id } = await prepared();
    for (const role of ["authenticated", "parent_worker"] as const)
      await expect(query(role, "insert into parent_private.personal_act_evidence(operation_id,act,packet_hash,reference,verified_at,expires_at) select id,'identity',packet_hash,'synthetic-forged',now(),now()+interval '1 hour' from public.parent_operations where id=$1", [id]))
        .rejects.toMatchObject({ code: "42501" });
    expect(await evidence(id)).toEqual([]);
  });

  it("cascades retained verification history when its synthetic request is deleted", async () => {
    const { job, id } = await prepared();
    await record(id, "synthetic-history-first");
    await fixture.admin.query("update parent_private.personal_act_evidence set expires_at=now()-interval '1 second' where operation_id=$1", [id]);
    await record(id, "synthetic-history-new");
    expect(await evidence(id)).toHaveLength(2);
    await fixture.admin.query("delete from public.parent_requests where id=$1", [job.request.id]);
    expect(await evidence(id)).toEqual([]);
  });

  it("does not append verification after the operation has begun execution", async () => {
    const { job, id } = await prepared();
    await record(id, "synthetic-before-execution");
    await begin(job, id);
    const before = await evidence(id);
    await expect(record(id, "synthetic-after-execution")).rejects.toMatchObject({ code: "42501" });
    expect(await evidence(id)).toEqual(before);
  });

  it.each(["null_observed", "future_observed", "null_reference", "unsupported_act"])("rejects %s before storing evidence", async (state) => {
    const { id } = await prepared();
    const future = (await fixture.admin.query("select (now()+interval '1 second')::text observed")).rows[0].observed;
    await expect(record(id, state === "null_reference" ? null : "synthetic-malformed",
      state === "null_observed" ? null : state === "future_observed" ? future : undefined,
      verifier, state === "unsupported_act" ? "not-an-authorized-act" : "identity"))
      .rejects.toThrow();
    expect(await evidence(id)).toEqual([]);
  });
});
