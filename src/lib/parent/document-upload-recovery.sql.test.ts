import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";
const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
describe.skipIf(!modulePath)("owned immutable document upload attempts", () => {
  let fixture: Awaited<ReturnType<typeof createParentSqlFixture>>, owner: string, session: string, id: string;
  const sha = "a".repeat(64);
  async function query(sql: string, values: unknown[] = [], user = owner, token = session, role = "authenticated") {
    await fixture.admin.query(`set role ${role}`);
    try { await fixture.admin.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub:user, session_id:token, role, amr:[{method:"otp"}] })]);return await fixture.admin.query(sql, values); }
    finally { await fixture.admin.query("reset role"); }
  }
  const register = async (key: string, change: { hash?:string; filename?:string; consent?:string } = {}, user=owner, token=session) =>
    (await query("select public.parent_register_document($1,$2,'application/pdf',24,null,$3,$4,$5) value", [id,change.filename??"synthetic.pdf",change.consent??"2026-10-25",key,change.hash??sha],user,token)).rows[0].value;
  beforeAll(async () => { fixture=await createParentSqlFixture(modulePath!); });
  afterAll(async () => { await fixture?.admin.end(); });
  beforeEach(async () => {
    owner=randomUUID();session=randomUUID();
    await fixture.admin.query("update parent_private.processing_controls set enabled=true,approval_reference='isolated document recovery fixture',approved_until=now()+interval '1 day'");
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",[owner,`${owner}@example.invalid`]);
    await fixture.admin.query("insert into auth.sessions(id,user_id,not_after) values($1,$2,now()+interval '1 day')",[session,owner]);
    await query("select public.parent_ensure_account()");
    id=(await query("select public.parent_start_request($1,$2,$3) id",[JSON.stringify(fixtureIntake({needs:["food_now"],utilityProviders:[]})),JSON.stringify(fixtureMandate({mode:"prepare_only",recipientIds:["philly-food"],allowedActions:["research","prepare"],allowedData:["household","documents"],expiresAt:new Date(Date.now()+86400000).toISOString()})),randomUUID()])).rows[0].id as string;
  });
  it("reuses the same confirmed document, original dates and one version change after an unknown acknowledgement",async()=>{
    const key=randomUUID(),first=await register(key);expect(first.existing).toBe(false);
    await query("insert into storage.objects(bucket_id,name,metadata) values('parent-documents',$1,'{\"size\":24,\"mimetype\":\"application/pdf\"}')",[first.document.object_path]);
    await query("select public.parent_confirm_document_upload($1,$2)",[id,first.document.id]);
    const before=(await fixture.admin.query("select * from public.parent_documents where id=$1",[first.document.id])).rows[0];
    const repeated=await register(key);expect(repeated.existing).toBe(true);expect(repeated.document.id).toBe(first.document.id);
    await query("select public.parent_confirm_document_upload($1,$2)",[id,first.document.id]);
    expect((await fixture.admin.query("select * from public.parent_documents where id=$1",[first.document.id])).rows[0]).toEqual(before);
    expect((await fixture.admin.query("select version from public.parent_requests where id=$1",[id])).rows[0].version).toBe(2);
    expect((await fixture.admin.query("select count(*)::int n from public.parent_documents where request_id=$1",[id])).rows[0].n).toBe(1);
    expect((await fixture.admin.query("select count(*)::int n from public.parent_events where request_id=$1 and kind='document.upload_confirmed'",[id])).rows[0].n).toBe(1);
  });
  it("rejects changed bytes or metadata under the same attempt before changing its source",async()=>{
    const key=randomUUID(),first=await register(key);
    for(const change of [{hash:"b".repeat(64)},{filename:"different.pdf"},{consent:"other"}])await expect(register(key,change)).rejects.toMatchObject({code:"PT409"});
    expect((await register(key)).document).toEqual(first.document);
    await expect(fixture.admin.query("update public.parent_documents set upload_sha256=$2 where id=$1",[first.document.id,"b".repeat(64)])).rejects.toMatchObject({code:"23514"});
    await expect(fixture.admin.query("update public.parent_documents set expires_at=expires_at+interval '1 day' where id=$1",[first.document.id])).rejects.toMatchObject({code:"23514"});
  });
  it("keeps pending bytes unconfirmed and applies current cancellation before another write",async()=>{
    const key=randomUUID(),first=await register(key);
    await expect(query("select public.parent_confirm_document_upload($1,$2)",[id,first.document.id])).rejects.toMatchObject({code:"42501"});
    await query("select public.parent_control_request($1,'cancel')",[id]);
    await expect(register(key)).rejects.toMatchObject({code:"42501"});
    await expect(register(randomUUID())).rejects.toMatchObject({code:"42501"});
    expect((await fixture.admin.query("select upload_confirmed_at,status from public.parent_documents where id=$1",[first.document.id])).rows[0]).toEqual({upload_confirmed_at:null,status:"uploaded"});
  });
  it("adopts only the exact owned pending legacy id while preserving its original file and consent dates",async()=>{
    const original=(await query("select to_jsonb(d) value from public.parent_register_document($1,'synthetic.pdf','application/pdf',24,null,'2026-10-25') d",[id])).rows[0].value;
    const adopted=await register(original.id);expect(adopted.existing).toBe(true);expect(adopted.document.id).toBe(original.id);expect(adopted.document.object_path).toBe(original.object_path);expect(adopted.document.created_at).toBe(original.created_at);expect(adopted.document.consented_at).toBe(original.consented_at);expect(adopted.document.expires_at).toBe(original.expires_at);
    expect((await register(original.id)).document).toEqual(adopted.document);expect((await fixture.admin.query("select count(*)::int n from public.parent_documents where request_id=$1",[id])).rows[0].n).toBe(1);
  });
  it("does not adopt changed legacy metadata, a completed file or an expired attempt",async()=>{
    const original=(await query("select to_jsonb(d) value from public.parent_register_document($1,'synthetic.pdf','application/pdf',24,null,'2026-10-25') d",[id])).rows[0].value;
    await expect(register(original.id,{filename:"different.pdf"})).rejects.toMatchObject({code:"PT409"});
    await fixture.admin.query("update public.parent_documents set expires_at=now()-interval '1 second' where id=$1",[original.id]);await expect(register(original.id)).rejects.toMatchObject({code:"42501"});
    const completed=(await query("select to_jsonb(d) value from public.parent_register_document($1,'synthetic.pdf','application/pdf',24,null,'2026-10-25') d",[id])).rows[0].value;
    await query("insert into storage.objects(bucket_id,name,metadata) values('parent-documents',$1,'{\"size\":24,\"mimetype\":\"application/pdf\"}')",[completed.object_path]);await query("select public.parent_confirm_document_upload($1,$2)",[id,completed.id]);await expect(register(completed.id)).rejects.toMatchObject({code:"42501"});
  });
  it("retains the original expiry and deletion while leaving legacy registration and its quota unchanged",async()=>{
    const key=randomUUID(),first=await register(key);
    await fixture.admin.query("update public.parent_documents set expires_at=now()-interval '1 second' where id=$1",[first.document.id]);
    const expired=await register(key);expect(expired.document.id).toBe(first.document.id);
    await expect(query("insert into storage.objects(bucket_id,name,metadata) values('parent-documents',$1,'{\"size\":24,\"mimetype\":\"application/pdf\"}')",[first.document.object_path])).rejects.toMatchObject({code:"42501"});
    await expect(query("select public.parent_confirm_document_upload($1,$2)",[id,first.document.id])).rejects.toMatchObject({code:"42501"});
    await query("select public.parent_delete_document($1,$2)",[id,first.document.id]);
    expect((await register(key)).document.status).toBe("deletion_pending");
    for(let index=0;index<10;index++)await query("select public.parent_register_document($1,'legacy.pdf','application/pdf',24,null,'2026-10-25')",[id]);
    await expect(register(randomUUID())).rejects.toMatchObject({code:"P0001",message:"parent_document_limit"});
    expect((await register(key)).document.expires_at).toBe(expired.document.expires_at);
  });
  it("does not reopen a pending upload after the ordinary document purpose becomes WIC-only",async()=>{
    const key=randomUUID(),first=await register(key);
    await fixture.admin.query("update public.parent_requests set intake=jsonb_set(intake,'{needs}','[\"wic_new\"]') where id=$1",[id]);
    await expect(register(key)).rejects.toMatchObject({code:"42501"});
    await expect(register(randomUUID())).rejects.toMatchObject({code:"42501"});
    await expect(query("select public.parent_confirm_document_upload($1,$2)",[id,first.document.id])).rejects.toMatchObject({code:"42501"});
  });
  it("denies another owner and closed execution roles without revealing or replacing the attempted document",async()=>{
    const key=randomUUID(),first=await register(key),other=randomUUID(),otherSession=randomUUID();
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",[other,`${other}@example.invalid`]);
    await fixture.admin.query("insert into auth.sessions(id,user_id,not_after) values($1,$2,now()+interval '1 day')",[otherSession,other]);
    await query("select public.parent_ensure_account()",[],other,otherSession);
    await expect(register(key,{},other,otherSession)).rejects.toMatchObject({code:"42501"});
    expect((await query("select id from public.parent_documents where upload_key=$1",[key],other,otherSession)).rows).toEqual([]);
    for(const role of ["anon","service_role","parent_worker","parent_retention_worker","parent_storage_broker"])await expect(query("select public.parent_register_document($1,'synthetic.pdf','application/pdf',24,null,'2026-10-25',$2,$3)",[id,key,sha],owner,session,role)).rejects.toMatchObject({code:"42501"});
    expect((await register(key)).document.id).toBe(first.document.id);
  });
});
