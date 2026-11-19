import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
describe.skipIf(!modulePath)("WIC ordinary document collection remains closed", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>;
  const owner = randomUUID(), session = randomUUID();
  beforeAll(async () => {
    fixture = await createParentSqlFixture(modulePath!);
    await fixture.admin.query("update parent_private.processing_controls set enabled=true,approval_reference='isolated WIC document test',approved_until=now()+interval '1 day',wic_details_enabled=true,wic_details_approval_reference='isolated private answer test',wic_details_approved_until=now()+interval '1 day',wic_details_notice_version='wic-application-details-2026-11-13.v1'");
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [owner, `${owner}@example.invalid`]);
    await fixture.admin.query("insert into auth.sessions(id,user_id,not_after) values($1,$2,now()+interval '1 hour')", [session, owner]);
  });
  afterAll(async () => { await fixture?.admin.end(); });
  async function query(sql: string, values: unknown[] = [], role = "authenticated") {
    await fixture.admin.query(`set role ${role}`);
    try {
      await fixture.admin.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner, session_id: session, role, amr: [{ method: "otp" }] })]);
      return await fixture.admin.query(sql, values);
    } finally { await fixture.admin.query("reset role"); }
  }
  async function start(needs = ["food_now"]) {
    return (await query("select public.parent_start_request($1,$2,$3) id", [
      JSON.stringify(fixtureIntake({ needs: needs as ReturnType<typeof fixtureIntake>["needs"] })),
      JSON.stringify(fixtureMandate({ recipientIds: ["philly-food", "wic-pa"], allowedData: ["household", "documents"], expiresAt: new Date(Date.now()+86400000).toISOString() })), randomUUID(),
    ])).rows[0].id as string;
  }
  const register = (id: string) => query("select * from public.parent_register_document($1,'synthetic.pdf','application/pdf',100,1,'2026-10-25')", [id]);
  it.each(["wic_new", "wic_continuing"])("denies %s registration even with separate private-answer approval", async need => {
    const id = await start([need]);
    await expect(register(id)).rejects.toMatchObject({ code: "42501" });
    expect((await fixture.admin.query("select id from public.parent_documents where request_id=$1", [id])).rows).toEqual([]);
  });
  it("preserves ordinary and mixed other-need document registration", async () => {
    for (const needs of [["food_now"], ["food_now", "wic_new"]]) {
      const id = await start(needs);
      expect((await register(id)).rows).toHaveLength(1);
    }
  });
  it("blocks a previously registered object's upload and confirmation after routing becomes WIC-only", async () => {
    const id = await start(), document = (await register(id)).rows[0], pending = (await register(id)).rows[0];
    await query("insert into storage.objects(bucket_id,name,metadata) values('parent-documents',$1,'{\"size\":100,\"mimetype\":\"application/pdf\"}')", [document.object_path]);
    await fixture.admin.query("update public.parent_requests set intake=jsonb_set(intake,'{needs}','[\"wic_new\"]') where id=$1", [id]);
    await expect(query("insert into storage.objects(bucket_id,name,metadata) values('parent-documents',$1,'{\"size\":100,\"mimetype\":\"application/pdf\"}')", [pending.object_path]))
      .rejects.toMatchObject({ code: "42501" });
    await expect(query("select public.parent_confirm_document_upload($1,$2)", [id, document.id])).rejects.toMatchObject({ code: "42501", message: "WIC document processing is unavailable" });
    expect((await fixture.admin.query("select upload_confirmed_at from public.parent_documents where id=$1", [document.id])).rows[0].upload_confirmed_at).toBeNull();
  });
  it("denies broker processing of existing WIC-only bytes and hides the pre-boundary function", async () => {
    const id = await start(), document = (await register(id)).rows[0];
    await query("insert into storage.objects(bucket_id,name,metadata) values('parent-documents',$1,'{\"size\":100,\"mimetype\":\"application/pdf\"}')", [document.object_path]);
    await query("select public.parent_confirm_document_upload($1,$2)", [id, document.id]);
    await fixture.admin.query("update public.parent_requests set intake=jsonb_set(intake,'{needs}','[\"wic_new\"]') where id=$1", [id]);
    const job = (await query("select parent_private.parent_claim_job(120) value", [], "parent_worker")).rows[0].value;
    // Earlier test requests may be due too; obtain the exact owned test job before exercising its broker grant.
    if (job.request.id !== id) {
      await fixture.admin.query("update public.parent_jobs set state='cancelled',lease_token=null,lease_until=null where request_id<>$1", [id]);
    }
    const active = job.request.id === id ? job : (await query("select parent_private.parent_claim_job(120) value", [], "parent_worker")).rows[0].value;
    await expect(query("select parent_private.parent_authorize_storage($1,$2,'parent-documents',$3,'download')", [active.jobId, active.leaseToken, document.object_path], "parent_storage_broker"))
      .rejects.toMatchObject({ code: "42501", message: "WIC document processing is unavailable" });
    await expect(query("select parent_private.authorize_storage_before_wic_documents($1,$2,'parent-documents',$3,'download')", [active.jobId, active.leaseToken, document.object_path], "parent_storage_broker"))
      .rejects.toMatchObject({ code: "42501" });
  });
});
