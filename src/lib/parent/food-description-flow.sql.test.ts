import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FOOD_DESCRIPTION_FINGERPRINT, runOneFoodDescriptionTurn } from "./food-description-runtime";
import { validateFoodDescriptionSelection } from "./food-description";
import { FAMILY_PROFILE_NOTICE_VERSION, familyProfileReadSchema } from "./family-profile";
import { projectFamilyProfileApplication } from "./family-profile-application";
import { SNAP_EN_TEMPLATE_ID, SNAP_ES_TEMPLATE_ID, SNAP_SPANISH_APPLICATION_SOURCE } from "./snap-form-source";
import { SNAP_APPLICATION_NOTICE_VERSION } from "./constants";
import { fixtureIntake, fixtureMandate } from "./test-fixtures";
import { assessFoodSupport } from "./food-assessment";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
const sourceData=vi.hoisted(()=>({rpc:vi.fn(),identity:vi.fn()}));
vi.mock("./auth",()=>({createParentClient:async()=>({rpc:sourceData.rpc})}));
vi.mock("./account-deletion",()=>({getParentDeletionStatus:sourceData.identity}));
import { getFoodDescriptionResult } from "./food-description-data";
const modulePath=process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
describe.skipIf(!modulePath)("description deterministic clarification and immutable charged revision composition",()=>{
  let fixture:Awaited<ReturnType<typeof createParentSqlFixture>>,owner:string,session:string;
  async function query(sql:string,values:unknown[]=[],role="authenticated"){
    await fixture.admin.query(`set role ${role}`);
    try{await fixture.admin.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:owner,session_id:session,role,amr:[{method:"otp"}]})]);return await fixture.admin.query(sql,values);}
    finally{await fixture.admin.query("reset role");}
  }
  async function begin(description="I need help with food and benefits.",routingAnswers?:unknown, selected?:unknown,failAfterDispatch=false){
    const id=(await query("select public.parent_create_food_description($1,$2,'food-description-2026-11-18.v1',true) id",[owner,randomUUID()])).rows[0].id as string;
    await query("select public.parent_queue_food_description($1,$2,0,$3,$4)",[id,owner,randomUUID(),JSON.stringify({description,screenLocale:"en",...(routingAnswers?{routingAnswers}:{})})]);
    const selection=selected??{needIds:["food_now"],selections:[],assertions:[],exclusions:[],questionIds:["foodForTwoDays","benefitHistory"],outOfScope:null};
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({id:"resp_synthetic",status:"completed",usage:{input_tokens:200,output_tokens:80,total_tokens:280,input_tokens_details:{cached_tokens:0,cache_write_tokens:0,cache_write_tokens_details:{ttl_30m_tokens:0,ttl_12h_tokens:0}},output_tokens_details:{reasoning_tokens:0}},output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(selection)}]}]}));
    if(failAfterDispatch)fetcher.mockRejectedValue(new Error("synthetic delivery unknown"));
    await runOneFoodDescriptionTurn({database:{query:(sql,values)=>query(sql,values,"parent_worker")},apiKey:"synthetic-no-network",projectId:"proj_synthetic",fetcher,now:()=>new Date()});expect(fetcher).toHaveBeenCalledTimes(1);
    return {id,fetcher};
  }
  async function result(id:string){return (await query("select public.parent_food_description_result($1) value",[id])).rows[0].value;}
  beforeEach(async()=>{
    vi.setSystemTime(new Date("2026-11-18T15:00:00Z"));owner=randomUUID();session=randomUUID();
    sourceData.identity.mockResolvedValue({ownerId:owner,status:"active"});
    sourceData.rpc.mockImplementation(async(name:string,params:{p_draft:string})=>{
      if(name!=="parent_food_description_result")throw new Error("Unexpected synthetic result RPC");
      try{return{data:(await query("select public.parent_food_description_result($1) value",[params.p_draft])).rows[0].value,error:null};}
      catch(error){return{data:null,error:{code:(error as {code:string}).code,message:"Synthetic SQL result rejected"}};}
    });
    await fixture.admin.query("update parent_private.food_description_drafts set state='cancelled',input=null,context=null,projection=null,selection=null,payload_hash=null,lease_token=null,lease_until=null");
    await fixture.admin.query(`update parent_private.processing_controls set enabled=true,approval_reference='synthetic only',approved_until=now()+interval '90 days',existing_accounts_enabled=true,
      food_description_enabled=true,food_description_approval_reference='synthetic only',food_description_approved_until=now()+interval '1 day',food_description_notice_version='food-description-2026-11-18.v1',
      food_description_processor_reference='synthetic processor',food_description_evaluation_reference='synthetic guards, no model quality evaluation',food_description_evaluation_fingerprint=$1,food_description_retention_reference='synthetic24h48h',
      food_description_project_budget_reference='synthetic project',food_description_project_id='proj_synthetic',food_description_budget_reference='synthetic feature',food_description_budget_started_at=now()-interval '1 hour',food_description_call_limit=10000,model_budget_started_at=now()-interval '1 hour',model_call_limit=10000`,[FOOD_DESCRIPTION_FINGERPRINT]);
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",[owner,`${owner}@example.invalid`]);await fixture.admin.query("insert into auth.sessions(id,user_id,not_after) values($1,$2,now()+interval '90 days')",[session,owner]);await query("select public.parent_ensure_account()");
    await query("select parent_private.parent_record_food_description_health(true,$1,'proj_synthetic')",[FOOD_DESCRIPTION_FINGERPRINT],"parent_worker");
  });
  beforeAll(async()=>{vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-11-18T15:00:00Z"));fixture=await createParentSqlFixture(modulePath!);});
  afterAll(async()=>{await fixture?.admin.end();vi.useRealTimers();});
  it("installs only the narrow owned clarification port, with all new private helpers closed",async()=>{
    const helpers=["parent_private.food_description_current_routing_facts(parent_private.food_description_drafts)","parent_private.food_description_repeated_input(parent_private.food_description_drafts,text,jsonb)","parent_private.food_description_values(parent_private.food_description_drafts)","parent_private.food_description_answers(parent_private.food_description_drafts)","parent_private.food_description_needs(jsonb)"];
    for(const helper of helpers)for(const role of ["anon","authenticated","service_role","parent_worker","parent_storage_broker"])
      expect((await fixture.admin.query("select has_function_privilege($1,$2,'execute') allowed",[role,helper])).rows[0].allowed).toBe(false);
    expect((await fixture.admin.query("select has_function_privilege('authenticated','public.parent_resolve_food_description(uuid,uuid,integer,jsonb,text[],uuid)','execute') allowed")).rows[0].allowed).toBe(true);
  });
  it("resolves necessary typed answers without a second model call and retains the original charged projection",async()=>{
    const {id,fetcher}=await begin(),before=await result(id),key=randomUUID(),answers={foodForTwoDays:"no",benefitHistory:"never",existingIssue:null};
    expect(validateFoodDescriptionSelection({...before,now:new Date()})).toMatchObject({state:"needs_clarification",questionIds:["foodForTwoDays","benefitHistory"]});
    vi.setSystemTime(new Date("2026-11-18T15:00:05Z"));
    const params=[id,owner,1,JSON.stringify(answers),["foodForTwoDays","benefitHistory"],key];
    expect((await query("select public.parent_resolve_food_description($1,$2,$3,$4,$5,$6) revision",params)).rows[0].revision).toBe(2);
    expect((await query("select public.parent_resolve_food_description($1,$2,$3,$4,$5,$6) revision",params)).rows[0].revision).toBe(2);
    expect(validateFoodDescriptionSelection({...await result(id),now:new Date()})).toMatchObject({state:"proposal",proposedAnswers:answers,needIds:["food_now","snap_new"],questionIds:[],executionGranted:false});
    const attempts=(await fixture.admin.query("select revision,model_projection,result_selection from parent_private.food_description_calls where draft_id=$1",[id])).rows;
    expect(attempts).toHaveLength(1);expect(attempts[0].revision).toBe(1);expect(attempts[0].model_projection).toEqual(before.projection);expect(attempts[0].model_projection.routingFacts).toEqual({});
    expect(fetcher).toHaveBeenCalledTimes(1);expect((await fixture.admin.query("select state,content_expires_at-created_at=interval '24 hours' fixed from parent_private.food_description_drafts where id=$1",[id])).rows[0]).toEqual({state:"result",fixed:true});
  });
  it("reuses fresh explicitly typed routing answers without asking them again or renewing their original date",async()=>{
    const routingAnswers={foodForTwoDays:{value:"no",confirmedAt:"2026-11-18T14:00:00Z"},benefitHistory:{value:"never",confirmedAt:"2026-11-18T14:00:00Z"}};
    const {id}=await begin("Food and grocery help, please.",routingAnswers,{needIds:["food_now","snap_new"],selections:[],assertions:[],exclusions:[],questionIds:[],outOfScope:null});
    const value=await result(id),validated=validateFoodDescriptionSelection({...value,now:new Date()});
    expect(validated).toMatchObject({state:"proposal",needIds:["food_now","snap_new"],questionIds:[],proposedAnswers:{foodForTwoDays:"no",benefitHistory:"never"}});
    expect(new Date(value.projection.routingFacts.foodForTwoDays.confirmedAt).toISOString()).toBe("2026-11-18T14:00:00.000Z");
    expect(new Date(value.projection.routingFacts.foodForTwoDays.expiresAt).toISOString()).toBe("2026-11-19T14:00:00.000Z");
    const key=randomUUID(),params=[id,owner,1,JSON.stringify(validated.proposedAnswers),["foodForTwoDays"],key];
    expect((await query("select public.parent_resolve_food_description($1,$2,$3,$4,$5,$6) revision",params)).rows[0].revision).toBe(1);
    expect((await query("select public.parent_resolve_food_description($1,$2,$3,$4,$5,$6) revision",params)).rows[0].revision).toBe(1);
    params[3]=JSON.stringify({...validated.proposedAnswers,foodForTwoDays:"yes"});
    await expect(query("select public.parent_resolve_food_description($1,$2,$3,$4,$5,$6)",params)).rejects.toMatchObject({code:"PT409"});
  });
  it.each([
    {zip:{value:"19104",confirmedAt:"2026-11-18T14:00:00Z"}},
    {foodForTwoDays:{value:"no",confirmedAt:"2026-11-19T14:00:00Z"}},
    {foodForTwoDays:{value:null,confirmedAt:"2026-11-18T14:00:00Z"}},
    {foodForTwoDays:{value:"no",confirmedAt:"bad"}},
    {foodForTwoDays:{value:"no",confirmedAt:"2026-11-18T14:00:00Z",source:"family_profile"}},
  ])("rejects unpermitted or invalid routing facts before storing prose: %j",async routingAnswers=>{
    const id=(await query("select public.parent_create_food_description($1,$2,'food-description-2026-11-18.v1',true) id",[owner,randomUUID()])).rows[0].id;
    await expect(query("select public.parent_queue_food_description($1,$2,0,$3,$4)",[id,owner,randomUUID(),JSON.stringify({description:"Food help",screenLocale:"en",routingAnswers})])).rejects.toMatchObject({code:"23514"});
    expect((await fixture.admin.query("select input,state,revision from parent_private.food_description_drafts where id=$1",[id])).rows[0]).toEqual({input:null,state:"empty",revision:0});
  });
  it("omits expired routing answers rather than silently refreshing them",async()=>{
    const {id}=await begin("Food help",{foodForTwoDays:{value:"no",confirmedAt:"2026-11-16T14:00:00Z"}});
    expect(validateFoodDescriptionSelection({...await result(id),now:new Date()})).toMatchObject({state:"needs_clarification",questionIds:["foodForTwoDays","benefitHistory"]});
  });
  it("clears charged content on cancellation while retaining quota and anonymous reservations",async()=>{
    const {id}=await begin();
    await query("select public.parent_cancel_food_description($1,$2)",[id,owner]);
    const archive=(await query("select public.parent_get_food_descriptions() value")).rows[0].value;
    expect(archive.drafts[0]).toMatchObject({input:null,projection:null,selection:null,usage:[{modelProjection:null,selection:null}]});
    expect((await fixture.admin.query("select count(*)::integer n from parent_private.food_description_calls where draft_id=$1",[id])).rows[0].n).toBe(1);
    expect((await fixture.admin.query("select count(*)::integer n from parent_private.model_call_reservations where purpose='food_description'")).rows[0].n).toBeGreaterThan(0);
  });
  async function readySource() {
    const {id}=await begin("Food and grocery support.",{foodForTwoDays:{value:"no",confirmedAt:"2026-11-18T14:00:00Z"},benefitHistory:{value:"never",confirmedAt:"2026-11-18T14:00:00Z"}},
      {needIds:["food_now","snap_new"],selections:[],assertions:[],exclusions:[],questionIds:[],outOfScope:null});
    return {draftId:id,revision:1};
  }
  function packet(needs:["food_now"]|["food_now","snap_new"]=["food_now","snap_new"]) {
    return {intake:fixtureIntake({needs,utilityProviders:[]}),mandate:fixtureMandate({recipientIds:needs.length===1?["philly-food"]:["philly-food","snap-pa"],mode:"prepare_only",allowedActions:["research","prepare"],expiresAt:new Date(Date.now()+86400000).toISOString()})};
  }
  async function start(source:unknown,body=packet(),key=randomUUID()) {
    return (await query("select public.parent_start_food_description_request($1,$2,$3,$4) id",[JSON.stringify(source),JSON.stringify(body.intake),JSON.stringify(body.mandate),key])).rows[0].id;
  }
  it("starts one actual combined request, mandate and job atomically and acknowledges only its exact source/body/key",async()=>{
    const source=await readySource(),body=packet(),key=randomUUID(),id=await start(source,body,key);
    expect(await start(source,body,key)).toBe(id);
    const row=(await fixture.admin.query("select description_source,intake from public.parent_requests where id=$1",[id])).rows[0];
    expect(row.description_source).toEqual(source);expect(row.intake).toEqual(body.intake);
    expect((await fixture.admin.query("select count(*)::integer n from public.parent_jobs where request_id=$1",[id])).rows[0].n).toBe(1);
    await expect(start(source,body)).rejects.toMatchObject({code:"PT409"});
    await expect(start({...source,revision:2},body,key)).rejects.toMatchObject({code:"PT409"});
    await expect(start(source,{...body,intake:{...body.intake,zip:"19129"}},key)).rejects.toMatchObject({code:"PT409"});
    const stored=JSON.stringify(row);expect(stored).not.toContain("Food and grocery support");expect(stored).not.toContain("descriptionHash");
  });
  it.each(["revision","owner","cancel","purpose","capability","facts","program","scope"])("rejects stale or expanded description start %s without an actual request",async reason=>{
    const source=await readySource(),body=packet();
    if(reason==="revision")source.revision++;
    if(reason==="owner")await fixture.admin.query("update parent_private.food_description_drafts set owner_id=$2 where id=$1",[source.draftId,randomUUID()]).catch(async()=>{
      source.draftId=randomUUID();
    });
    if(reason==="cancel")await query("select public.parent_cancel_food_description($1,$2)",[source.draftId,owner]);
    if(reason==="purpose")await fixture.admin.query("update parent_private.processing_controls set food_description_enabled=false");
    if(reason==="capability")await fixture.admin.query("update parent_private.worker_health set food_description_fingerprint=repeat('b',64)");
    if(reason==="facts")body.intake.urgency="planning";
    if(reason==="program")body.mandate.recipientIds=["wic-pa"];
    if(reason==="scope")body.intake.needs=["food_now","snap_pending"];
    await expect(start(source,body)).rejects.toMatchObject({code:"PT409"});
    expect((await fixture.admin.query("select count(*)::integer n from public.parent_requests r join public.parent_households h on h.id=r.household_id where h.owner_id=$1",[owner])).rows[0].n).toBe(0);
  });
  it("keeps an exact known acknowledgement available after description purpose closure and original content purge",async()=>{
    const source=await readySource(),body=packet(),key=randomUUID(),id=await start(source,body,key);
    await fixture.admin.query("update parent_private.processing_controls set food_description_enabled=false");
    await query("select public.parent_cancel_food_description($1,$2)",[source.draftId,owner]);
    expect(await start(source,body,key)).toBe(id);
    await fixture.admin.query("update public.parent_requests set intake=jsonb_set(intake,'{zip}','\"19129\"'),version=version+1 where id=$1",[id]);
    await expect(start(source,body,key)).rejects.toMatchObject({code:"PT409"});
  });
  it.each(["combined","snap_then_food"])("preserves the existing source-aware private SNAP historical receipt after correction/clear/closure in %s",async mode=>{
    const source=await readySource(),body=packet(),key=randomUUID();
    if(mode==="snap_then_food"){body.intake.needs=["snap_new"];body.mandate.recipientIds=["snap-pa"];}
    await fixture.admin.query(`update parent_private.processing_controls set family_profile_enabled=true,family_profile_approval_reference='synthetic only',family_profile_approved_until=now()+interval '2 days',family_profile_notice_version=$1,
      snap_details_enabled=true,snap_details_approval_reference='synthetic only',snap_details_approved_until=now()+interval '2 days',snap_details_notice_version=$2`,[FAMILY_PROFILE_NOTICE_VERSION,SNAP_APPLICATION_NOTICE_VERSION]);
    const profileDetails={primaryPerson:{id:randomUUID(),firstName:"Synthetic",lastName:"Family"},homeAddress:{street:"1 Synthetic Lane",city:"Philadelphia",state:"PA",zip:"19104"},preferredLanguage:"en"};
    await query("select public.parent_save_family_profile($1,0,$2,$3,true,true,'{}',$4)",[owner,JSON.stringify(profileDetails),FAMILY_PROFILE_NOTICE_VERSION,randomUUID()]);
    const profile=familyProfileReadSchema.parse((await query("select public.parent_get_family_profile() value")).rows[0].value).profile!;
    const options={useHomeAddress:true},projection=projectFamilyProfileApplication(profile,"snap-pa",{now:new Date(),...options});
    const profileSource={expectedOwnerId:owner,revision:profile.revision,fields:projection.fields,options};
    body.intake.householdSize=null;
    const params=[JSON.stringify(source),JSON.stringify(body.intake),JSON.stringify(body.mandate),key,JSON.stringify(projection.details),SNAP_APPLICATION_NOTICE_VERSION,JSON.stringify(profileSource),null,SNAP_ES_TEMPLATE_ID];
    const execute=()=>query("select public.parent_start_food_description_request($1,$2,$3,$4,$5,$6,$7,$8,$9) id",params);
    const id=(await execute()).rows[0].id;
    if(mode==="snap_then_food"){expect(await getFoodDescriptionResult(source.draftId)).toMatchObject({state:"proposal",needIds:["food_now"]});expect(await start(source,packet(["food_now"]))).not.toBe(id);}
    expect(JSON.stringify((await fixture.admin.query("select model_projection from parent_private.food_description_calls where draft_id=$1",[source.draftId])).rows)).not.toMatch(/Synthetic Family|Synthetic Lane|primaryPerson|homeAddress/);
    expect((await fixture.admin.query("select source from public.parent_snap_application_details where request_id=$1 order by revision desc limit 1",[id])).rows[0].source).toEqual(SNAP_SPANISH_APPLICATION_SOURCE);
    await query("select public.parent_save_family_profile($1,1,$2,$3,true,true,'{}',$4)",[owner,JSON.stringify({...profileDetails,primaryPerson:{...profileDetails.primaryPerson,firstName:"Corrected"}}),FAMILY_PROFILE_NOTICE_VERSION,randomUUID()]);
    await query("select public.parent_clear_family_profile($1,2,$2)",[owner,randomUUID()]);
    await query("select public.parent_cancel_food_description($1,$2)",[source.draftId,owner]);
    await fixture.admin.query("update parent_private.processing_controls set family_profile_enabled=false,food_description_enabled=false");
    const before=(await fixture.admin.query("select to_jsonb(r) value from public.parent_requests r where id=$1",[id])).rows[0].value;
    const snapshots=(await fixture.admin.query("select to_jsonb(s) value from public.parent_snap_application_details s where request_id=$1 order by revision",[id])).rows;
    expect((await execute()).rows[0].id).toBe(id);
    expect((await fixture.admin.query("select to_jsonb(r) value from public.parent_requests r where id=$1",[id])).rows[0].value).toEqual(before);
    expect((await fixture.admin.query("select to_jsonb(s) value from public.parent_snap_application_details s where request_id=$1 order by revision",[id])).rows).toEqual(snapshots);
    params[8]=SNAP_EN_TEMPLATE_ID;await expect(execute()).rejects.toMatchObject({code:"PT409"});
  });
  it("rolls back the whole description-bound private start when the existing SNAP purpose is closed",async()=>{
    const source=await readySource(),body=packet();await fixture.admin.query("update parent_private.processing_controls set snap_details_enabled=false");
    await expect(query("select public.parent_start_food_description_request($1,$2,$3,$4,$5,$6)",[JSON.stringify(source),JSON.stringify(body.intake),JSON.stringify(body.mandate),randomUUID(),JSON.stringify({zip:"19104"}),SNAP_APPLICATION_NOTICE_VERSION])).rejects.toMatchObject({code:"42501"});
    expect((await fixture.admin.query("select count(*)::integer n from public.parent_requests r join public.parent_households h on h.id=r.household_id where h.owner_id=$1",[owner])).rows[0].n).toBe(0);
  });
  it("clears an obsolete model issue assertion when a parent corrects receiving history to never applied without another model call",async()=>{
    const description="No food. I receive SNAP and need renewal.";
    const span=(text:string)=>({start:description.indexOf(text),end:description.indexOf(text)+text.length,text});
    const {id,fetcher}=await begin(description,undefined,{needIds:["food_now","snap_renewal"],selections:[],assertions:[
      {questionId:"foodForTwoDays",value:"no",span:span("No food")},{questionId:"benefitHistory",value:"receiving",span:span("receive SNAP")},{questionId:"existingIssue",value:"renewal",span:span("need renewal")}
    ],exclusions:[],questionIds:[],outOfScope:null});
    expect(validateFoodDescriptionSelection({...await result(id),now:new Date()})).toMatchObject({state:"proposal",needIds:["food_now","snap_renewal"]});
    await query("select public.parent_resolve_food_description($1,$2,1,$3,$4,$5)",[id,owner,JSON.stringify({foodForTwoDays:"no",benefitHistory:"never",existingIssue:null}),["benefitHistory"],randomUUID()]);
    expect(validateFoodDescriptionSelection({...await result(id),now:new Date()})).toMatchObject({state:"proposal",needIds:["food_now","snap_new"],proposedAnswers:{benefitHistory:"never",existingIssue:null}});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["en","es"])("rejects key-only or display-locale-only duplicate charged unknown prose in %s without another reservation",async screenLocale=>{
    const {id}=await begin("Food help",undefined,undefined,true);
    expect((await fixture.admin.query("select state from parent_private.food_description_drafts where id=$1",[id])).rows[0].state).toBe("unknown");
    await expect(query("select public.parent_queue_food_description($1,$2,1,$3,$4)",[id,owner,randomUUID(),JSON.stringify({description:"Food help",screenLocale})])).rejects.toMatchObject({code:"PT409"});
    expect((await fixture.admin.query("select count(*)::integer n from parent_private.food_description_calls where draft_id=$1",[id])).rows[0].n).toBe(1);
  });
  it("permits a new explicit interpretation of unchanged prose only when actual owned routing context changed",async()=>{
    const {id}=await begin("Food help",undefined,undefined,true);
    const read=async()=>(await query("select public.parent_get_food_descriptions() value")).rows[0].value.drafts.find((d:{id:string})=>d.id===id);
    expect((await read()).sameChargedContext).toBe(true);
    const existing=packet();existing.intake.needs=["snap_pending"];existing.mandate.recipientIds=["snap-pa"];
    await query("select public.parent_start_request($1,$2,$3)",[JSON.stringify(existing.intake),JSON.stringify(existing.mandate),randomUUID()]);
    expect((await read()).sameChargedContext).toBe(false);
    expect((await query("select public.parent_queue_food_description($1,$2,1,$3,$4) revision",[id,owner,randomUUID(),JSON.stringify({description:"Food help",screenLocale:"es"})])).rows[0].revision).toBe(2);
    const current=(await fixture.admin.query("select context from parent_private.food_description_drafts where id=$1",[id])).rows[0].context;
    expect(current.history).toEqual([expect.objectContaining({need:"snap_pending",requestStatus:"active"})]);
    expect((await fixture.admin.query("select count(*)::integer n from parent_private.food_description_calls where draft_id=$1",[id])).rows[0].n).toBe(1);
  });
  it.each([{},null,{draftId:null,revision:1},{draftId:"11111111-1111-4111-8111-111111111111",revision:"1"},{draftId:"11111111-1111-4111-8111-111111111111",revision:1,description:"unpermitted prose"}])("rejects malformed or content-bearing actual-start source %j",async source=>{
    await expect(start(source)).rejects.toMatchObject({code:"23514"});
  });
  it("keeps independent uncovered food available when a current owned SNAP case already covers benefit work",async()=>{
    const existing=packet();existing.intake.needs=["snap_pending"];existing.mandate.recipientIds=["snap-pa"];
    const existingId=(await query("select public.parent_start_request($1,$2,$3) id",[JSON.stringify(existing.intake),JSON.stringify(existing.mandate),randomUUID()])).rows[0].id;
    const {id}=await begin("Food now and my pending SNAP case.",{foodForTwoDays:{value:"no",confirmedAt:"2026-11-18T14:00:00Z"},benefitHistory:{value:"applied",confirmedAt:"2026-11-18T14:00:00Z"}},
      {needIds:["food_now","snap_pending"],selections:[],assertions:[],exclusions:[],questionIds:[],outOfScope:null});
    expect(await getFoodDescriptionResult(id)).toMatchObject({state:"proposal",needIds:["food_now"],existingRequests:[{requestId:existingId,needIds:["snap_pending"]}],executionGranted:false});
    const created=await start({draftId:id,revision:1},packet(["food_now"]));expect(created).not.toBe(existingId);
  });
  it("reuses actual current food work while keeping uncovered new SNAP available under its own mandate",async()=>{
    const existing=packet(["food_now"]);
    const existingId=(await query("select public.parent_start_request($1,$2,$3) id",[JSON.stringify(existing.intake),JSON.stringify(existing.mandate),randomUUID()])).rows[0].id;
    const {id}=await begin("Food and grocery help.",{foodForTwoDays:{value:"no",confirmedAt:"2026-11-18T14:00:00Z"},benefitHistory:{value:"never",confirmedAt:"2026-11-18T14:00:00Z"}},
      {needIds:["food_now","snap_new"],selections:[],assertions:[],exclusions:[],questionIds:[],outOfScope:null});
    expect(await getFoodDescriptionResult(id)).toMatchObject({state:"proposal",needIds:["snap_new"],existingRequests:[{requestId:existingId,needIds:["food_now"]}],executionGranted:false});
    const snap=packet();snap.intake.needs=["snap_new"];snap.mandate.recipientIds=["snap-pa"];expect(await start({draftId:id,revision:1},snap)).not.toBe(existingId);
  });
  it.each(["food_now","snap_new"] as const)("starts later disjoint support from the same source after %s, without another interpretation or inherited mandate",async firstNeed=>{
    const source=await readySource(),first=packet(),second=packet();
    first.intake.needs=[firstNeed];first.mandate.recipientIds=firstNeed==="food_now"?["philly-food"]:["snap-pa"];
    const secondNeed=firstNeed==="food_now"?"snap_new":"food_now";second.intake.needs=[secondNeed];second.mandate.recipientIds=secondNeed==="food_now"?["philly-food"]:["snap-pa"];
    const key=randomUUID(),firstId=await start(source,first,key);
    expect(await getFoodDescriptionResult(source.draftId)).toMatchObject({state:"proposal",needIds:[secondNeed],existingRequests:[{requestId:firstId,needIds:[firstNeed]}]});
    const secondId=await start(source,second);expect(secondId).not.toBe(firstId);
    expect(await getFoodDescriptionResult(source.draftId)).toMatchObject({state:"open_existing",needIds:[],existingRequests:expect.arrayContaining([{requestId:firstId,needIds:[firstNeed]},{requestId:secondId,needIds:[secondNeed]}])});
    expect((await fixture.admin.query("select count(*)::integer n from parent_private.food_description_calls where draft_id=$1",[source.draftId])).rows[0].n).toBe(1);
    await query("select public.parent_control_request($1,'cancel')",[firstId]);
    await expect(start(source,first)).rejects.toMatchObject({code:"PT409"});
    const before=(await fixture.admin.query("select to_jsonb(r) value from public.parent_requests r where id=$1",[firstId])).rows[0].value;
    expect(await start(source,first,key)).toBe(firstId);
    expect((await fixture.admin.query("select to_jsonb(r) value from public.parent_requests r where id=$1",[firstId])).rows[0].value).toEqual(before);
    expect((await fixture.admin.query("select count(*)::integer n from public.parent_events where request_id=any($1::uuid[]) and kind='request.started'",[[firstId,secondId]])).rows[0].n).toBe(2);
  });
  it("retains original source/need use after a current intake correction removes that need",async()=>{
    const source=await readySource(),body=packet(),id=await start(source,body);
    const corrected={...body.intake,needs:["snap_new"]};await query("select public.parent_correct_request($1,$2,1)",[id,JSON.stringify(corrected)]);
    expect((await fixture.admin.query("select intake->'needs' needs from public.parent_requests where id=$1",[id])).rows[0].needs).toEqual(["snap_new"]);
    await expect(start(source,packet(["food_now"]))).rejects.toMatchObject({code:"PT409"});
    const evidence=(await fixture.admin.query("select evidence from public.parent_events where request_id=$1 and kind='request.started'",[id])).rows[0].evidence;
    expect(evidence.descriptionSource).toEqual(source);expect(evidence.descriptionNeeds).toEqual(["food_now","snap_new"]);
    expect(JSON.stringify(evidence)).not.toContain("Food and grocery support");
  });
  it("rejects overlapping combined scope before any hidden partial start, then permits its disjoint explicitly authorized sibling",async()=>{
    const source=await readySource(),food=packet(["food_now"]),first=await start(source,food);
    await expect(start(source,packet())).rejects.toMatchObject({code:"PT409"});
    expect((await fixture.admin.query("select count(*)::integer n from public.parent_requests where description_source=$1",[JSON.stringify(source)])).rows[0].n).toBe(1);
    const snap=packet();snap.intake.needs=["snap_new"];snap.mandate.recipientIds=["snap-pa"];
    const second=await start(source,snap);expect(second).not.toBe(first);
    expect((await fixture.admin.query("select mandate from public.parent_requests where id=$1",[first])).rows[0].mandate).toEqual(food.mandate);
  });
  it("rechecks a newly created current food scope at start and recomputes only the uncovered sibling without another model call",async()=>{
    const source=await readySource();expect(await getFoodDescriptionResult(source.draftId)).toMatchObject({needIds:["food_now","snap_new"]});
    const food=packet(["food_now"]),existing=(await query("select public.parent_start_request($1,$2,$3) id",[JSON.stringify(food.intake),JSON.stringify(food.mandate),randomUUID()])).rows[0].id;
    await expect(start(source,packet())).rejects.toMatchObject({code:"PT409"});
    expect(await getFoodDescriptionResult(source.draftId)).toMatchObject({state:"proposal",needIds:["snap_new"],existingRequests:[{requestId:existing,needIds:["food_now"]}]});
    const snap=packet();snap.intake.needs=["snap_new"];snap.mandate.recipientIds=["snap-pa"];
    expect(await start(source,snap)).toEqual(expect.any(String));
  });
  it("records an explicit same-value parent answer as typed provenance without renewing an existing typed fact or charging again",async()=>{
    const description="No food. I never applied for SNAP.";const span=(text:string)=>({start:description.indexOf(text),end:description.indexOf(text)+text.length,text});
    const {id}=await begin(description,undefined,{needIds:["food_now","snap_new"],selections:[],assertions:[{questionId:"foodForTwoDays",value:"no",span:span("No food")},{questionId:"benefitHistory",value:"never",span:span("never applied for SNAP")}],exclusions:[],questionIds:[],outOfScope:null});
    const answers={foodForTwoDays:"no",benefitHistory:"never",existingIssue:null};
    expect((await query("select public.parent_resolve_food_description($1,$2,1,$3,$4,$5) revision",[id,owner,JSON.stringify(answers),["foodForTwoDays"],randomUUID()])).rows[0].revision).toBe(2);
    const first=(await result(id)).projection.routingFacts.foodForTwoDays;
    expect(first).toMatchObject({value:"no",source:"parent_typed"});
    vi.setSystemTime(new Date("2026-11-18T15:00:05Z"));
    expect((await query("select public.parent_resolve_food_description($1,$2,2,$3,$4,$5) revision",[id,owner,JSON.stringify(answers),["foodForTwoDays"],randomUUID()])).rows[0].revision).toBe(2);
    expect((await result(id)).projection.routingFacts.foodForTwoDays).toEqual(first);
    expect((await fixture.admin.query("select count(*)::integer n from parent_private.food_description_calls where draft_id=$1",[id])).rows[0].n).toBe(1);
  });
  it("matches all24 existing deterministic typed-answer branches without a model",async()=>{
    for(const foodForTwoDays of ["yes","no","not_sure"])for(const benefitHistory of ["never","applied","receiving","not_sure"]){
      for(const existingIssue of benefitHistory==="receiving"?["renewal","stopped","card","none","not_sure"]:[null]){
        const answers={foodForTwoDays,benefitHistory,existingIssue};
        expect((await fixture.admin.query("select parent_private.food_description_needs($1) needs",[JSON.stringify(answers)])).rows[0].needs).toEqual(assessFoodSupport(answers).map(path=>path.need));
      }
    }
  });

  it("starts a distinct card problem under its own mandate while a current renewal covers only renewal",async()=>{
    const existing=packet();existing.intake.needs=["snap_renewal"];existing.mandate.recipientIds=["snap-pa"];
    const prior=(await query("select public.parent_start_request($1,$2,$3) id",[JSON.stringify(existing.intake),JSON.stringify(existing.mandate),randomUUID()])).rows[0].id;
    const {id}=await begin("My SNAP card needs help.",{foodForTwoDays:{value:"yes",confirmedAt:"2026-11-18T14:00:00Z"},benefitHistory:{value:"receiving",confirmedAt:"2026-11-18T14:00:00Z"},existingIssue:{value:"card",confirmedAt:"2026-11-18T14:00:00Z"}},
      {needIds:["snap_problem"],selections:[],assertions:[],exclusions:[],questionIds:[],outOfScope:null});
    const body=packet();body.intake.needs=["snap_problem"];body.mandate.recipientIds=["snap-pa"];
    expect(await start({draftId:id,revision:1},body)).not.toBe(prior);
  });

  it.each((["snap_new","snap_renewal"] as const).flatMap(underlyingNeed=>["prepared","submitted","approved","received","received_other_route","no_follow_up","expired","later_declined","corrected"].map(kind=>({underlyingNeed,kind}))))("reuses pending follow-up only with current same-application proof and exact mandate ($underlyingNeed / $kind)",async({underlyingNeed,kind})=>{
    const existing=packet();existing.intake.needs=[underlyingNeed];existing.mandate.recipientIds=["snap-pa"];
    if(kind!=="no_follow_up"){existing.mandate.mode="full";existing.mandate.allowedActions=["research","prepare","follow_up"];}
    if(kind==="expired")existing.mandate.expiresAt=new Date(Date.now()+1000).toISOString();
    const prior=(await query("select public.parent_start_request($1,$2,$3) id",[JSON.stringify(existing.intake),JSON.stringify(existing.mandate),randomUUID()])).rows[0].id;
    if(kind!=="prepared"){
      const evidence={source:"agency_receipt",reference:"synthetic-only",recordedAt:new Date().toISOString()};
      await fixture.admin.query("insert into public.parent_operations(request_id,request_version,program_id,need,action,packet,packet_hash,data_categories,idempotency_key,state,evidence) values($1,1,'snap-pa',$4,'submit','{}',repeat('a',64),'{}',$2,'agency_submitted',$3)",[prior,randomUUID(),JSON.stringify(evidence),underlyingNeed]);
      if(kind==="received_other_route")await fixture.admin.query("insert into public.parent_operations(request_id,request_version,program_id,need,action,packet,packet_hash,data_categories,idempotency_key,state,evidence) values($1,1,'uesf-benefits',$3,'follow_up','{}',repeat('d',64),'{}',$2,'support_received',jsonb_build_object('source','agency_receipt','reference','synthetic-received-other-route','recordedAt',now()))",[prior,randomUUID(),underlyingNeed]);
      if(kind==="approved"||kind==="received")await fixture.admin.query("insert into public.parent_operations(request_id,request_version,program_id,need,action,packet,packet_hash,data_categories,idempotency_key,state,evidence,updated_at) values($1,1,'snap-pa',$4,'follow_up','{}',repeat('c',64),'{}',$2,$5,$3,now()+interval '1 second')",[prior,randomUUID(),JSON.stringify({...evidence,reference:"synthetic-later-receipt"}),underlyingNeed,kind==="approved"?"assistance_approved":"support_received"]);
      if(kind==="later_declined")await fixture.admin.query("insert into public.parent_operations(request_id,request_version,program_id,need,action,packet,packet_hash,data_categories,idempotency_key,state,evidence,updated_at) values($1,1,'snap-pa',$4,'follow_up','{}',repeat('b',64),'{}',$2,'declined',$3,now()+interval '1 second')",[prior,randomUUID(),JSON.stringify({...evidence,reference:"synthetic-newer-denial"}),underlyingNeed]);
    }
    if(kind==="expired")vi.setSystemTime(new Date(Date.now()+2000));
    if(kind==="corrected")await fixture.admin.query("update public.parent_requests set account_changed_at=jsonb_build_object($2::text,(now()+interval '1 second')::text) where id=$1",[prior,underlyingNeed]);
    const {id}=await begin("Please check my pending SNAP application.",{foodForTwoDays:{value:"yes",confirmedAt:"2026-11-18T14:00:00Z"},benefitHistory:{value:"applied",confirmedAt:"2026-11-18T14:00:00Z"}},
      {needIds:["snap_pending"],selections:[],assertions:[],exclusions:[],questionIds:[],outOfScope:null});
    const dto=(await result(id)).currentRequests.find((value:{requestId:string})=>value.requestId===prior);expect(dto.pendingSnapFollowUp).toBe(["submitted","approved"].includes(kind));
    const proposed=await getFoodDescriptionResult(id);expect(proposed.needIds).toEqual(["submitted","approved"].includes(kind)?[]:["snap_pending"]);
    const body=packet();body.intake.needs=["snap_pending"];body.mandate.recipientIds=["snap-pa"];
    if(["submitted","approved"].includes(kind))await expect(start({draftId:id,revision:1},body)).rejects.toMatchObject({code:"PT409"});
    else expect(await start({draftId:id,revision:1},body)).not.toBe(prior);
  });

  it("keeps a declined problem-only case separate from a genuine new-application scope",async()=>{
    const existing=packet();existing.intake.needs=["snap_problem"];existing.mandate.recipientIds=["snap-pa"];
    const prior=(await query("select public.parent_start_request($1,$2,$3) id",[JSON.stringify(existing.intake),JSON.stringify(existing.mandate),randomUUID()])).rows[0].id;
    await fixture.admin.query("insert into public.parent_operations(request_id,request_version,program_id,need,action,packet,packet_hash,data_categories,idempotency_key,state,evidence) values($1,1,'snap-pa','snap_problem','follow_up','{}',repeat('a',64),'{}',$2,'declined',jsonb_build_object('source','agency_receipt','reference','synthetic-card-problem-only','recordedAt',now()))",[prior,randomUUID()]);
    const {id}=await begin("I have never applied for SNAP.",{foodForTwoDays:{value:"yes",confirmedAt:"2026-11-18T14:00:00Z"},benefitHistory:{value:"never",confirmedAt:"2026-11-18T14:00:00Z"}},
      {needIds:["snap_new"],selections:[],assertions:[],exclusions:[],questionIds:[],outOfScope:null});
    expect(await getFoodDescriptionResult(id)).toMatchObject({state:"proposal",needIds:["snap_new"],existingRequests:[],duplicateApplicationBlocked:false});
    const body=packet();body.intake.needs=["snap_new"];body.mandate.recipientIds=["snap-pa"];expect(await start({draftId:id,revision:1},body)).not.toBe(prior);
  });

  it("preserves original used scope together with later current authorized scope on the same source",async()=>{
    const source=await readySource(),food=packet(["food_now"]),prior=await start(source,food),both=packet();
    await query("select public.parent_correct_request($1,$2,1)",[prior,JSON.stringify(both.intake)]);
    both.mandate.mode="full";both.mandate.allowedActions=["research","prepare","follow_up"];
    await query("select public.parent_replace_mandate($1,$2,2)",[prior,JSON.stringify(both.mandate)]);
    const version=(await fixture.admin.query("select version from public.parent_requests where id=$1",[prior])).rows[0].version;
    await fixture.admin.query("insert into public.parent_operations(request_id,request_version,program_id,need,action,packet,packet_hash,data_categories,idempotency_key,state,evidence) values($1,$2,'snap-pa','snap_new','submit','{}',repeat('a',64),'{}',$3,'agency_submitted',jsonb_build_object('source','agency_receipt','reference','synthetic-current-scope','recordedAt',now()))",[prior,version,randomUUID()]);
    const dto=(await result(source.draftId)).currentRequests.find((value:{requestId:string})=>value.requestId===prior);
    expect(dto).toMatchObject({needIds:["food_now","snap_new"],pendingSnapFollowUp:true});
    expect(await getFoodDescriptionResult(source.draftId)).toMatchObject({state:"open_existing",needIds:[],existingRequests:[{requestId:prior,needIds:["food_now","snap_new"]}]});
  });

});
