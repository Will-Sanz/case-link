import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { SNAP_APPLICATION_NOTICE_VERSION } from "./constants";
import { fixtureIntake, fixtureMandate, fixtureSnapApplication } from "./test-fixtures";
import { openSnapFinalPacket, sealSnapFinalPacket, snapFinalPacketAad, type SnapFinalPacketBinding } from "./snap-final-packet";

const modulePath=process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
type Role="authenticated"|"anon"|"service_role"|"parent_worker"|"parent_storage_broker"|"parent_retention_worker"|"parent_snap_finalizer";
type Scope={owner:string;request:string;version:number;snapshot:string;snapshotHash:string;authorization:string;key:string};
type Staged={binding:SnapFinalPacketBinding;aad:string;keyBase64:string};
const payload=Buffer.from("SYNTHETIC_NONPDF_PACKET_FOR_SQL_LOGIC_ONLY");
const digest=createHash("sha256").update(payload).digest("hex");
const vaultCreateDouble="create or replace function vault.create_secret(text) returns uuid language sql as $$insert into vault.secrets(secret) values($1) returning id$$";

describe.skipIf(!modulePath)("SNAP encrypted staging SQL logic (explicit non-cryptographic Vault double)",()=>{
 let fixture:Awaited<ReturnType<typeof createParentSqlFixture>>;
 const sessions=new Map<string,string>();
 async function tx<T>(fn:()=>Promise<T>){
  await fixture.admin.query("begin");
  try{const value=await fn();await fixture.admin.query("commit");return value;}
  catch(error){await fixture.admin.query("rollback");throw error;}
 }
 async function role(role:Role,sql:string,values:unknown[]=[],user?:string){
  await fixture.admin.query("savepoint role_call");
  try{
   await fixture.admin.query(`set local role ${role}`);
   await fixture.admin.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role,sub:user,session_id:user&&sessions.get(user),amr:[{method:"otp"}]})]);
   const value=await fixture.admin.query(sql,values);
   await fixture.admin.query("reset role");await fixture.admin.query("release savepoint role_call");return value;
  }catch(error){await fixture.admin.query("rollback to savepoint role_call");await fixture.admin.query("release savepoint role_call");throw error;}
 }
 beforeAll(async()=>{
  fixture=await createParentSqlFixture(modulePath!);
  // This fixture stores fake keys in plaintext. Only the separate native Vault proof establishes encryption.
  for(const statement of ["create schema vault","create schema extensions",
   "create table vault.secrets(id uuid primary key default gen_random_uuid(),secret text not null)",
   "create view vault.decrypted_secrets as select id,secret decrypted_secret from vault.secrets",
   "create function extensions.gen_random_bytes(integer) returns bytea language sql as $$select decode(repeat('ab',$1),'hex')$$",
   vaultCreateDouble,
   "grant usage on schema vault to service_role","grant select on vault.secrets,vault.decrypted_secrets to service_role"])
   await fixture.admin.query(statement);
 });
 afterAll(async()=>{await fixture?.admin.end();});
 async function setup(ttl="1 hour",details=fixtureSnapApplication(new Date())):Promise<Scope>{
  const owner=randomUUID(),session=randomUUID();sessions.set(owner,session);
  // Explicit synthetic legacy provider route; no accepted direct-completion method is assumed.
  await fixture.admin.query(`insert into parent_private.provider_capabilities(program_id,action,enabled,transport_verified,requires_form,permission_version,permission_reference,allowed_fields,field_categories,required_acts,verified_until)
   values('snap-pa','submit',true,true,true,'synthetic-packet-route','synthetic route fixture only',array['protectedSnapPacket','incomeAmount'],'{"protectedSnapPacket":"household","incomeAmount":"income"}',array['applicant_signature_printed_page_1','rights_certification_printed_page_5'],clock_timestamp()+interval '1 hour')
   on conflict(program_id,action) do update set enabled=true,transport_verified=true,requires_form=true,permission_version=excluded.permission_version,permission_reference=excluded.permission_reference,
    allowed_fields=excluded.allowed_fields,field_categories=excluded.field_categories,required_acts=excluded.required_acts,verified_until=excluded.verified_until`);
  await fixture.admin.query(`update parent_private.processing_controls set enabled=true,approval_reference='synthetic packet SQL fixture only',approved_until=now()+interval '1 day',
   snap_details_enabled=true,snap_details_approval_reference='synthetic only',snap_details_approved_until=now()+interval '1 day',snap_details_notice_version=$1,
   snap_protected_enabled=true,snap_protected_approval_reference='synthetic only; not a published policy',snap_protected_approved_until=now()+interval '1 day',
   snap_protected_policy_version='synthetic-policy-1',snap_protected_retention_policy_version='synthetic-retention-1',snap_protected_max_retention_seconds=300`,[SNAP_APPLICATION_NOTICE_VERSION]);
  await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",[owner,`${owner}@example.invalid`]);
  await fixture.admin.query("insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')",[session,owner]);
  const request=(await tx(()=>role("authenticated","select public.parent_start_request($1,$2,$3) id",[
   JSON.stringify(fixtureIntake({needs:["snap_new"],utilityProviders:[]})),JSON.stringify(fixtureMandate({recipientIds:["snap-pa"],expiresAt:new Date(Date.now()+3600000).toISOString()})),randomUUID()],owner))).rows[0].id as string;
  const snapshot=(await tx(()=>role("authenticated","select public.parent_save_snap_application_details($1,1,$2,$3,$4) id",[request,JSON.stringify(details),SNAP_APPLICATION_NOTICE_VERSION,randomUUID()],owner))).rows[0].id as string;
  const version=(await fixture.admin.query("select version from public.parent_requests where id=$1",[request])).rows[0].version as number;
  const binding=(await fixture.admin.query("select parent_private.snap_application_binding($1,$2,$3) value",[request,version,snapshot])).rows[0].value as {snapshotHash:string};
  const key=randomUUID();
  // Explicit test-only authority; real parent metadata authorization is exercised separately below.
  const authorization=(await fixture.admin.query(`insert into parent_private.snap_final_packet_authorizations(request_id,owner_id,request_version,snapshot_id,snapshot_hash,subject_ids,recipient,need,purpose,policy_version,retention_policy_version,consent_reference,consented_at,expires_at,
   packet_id,content_sha256,byte_length,authorization_session_id,authority_declaration)
   values($1,$2,$3,$4,$5,$6,'snap-pa','snap_new','snap_final_application_packet','synthetic-policy-1','synthetic-retention-1','synthetic-only-fixture',now(),clock_timestamp()+$7::interval,
    $8,$9,$10,$11,'parent_declared_household_data_authority') returning id`,
   [request,owner,version,snapshot,binding.snapshotHash,details.household!.filter(person=>person.requestingSnap).map(person=>person.id),ttl,key,digest,payload.length,session])).rows[0].id as string;
  return{owner,request,version,snapshot,snapshotHash:binding.snapshotHash,authorization,key};
 }
 async function begin(s:Scope,changes:Partial<Scope>={},hash=digest,size=payload.length):Promise<Staged>{
  const v={...s,...changes};return(await role("parent_snap_finalizer","select parent_private.parent_begin_snap_final_packet($1,$2,$3,$4,$5,$6,$7,$8) value",[v.authorization,v.request,v.version,v.snapshot,v.snapshotHash,hash,size,v.key])).rows[0].value as Staged;
 }
 async function seal(s:Scope,b:Staged,change?:{iv?:Buffer;tag?:Buffer;ciphertext?:Buffer}){
  const packet=sealSnapFinalPacket(payload,Buffer.from(b.keyBase64,"base64"),b.binding,new Date());
  const value=(await role("parent_snap_finalizer","select parent_private.parent_seal_snap_final_packet($1,$2,$3,$4,$5,$6,$7) value",
   [b.binding.packetId,s.request,s.version,s.authorization,change?.iv??Buffer.from(packet.iv),change?.tag??Buffer.from(packet.tag),change?.ciphertext??Buffer.from(packet.ciphertext)])).rows[0].value;
  return{packet,value};
 }
 async function stage(s:Scope){return tx(async()=>{const b=await begin(s);await seal(s,b);return b;});}
 async function read(s:Scope,id:string,changes:Partial<Scope>={}){
  const v={...s,...changes};return(await role("parent_snap_finalizer","select parent_private.parent_read_snap_final_packet($1,$2,$3,$4,$5,$6) value",[id,v.request,v.version,v.authorization,v.snapshot,v.snapshotHash])).rows[0].value as Staged&{iv:string;tag:string;ciphertext:string};
 }
 async function count(table:string){return(await fixture.admin.query(`select count(*)::int n from ${table}`)).rows[0].n as number;}
 async function operation(s:Scope,alternate=false){
  await fixture.admin.query(`insert into parent_private.provider_capabilities(program_id,action,enabled,transport_verified,requires_form,permission_version,permission_reference,allowed_fields,field_categories,required_acts,verified_until)
   values('snap-pa','submit',true,true,true,'synthetic-packet-bind','synthetic association only',array['zip','householdSize','protectedSnapPacket'],'{"zip":"household","householdSize":"household","protectedSnapPacket":"household"}','{}',now()+interval '1 hour')
   on conflict(program_id,action) do update set enabled=true,transport_verified=true,requires_form=true,permission_version=excluded.permission_version,allowed_fields=excluded.allowed_fields,field_categories=excluded.field_categories,required_acts='{}',verified_until=excluded.verified_until`);
  return(await fixture.admin.query(`insert into public.parent_operations(request_id,request_version,need,program_id,action,packet,packet_hash,data_categories,idempotency_key,permission_version)
   values($1,$2,'snap_new','snap-pa','submit',$4::jsonb,encode(sha256(convert_to($4::jsonb::text,'UTF8')),'hex'),array['household'],$3,'synthetic-packet-bind') returning id`,[s.request,s.version,randomUUID(),JSON.stringify(alternate?{zip:"19104",householdSize:3}:{zip:"19104"})])).rows[0].id as string;
 }
 async function bind(s:Scope,id:string,operation:string){return role("parent_snap_finalizer","select parent_private.parent_bind_snap_final_packet($1,$2,$3,$4,$5) id",[id,s.request,s.version,s.authorization,operation]);}
 async function purge(){return tx(async()=>((await role("parent_retention_worker","select parent_private.parent_purge_snap_final_packets(100) n")).rows[0].n as number));}
 type Capture={intent:Omit<SnapFinalPacketBinding,"expiresAt">;authorizationExpiresAt:string;subjectIds:string[];authorityDeclaration:string;consentedAt:string;state:"authorized"|"stored"};
 const captureSql="select public.parent_authorize_snap_final_packet($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) value";
 async function captureSetup(details=fixtureSnapApplication(new Date())){
  const s=await setup("1 hour",details);
  await fixture.admin.query("delete from parent_private.snap_final_packet_authorizations where id=$1",[s.authorization]);
  return s;
 }
 async function authorize(s:Scope,changes:Partial<{request:string;version:number;snapshot:string;snapshotHash:string;key:string;hash:string;size:number|null;policy:string;retention:string;subjects:(string|null)[]|null;declared:boolean|null}>={},actor=s.owner):Promise<Capture>{
  const v={...s,hash:digest,size:payload.length,policy:"synthetic-policy-1",retention:"synthetic-retention-1",
   subjects:fixtureSnapApplication().household!.filter(person=>person.requestingSnap).map(person=>person.id),declared:true,...changes};
  return(await tx(()=>role("authenticated",captureSql,[v.request,v.version,v.snapshot,v.snapshotHash,v.key,v.hash,v.size,v.policy,v.retention,v.subjects,v.declared],actor))).rows[0].value as Capture;
 }
 async function recover(s:Scope,actor=s.owner,packet=s.key,version=s.version):Promise<Capture>{
  return(await tx(()=>role("authenticated","select public.parent_get_snap_final_packet_authorization($1,$2,$3) value",[s.request,packet,version],actor))).rows[0].value as Capture;
 }

 it("starts with every protected processing/policy/retention control closed or NULL",async()=>{
  expect((await fixture.admin.query("select snap_protected_enabled,snap_protected_approval_reference,snap_protected_approved_until,snap_protected_policy_version,snap_protected_retention_policy_version,snap_protected_max_retention_seconds from parent_private.processing_controls")).rows[0]).toEqual({snap_protected_enabled:false,snap_protected_approval_reference:null,snap_protected_approved_until:null,snap_protected_policy_version:null,snap_protected_retention_policy_version:null,snap_protected_max_retention_seconds:null});
 });
 it("keeps both public metadata functions closed with the default false/NULL purpose controls",async()=>{
  await expect(tx(()=>role("authenticated",captureSql,[randomUUID(),1,randomUUID(),digest,randomUUID(),digest,payload.length,"synthetic-policy-1","synthetic-retention-1",[randomUUID()],true],randomUUID()))).rejects.toMatchObject({code:"42501"});
  await expect(tx(()=>role("authenticated","select public.parent_get_snap_final_packet_authorization($1,$2,1)",[randomUUID(),randomUUID()],randomUUID()))).rejects.toMatchObject({code:"42501"});
  expect(await count("parent_private.snap_final_packet_authorizations")).toBe(0);
 });
 it("records only the exact declared authority/intent metadata without creating keys, files, acts, Submit or operations",async()=>{
  const s=await captureSetup(),before=[await count("vault.secrets"),await count("parent_private.snap_final_packets"),await count("public.parent_operations"),await count("parent_private.personal_act_evidence"),await count("parent_private.snap_submission_authorizations")];
  const value=await authorize(s);
  expect(Object.keys(value).sort()).toEqual(["intent","authorizationExpiresAt","subjectIds","authorityDeclaration","consentedAt","state"].sort());
  expect(value.intent).toMatchObject({packetId:s.key,ownerId:s.owner,requestId:s.request,requestVersion:s.version,snapshotId:s.snapshot,snapshotHash:s.snapshotHash,
   recipient:"snap-pa",need:"snap_new",purpose:"snap_final_application_packet",contentSha256:digest,byteLength:payload.length});
  expect(Object.keys(value.intent)).toHaveLength(18);
  expect(value.authorityDeclaration).toBe("parent_declared_household_data_authority");expect(value.state).toBe("authorized");
  expect(JSON.stringify(value)).not.toMatch(/Private Canary|keyBase64|ciphertext|vault_secret|authorization_session_id/);
  const row=(await fixture.admin.query("select to_jsonb(a) value from parent_private.snap_final_packet_authorizations a where packet_id=$1",[s.key])).rows[0].value as Record<string,unknown>;
  expect(row.authorization_session_id).toBe(sessions.get(s.owner));expect(row.subject_ids).toEqual(value.subjectIds);
  expect(row.consented_at).toBe(row.created_at);expect(row.consent_reference).toBe(`snap-capture:${s.key}`);
  expect([await count("vault.secrets"),await count("parent_private.snap_final_packets"),await count("public.parent_operations"),await count("parent_private.personal_act_evidence"),await count("parent_private.snap_submission_authorizations")]).toEqual(before);
 });
 it("recovers the caller-known intent after a lost response and never extends its consent or expiry on replay",async()=>{
  const s=await captureSetup(),first=await authorize(s);await delay(5);
  expect(await recover(s)).toEqual(first);expect(await authorize(s)).toEqual(first);
  expect((await fixture.admin.query("select count(*)::int n from parent_private.snap_final_packet_authorizations where packet_id=$1",[s.key])).rows[0].n).toBe(1);
 });
 it("stages the exact publicly authorized intent and reports stored metadata without returning protected bytes",async()=>{
  const s=await captureSetup(),authorized=await authorize(s);s.authorization=authorized.intent.authorizationId;
  const staged=await stage(s);expect(staged.binding).toMatchObject(authorized.intent);
  expect(await recover(s)).toEqual({...authorized,state:"stored"});
 });
 it.each(["hash","size","key"] as const)("cannot stage different %s under one capture authorization",async field=>{
  const s=await captureSetup(),value=await authorize(s);s.authorization=value.intent.authorizationId;
  const before=[await count("vault.secrets"),await count("parent_private.snap_final_packets")];
  await expect(tx(()=>begin(s,field==="key"?{key:randomUUID()}: {},field==="hash"?"a".repeat(64):digest,field==="size"?payload.length+1:payload.length))).rejects.toMatchObject({code:"23514"});
  expect([await count("vault.secrets"),await count("parent_private.snap_final_packets")]).toEqual(before);
 });
 it("denies unstaged legacy NULL-intent authority without guessing or backfilling it",async()=>{
  const s=await setup(),key=randomUUID();
  const legacy=(await fixture.admin.query(`insert into parent_private.snap_final_packet_authorizations select (jsonb_populate_record(null::parent_private.snap_final_packet_authorizations,
   to_jsonb(a)||jsonb_build_object('id',$2::uuid,'packet_id',null,'content_sha256',null,'byte_length',null,'authorization_session_id',null,'authority_declaration',null))).*
   from parent_private.snap_final_packet_authorizations a where id=$1 returning id`,[s.authorization,key])).rows[0].id as string;
  await expect(tx(()=>begin(s,{authorization:legacy}))).rejects.toMatchObject({code:"42501"});
  expect((await fixture.admin.query("select packet_id from parent_private.snap_final_packet_authorizations where id=$1",[legacy])).rows[0].packet_id).toBeNull();
 });
 it.each(["packet_id","content_sha256","byte_length","authorization_session_id","authority_declaration"])("cannot insert a partially NULL %s intent",async field=>{
  const s=await setup(),changes={id:randomUUID(),packet_id:randomUUID(),[field]:null};
  await expect(fixture.admin.query(`insert into parent_private.snap_final_packet_authorizations select (jsonb_populate_record(null::parent_private.snap_final_packet_authorizations,to_jsonb(a)||$2::jsonb)).*
   from parent_private.snap_final_packet_authorizations a where id=$1`,[s.authorization,JSON.stringify(changes)])).rejects.toMatchObject({code:"23514"});
 });
 it.each([
  {hash:"e".repeat(64)}, {size:payload.length+1}, {subjects:[randomUUID()]}, {declared:false}, {declared:null},
  {subjects:null}, {subjects:[]}, {subjects:[null]}, {subjects:[fixtureSnapApplication().household![0].id,fixtureSnapApplication().household![0].id]},
  {size:0}, {size:null}, {size:10485761}, {hash:"not-a-digest"},
 ])("rejects invalid or changed capture metadata %j without replacing an authorization",async changes=>{
  const s=await captureSetup(),first=await authorize(s);
  await expect(authorize(s,changes)).rejects.toMatchObject({code:"23514"});expect(await recover(s)).toEqual(first);
 });
 it.each(["policy","retention"] as const)("rejects an unapproved %s version",async field=>{
  const s=await captureSetup();await expect(authorize(s,{[field]:"unapproved-version"})).rejects.toMatchObject({code:"42501"});
  expect((await fixture.admin.query("select 1 from parent_private.snap_final_packet_authorizations where packet_id=$1",[s.key])).rows).toEqual([]);
 });
 it.each(["request","version","snapshot","snapshotHash"] as const)("denies wrong current %s bindings",async field=>{
  const s=await captureSetup(),change=field==="version"?s.version+1:field==="snapshotHash"?"f".repeat(64):randomUUID();
  await expect(authorize(s,{[field]:change})).rejects.toMatchObject({code:"42501"});
 });
 it("derives only applying household subjects and checks the whole declared set",async()=>{
  const details=fixtureSnapApplication(),child=randomUUID(),other=randomUUID();
  details.household!.push({id:child,firstName:"Synthetic Child",lastName:"Fixture",dateOfBirth:"2020-01-01",sex:"male",student:true,relationship:"CHILD",requestingSnap:true,citizen:true},
   {id:other,firstName:"Synthetic Nonapplicant",lastName:"Fixture",dateOfBirth:"1992-01-01",sex:"female",student:false,relationship:"OTHER",requestingSnap:false});
  details.householdSize=3;const s=await captureSetup(details),subjects=[child,details.household![0].id];
  await expect(authorize(s)).rejects.toMatchObject({code:"23514"});
  await expect(authorize(s,{subjects:[...subjects,other]})).rejects.toMatchObject({code:"23514"});
  const value=await authorize(s,{subjects});expect(value.subjectIds).toEqual(subjects.sort());
  expect((await authorize(s,{subjects:[...subjects].reverse()}))).toEqual(value);
 });
 it("denies another parent's read and gives no foreign owner data on a global packet UUID collision",async()=>{
  const first=await captureSetup(),original=await authorize(first),second=await captureSetup();
  await expect(recover(first,second.owner)).rejects.toMatchObject({code:"42501",message:"protected SNAP authorization unavailable"});
  await expect(recover(second,second.owner,first.key)).rejects.toMatchObject({code:"42501",message:"protected SNAP authorization unavailable"});
  await expect(authorize(second,{key:first.key})).rejects.toMatchObject({code:"23514",message:"invalid protected SNAP authorization"});
  expect(await recover(first)).toEqual(original);
 });
 it("records the original session without blocking sign-out, later owned recovery or durable staging",async()=>{
  const s=await captureSetup(),value=await authorize(s),originalSession=sessions.get(s.owner)!,newSession=randomUUID();s.authorization=value.intent.authorizationId;
  await fixture.admin.query("delete from auth.sessions where id=$1",[originalSession]);
  await expect(recover(s)).rejects.toMatchObject({code:"42501"});
  await fixture.admin.query("insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 hour')",[newSession,s.owner]);
  sessions.set(s.owner,newSession);expect(await recover(s)).toEqual(value);expect(await authorize(s)).toEqual(value);
  expect((await fixture.admin.query("select authorization_session_id from parent_private.snap_final_packet_authorizations where packet_id=$1",[s.key])).rows[0].authorization_session_id).toBe(originalSession);
  await fixture.admin.query("delete from auth.sessions where id=$1",[newSession]);
  await stage(s);
 });
 it.each(["session","account"] as const)("requires a currently active %s for metadata writes and reads",async field=>{
  const s=await captureSetup();await authorize(s);
  if(field==="session")await fixture.admin.query("update auth.sessions set not_after=now()-interval '1 second' where id=$1",[sessions.get(s.owner)]);
  else await fixture.admin.query("update public.parent_accounts set status='deletion_requested' where id=$1",[s.owner]);
  await expect(authorize(s)).rejects.toMatchObject({code:"42501"});await expect(recover(s)).rejects.toMatchObject({code:"42501"});
 });
 it.each(["enabled=false","snap_details_enabled=false","snap_protected_enabled=false","snap_protected_policy_version=null","snap_protected_retention_policy_version=null","snap_protected_max_retention_seconds=null","snap_protected_approval_reference=null","snap_protected_approved_until=clock_timestamp()-interval '1 second'"])("closes metadata access when %s",async assignment=>{
  const s=await captureSetup();await authorize(s);await fixture.admin.query(`update parent_private.processing_controls set ${assignment}`);
  await expect(authorize(s)).rejects.toMatchObject({code:"42501"});await expect(recover(s)).rejects.toMatchObject({code:"42501"});
 });
 it.each(["approved_until","snap_details_approved_until","snap_protected_approved_until"])("bounds new consent expiry to %s",async field=>{
  const s=await captureSetup(),limit=(await fixture.admin.query(`update parent_private.processing_controls set ${field}=clock_timestamp()+interval '30 seconds' returning to_char(${field} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') value`)).rows[0].value as string;
  const value=await authorize(s);expect(value.authorizationExpiresAt).toBe(limit);
 });
 it("uses the configured retention bound without extending it on reads or retries",async()=>{
  const s=await captureSetup(),before=Date.now(),value=await authorize(s);
  expect(Date.parse(value.authorizationExpiresAt)-before).toBeGreaterThan(299000);expect(Date.parse(value.authorizationExpiresAt)-before).toBeLessThanOrEqual(300100);
  expect(await recover(s)).toEqual(value);expect(await authorize(s)).toEqual(value);
 });
 it("also bounds consent expiry to the original mandate without choosing a new duration",async()=>{
  const s=await captureSetup(),limit=new Date(Date.now()+30000).toISOString();
  await fixture.admin.query("update public.parent_requests set mandate=jsonb_set(mandate,'{expiresAt}',to_jsonb($2::text)) where id=$1",[s.request,limit]);
  expect((await authorize(s)).authorizationExpiresAt).toBe(limit);
 });
 it("refuses an expired authorization on recovery/replay rather than extending its captured lifetime",async()=>{
  const s=await captureSetup();await fixture.admin.query("update parent_private.processing_controls set snap_protected_approved_until=clock_timestamp()+interval '0.25 seconds'");
  await authorize(s);await delay(270);
  await expect(recover(s)).rejects.toMatchObject({code:"42501"});await expect(authorize(s)).rejects.toMatchObject({code:"42501"});
 });
 it("uses current session expiry even when the SQL transaction began earlier",async()=>{
  const s=await captureSetup();await fixture.admin.query("update auth.sessions set not_after=clock_timestamp()+interval '0.05 seconds' where id=$1",[sessions.get(s.owner)]);
  await tx(async()=>{
   await delay(70);
   await expect(role("authenticated",captureSql,[s.request,s.version,s.snapshot,s.snapshotHash,s.key,digest,payload.length,"synthetic-policy-1","synthetic-retention-1",[fixtureSnapApplication().household![0].id],true],s.owner)).rejects.toMatchObject({code:"42501"});
  });
 });
 it("bounds new authorization rows but still permits an exact unextended replay at the limit",async()=>{
  const s=await captureSetup(),first=await authorize(s);
  await fixture.admin.query(`insert into parent_private.snap_final_packet_authorizations select (jsonb_populate_record(null::parent_private.snap_final_packet_authorizations,
   to_jsonb(a)||jsonb_build_object('id',gen_random_uuid(),'packet_id',gen_random_uuid()))).* from parent_private.snap_final_packet_authorizations a cross join generate_series(1,19) where a.packet_id=$1`,[s.key]);
  await expect(authorize(s,{key:randomUUID()})).rejects.toMatchObject({code:"23514"});expect(await authorize(s)).toEqual(first);
 });
 it.each(["revocation","correction","cancel"] as const)("stops old capture authorization after %s",async event=>{
  const s=await captureSetup(),value=await authorize(s);s.authorization=value.intent.authorizationId;
  if(event==="revocation")await fixture.admin.query("update parent_private.snap_final_packet_authorizations set revoked_at=clock_timestamp() where id=$1",[s.authorization]);
  else if(event==="correction"){
   const details=fixtureSnapApplication();details.applicant!.firstName="Corrected";details.household![0].firstName="Corrected";
   await tx(()=>role("authenticated","select public.parent_save_snap_application_details($1,$2,$3,$4,$5)",[s.request,s.version,JSON.stringify(details),SNAP_APPLICATION_NOTICE_VERSION,randomUUID()],s.owner));
  }else await tx(()=>role("authenticated","select public.parent_control_request($1,'cancel')",[s.request],s.owner));
  await expect(authorize(s)).rejects.toMatchObject({code:"42501"});await expect(recover(s)).rejects.toMatchObject({code:"42501"});
  await expect(tx(()=>begin(s))).rejects.toMatchObject({code:"42501"});
 });
 it.each(["packet_id","content_sha256","byte_length","authorization_session_id","authority_declaration"])("keeps recorded %s immutable",async field=>{
  const s=await captureSetup();await authorize(s);const expression=field==="byte_length"?"byte_length+1":field==="content_sha256"?"repeat('f',64)":field==="authority_declaration"?"null":"gen_random_uuid()";
  await expect(fixture.admin.query(`update parent_private.snap_final_packet_authorizations set ${field}=${expression} where packet_id=$1`,[s.key])).rejects.toMatchObject({code:"23514"});
 });
 it.each(["anon","service_role","parent_worker","parent_storage_broker","parent_retention_worker","parent_snap_finalizer"] as const)("does not grant %s public parent metadata authority",async actor=>{
  const s=await captureSetup();
  await expect(tx(()=>role(actor,captureSql,[s.request,s.version,s.snapshot,s.snapshotHash,s.key,digest,payload.length,"synthetic-policy-1","synthetic-retention-1",[fixtureSnapApplication().household![0].id],true],s.owner))).rejects.toMatchObject({code:"42501"});
  await expect(tx(()=>role(actor,"select public.parent_get_snap_final_packet_authorization($1,$2,$3)",[s.request,s.key,s.version],s.owner))).rejects.toMatchObject({code:"42501"});
 });
 it("seals atomically, agrees on canonical AAD, and reads only exact-scoped immutable bytes",async()=>{
  const s=await setup();const b=await tx(async()=>{const b=await begin(s);const replay=await begin(s);expect(replay).toEqual(b);expect(Buffer.from(b.aad,"base64")).toEqual(Buffer.from(snapFinalPacketAad(b.binding)));await seal(s,b);return b;});
  const stored=await tx(()=>read(s,b.binding.packetId));
  expect(openSnapFinalPacket({binding:stored.binding,iv:Buffer.from(stored.iv,"base64"),tag:Buffer.from(stored.tag,"base64"),ciphertext:Buffer.from(stored.ciphertext,"base64")},Buffer.from(stored.keyBase64,"base64"),new Date())).toEqual(payload);
  expect(stored.binding).toEqual(b.binding);
  await expect(tx(()=>seal(s,b))).rejects.toMatchObject({code:"42501"});
 });
 it("cannot commit a key/pending row without sealing",async()=>{
  const s=await setup(),before=[await count("vault.secrets"),await count("parent_private.snap_final_packets")];
  await expect(tx(async()=>{await begin(s);})).rejects.toMatchObject({code:"23514"});
  expect([await count("vault.secrets"),await count("parent_private.snap_final_packets")]).toEqual(before);
 });
 it("reconciles a lost commit response using only the pre-known staging UUID",async()=>{
  const s=await setup();await stage(s);
  const stored=await tx(()=>read(s,s.key));
  expect(stored.binding.packetId).toBe(s.key);
  expect(openSnapFinalPacket({binding:stored.binding,iv:Buffer.from(stored.iv,"base64"),tag:Buffer.from(stored.tag,"base64"),ciphertext:Buffer.from(stored.ciphertext,"base64")},Buffer.from(stored.keyBase64,"base64"),new Date())).toEqual(payload);
  await expect(tx(()=>begin(s,{},"e".repeat(64)))).rejects.toMatchObject({code:"23514"});
  expect((await tx(()=>read(s,s.key))).ciphertext).toBe(stored.ciphertext);
 });
 it("rejects a staging UUID from another receipt without leaking/replacing its packet or retaining a key",async()=>{
  const first=await setup();await stage(first);const original=await tx(()=>read(first,first.key));
  const second={...await setup(),key:first.key},before=[await count("vault.secrets"),await count("parent_private.snap_final_packets")];
  await expect(tx(()=>begin(second))).rejects.toMatchObject({code:"23514",message:"protected SNAP staging failed"});
  expect([await count("vault.secrets"),await count("parent_private.snap_final_packets")]).toEqual(before);
  await expect(tx(()=>read(second,first.key))).rejects.toMatchObject({code:"42501"});
  expect(await tx(()=>read(first,first.key))).toEqual(original);
 });
 it("rolls back both key and packet after an interrupted stage",async()=>{
  const s=await setup(),before=[await count("vault.secrets"),await count("parent_private.snap_final_packets")];
  await expect(tx(async()=>{await begin(s);throw new Error("synthetic interrupted stage");})).rejects.toThrow("synthetic interrupted stage");
  expect([await count("vault.secrets"),await count("parent_private.snap_final_packets")]).toEqual(before);
 });
 it("does not expose or replace a failed Vault key service",async()=>{
  const s=await setup(),before=[await count("vault.secrets"),await count("parent_private.snap_final_packets")];
  await fixture.admin.query("create or replace function vault.create_secret(text) returns uuid language plpgsql as $$begin raise exception 'PRIVATE_SYNTHETIC_KEY_FAILURE';end$$");
  try{await expect(tx(()=>begin(s))).rejects.toMatchObject({message:"protected SNAP staging failed"});}
  finally{await fixture.admin.query(vaultCreateDouble);}
  expect([await count("vault.secrets"),await count("parent_private.snap_final_packets")]).toEqual(before);
 });
 it.each(["snap_protected_enabled=false","snap_protected_policy_version=null","snap_protected_retention_policy_version=null","snap_protected_max_retention_seconds=null","snap_protected_approval_reference=null","snap_protected_approved_until=now()-interval '1 second'"])("fails closed for %s",async assignment=>{
  const s=await setup();await fixture.admin.query(`update parent_private.processing_controls set ${assignment}`);
  await expect(tx(()=>begin(s))).rejects.toMatchObject({code:"42501"});
 });
 it.each(["authorization","request","snapshot","snapshotHash","version"] as const)("denies changed %s during both creation and retrieval",async field=>{
  const s=await setup(),b=await stage(s),changed=field==="version"?s.version+1:field==="snapshotHash"?"f".repeat(64):randomUUID();
  await expect(tx(()=>begin(s,{[field]:changed}))).rejects.toMatchObject({code:"42501"});
  await expect(tx(()=>read(s,b.binding.packetId,{[field]:changed}))).rejects.toMatchObject({code:"42501"});
 });
 it.each(["subject","policy","retention","owner","future_consent","expired_consent"] as const)("requires recorded exact %s authority",async field=>{
  const s=await setup(),id=randomUUID(),key=randomUUID();
  const changes:Record<string,unknown>={id,packet_id:key};
  if(field==="subject")changes.subject_ids=[randomUUID()];
  if(field==="policy")changes.policy_version="different-policy";
  if(field==="retention")changes.retention_policy_version="different-retention";
  if(field==="owner"){const other=await setup();changes.owner_id=other.owner;}
  if(field==="future_consent"){changes.consented_at=new Date(Date.now()+60000).toISOString();changes.created_at=new Date(Date.now()+60000).toISOString();}
  if(field==="expired_consent"){changes.consented_at=new Date(Date.now()-20000).toISOString();changes.expires_at=new Date(Date.now()-10000).toISOString();}
  await fixture.admin.query(`insert into parent_private.snap_final_packet_authorizations select (jsonb_populate_record(null::parent_private.snap_final_packet_authorizations,to_jsonb(a)||$2::jsonb)).* from parent_private.snap_final_packet_authorizations a where id=$1`,[s.authorization,JSON.stringify(changes)]);
  await expect(tx(()=>begin(s,{authorization:id,key}))).rejects.toMatchObject({code:"42501"});
 });
 it.each(["other-purpose","other-recipient","other-need"])("never accepts %s metadata",async variant=>{
  const s=await setup(),changes={id:randomUUID(),packet_id:randomUUID(),...(variant==="other-purpose"?{purpose:"other_program"}:variant==="other-recipient"?{recipient:"other-provider"}:{need:"snap_renewal"})};
  await expect(fixture.admin.query(`insert into parent_private.snap_final_packet_authorizations select (jsonb_populate_record(null::parent_private.snap_final_packet_authorizations,to_jsonb(a)||$2::jsonb)).* from parent_private.snap_final_packet_authorizations a where id=$1`,[s.authorization,JSON.stringify(changes)])).rejects.toMatchObject({code:"23514"});
 });
 it.each(["iv","tag","ciphertext"] as const)("rejects invalid %s without losing the pending transaction",async field=>{
  const s=await setup();await tx(async()=>{const b=await begin(s);await expect(seal(s,b,{[field]:Buffer.alloc(1)})).rejects.toMatchObject({code:"23514"});await seal(s,b);});
 });
 it("rejects a staging idempotency key reused for different bytes",async()=>{
  const s=await setup();await tx(async()=>{const b=await begin(s);await expect(begin(s,{},"e".repeat(64))).rejects.toMatchObject({code:"23514"});await seal(s,b);});
 });
 it.each(["anon","authenticated","service_role","parent_worker","parent_storage_broker","parent_retention_worker"] as const)("denies %s packet/key access and staging calls",async actor=>{
  const s=await setup();
  for(const table of ["snap_final_packets","snap_final_packet_authorizations"])
   await expect(tx(()=>role(actor,`select * from parent_private.${table}`))).rejects.toMatchObject({code:"42501"});
  await expect(tx(()=>role(actor,"select parent_private.parent_begin_snap_final_packet($1,$2,$3,$4,$5,$6,$7,$8)",[s.authorization,s.request,s.version,s.snapshot,s.snapshotHash,digest,payload.length,s.key]))).rejects.toMatchObject({code:"42501"});
 });
 it("keeps the finalizer away from direct tables/Vault and arbitrary Vault identifiers",async()=>{
  const s=await setup();for(const table of ["parent_private.snap_final_packets","parent_private.snap_final_packet_authorizations","vault.decrypted_secrets"])
   await expect(tx(()=>role("parent_snap_finalizer",`select * from ${table}`))).rejects.toMatchObject({code:"42501"});
  await expect(tx(()=>read(s,randomUUID()))).rejects.toMatchObject({code:"42501"});
 });
 it("rejects the old association route for unrelated ordinary operations without verified canonical content",async()=>{
  const s=await setup(),b=await stage(s),first=await operation(s),second=await operation(s,true);
  await expect(tx(()=>bind(s,b.binding.packetId,first))).rejects.toMatchObject({code:"42501"});
  await expect(tx(()=>bind(s,b.binding.packetId,second))).rejects.toMatchObject({code:"42501"});
  expect((await fixture.admin.query("select operation_id from parent_private.snap_final_packets where id=$1",[b.binding.packetId])).rows[0].operation_id).toBeNull();
  expect((await fixture.admin.query("select state,executed_at,artifact_id from public.parent_operations where id=$1",[first])).rows[0]).toEqual({state:"prepared",executed_at:null,artifact_id:null});
  expect((await fixture.admin.query("select count(*)::int n from parent_private.snap_submission_authorizations where operation_id=$1",[first])).rows[0].n).toBe(0);
  expect((await tx(()=>read(s,b.binding.packetId))).binding).toEqual(b.binding);
 });
 it.each(["request","version","state","permission"] as const)("rejects a different operation %s",async field=>{
  const s=await setup(),b=await stage(s);let op:string;
  if(field==="request")op=await operation(await setup());
  else{op=await operation(s);if(field==="version")await fixture.admin.query("update public.parent_requests set version=version+1 where id=$1",[s.request]);
   if(field==="state")await fixture.admin.query("update public.parent_operations set state='failed' where id=$1",[op]);
   if(field==="permission")await fixture.admin.query("update parent_private.provider_capabilities set permission_version='different-synthetic-permission' where program_id='snap-pa' and action='submit'");}
  await expect(tx(()=>bind(s,b.binding.packetId,op))).rejects.toMatchObject({code:"42501"});
 });
 it.each(["iv","tag","ciphertext","aad","content_sha256","expires_at"] as const)("makes stored %s immutable",async field=>{
  const s=await setup(),b=await stage(s);
  const expression=field==="content_sha256"?"repeat('f',64)":field==="expires_at"?"expires_at+interval '1 second'":"decode('00','hex')";
  await expect(fixture.admin.query(`update parent_private.snap_final_packets set ${field}=${expression} where id=$1`,[b.binding.packetId])).rejects.toMatchObject({code:"23514"});
 });
 it.each(["revocation","correction","cancel"] as const)("denies and purges unattempted data/key after %s",async event=>{
  const s=await setup(),b=await stage(s),keyId=(await fixture.admin.query("select vault_secret_id from parent_private.snap_final_packets where id=$1",[b.binding.packetId])).rows[0].vault_secret_id;
  if(event==="revocation")await fixture.admin.query("update parent_private.snap_final_packet_authorizations set revoked_at=clock_timestamp() where id=$1",[s.authorization]);
  else if(event==="correction")await fixture.admin.query("update public.parent_requests set version=version+1 where id=$1",[s.request]);
  else await tx(()=>role("authenticated","select public.parent_control_request($1,'cancel')",[s.request],s.owner));
  await expect(tx(()=>read(s,b.binding.packetId))).rejects.toMatchObject({code:"42501"});await purge();
  expect((await fixture.admin.query("select 1 from parent_private.snap_final_packets where id=$1",[b.binding.packetId])).rows).toEqual([]);
  expect((await fixture.admin.query("select 1 from vault.secrets where id=$1",[keyId])).rows).toEqual([]);
 });
 it("deletes attempted canonical data/key at explicit expiry while keeping it until then",async()=>{
  const s=await setup("0.25 seconds"),b=await stage(s),op=await operation(s),keyId=(await fixture.admin.query("select vault_secret_id from parent_private.snap_final_packets where id=$1",[b.binding.packetId])).rows[0].vault_secret_id;
  // Synthetic attempted-retention state only; the production binder rejects this ordinary ZIP operation.
  await fixture.admin.query("update parent_private.snap_final_packets set operation_id=$2 where id=$1",[b.binding.packetId,op]);
  await fixture.admin.query("update public.parent_operations set executed_at=clock_timestamp(),state='delivery_unknown' where id=$1",[op]);
  await fixture.admin.query("update parent_private.snap_final_packet_authorizations set revoked_at=clock_timestamp() where id=$1",[s.authorization]);
  await purge();expect((await fixture.admin.query("select 1 from parent_private.snap_final_packets where id=$1",[b.binding.packetId])).rows).toHaveLength(1);
  await delay(270);await purge();expect((await fixture.admin.query("select 1 from parent_private.snap_final_packets where id=$1",[b.binding.packetId])).rows).toEqual([]);
  expect((await fixture.admin.query("select 1 from vault.secrets where id=$1",[keyId])).rows).toEqual([]);
 });
 it("stops old bytes after an actual saved application correction",async()=>{
  const s=await setup(),b=await stage(s),details=fixtureSnapApplication(new Date());details.applicant!.firstName="Changed";details.household![0].firstName="Changed";
  await tx(()=>role("authenticated","select public.parent_save_snap_application_details($1,$2,$3,$4,$5)",[s.request,s.version,JSON.stringify(details),SNAP_APPLICATION_NOTICE_VERSION,randomUUID()],s.owner));
  await expect(tx(()=>read(s,b.binding.packetId))).rejects.toMatchObject({code:"42501"});await purge();
  expect((await fixture.admin.query("select 1 from parent_private.snap_final_packets where id=$1",[b.binding.packetId])).rows).toEqual([]);
 });
 it("deletes the linked key on purpose/request erasure",async()=>{
  const s=await setup(),b=await stage(s),id=(await fixture.admin.query("select vault_secret_id from parent_private.snap_final_packets where id=$1",[b.binding.packetId])).rows[0].vault_secret_id;
  await fixture.admin.query("delete from parent_private.snap_final_packet_authorizations where id=$1",[s.authorization]);
  expect((await fixture.admin.query("select 1 from vault.secrets where id=$1",[id])).rows).toEqual([]);
 });
 it("erases revoked unattempted packet/key data even after all processing is closed",async()=>{
  const s=await setup(),b=await stage(s),id=(await fixture.admin.query("select vault_secret_id from parent_private.snap_final_packets where id=$1",[b.binding.packetId])).rows[0].vault_secret_id;
  await fixture.admin.query("update parent_private.snap_final_packet_authorizations set revoked_at=clock_timestamp() where id=$1",[s.authorization]);
  await fixture.admin.query("update parent_private.processing_controls set enabled=false,snap_details_enabled=false,snap_protected_enabled=false");
  await expect(tx(()=>read(s,b.binding.packetId))).rejects.toMatchObject({code:"42501"});await purge();
  expect((await fixture.admin.query("select 1 from parent_private.snap_final_packets where id=$1",[b.binding.packetId])).rows).toEqual([]);
  expect((await fixture.admin.query("select 1 from vault.secrets where id=$1",[id])).rows).toEqual([]);
 });
});
