import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";
import { PECO_APPLICATION_NOTICE_VERSION } from "./peco-application-fields";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
const at = new Date("2026-11-13T21:00:00Z");
describe.skipIf(!modulePath)("private PECO ordinary document boundary", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>, owner: string, session: string;
  const intake = (needs = ["electricity"]) => fixtureIntake({ needs: needs as ReturnType<typeof fixtureIntake>["needs"], householdSize: null, utilityProviders: needs.includes("electricity") ? ["peco"] : [], accountAuthority: "self" });
  const mandate = (allowedData = ["household", "income", "utility"]) => fixtureMandate({ mode: "prepare_only", recipientIds: ["peco-cap"], allowedActions: ["research", "prepare"], allowedData: allowedData as ReturnType<typeof fixtureMandate>["allowedData"], expiresAt: new Date(at.getTime() + 86400000).toISOString() });
  async function query(sql: string, values: unknown[] = [], role = "authenticated") {
    await fixture.admin.query(`set role ${role}`);
    try {
      await fixture.admin.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner, session_id: session, role, amr: [{ method: "otp" }] })]);
      return await fixture.admin.query(sql, values);
    } finally { await fixture.admin.query("reset role"); }
  }
  const start = async (needs?: string[], allowedData?: string[]) => (await query("select public.parent_start_request($1,$2,$3) id", [JSON.stringify(intake(needs)), JSON.stringify(mandate(allowedData)), randomUUID()])).rows[0].id as string;
  const register = async (request: string) => (await query("select * from public.parent_register_document($1,'synthetic.pdf','application/pdf',100,1,'2026-10-25')", [request])).rows[0];
  const store = (path: string) => query("insert into storage.objects(bucket_id,name,metadata) values('parent-documents',$1,'{\"size\":100,\"mimetype\":\"application/pdf\"}')", [path]);
  const confirm = (request: string, document: string) => query("select public.parent_confirm_document_upload($1,$2)", [request, document]);
  const version = async (request: string) => (await query("select version from public.parent_requests where id=$1", [request])).rows[0].version as number;
  const markPrivate = async (request: string) => query("select public.parent_save_peco_application_details($1,$2,'{}',$3,$4,true,true)", [request, await version(request), PECO_APPLICATION_NOTICE_VERSION, randomUUID()]);
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(at);
    fixture = await createParentSqlFixture(modulePath!);
    expect(new Date((await fixture.admin.query("select now() value")).rows[0].value).toISOString()).toBe(at.toISOString());
  });
  afterAll(async () => { await fixture?.admin.end(); vi.useRealTimers(); });
  beforeEach(async () => {
    owner = randomUUID(); session = randomUUID();
    await fixture.admin.query("update parent_private.processing_controls set enabled=true,approval_reference='isolated document boundary test',approved_until=now()+interval '1 day',peco_details_enabled=true,peco_details_approval_reference='isolated private answer test',peco_details_approved_until=now()+interval '1 day',peco_details_notice_version=$1", [PECO_APPLICATION_NOTICE_VERSION]);
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [owner, `${owner}@example.invalid`]);
    await fixture.admin.query("insert into auth.sessions(id,user_id,not_after) values($1,$2,now()+interval '1 hour')", [session, owner]);
  });
  it("closes capture from the atomic private start even after its collection flag closes", async () => {
    const request = (await query("select public.parent_start_peco_application($1,$2,'{}',$3,$4,true,true) id", [JSON.stringify(intake()), JSON.stringify(mandate()), PECO_APPLICATION_NOTICE_VERSION, randomUUID()])).rows[0].id as string;
    await fixture.admin.query("update parent_private.processing_controls set peco_details_enabled=false");
    await expect(register(request)).rejects.toMatchObject({ code: "42501", message: "PECO private document processing is unavailable" });
    expect((await query("select id from public.parent_documents where request_id=$1", [request])).rows).toEqual([]);
  });
  it.each([["electricity"], ["electricity", "wic_new"], ["snap_new"], ["food_now"]])("preserves separately consented ordinary registration, storage and confirmation for %j", async (...needs) => {
    const request = await start(needs), document = await register(request);
    await store(document.object_path); await confirm(request, document.id);
    expect((await query("select upload_confirmed_at from public.parent_documents where id=$1", [document.id])).rows[0].upload_confirmed_at).not.toBeNull();
  });
  it("blocks both never-stored and already-stored pending uploads when ordinary preparation gains a private revision", async () => {
    const request = await start(), stored = await register(request), pending = await register(request);
    await store(stored.object_path); await markPrivate(request);
    const before = await version(request);
    await expect(store(pending.object_path)).rejects.toMatchObject({ code: "42501" });
    await expect(confirm(request, stored.id)).rejects.toMatchObject({ code: "42501", message: "PECO private document processing is unavailable" });
    expect(await version(request)).toBe(before);
    expect((await query("select upload_confirmed_at from public.parent_documents where request_id=$1", [request])).rows.every(row => row.upload_confirmed_at === null)).toBe(true);
    expect((await fixture.admin.query("select name from storage.objects where bucket_id='parent-documents' and name=$1", [pending.object_path])).rows).toEqual([]);
  });
  it("keeps confirmed owner history readable and deletable while denying broker use even after broader document permission", async () => {
    const request = await start(), document = await register(request);
    await store(document.object_path); await confirm(request, document.id); await markPrivate(request);
    await query("select public.parent_replace_mandate($1,$2,$3)", [request, JSON.stringify(mandate(["household", "income", "utility", "documents"])), await version(request)]);
    expect((await query("select id from public.parent_documents where id=$1", [document.id])).rows).toHaveLength(1);
    expect((await query("select name from storage.objects where bucket_id='parent-documents' and name=$1", [document.object_path])).rows).toHaveLength(1);
    await fixture.admin.query("update public.parent_jobs set state='cancelled',lease_token=null,lease_until=null where request_id<>$1", [request]);
    const job = (await query("select parent_private.parent_claim_job(120) value", [], "parent_worker")).rows[0].value;
    expect(job.request.id).toBe(request);
    await expect(query("select parent_private.parent_authorize_storage($1,$2,'parent-documents',$3,'download')", [job.jobId, job.leaseToken, document.object_path], "parent_storage_broker"))
      .rejects.toMatchObject({ code: "42501", message: "PECO private document processing is unavailable" });
    await expect(query("select parent_private.authorize_storage_before_wic_documents($1,$2,'parent-documents',$3,'download')", [job.jobId, job.leaseToken, document.object_path], "parent_storage_broker"))
      .rejects.toMatchObject({ code: "42501" });
    await query("select public.parent_delete_document($1,$2)", [request, document.id]);
    expect((await fixture.admin.query("select status from public.parent_documents where id=$1", [document.id])).rows[0].status).toBe("deletion_pending");
  });
});
