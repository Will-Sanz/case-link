import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import type { ServiceMandate, SupportNeed } from "./domain";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;

describe.skipIf(!modulePath)("exact operation purpose against PostgreSQL migrations", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>;
  const owner = randomUUID(),
    session = randomUUID();
  const packet = { householdSize: 3 };
  const permission = "synthetic-purpose-test";
  type Job = { jobId: string; leaseToken: string; requestId: string };

  async function asRole(
    role: "authenticated" | "parent_worker",
    sql: string,
    values: unknown[] = [],
  ) {
    const db = fixture.admin;
    await db.query(`set role ${role}`);
    try {
      await db.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify(
          role === "authenticated"
            ? { sub: owner, session_id: session, role, amr: [{ method: "otp" }] }
            : { role },
        ),
      ]);
      return await db.query(sql, values);
    } finally {
      await db.query("reset role");
    }
  }

  beforeAll(async () => {
    fixture = await createParentSqlFixture(modulePath!);
    const db = fixture.admin;
    await db.query(
      "update parent_private.processing_controls set enabled=true,approval_reference='isolated synthetic purpose test',approved_until=now()+interval '1 day'",
    );
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,'purpose@example.invalid',now())",
      [owner],
    );
    await db.query(
      "insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')",
      [session, owner],
    );
    await db.query(
      "insert into parent_private.provider_capabilities(program_id,action,enabled,transport_verified,requires_form,permission_version,permission_reference,allowed_fields,field_categories,required_acts,verified_until) values('peco-cap','share',true,true,false,$1,'isolated synthetic fixture',array['householdSize'],'{\"householdSize\":\"household\"}',array[]::text[],now()+interval '1 day')",
      [permission],
    );
  });

  afterAll(async () => {
    await fixture?.admin.end();
  });

  async function request(
    needs: SupportNeed[],
    recipients: string[],
    actions: ServiceMandate["allowedActions"] = ["research", "prepare", "share"],
    mode: ServiceMandate["mode"] = "full",
  ): Promise<Job> {
    const active = await asRole(
      "authenticated",
      "select id from public.parent_requests where status in ('active','paused')",
    );
    for (const row of active.rows)
      await asRole(
        "authenticated",
        "select public.parent_control_request($1,'cancel')",
        [row.id],
      );
    const requestId = (
      await asRole("authenticated", "select public.parent_start_request($1,$2,$3) id", [
        JSON.stringify(fixtureIntake({ needs })),
        JSON.stringify(fixtureMandate({
          recipientIds: recipients,
          allowedActions: actions,
          mode,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        })),
        randomUUID(),
      ])
    ).rows[0].id as string;
    const job = (
      await asRole("parent_worker", "select parent_private.parent_claim_job(120) job")
    ).rows[0].job;
    expect(job.request.id).toBe(requestId);
    return { jobId: job.jobId, leaseToken: job.leaseToken, requestId };
  }

  function prepare(
    job: Job,
    program: string,
    need: string | null,
    action = "prepare",
  ) {
    return asRole(
      "parent_worker",
      "select parent_private.parent_prepare_operation($1,$2,1,$3,$4,$5,array['household'],array[]::uuid[],$6,$7) id",
      [job.jobId, job.leaseToken, program, action, JSON.stringify(packet), randomUUID(), need],
    );
  }

  it.each([
    ["research", "electricity"],
    ["prepare", "food_now"],
    ["share", "electricity"],
  ])("rejects %s for explicit incompatible need %s even with a named provider", async (action, need) => {
    const job = await request(["food_now"], ["peco-cap"]);
    await expect(prepare(job, "peco-cap", need, action)).rejects.toThrow();
    expect((
      await fixture.admin.query(
        "select count(*)::integer count from public.parent_operations where request_id=$1",
        [job.requestId],
      )
    ).rows[0].count).toBe(0);
  });

  it("rejects an omitted need without a compatible purpose and an explicit wrong purpose when another need is compatible", async () => {
    const food = await request(["food_now"], ["peco-cap"]);
    await expect(prepare(food, "peco-cap", null)).rejects.toThrow();
    const mixed = await request(["food_now", "electricity"], ["peco-cap"]);
    await expect(prepare(mixed, "peco-cap", "food_now")).rejects.toThrow();
  });

  it("rejects ambiguous omitted benefits purposes and preserves unique legacy inference", async () => {
    const combined = await request(["snap_new", "wic_new"], ["uesf-benefits"]);
    await expect(prepare(combined, "uesf-benefits", null)).rejects.toThrow();
    const unique = await request(["electricity"], ["peco-cap"]);
    const result = await prepare(unique, "peco-cap", null);
    expect((
      await fixture.admin.query("select need from public.parent_operations where id=$1", [result.rows[0].id])
    ).rows[0].need).toBe("electricity");
    const share = await prepare(unique, "peco-cap", "electricity", "share");
    const begun = await asRole(
      "parent_worker",
      "select parent_private.parent_begin_operation($1,$2,$3) operation",
      [share.rows[0].id, unique.jobId, unique.leaseToken],
    );
    expect(begun.rows[0].operation.need).toBe("electricity");
  });

  async function register(job: Job, need: string | null) {
    const template = `purpose-${randomUUID()}`;
    await fixture.admin.query(
      "insert into parent_private.form_templates(id,version,program_id,needs,content_sha256,object_path,field_map,required_acts,source_url,verified_until,active) values($1,'1','peco-cap',array['electricity'],$2,$3,'{\"HouseholdSize\":\"householdSize\"}',array[]::text[],'https://example.invalid/synthetic-form',now()+interval '1 day',true)",
      [template, "a".repeat(64), `${template}.pdf`],
    );
    return asRole(
      "parent_worker",
      "select parent_private.parent_register_form_artifact($1,$2,'peco-cap',$3,'1',$4,$5,$6) artifact",
      [job.jobId, job.leaseToken, template, JSON.stringify(packet), "b".repeat(64), need],
    );
  }

  it.each(["food_now", "electricity"])("rejects form registration for explicit incompatible purpose %s", async (need) => {
    const job = await request(["food_now"], ["peco-cap"]);
    await expect(register(job, need)).rejects.toThrow();
    expect((
      await fixture.admin.query(
        "select count(*)::integer count from public.parent_form_artifacts where request_id=$1",
        [job.requestId],
      )
    ).rows[0].count).toBe(0);
  });

  it("rejects form preparation for an unnamed recipient", async () => {
    const unnamed = await request(["electricity"], ["philly-food"]);
    await expect(register(unnamed, "electricity")).rejects.toThrow();
  });

  it("rejects form preparation under a research-only mandate", async () => {
    const researchOnly = await request(["electricity"], ["peco-cap"], ["research"]);
    await expect(register(researchOnly, "electricity")).rejects.toThrow();
  });

  it("preserves uniquely inferred form registration within named prepare scope", async () => {
    const permitted = await request(
      ["electricity"], ["peco-cap"], ["research", "prepare"], "prepare_only",
    );
    expect((await register(permitted, null)).rows[0].artifact.need).toBe("electricity");
  });

  it.each(["food_now", "electricity"])("blocks dispatch of an already stored invalid operation with need %s", async (need) => {
    const job = await request(["food_now"], ["peco-cap"]);
    const operation = randomUUID();
    // Represents a row written before the purpose guard existed, without weakening the worker role.
    await fixture.admin.query(
      "insert into public.parent_operations(id,request_id,request_version,need,program_id,action,packet,packet_hash,data_categories,document_ids,idempotency_key,permission_version) values($1,$2,1,$3,'peco-cap','share',$4,encode(sha256(convert_to($4::jsonb::text,'UTF8')),'hex'),array['household'],array[]::uuid[],$5,$6)",
      [operation, job.requestId, need, JSON.stringify(packet), randomUUID(), permission],
    );
    await expect(asRole(
      "parent_worker",
      "select parent_private.parent_begin_operation($1,$2,$3)",
      [operation, job.jobId, job.leaseToken],
    )).rejects.toThrow();
    expect((
      await fixture.admin.query("select state,executed_at from public.parent_operations where id=$1", [operation])
    ).rows[0]).toMatchObject({ state: "prepared", executed_at: null });
  });
});
