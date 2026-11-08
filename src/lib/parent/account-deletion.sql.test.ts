import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { fixtureIntake, fixtureMandate, fixtureSnapApplication } from "./test-fixtures";
import { DOCUMENT_CONSENT_VERSION, SNAP_APPLICATION_NOTICE_VERSION } from "./constants";

const modulePath = process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
type Owner = { id: string; session: string; request: string };
describe.skipIf(!modulePath)("parent-purpose deletion after processing closes (SQL logic fixture)", () => {
  let f: Awaited<ReturnType<typeof createParentSqlFixture>>;
  beforeAll(async () => { f = await createParentSqlFixture(modulePath!); });
  afterAll(async () => { await f?.admin.end(); });
  async function as(owner: Owner, sql: string, values: unknown[] = [], claims: Record<string, unknown> = {}, role = "authenticated") {
    await f.admin.query("begin");
    try {
      await f.admin.query(`set local role ${role}`);
      await f.admin.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role, sub: owner.id, session_id: owner.session, amr: [{ method: "password" }], ...claims })]);
      const result = await f.admin.query(sql, values); await f.admin.query("commit"); return result;
    } catch (error) { await f.admin.query("rollback"); throw error; }
  }
  async function setup(need: "food_now" | "snap_new" = "food_now"): Promise<Owner> {
    const o = { id: randomUUID(), session: randomUUID(), request: "" };
    await f.admin.query("update parent_private.processing_controls set enabled=true,approval_reference='synthetic deletion test',approved_until=clock_timestamp()+interval '1 hour',existing_accounts_enabled=true");
    await f.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [o.id, `${o.id}@example.invalid`]);
    await f.admin.query("insert into auth.sessions(id,user_id,not_after) values($1,$2,clock_timestamp()+interval '1 hour')", [o.session, o.id]);
    o.request = (await as(o, "select public.parent_start_request($1,$2,$3) id", [JSON.stringify(fixtureIntake({ needs: [need], utilityProviders: [] })), JSON.stringify(fixtureMandate({ recipientIds: [need === "snap_new" ? "snap-pa" : "philly-food"], expiresAt: new Date(Date.now()+3600000).toISOString() })), randomUUID()])).rows[0].id as string;
    return o;
  }
  const close = () => f.admin.query("update parent_private.processing_controls set enabled=false,approved_until=clock_timestamp()-interval '1 hour',existing_accounts_enabled=false");
  const remove = (o: Owner, claims: Record<string, unknown> = {}, role = "authenticated") => as(o, "select public.parent_request_deletion()", [], claims, role);
  const status = (o: Owner) => as(o, "select public.parent_get_deletion_status() status");

  it("records owned deletion after closure, stops work, preserves other families and shared Auth/school records, and does not renew on replay", async () => {
    const owner = await setup(), other = await setup();
    await f.admin.query("insert into public.app_users(id,email,role,is_active) values($1,'shared@example.invalid','case_manager',true)", [owner.id]);
    const school = randomUUID();
    await f.admin.query("insert into public.families(id,name,created_by_id) values($1,'Synthetic school family',$2)", [school,owner.id]);
    await close();
    await expect(as(owner, "select public.parent_ensure_account()")).rejects.toMatchObject({ code: "42501" });
    await remove(owner);
    expect((await status(owner)).rows[0]).toEqual({ status: "deletion_requested" });
    const recorded = (await f.admin.query("select r.version,r.status,r.mandate_revoked_at,a.updated_at from public.parent_requests r join public.parent_households h on h.id=r.household_id join public.parent_accounts a on a.id=h.owner_id where r.id=$1", [owner.request])).rows[0];
    expect(recorded.status).toBe("cancelled"); expect(recorded.mandate_revoked_at).toBeTruthy();
    expect((await f.admin.query("select state from public.parent_jobs where request_id=$1", [owner.request])).rows.every(r => r.state === "cancelled")).toBe(true);
    await remove(owner);
    expect((await f.admin.query("select r.version,r.status,r.mandate_revoked_at,a.updated_at from public.parent_requests r join public.parent_households h on h.id=r.household_id join public.parent_accounts a on a.id=h.owner_id where r.id=$1", [owner.request])).rows[0]).toEqual(recorded);
    expect((await f.admin.query("select status from public.parent_requests where id=$1", [other.request])).rows[0].status).toBe("active");
    expect((await f.admin.query("select count(*) n from auth.users where id=$1", [owner.id])).rows[0].n).toBe(1);
    expect((await f.admin.query("select count(*) n from public.families where id=$1", [school])).rows[0].n).toBe(1);
    expect((await f.admin.query("select count(*) n from public.app_users where id=$1", [owner.id])).rows[0].n).toBe(1);
    expect((await as(owner, "select * from public.parent_requests")).rows).toEqual([]);
    await expect(as(owner, "select public.parent_ensure_account()")).rejects.toMatchObject({ code: "42501" });
  });

  it("revokes existing protected acquisition authority without extending its retention date", async () => {
    const owner = await setup("snap_new"), details = fixtureSnapApplication(new Date());
    await f.admin.query("update parent_private.processing_controls set snap_details_enabled=true,snap_details_approval_reference='synthetic test',snap_details_approved_until=clock_timestamp()+interval '1 hour',snap_details_notice_version=$1",[SNAP_APPLICATION_NOTICE_VERSION]);
    const snapshot = (await as(owner,"select public.parent_save_snap_application_details($1,1,$2,$3,$4) id",[owner.request,JSON.stringify(details),SNAP_APPLICATION_NOTICE_VERSION,randomUUID()])).rows[0].id;
    const version = (await f.admin.query("select version from public.parent_requests where id=$1",[owner.request])).rows[0].version;
    const authority = (await f.admin.query(`insert into parent_private.snap_final_packet_authorizations(request_id,owner_id,request_version,snapshot_id,snapshot_hash,subject_ids,recipient,need,purpose,policy_version,retention_policy_version,consent_reference,consented_at,expires_at,authorization_kind,authorization_session_id,authority_declaration)
      values($1,$2,$3,$4,$5,$6,'snap-pa','snap_new','snap_final_application_packet','synthetic-policy','synthetic-retention','synthetic-only',clock_timestamp(),clock_timestamp()+interval '1 hour','direct_entry',$7,'parent_declared_household_data_authority') returning id,expires_at`,[owner.request,owner.id,version,snapshot,"a".repeat(64),details.household!.filter(person=>person.requestingSnap).map(person=>person.id),owner.session])).rows[0];
    await close();await remove(owner);
    const revoked=(await f.admin.query("select revoked_at,expires_at from parent_private.snap_final_packet_authorizations where id=$1",[authority.id])).rows[0];
    expect(revoked.revoked_at).toBeTruthy();expect(revoked.expires_at).toEqual(authority.expires_at);
  });

  it("queues private files for independent cleanup after closure without claiming storage erasure", async () => {
    const owner = await setup(), doc = randomUUID(), objectPath = `${owner.id}/${owner.request}/${doc}`;
    await f.admin.query("insert into public.parent_documents(id,request_id,filename,media_type,size_bytes,page_count,object_path,consent_version) values($1,$2,'synthetic.pdf','application/pdf',20,1,$3,$4)", [doc,owner.request,objectPath,DOCUMENT_CONSENT_VERSION]);
    await f.admin.query("insert into storage.objects(bucket_id,name) values('parent-documents',$1)", [objectPath]);
    await close(); await remove(owner);
    expect((await f.admin.query("select status,expires_at<=clock_timestamp() expired from public.parent_documents where id=$1", [doc])).rows[0]).toEqual({ status: "deletion_pending", expired: true });
    expect((await f.admin.query("select count(*) n from storage.objects where name=$1", [objectPath])).rows[0].n).toBe(1);
    const batch = (await as(owner, "select parent_private.parent_claim_cleanup(100) batch", [], {}, "parent_retention_worker")).rows[0].batch as { documents: {id:string}[] };
    expect(batch.documents.some(item => item.id === doc)).toBe(true);
    expect((await f.admin.query("select count(*) n from storage.objects where name=$1", [objectPath])).rows[0].n).toBe(1);
  });

  it.each(["missing_session", "faked_session", "stale_session", "foreign_session", "unconfirmed", "anonymous", "banned", "security_hold", "disabled", "staff_only", "no_parent_account", "no_household", "inactive_shared_staff", "shared_otp"])("rejects %s without enrollment or mutation", async kind => {
    const owner = await setup(), claims: Record<string, unknown> = {};
    if (kind === "missing_session") claims.session_id = null;
    if (kind === "faked_session") claims.session_id = randomUUID();
    if (kind === "foreign_session") claims.session_id = (await setup()).session;
    if (kind === "stale_session") await f.admin.query("update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=$1", [owner.session]);
    if (kind === "unconfirmed") await f.admin.query("update auth.users set email_confirmed_at=null where id=$1", [owner.id]);
    if (kind === "anonymous") await f.admin.query("update auth.users set is_anonymous=true where id=$1", [owner.id]);
    if (kind === "banned") await f.admin.query("update auth.users set banned_until=clock_timestamp()+interval '1 hour' where id=$1", [owner.id]);
    if (["security_hold","disabled"].includes(kind)) await f.admin.query("update public.parent_accounts set status=$1 where id=$2", [kind,owner.id]);
    if (["staff_only","inactive_shared_staff","shared_otp"].includes(kind)) await f.admin.query("insert into public.app_users(id,role,is_active) values($1,'case_manager',$2)", [owner.id,kind!=="inactive_shared_staff"]);
    if (kind === "shared_otp") claims.amr = [{ method: "otp" }];
    if (["staff_only","no_parent_account"].includes(kind)) await f.admin.query("delete from public.parent_accounts where id=$1", [owner.id]);
    if (kind === "no_household") await f.admin.query("delete from public.parent_households where owner_id=$1", [owner.id]);
    await close();
    const before = (await f.admin.query("select (select count(*) from public.parent_accounts) accounts,(select count(*) from public.parent_households) households,(select count(*) from parent_private.deletion_tombstones) tombstones")).rows[0];
    await expect(remove(owner,claims)).rejects.toMatchObject({ code: "42501" });
    await expect(as(owner,"select public.parent_get_deletion_status()",[],claims)).rejects.toMatchObject({ code: "42501" });
    expect((await f.admin.query("select (select count(*) from public.parent_accounts) accounts,(select count(*) from public.parent_households) households,(select count(*) from parent_private.deletion_tombstones) tombstones")).rows[0]).toEqual(before);
  });

  it.each(["anon","service_role","parent_worker","parent_storage_broker","parent_retention_worker","parent_snap_finalizer","parent_snap_sender"])("does not grant %s a rights API or broader access", async role => {
    const owner = await setup(); await close();
    await expect(remove(owner,{},role)).rejects.toMatchObject({ code: "42501" });
    await expect(as(owner,"select public.parent_get_deletion_status()",[],{},role)).rejects.toMatchObject({ code: "42501" });
  });
  it("does not give the authenticated parent direct private-table, Auth, Storage or worker-role privileges", async () => {
    const owner = await setup(); await close(); await remove(owner);
    for (const sql of ["select * from parent_private.processing_controls", "select * from auth.users", "select * from parent_private.snap_final_packets", "delete from auth.users"])
      await expect(as(owner,sql)).rejects.toMatchObject({ code: "42501" });
    expect((await as(owner,"select * from storage.objects")).rows).toEqual([]);
    expect((await f.admin.query("select pg_has_role('authenticated','parent_worker','MEMBER') member,pg_has_role('authenticated','parent_worker','SET') can_set")).rows[0]).toEqual({ member: false, can_set: false });
  });
});
