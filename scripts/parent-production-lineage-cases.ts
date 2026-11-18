import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { fixtureIntake, fixtureMandate, fixtureSnapApplication } from "../src/lib/parent/test-fixtures";
import { DOCUMENT_CONSENT_VERSION, SNAP_APPLICATION_NOTICE_VERSION } from "../src/lib/parent/constants";
import { runOneParentJob, type WorkerDatabase } from "../src/lib/parent/worker-runtime";
import { foodAccessPlanSchema, foodAccessReportSchema } from "../src/lib/parent/food-access";
import { foodAccessAlternativesSchema } from "../src/lib/parent/food-access-alternatives";
import type { SupportRequest } from "../src/lib/parent/domain";
import { applyPendingProductionSources, lineageHash, loadProductionLineage } from "./parent-production-lineage";

/** All identities/records below are created here; fake non-PDF packet bytes prove SQL authority only. */
export async function rehearseParentProductionUpgrade(db:WorkerDatabase,options:{embedded:boolean;peer?:WorkerDatabase}){
  const lineage=loadProductionLineage(),owner=randomUUID(),session=randomUUID(),other=randomUUID(),otherSession=randomUUID();
  const actors=new Map([[owner,session],[other,otherSession]]);
  const call=async(actor:string,sql:string,values:unknown[]=[],user=owner,connection=db)=>{
    await connection.query("begin");
    try{await connection.query(`set local role ${actor}`);await connection.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role:actor,...(actor==="authenticated"?{sub:user,session_id:actors.get(user),amr:[{method:"otp"}]}:{})})]);const result=await connection.query(sql,values);await connection.query("commit");return result;}
    catch(error){await connection.query("rollback");throw error;}
  };
  const parent=(sql:string,values:unknown[]=[])=>call("authenticated",sql,values);
  const value=async(sql:string,args:unknown[]=[])=> (await db.query(sql,args)).rows[0].value;
  const request=async(id:string)=>(await value("select to_jsonb(r) value from public.parent_requests r where id=$1",[id])) as SupportRequest;
  const row=async(table:string,key:string)=>value(`select to_jsonb(r) value from ${table} r where id=$1`,[key]) as Promise<Record<string,unknown>>;
  if(options.embedded){
    for(const sql of ["create schema vault","create schema extensions","create table vault.secrets(id uuid primary key default gen_random_uuid(),secret text not null)","create view vault.decrypted_secrets as select id,secret decrypted_secret from vault.secrets",
      "create function vault.create_secret(text) returns uuid language sql as $$insert into vault.secrets(secret) values($1) returning id$$","create function extensions.gen_random_bytes(integer) returns bytea language sql as $$select decode(repeat('ab',$1),'hex')$$"])await db.query(sql);
  }else assert.ok(await value("select to_regprocedure('vault.create_secret(text,text,text)')::text value"),"Native rehearsal requires its real local Vault schema");
  await db.query("create role caselink_lineage_worker_fixture login connection limit 2 valid until 'infinity'");
  await db.query("grant parent_worker to caselink_lineage_worker_fixture");
  await db.query(`update parent_private.processing_controls set enabled=true,approval_reference='SYNTHETIC lineage only',approved_until='infinity',
    snap_details_enabled=true,snap_details_approval_reference='SYNTHETIC lineage only',snap_details_approved_until='infinity',snap_details_notice_version=$1,
    snap_protected_enabled=true,snap_protected_approval_reference='SYNTHETIC lineage only',snap_protected_approved_until='infinity',
    snap_protected_policy_version='synthetic-policy-1',snap_protected_retention_policy_version='synthetic-retention-1',snap_protected_max_retention_seconds=300,
    model_call_limit=1,model_budget_started_at=clock_timestamp()`,[SNAP_APPLICATION_NOTICE_VERSION]);
  assert.equal(await value("select parent_private.reserve_model_capacity() value"),true); // One synthetic spent reservation exhausts this fixture's existing budget.
  for(const [id,sid]of actors){await db.query("insert into auth.users(id,email,email_confirmed_at,created_at) values($1,$2,now(),now())",[id,`${id}@example.invalid`]);await db.query("insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values($1,$2,now(),now(),now()+interval '1 day')",[sid,id]);await call("authenticated","select public.parent_ensure_account()",[],id);}
  const start=async(intake:unknown,mandate:unknown,key=randomUUID())=>String((await parent("select public.parent_start_request($1,$2,$3) id",[JSON.stringify(intake),JSON.stringify(mandate),key])).rows[0].id);
  const mandate=(overrides:Parameters<typeof fixtureMandate>[0]={})=>fixtureMandate({expiresAt:new Date(Date.now()+86400000).toISOString(),...overrides});
  const ordinary=await start(fixtureIntake({needs:["snap_pending"],utilityProviders:[]}),mandate({recipientIds:["uesf-benefits"]}));
  const original=await start(fixtureIntake({needs:["snap_new"],utilityProviders:[]}),mandate({recipientIds:["snap-pa"]}));
  const details=fixtureSnapApplication(new Date()),snapshot=String((await parent("select public.parent_save_snap_application_details($1,1,$2,$3,$4) id",[original,JSON.stringify(details),SNAP_APPLICATION_NOTICE_VERSION,randomUUID()])).rows[0].id);
  const version=(await request(original)).version,hash=String((await db.query("select parent_private.snap_application_binding($1,$2)->>'snapshotHash' hash",[original,version])).rows[0].hash);
  const acts=["applicant_signature_printed_page_1","rights_certification_printed_page_5"],packet=randomUUID(),acquisition=randomUUID(),bytes=11,digest=lineageHash("SYNTHETIC_NONPDF_LINEAGE_METADATA");
  await db.query(`insert into parent_private.provider_capabilities(program_id,action,enabled,transport_verified,requires_form,permission_version,permission_reference,allowed_fields,field_categories,required_acts,verified_until,snap_direct_completion_version,snap_direct_completion_evidence_reference)
    values('snap-pa','submit',true,true,true,'synthetic-lineage','SYNTHETIC ONLY; no provider acceptance',array['protectedSnapPacket','incomeAmount'],'{"protectedSnapPacket":"household","incomeAmount":"income"}',$1,now()+interval '1 hour','pa600fs-direct-completion-2026-11-05.v1','SYNTHETIC method only')
    on conflict(program_id,action) do update set enabled=true,transport_verified=true,requires_form=true,permission_version=excluded.permission_version,permission_reference=excluded.permission_reference,allowed_fields=excluded.allowed_fields,field_categories=excluded.field_categories,required_acts=excluded.required_acts,verified_until=excluded.verified_until,snap_direct_completion_version=excluded.snap_direct_completion_version,snap_direct_completion_evidence_reference=excluded.snap_direct_completion_evidence_reference`,[acts]);
  await db.query(`insert into parent_private.provider_capabilities(program_id,action,enabled,transport_verified,requires_form,permission_version,permission_reference,allowed_fields,field_categories,required_acts,verified_until)
    values('snap-pa','follow_up',true,true,false,'synthetic-lineage','SYNTHETIC read-only protocol only',array['protectedSnapPacket'],'{"protectedSnapPacket":"household"}','{}',now()+interval '1 hour')
    on conflict(program_id,action) do update set enabled=true,transport_verified=true,permission_version=excluded.permission_version,permission_reference=excluded.permission_reference,allowed_fields=excluded.allowed_fields,field_categories=excluded.field_categories,required_acts=excluded.required_acts,verified_until=excluded.verified_until`);
  await parent("select public.parent_authorize_snap_direct_acquisition($1,$2,$3,$4,$5,'synthetic-policy-1','synthetic-retention-1',$6,true,date_trunc('milliseconds',clock_timestamp()+interval '4 minutes'))",[original,version,snapshot,hash,acquisition,details.household!.filter(p=>p.requestingSnap).map(p=>p.id)]);
  const authorization=String(((await parent("select public.parent_authorize_snap_direct_packet($1,$2,$3,$4,$5,$6,$7,$8) value",[original,version,snapshot,hash,packet,digest,bytes,acquisition])).rows[0].value as {intent:{authorizationId:string}}).intent.authorizationId);
  let verified:{verificationId:string};await db.query("begin");
  try{await db.query("set local role parent_snap_finalizer");await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role:"parent_snap_finalizer"})]);
    await db.query("select parent_private.parent_begin_snap_final_packet($1,$2,$3,$4,$5,$6,$7,$8)",[authorization,original,version,snapshot,hash,digest,bytes,packet]);
    await db.query("select parent_private.parent_seal_snap_final_packet($1,$2,$3,$4,decode(repeat('ab',12),'hex'),decode(repeat('ab',16),'hex'),decode(repeat('ab',$5),'hex'))",[packet,original,version,authorization,bytes]);
    verified=(await db.query("select parent_private.parent_record_snap_direct_construction($1,$2,$3,$4) value",[packet,original,version,authorization])).rows[0].value as {verificationId:string};await db.query("commit");
  }catch(error){await db.query("rollback");throw error;}
  const operation=String((await call("parent_snap_finalizer","select parent_private.parent_prepare_snap_final_operation($1,$2,$3,$4,$5) id",[packet,original,version,authorization,verified.verificationId])).rows[0].id);
  const document=(await parent("select to_jsonb(public.parent_register_document($1,'legacy.pdf','application/pdf',11,null,$2)) value",[original,DOCUMENT_CONSENT_VERSION])).rows[0].value as Record<string,unknown>;
  const oldClaim=(await call("parent_worker","select parent_private.parent_claim_job(15,true) value")).rows[0].value as {jobId:string;leaseToken:string;request:{id:string}};
  assert.equal(oldClaim.request.id,original,"Installed two-argument pre-Submit continuation is claimable");
  await assert.rejects(call("parent_worker","select parent_private.parent_begin_operation($1,$2,$3)",[operation,oldClaim.jobId,oldClaim.leaseToken]),{code:"42501"});
  const preserved={request:await row("public.parent_requests",original),snapshot:await row("public.parent_snap_application_details",snapshot),packet:await row("parent_private.snap_final_packets",packet),operation:await row("public.parent_operations",operation),document,job:await row("public.parent_jobs",oldClaim.jobId),controls:await value("select to_jsonb(c) value from parent_private.processing_controls c") as Record<string,unknown>};
  const oldReservations=await value("select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) value from parent_private.model_call_reservations r") as Record<string,unknown>[];
  const oldCapabilities=await value("select jsonb_agg(to_jsonb(c) order by c.program_id,c.action) value from parent_private.provider_capabilities c") as Record<string,unknown>[];
  const login=async()=>value("select jsonb_build_object('login',rolcanlogin,'limit',rolconnlimit,'validUntil',rolvaliduntil::text,'membership',pg_has_role('caselink_lineage_worker_fixture','parent_worker','member')) value from pg_roles where rolname='caselink_lineage_worker_fixture'");
  const oldLogin=await login();
  const applied=await applyPendingProductionSources(db,lineage);
  for(const [table,id,key]of [["public.parent_requests",original,"request"],["public.parent_snap_application_details",snapshot,"snapshot"],["parent_private.snap_final_packets",packet,"packet"],["public.parent_operations",operation,"operation"],["public.parent_documents",String(document.id),"document"],["public.parent_jobs",oldClaim.jobId,"job"]]as const){
    const after=await row(table,id);for(const [field,before]of Object.entries(preserved[key]))assert.deepEqual(after[field],before,`Upgrade changed original ${key}.${field}`);
  }
  const controls=await value("select to_jsonb(c) value from parent_private.processing_controls c") as Record<string,unknown>;
  for(const [field,before]of Object.entries(preserved.controls))assert.deepEqual(controls[field],before,`Upgrade changed operating control ${field}`);
  const reservations=await value("select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) value from parent_private.model_call_reservations r") as Record<string,unknown>[];
  assert.equal(reservations.length,oldReservations.length);for(const [index,before]of oldReservations.entries()){for(const [field,setting]of Object.entries(before))assert.deepEqual(reservations[index][field],setting);assert.equal(reservations[index].purpose,null);} // New nullable attribution never refunds a legacy reservation.
  const capabilities=await value("select jsonb_agg(to_jsonb(c) order by c.program_id,c.action) value from parent_private.provider_capabilities c") as Record<string,unknown>[];
  for(const before of oldCapabilities){const after=capabilities.find(row=>row.program_id===before.program_id&&row.action===before.action)!;for(const [field,setting]of Object.entries(before))assert.deepEqual(after[field],setting,`Upgrade changed provider ${before.program_id}.${field}`);}
  for(const capability of capabilities)if(capability.program_id!=="snap-pa")assert.equal(capability.enabled,false);
  for(const [field,setting]of Object.entries(controls))if(/^(?:peco|pgw|water|wic|family_profile|food_description).*enabled$/.test(field))assert.equal(setting,false,`New purpose unexpectedly enabled: ${field}`);
  assert.deepEqual(await login(),oldLogin);assert.equal(await value("select parent_private.processing_enabled() value"),true);
  assert.equal(await value("select parent_private.reserve_model_capacity() value"),false,"An exhausted original budget stays exhausted");
  await db.query("begin");await db.query("update parent_private.processing_controls set approved_until=null");assert.equal(await value("select parent_private.processing_enabled() value"),false);await db.query("rollback");
  const window=(await parent("select public.parent_authorization_window() value")).rows[0].value as {issuedAt:string;expiresAt:string};assert.equal(Date.parse(window.expiresAt)-Date.parse(window.issuedAt),30*86400000);
  for(const f of lineage.functions){const after=(await db.query("select pg_get_userbyid(proowner) owner,to_jsonb(proacl) acl,to_jsonb(proconfig) config,prosecdef from pg_proc where oid=$1::regprocedure",[f.signature])).rows[0];assert.equal(after.owner,f.owner);assert.deepEqual((after.acl as string[]).sort(),[...f.acl].sort());assert.deepEqual(after.config,f.searchPath);assert.equal(after.prosecdef,f.securityDefiner);if(f.signature.includes("snap_test")||f.signature.includes("snap_controlled_test")||f.signature.includes("preserve_snap_test")||["parent_private.processing_enabled()","parent_authorization_window()"].includes(f.signature))assert.equal(lineageHash(String(await value("select pg_get_functiondef($1::regprocedure) value",[f.signature]))),f.sha256);}
  if(options.peer){const lease=await value("select lease_until::text value from public.parent_jobs where id=$1",[oldClaim.jobId]),remaining=Date.parse(String(lease))-Date.now();if(remaining>2000)assert.equal((await call("parent_worker","select parent_private.parent_claim_job(15,true,true,false) value",[],owner,options.peer)).rows[0].value,null,"A second real connection cannot acquire the preserved live lease");const wait=Math.max(0,remaining+75);assert.ok(wait<=16000);await delay(wait);}
  else await db.query("update public.parent_jobs set lease_until=now()-interval '1 second' where id=$1",[oldClaim.jobId]); // Explicit embedded-only expiry double; native waits for real expiry.
  let external=0,publicQueries=0,unexpectedPublicReads=0;
  const forbidden=async()=>{external++;throw new Error("No external model/provider/Storage action is permitted");};
  const source={objectid:122,site_name:"Share Community Fridge",address:"2901 W Hunting Park Ave",zip_code:"19129",status:"Active",category_type:"Food Site"};
  const cityRequest=(input:RequestInfo|URL,init?:RequestInit)=>{try{const url=new URL(String(input));assert.equal(url.origin,"https://services.arcgis.com");assert.ok(url.pathname.endsWith("/FeatureServer/0/query"));assert.equal(url.username+url.password+url.hash,"");assert.equal(init?.method??"GET","GET");assert.ok(!init?.body);assert.equal(new Headers(init?.headers).has("authorization"),false);assert.equal(url.searchParams.get("f"),"json");assert.equal(url.searchParams.get("returnGeometry"),"false");assert.ok(["objectid=122","zip_code='19129' AND status='Active'"].includes(url.searchParams.get("where")??""));return url;}catch(error){unexpectedPublicReads++;throw error;}};
  const fetcher:typeof fetch=async(input,init)=>{const url=cityRequest(input,init);publicQueries++;if(url.searchParams.get("where")==="objectid=122")return Response.json({features:[{attributes:source}]});return Response.json({features:[{attributes:source},{attributes:{...source,objectid:148,site_name:"Synthetic public pantry",address:"10 Synthetic Street"}},{attributes:{...source,objectid:149,status:"Inactive"}},{attributes:{...source,objectid:150,category_type:"School Meal Site"}}]});};
  const work=(protectedReady=false)=>runOneParentJob({database:{query:(sql,args)=>call("parent_worker",sql,args)},continuationOnly:true,brokerOrigin:"http://127.0.0.1:3310",brokerSecret:"synthetic-lineage-no-real-secret-32chars",supabaseOrigin:"http://127.0.0.1:55321",fetcher,coordinate:forbidden,...(protectedReady?{protectedSnapSubmission:{execute:forbidden,reconcile:forbidden}}:{})});
  assert.deepEqual(await work(true),{state:"saved"});assert.ok((await request(original)).required_actions.some(action=>action.field==="snap_final_submit"));
  assert.deepEqual(await row("public.parent_operations",operation),preserved.operation);
  assert.equal((await db.query("select count(*)::int n from parent_private.snap_submission_authorizations where operation_id=$1",[operation])).rows[0].n,0);
  // Synthetic personal acts permit a DB-only intent; no provider is contacted. A lost lease must reconcile, never resend.
  await parent("select public.parent_authorize_snap_protected_submission($1,$2,$3,$4,$5,$6,$7)",[original,operation,version,preserved.operation.packet_hash,packet,digest,acts]);
  const dispatchClaim=(await call("parent_worker","select parent_private.parent_claim_job(15,true,true,false) value")).rows[0].value as {jobId:string;leaseToken:string};
  await call("parent_worker","select parent_private.parent_begin_operation($1,$2,$3)",[operation,dispatchClaim.jobId,dispatchClaim.leaseToken]);
  if(options.peer){const lease=await value("select lease_until::text value from public.parent_jobs where id=$1",[dispatchClaim.jobId]);const wait=Math.max(0,new Date(String(lease)).getTime()-Date.now()+75);assert.ok(wait<=16000);await delay(wait);}
  else await db.query("update public.parent_jobs set lease_until=now()-interval '1 second' where id=$1",[dispatchClaim.jobId]);
  const recovery=(await call("parent_worker","select parent_private.parent_claim_job(15,true,true,false) value",[],owner,options.peer??db)).rows[0].value as {jobId:string;leaseToken:string;unknownOperations:{id:string;state:string}[]};
  assert.ok(recovery.unknownOperations.some(row=>row.id===operation&&row.state==="delivery_unknown"));
  await assert.rejects(call("parent_worker","select parent_private.parent_begin_operation($1,$2,$3)",[operation,recovery.jobId,recovery.leaseToken]),{code:"42501"});
  await assert.rejects(call("parent_worker","select parent_private.parent_begin_operation($1,$2,$3)",[operation,dispatchClaim.jobId,dispatchClaim.leaseToken]),{code:"42501"});
  const uncertain=await request(original);
  await call("parent_worker","select parent_private.parent_save_job_plan($1,$2,$3,$4,$5,clock_timestamp()+interval '31 seconds','caselink','scheduled_follow_up')",[recovery.jobId,recovery.leaseToken,uncertain.version,JSON.stringify(uncertain.plan),JSON.stringify(uncertain.required_actions)]);
  if(options.peer){const due=await value("select run_at::text value from public.parent_jobs where id=$1",[recovery.jobId]);const wait=Math.max(0,Date.parse(String(due))-Date.now()+75);assert.ok(wait<=32000);await delay(wait);}
  else await db.query("update public.parent_jobs set run_at=now()-interval '1 second' where id=$1",[recovery.jobId]);
  let reconciliations=0;
  assert.deepEqual(await runOneParentJob({database:{query:(sql,args)=>call("parent_worker",sql,args)},continuationOnly:true,brokerOrigin:"http://127.0.0.1:3310",brokerSecret:"synthetic-lineage-no-real-secret-32chars",supabaseOrigin:"http://127.0.0.1:55321",fetcher:forbidden,coordinate:forbidden,
    protectedSnapSubmission:{execute:forbidden,reconcile:async intent=>{reconciliations++;assert.equal(intent.operationId,operation);assert.equal(intent.packetHash,preserved.operation.packet_hash);assert.equal(intent.protectedPacket.packetId,packet);return{operationId:operation,packetId:packet,contentSha256:digest,state:"delivery_unknown"};}}}),{state:"saved"});
  assert.equal(reconciliations,1);assert.equal((await row("public.parent_operations",operation)).state,"delivery_unknown");
  const adopted=(await parent("select public.parent_register_document($1,'legacy.pdf','application/pdf',11,null,$2,$3,$4) value",[original,DOCUMENT_CONSENT_VERSION,document.id,digest])).rows[0].value as {document:Record<string,unknown>;existing:boolean};
  assert.equal(adopted.existing,true);for(const field of ["id","object_path","created_at","consented_at","expires_at"])assert.deepEqual(adopted.document[field],document[field]);assert.equal(adopted.document.upload_key,document.id);assert.equal(adopted.document.upload_confirmed_at,null);
  await assert.rejects(parent("select public.parent_register_document($1,'changed.pdf','application/pdf',11,null,$2,$3,$4)",[original,DOCUMENT_CONSENT_VERSION,document.id,digest]),{code:"PT409"});
  await assert.rejects(call("authenticated","select public.parent_register_document($1,'legacy.pdf','application/pdf',11,null,$2,$3,$4)",[original,DOCUMENT_CONSENT_VERSION,document.id,digest],other),{code:"42501"});
  // Independent routing reuses the old ordinary ZIP; applicant-home answers retain their own dates/source.
  const routedIntake=fixtureIntake({needs:["snap_new"],utilityProviders:[]}),routedMandate=mandate({recipientIds:["snap-pa"]}),routedDetails=fixtureSnapApplication(new Date());routedDetails.zip="19129";
  const sourceZip=(await parent("select public.parent_reusable_zip() value")).rows[0].value as {sourceRequestId:string;sourceVersion:number;value:string};assert.ok([ordinary,original].includes(sourceZip.sourceRequestId));assert.equal(sourceZip.value,"19104");
  const routingKey=randomUUID(),routingArgs=[JSON.stringify(routedIntake),JSON.stringify(routedMandate),JSON.stringify(routedDetails),SNAP_APPLICATION_NOTICE_VERSION,routingKey,sourceZip.sourceRequestId,sourceZip.sourceVersion];
  const routed=String((await parent("select public.parent_start_snap_application_with_routing($1,$2,$3,$4,$5,$6,$7) id",routingArgs)).rows[0].id);
  assert.equal((await request(routed)).intake.zip,"19104");assert.equal((await value("select details value from public.parent_snap_application_details where request_id=$1 order by revision desc limit 1",[routed]) as {zip:string}).zip,"19129");
  const corrected={...routedDetails,phone:"215-555-0104"};await parent("select public.parent_save_snap_application_details($1,$2,$3,$4,$5)",[routed,(await request(routed)).version,JSON.stringify(corrected),SNAP_APPLICATION_NOTICE_VERSION,randomUUID()]);
  assert.equal((await request(routed)).intake.zip,"19104");await parent("select public.parent_control_request($1,'cancel')",[sourceZip.sourceRequestId]);
  const historical=await request(routed);assert.equal(String((await parent("select public.parent_start_snap_application_with_routing($1,$2,$3,$4,$5,$6,$7) id",routingArgs)).rows[0].id),routed);assert.deepEqual(await request(routed),historical);
  await assert.rejects(parent("select public.parent_start_snap_application_with_routing($1,$2,$3,$4,$5,$6,$7)",[...routingArgs.slice(0,2),JSON.stringify({...routedDetails,phone:"215-555-0105"}),...routingArgs.slice(3)]),{code:"PT409"});
  // Actual installed fictional classification cannot be removed or become an agency outcome.
  await db.query("update public.parent_requests set controlled_test=true where id=$1",[original]);
  await assert.rejects(db.query("update public.parent_requests set controlled_test=false where id=$1",[original]),{code:"42501"});
  const beforeFictionalOutcome=await row("public.parent_operations",operation);
  await assert.rejects(db.query("update public.parent_operations set state='agency_submitted' where id=$1",[operation]),{code:"42501"});
  assert.deepEqual(await row("public.parent_operations",operation),beforeFictionalOutcome);
  if((await request(original)).status!=="cancelled")await parent("select public.parent_control_request($1,'cancel')",[original]);
  const mixed=await start(fixtureIntake({needs:["food_now","snap_pending"],zip:"19129",householdSize:null,incomeAmount:null,utilityProviders:[]}),mandate({mode:"prepare_only",recipientIds:["share-community-fridge-19129","snap-pa"],allowedActions:["research","prepare"],allowedData:["household"]}));
  assert.deepEqual(await work(),{state:"saved"});let mixedRequest=await request(mixed),access=foodAccessPlanSchema.parse(mixedRequest.plan!.routes.find(route=>route.need==="food_now")!.foodAccess);assert.equal(access.state,"prepared");assert.equal(mixedRequest.status,"active");
  const reportArgs=[mixed,mixedRequest.version,access.site.id,access.planHash,randomUUID(),"no_food"];
  const negative=foodAccessReportSchema.parse((await parent("select public.parent_report_food_visit($1,$2,$3,$4,$5,$6) value",reportArgs)).rows[0].value);
  assert.deepEqual(await work(),{state:"saved"});mixedRequest=await request(mixed);const route=mixedRequest.plan!.routes.find(route=>route.need==="food_now")!;
  const directory=foodAccessAlternativesSchema.parse(route.foodAccessAlternatives);assert.deepEqual(directory.sourceReport,negative);assert.deepEqual(directory.sites.map(site=>site.id),[148]);assert.equal(directory.availability,"city_listed_unconfirmed");
  const beforeReplay=await request(mixed);assert.deepEqual((await parent("select public.parent_report_food_visit($1,$2,$3,$4,$5,$6) value",reportArgs)).rows[0].value,negative);assert.deepEqual(await request(mixed),beforeReplay);
  access=foodAccessPlanSchema.parse(route.foodAccess);await parent("select public.parent_report_food_visit($1,$2,$3,$4,$5,'received_enough_food')",[mixed,mixedRequest.version,access.site.id,access.planHash,randomUUID()]);
  assert.deepEqual(await work(),{state:"saved"});assert.equal((await request(mixed)).status,"active","Food cannot close the independent benefit need");
  const beforeCompletion=(await request(mixed)).version;await parent("select public.parent_report_outcome($1,'snap_pending','support_received','SYNTHETIC parent-attributed benefits report')",[mixed]);assert.equal((await request(mixed)).closed_reason,"completed");assert.equal((await request(mixed)).version,beforeCompletion+1);assert.deepEqual(await work(),{state:"idle"});assert.equal((await request(routed)).status,"active");
  const receiptRequest=await start(fixtureIntake({needs:["snap_pending"],utilityProviders:[]}),mandate({recipientIds:["uesf-benefits"]})),updateKey=randomUUID(),update={action:"answer_fact",version:1,need:"snap_pending",field:"householdSize",value:2};
  const ack=(await parent("select public.parent_apply_support_update($1,$2,$3) value",[receiptRequest,updateKey,JSON.stringify(update)])).rows[0].value;
  await parent("select public.parent_apply_support_update($1,$2,$3)",[receiptRequest,randomUUID(),JSON.stringify({...update,version:2,value:4})]);const current=await request(receiptRequest);
  assert.deepEqual((await parent("select public.parent_apply_support_update($1,$2,$3) value",[receiptRequest,updateKey,JSON.stringify(update)])).rows[0].value,ack);assert.deepEqual(await request(receiptRequest),current);
  await assert.rejects(parent("select public.parent_apply_support_update($1,$2,$3)",[receiptRequest,updateKey,JSON.stringify({...update,value:5})]),{code:"PT409"});
  const cancelled=await start(fixtureIntake({needs:["food_now"],zip:"19129",utilityProviders:[]}),mandate({mode:"prepare_only",recipientIds:["share-community-fridge-19129"],allowedActions:["research","prepare"],allowedData:["household"]}));
  await parent("select public.parent_control_request($1,'cancel')",[cancelled]);const queries=publicQueries;assert.deepEqual(await work(),{state:"idle"});assert.equal(publicQueries,queries);
  const revoked=await start(fixtureIntake({needs:["food_now"],zip:"19129",utilityProviders:[]}),mandate({mode:"prepare_only",recipientIds:["share-community-fridge-19129"],allowedActions:["research","prepare"],allowedData:["household"]}));
  let started!:()=>void,release!:()=>void;const reading=new Promise<void>(resolve=>{started=resolve;}),held=new Promise<void>(resolve=>{release=resolve;});
  const pending=runOneParentJob({database:{query:(sql,args)=>call("parent_worker",sql,args)},continuationOnly:true,brokerOrigin:"http://127.0.0.1:3310",brokerSecret:"synthetic-lineage-no-real-secret-32chars",supabaseOrigin:"http://127.0.0.1:55321",coordinate:forbidden,
    fetcher:async(input,init)=>{const url=cityRequest(input,init);assert.equal(url.searchParams.get("where"),"objectid=122");publicQueries++;started();await held;return Response.json({features:[{attributes:source}]});}});
  try{await Promise.race([reading,pending.then(()=>{throw new Error("The worker ended before its owned public read");})]);if(options.peer)assert.equal((await call("parent_worker","select parent_private.parent_claim_job(15,true,false,true) value",[],owner,options.peer)).rows[0].value,null);await parent("select public.parent_control_request($1,'cancel')",[revoked]);}finally{release();}
  assert.deepEqual(await pending,{state:"failed",reason:"execution_error"});assert.equal((await request(revoked)).status,"cancelled");assert.equal((await request(revoked)).plan,null);
  await start(fixtureIntake({needs:["food_now"],zip:"19129",utilityProviders:[]}),mandate({mode:"prepare_only",recipientIds:["share-community-fridge-19129"],allowedActions:["research","prepare"],allowedData:["household"]}));
  const beforeOffboarding=publicQueries;await db.query("update public.parent_accounts set status='deletion_requested' where id=$1",[owner]);try{assert.deepEqual(await work(),{state:"idle"});assert.equal(publicQueries,beforeOffboarding);}finally{await db.query("update public.parent_accounts set status='active' where id=$1",[owner]);}
  assert.equal((await db.query("select count(*)::int n from parent_private.model_call_reservations")).rows[0].n,1);assert.equal((await db.query("select count(*)::int n from parent_private.ai_calls")).rows[0].n,0);assert.equal(external,0);assert.equal(unexpectedPublicReads,0);
  return {appliedMigrations:applied,observedFunctions:25,ongoingInfinityPreserved:true,newPurposesRemainClosed:true,preSubmitReviewWithoutDispatch:true,deliveryUnknownReconciledWithoutResend:true,oldPacketAndDocumentPreserved:true,routingAndHistoricalReceipts:true,publicDirectoryAndMixedIsolation:true,exactUpdateReceipts:true,cancellation:true,
    cancellationDuringSourceRead:true,accountRevocationBlocksClaim:true,nativeConcurrentLeaseExclusion:!!options.peer,nativeLeaseExpiry:!!options.peer,embeddedClockDoubles:options.embedded,modelCalls:0,providerCalls:0,publicQueries,limits:"Synthetic SQL/worker logic only; no HTTP Auth, real PDF/handwriting, provider transport, production change or family outcome."};
}
