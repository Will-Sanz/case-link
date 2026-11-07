import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as packetCrypto from "./snap-final-packet";
import * as directRenderer from "./snap-direct-completion";
import { renderSnapSigningCopy } from "./snap-signing-copy";
import { fixtureSnapApplication, fixtureSnapSnapshot } from "./test-fixtures";
import { snapApplicationSnapshotSchema } from "./snap-application-snapshot";
import { SNAP_PARENT_CERTIFICATION_ACTS } from "./snap-protected-operation";
import { SNAP_DRAFT_CONTRACT } from "./snap-draft";
import { finalizeSnapDirectCompletion, reconcileSnapDirectCompletion, openSnapFinalPacketForIsolatedReview, reconcileSnapFinalPacket, stageSnapFinalPacket, SNAP_FINALIZER_ERROR, type SnapFinalizerIntent, type SnapDirectConstruction } from "./snap-finalizer-client";

type Envelope={binding:packetCrypto.SnapFinalPacketBinding;aad:string;keyBase64:string;iv:string;tag:string;ciphertext:string};
type Store={value?:Envelope;construction?:SnapDirectConstruction;operation?:string};
type Plan={principal?:Record<string,unknown>|null;entered?:unknown;begin?:unknown;seal?:unknown;read?:unknown;errorAt?:string;hangAt?:string;hangEnd?:boolean;lostCommit?:boolean;store?:Store;commit?:Promise<unknown>;
 binding?:packetCrypto.SnapFinalPacketBinding;directContext?:unknown;construction?:unknown;readConstruction?:unknown;operation?:unknown;readOperation?:unknown};
type State={plan:Plan;config:Record<string,unknown>;calls:{text:string;values?:unknown[]}[];ended:number;destroyed:number;handlers:Record<string,()=>void>;pending?:Envelope;pendingConstruction?:SnapDirectConstruction;pendingOperation?:string};
const mocked=vi.hoisted(()=>({plans:[] as Plan[],clients:[] as State[]}));

vi.mock("pg",()=>({Client:class{
 state:State;
 constructor(config:Record<string,unknown>){this.state={plan:mocked.plans.shift()??{},config,calls:[],ended:0,destroyed:0,handlers:{}};this.state.plan.store??={};mocked.clients.push(this.state);}
 get connection(){return{stream:{destroy:()=>{this.state.destroyed++;this.state.pending=undefined;this.state.pendingConstruction=undefined;this.state.pendingOperation=undefined;}}};}
 on(event:string,callback:()=>void){this.state.handlers[event]=callback;return this;}
 connect(){return this.state.plan.hangAt==="connect"?new Promise<void>(()=>{}):Promise.resolve();}
 end(){this.state.ended++;this.state.pending=undefined;this.state.pendingConstruction=undefined;this.state.pendingOperation=undefined;return this.state.plan.hangEnd?new Promise<void>(()=>{}):Promise.resolve();}
 query(text:string,values?:unknown[]){
  const s=this.state,p=s.plan;s.calls.push({text,values});
  const kind=text.includes("from pg_roles")?"principal":text.startsWith("select current_user")?"entered":text.includes("parent_get_snap_direct_context")?"directContext":text.includes("parent_record_snap_direct_construction")?"construction":text.includes("parent_read_snap_direct_construction")?"readConstruction":text.includes("parent_finish_snap_direct_completion")?"operation":text.includes("parent_read_snap_direct_operation")?"readOperation":text.includes("parent_begin_snap")?"beginPacket":text.includes("parent_seal_snap")?"seal":text.includes("parent_read_snap")?"read":text;
  if(p.hangAt===kind)return new Promise(()=>{});
  if(p.errorAt===kind)return Promise.reject(new Error("PRIVATE_SQL_KEY_AND_CONNECTION_CANARY"));
  if(kind==="principal")return Promise.resolve({rows:p.principal===null?[]:[p.principal??principal()]});
  if(kind==="entered")return Promise.resolve({rows:[p.entered??{role:"parent_snap_finalizer",principal:"finalizer_fixture"}]});
  if(kind==="directContext")return Promise.resolve({rows:[{value:p.directContext??directContext()}]});
  if(kind==="beginPacket")return Promise.resolve({rows:[{value:p.begin??{binding:p.binding??binding(),aad:Buffer.from(packetCrypto.snapFinalPacketAad(p.binding??binding())).toString("base64"),keyBase64:fixtureKey.toString("base64")}}]});
  if(kind==="seal"){
   s.pending={binding:p.binding??binding(),aad:Buffer.from(packetCrypto.snapFinalPacketAad(p.binding??binding())).toString("base64"),keyBase64:fixtureKey.toString("base64"),iv:Buffer.from(values![4] as Uint8Array).toString("base64"),tag:Buffer.from(values![5] as Uint8Array).toString("base64"),ciphertext:Buffer.from(values![6] as Uint8Array).toString("base64")};
   return Promise.resolve({rows:[{value:p.seal??s.pending.binding}]});
  }
  if(kind==="construction"){s.pendingConstruction=(p.construction??construction()) as SnapDirectConstruction;return Promise.resolve({rows:[{value:s.pendingConstruction}]});}
  if(kind==="readConstruction")return p.readConstruction===null||!p.store!.construction&&p.readConstruction===undefined?Promise.reject(new Error("PRIVATE_CONSTRUCTION_ABSENT")):Promise.resolve({rows:[{value:p.readConstruction??p.store!.construction}]});
  if(kind==="operation"){const value=p.operation??"77777777-7777-4777-8777-777777777777";s.pendingOperation=value as string;return Promise.resolve({rows:[{value}]});}
  if(kind==="readOperation")return p.readOperation===null||!p.store!.operation&&p.readOperation===undefined?Promise.reject(new Error("PRIVATE_OPERATION_ABSENT")):Promise.resolve({rows:[{value:p.readOperation??p.store!.operation}]});
  if(kind==="commit"){
   if(s.pending)p.store!.value=s.pending;if(s.pendingConstruction)p.store!.construction=s.pendingConstruction;if(s.pendingOperation)p.store!.operation=s.pendingOperation;s.pending=undefined;s.pendingConstruction=undefined;s.pendingOperation=undefined;
   if(p.lostCommit)return Promise.reject(new Error("PRIVATE_COMMIT_CANARY"));
   if(p.commit)return p.commit;
  }
  if(kind==="rollback"){s.pending=undefined;s.pendingConstruction=undefined;s.pendingOperation=undefined;}
  if(kind==="read")return p.read===null||!p.store!.value&&p.read===undefined?Promise.reject(new Error("PRIVATE_ABSENT_OR_REVOKED")):Promise.resolve({rows:[{value:p.read??p.store!.value}]});
  return Promise.resolve({rows:[]});
 }
}}));

const time=new Date("2026-11-04T20:35:00.000Z"),payload=Buffer.from("SYNTHETIC_PRIVATE_FINALIZER_BYTES"),fixtureKey=Buffer.alloc(32,0xab);
function intent():SnapFinalizerIntent{return{
 format:"caselink-snap-final-packet-v1",packetId:"11111111-1111-4111-8111-111111111111",ownerId:"22222222-2222-4222-8222-222222222222",requestId:"33333333-3333-4333-8333-333333333333",requestVersion:2,
 recipient:"snap-pa",need:"snap_new",purpose:"snap_final_application_packet",authorizationId:"44444444-4444-4444-8444-444444444444",policyVersion:"synthetic-policy",retentionPolicyVersion:"synthetic-retention",
 templateId:SNAP_DRAFT_CONTRACT.id,templateVersion:SNAP_DRAFT_CONTRACT.version,templateSha256:SNAP_DRAFT_CONTRACT.sha256,snapshotId:"55555555-5555-4555-8555-555555555555",snapshotHash:"a".repeat(64),contentSha256:createHash("sha256").update(payload).digest("hex"),byteLength:payload.length};}
function binding(){return{...intent(),expiresAt:new Date(time.getTime()+60000).toISOString()};}
function principal():Record<string,unknown>{return{rolname:"finalizer_fixture",rolcanlogin:true,rolinherit:false,rolsuper:false,rolbypassrls:false,rolcreaterole:false,rolcreatedb:false,rolreplication:false,current_role:"finalizer_fixture",member:true,can_set:true,admin_option:false,broader_membership:false,group_membership:false,group_login:false,group_inherit:false,group_super:false,group_bypassrls:false,group_createrole:false,group_createdb:false,group_replication:false};}
function options(signal?:AbortSignal,ms=30000){return{connectionString:"postgresql://finalizer_fixture:SYNTHETIC_PASSWORD@127.0.0.1:55322/postgres",deadline:new Date(Date.now()+ms),signal};}
const queries=(index=0)=>mocked.clients[index].calls.map(call=>call.text);
function envelope():Envelope{
 const p=packetCrypto.sealSnapFinalPacket(payload,fixtureKey,binding(),time);
 return{binding:p.binding,aad:Buffer.from(packetCrypto.snapFinalPacketAad(p.binding)).toString("base64"),keyBase64:fixtureKey.toString("base64"),iv:Buffer.from(p.iv).toString("base64"),tag:Buffer.from(p.tag).toString("base64"),ciphertext:Buffer.from(p.ciphertext).toString("base64")};
}
const officialTemplate=readFileSync("data/verified-forms/snap-pa600fs-2019.pdf"),preparedAt=new Date(time.getTime()-60000);
let directData:{intent:SnapFinalizerIntent;trusted:directRenderer.SnapDirectCompletionContext;completion:directRenderer.SnapDirectCompletion;rendered:directRenderer.SnapDirectCompletionResult};
beforeAll(async()=>{
 const fields=fixtureSnapApplication(preparedAt),snapshot=snapApplicationSnapshotSchema.parse({...fixtureSnapSnapshot(preparedAt,fields),id:intent().snapshotId,request_id:intent().requestId,base_version:1,request_version:2});
 const unsigned=(await renderSnapSigningCopy(officialTemplate,fields,preparedAt)).bytes!;
 const trusted:directRenderer.SnapDirectCompletionContext={requestId:snapshot.request_id,snapshot,preparedAt:preparedAt.toISOString(),unsignedContentSha256:createHash("sha256").update(unsigned).digest("hex"),
  context:{requestVersion:2,snapshotId:snapshot.id,snapshotHash:intent().snapshotHash,source:snapshot.source,applyingSubjectIds:fields.household!.filter(p=>p.requestingSnap).map(p=>p.id)}};
 const completion:directRenderer.SnapDirectCompletion={requestId:trusted.requestId,requestVersion:2,snapshotId:snapshot.id,snapshotHash:trusted.context.snapshotHash,source:snapshot.source,unsignedContentSha256:trusted.unsignedContentSha256,signingRoute:"applicant_name_handwriting",
  identifiers:fields.household!.filter(p=>p.requestingSnap).map((p,i)=>({personId:p.id,kind:"ssn",value:`90000000${i+1}`})),
  certifications:SNAP_PARENT_CERTIFICATION_ACTS.map((actId,i)=>({actId,provenance:"caller_reported_fresh_parent_drawing",startedAt:new Date(preparedAt.getTime()+10000+i*20000).toISOString(),completedAt:new Date(preparedAt.getTime()+20000+i*20000).toISOString(),date:"2026-11-04",strokes:[[{x:0.1,y:0.2},{x:0.5,y:0.8},{x:0.9,y:0.3}]]}))};
 const rendered=await directRenderer.renderSnapDirectCompletion(officialTemplate,trusted,completion,time);expect(rendered.bytes).not.toBeNull();
 if(!rendered.bytes)throw new Error("synthetic construction fixture unavailable");
 directData={trusted,completion,rendered,intent:{...intent(),contentSha256:rendered.contentSha256,byteLength:rendered.byteLength}};
});
function directContext(){return structuredClone({intent:directData.intent,context:directData.trusted.context,snapshot:directData.trusted.snapshot,preparedAt:directData.trusted.preparedAt,state:"authorized" as "authorized"|"stored"});}
function directBinding(){return{...directData.intent,expiresAt:binding().expiresAt};}
function construction():SnapDirectConstruction{return{verificationId:"66666666-6666-4666-8666-666666666666",packetId:directData.intent.packetId,snapshotId:directData.intent.snapshotId,snapshotHash:directData.intent.snapshotHash,contentSha256:directData.intent.contentSha256,
 validatorVersion:directRenderer.SNAP_DIRECT_COMPLETION_VERSION,source:directData.trusted.context.source,requiredPersonalActs:[...SNAP_PARENT_CERTIFICATION_ACTS],verifiedAt:time.toISOString(),expiresAt:directBinding().expiresAt};}
const directPlan=(change:Plan={}):Plan=>({binding:directBinding(),...change});
const directInput=()=>({intent:structuredClone(directData.intent),completion:structuredClone(directData.completion),template:Uint8Array.from(officialTemplate)});
const finalize=(value=directInput(),signal?:AbortSignal,ms=30000)=>finalizeSnapDirectCompletion(value.intent,value.completion,value.template,options(signal,ms));
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(time);mocked.plans.length=0;mocked.clients.length=0;});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});

describe("isolated SNAP finalizer client (synthetic pg replies; no live database)",()=>{
 it("copies/hash-binds bytes before awaiting, seals once and returns metadata only",async()=>{
  const bytes=Buffer.from(payload),input=intent(),promise=stageSnapFinalPacket(input,bytes,options());bytes.fill(0);input.requestVersion=9;
  expect(await promise).toEqual({state:"stored",binding:binding()});
  const calls=mocked.clients[0].calls,begin=calls.find(call=>call.text.includes("parent_begin_snap"))!,seal=calls.find(call=>call.text.includes("parent_seal_snap"))!;
  expect(begin.values![7]).toBe(intent().packetId);expect(begin.values![2]).toBe(2);
  expect(queries().filter(sql=>sql==="commit")).toHaveLength(1);expect(queries()).not.toContain("rollback");expect(mocked.clients[0].ended).toBe(1);
  const sealed={binding:binding(),iv:seal.values![4],tag:seal.values![5],ciphertext:seal.values![6]};
  expect(Buffer.from(packetCrypto.openSnapFinalPacket(sealed,fixtureKey,time))).toEqual(payload);
  expect(JSON.stringify(calls)).not.toContain(payload.toString());expect(JSON.stringify(calls)).not.toContain(fixtureKey.toString("base64"));
 });
 it.each(Object.keys(principal()).filter(key=>!["rolname","current_role"].includes(key)))("rejects unsafe/malformed principal %s before BEGIN",async field=>{
  const value=principal();value[field]=!value[field];mocked.plans.push({principal:value});
  await expect(stageSnapFinalPacket(intent(),payload,options())).rejects.toThrow(SNAP_FINALIZER_ERROR);expect(queries()).not.toContain("begin");expect(mocked.clients[0].ended).toBe(1);
 });
 it.each([{principal:null},{principal:{...principal(),rolname:"postgres"}},{principal:{...principal(),current_role:"service_role"}},{entered:{role:"parent_worker",principal:"finalizer_fixture"}}])("requires exact dedicated principal and entered role %#",async plan=>{
  mocked.plans.push(plan);await expect(stageSnapFinalPacket(intent(),payload,options())).rejects.toThrow(SNAP_FINALIZER_ERROR);expect(queries()).not.toContain("begin");
 });
 it.each(Object.keys(intent()))("rejects a changed server binding %s before sealing",async field=>{
  const b:Record<string,unknown>={...binding()};b[field]=field==="requestVersion"?3:field==="byteLength"?payload.length+1:field.endsWith("Id")?"99999999-9999-4999-8999-999999999999":"different";
  mocked.plans.push({begin:{binding:b,aad:Buffer.from(packetCrypto.snapFinalPacketAad(binding())).toString("base64"),keyBase64:fixtureKey.toString("base64")}});
  await expect(stageSnapFinalPacket(intent(),payload,options())).rejects.toThrow(SNAP_FINALIZER_ERROR);expect(queries()).toContain("rollback");expect(queries().some(sql=>sql.includes("parent_seal_snap"))).toBe(false);
 });
 it.each([{aad:"invalid"},{keyBase64:"not a key"},{keyBase64:Buffer.alloc(31).toString("base64")},{keyBase64:Buffer.alloc(33).toString("base64")},{binding:{...binding(),expiresAt:time.toISOString()}}])("rejects malformed AAD/key/expiry %#",async change=>{
  mocked.plans.push({begin:{binding:binding(),aad:Buffer.from(packetCrypto.snapFinalPacketAad(binding())).toString("base64"),keyBase64:fixtureKey.toString("base64"),...change}});
  await expect(stageSnapFinalPacket(intent(),payload,options())).rejects.toThrow(SNAP_FINALIZER_ERROR);expect(queries()).toContain("rollback");expect(queries()).not.toContain("commit");
 });
 it("rejects changed sealed metadata before COMMIT",async()=>{
  mocked.plans.push({seal:{...binding(),expiresAt:new Date(time.getTime()+59000).toISOString()}});
  await expect(stageSnapFinalPacket(intent(),payload,options())).rejects.toThrow(SNAP_FINALIZER_ERROR);expect(queries()).toContain("rollback");expect(queries()).not.toContain("commit");
 });
 it.each(["unwrapped","unknown_key","missing_key"])("requires the exact SQL begin return shape: %s",async shape=>{
  const reply:Record<string,unknown>={binding:binding(),aad:Buffer.from(packetCrypto.snapFinalPacketAad(binding())).toString("base64"),keyBase64:fixtureKey.toString("base64")};
  if(shape==="unknown_key")reply.privateDebug="PRIVATE_REPLY_CANARY";
  if(shape==="missing_key")delete reply.keyBase64;
  mocked.plans.push({begin:shape==="unwrapped"?binding():reply});
  await expect(stageSnapFinalPacket(intent(),payload,options())).rejects.toThrow(SNAP_FINALIZER_ERROR);expect(queries()).toContain("rollback");expect(queries()).not.toContain("commit");
 });
 it.each(["beginPacket","seal"])("rolls back a %s failure and hides database values",async errorAt=>{
  mocked.plans.push({errorAt});await expect(stageSnapFinalPacket(intent(),payload,options())).rejects.toMatchObject({message:SNAP_FINALIZER_ERROR});expect(queries()).toContain("rollback");expect(mocked.clients[0].ended).toBe(1);
 });
 it("reconciles a lost COMMIT after restart using a fresh exact read and no reseal",async()=>{
  const store:Store={};mocked.plans.push({store,lostCommit:true});const savedIntent=intent();
  expect(await stageSnapFinalPacket(savedIntent,payload,options())).toEqual({state:"commit_unknown",intent:savedIntent});
  expect(queries()).not.toContain("rollback");mocked.plans.push({store});
  expect(await reconcileSnapFinalPacket(savedIntent,options())).toEqual({state:"stored",binding:binding()});
  expect(mocked.clients).toHaveLength(2);expect(queries(1).some(sql=>sql.includes("parent_read_snap"))).toBe(true);
  expect(queries(1).some(sql=>sql.includes("parent_begin_snap")||sql.includes("parent_seal_snap"))).toBe(false);
 });
 it("keeps absence/revocation/failed verification unresolved without creating a packet",async()=>{
  mocked.plans.push({read:null});expect(await reconcileSnapFinalPacket(intent(),options())).toEqual({state:"commit_unknown",intent:intent()});
  expect(queries().some(sql=>sql.includes("parent_begin_snap")||sql.includes("parent_seal_snap"))).toBe(false);
 });
 it.each(["binding","aad","keyBase64","iv","tag","ciphertext"])("does not reconcile a tampered %s response",async field=>{
  const e:Record<string,unknown>={...envelope()};e[field]=field==="binding"?{...binding(),ownerId:"99999999-9999-4999-8999-999999999999"}:"AAAA";
  mocked.plans.push({read:e});expect((await reconcileSnapFinalPacket(intent(),options())).state).toBe("commit_unknown");expect(mocked.clients[0].ended).toBe(1);
 });
 it("returns bytes only through the distinct future isolated review call",async()=>{
  mocked.plans.push({read:envelope()});const result=await openSnapFinalPacketForIsolatedReview(intent(),options());expect(Buffer.from(result.bytes)).toEqual(payload);expect(result.binding).toEqual(binding());
  expect(queries().some(sql=>sql.includes("parent_begin_snap")||sql.includes("parent_seal_snap"))).toBe(false);
 });
 it("zeros decoded key and transient reconciliation plaintext buffers",async()=>{
  const keys:Uint8Array[]=[],clear:Uint8Array[]=[],seal=packetCrypto.sealSnapFinalPacket,open=packetCrypto.openSnapFinalPacket;
  vi.spyOn(packetCrypto,"sealSnapFinalPacket").mockImplementation((bytes,key,b,now)=>{keys.push(key);return seal(bytes,key,b,now);});
  vi.spyOn(packetCrypto,"openSnapFinalPacket").mockImplementation((p,key,now)=>{keys.push(key);const value=open(p,key,now);clear.push(value);return value;});
  const store:Store={};mocked.plans.push({store});await stageSnapFinalPacket(intent(),payload,options());mocked.plans.push({store});await reconcileSnapFinalPacket(intent(),options());
  expect(keys.length).toBe(2);for(const key of keys)expect([...key].every(byte=>byte===0)).toBe(true);expect([...clear[0]].every(byte=>byte===0)).toBe(true);expect(payload.toString()).toBe("SYNTHETIC_PRIVATE_FINALIZER_BYTES");
 });
 it("zeros the decoded key when a sealed-write fails",async()=>{
  let used:Uint8Array|undefined;const seal=packetCrypto.sealSnapFinalPacket;
  vi.spyOn(packetCrypto,"sealSnapFinalPacket").mockImplementation((bytes,key,b,now)=>{used=key;return seal(bytes,key,b,now);});
  mocked.plans.push({errorAt:"seal"});await expect(stageSnapFinalPacket(intent(),payload,options())).rejects.toThrow(SNAP_FINALIZER_ERROR);
  expect(used).toBeDefined();expect([...used!].every(byte=>byte===0)).toBe(true);
 });
 it("rejects mismatched bytes and unpersistable/missing intent before opening a connection",async()=>{
  await expect(stageSnapFinalPacket({...intent(),packetId:undefined},payload,options())).rejects.toThrow(SNAP_FINALIZER_ERROR);
  await expect(stageSnapFinalPacket(intent(),Buffer.alloc(payload.length),options())).rejects.toThrow(SNAP_FINALIZER_ERROR);expect(mocked.clients).toHaveLength(0);
 });
 it.each(["postgresql://postgres:p@127.0.0.1:55322/postgres","postgresql://finalizer_fixture:p@127.0.0.1:54322/postgres","postgresql://finalizer_fixture:p@db.example.supabase.co/postgres?sslmode=require","postgresql://finalizer_fixture:p@127.0.0.1:55322/postgres?options=role%3Dservice_role"])("rejects unsafe connection configuration %#",async connectionString=>{
  await expect(stageSnapFinalPacket(intent(),payload,{...options(),connectionString})).rejects.toThrow(SNAP_FINALIZER_ERROR);expect(mocked.clients).toHaveLength(0);
 });
 it.each([0,-1,30001])("rejects an expired/unbounded deadline %s before connecting",async ms=>{
  await expect(stageSnapFinalPacket(intent(),payload,options(undefined,ms))).rejects.toThrow(SNAP_FINALIZER_ERROR);expect(mocked.clients).toHaveLength(0);
 });
 it("does not connect with an already-aborted request",async()=>{
  const stop=new AbortController();stop.abort();await expect(stageSnapFinalPacket(intent(),payload,options(stop.signal))).rejects.toThrow(SNAP_FINALIZER_ERROR);expect(mocked.clients).toHaveLength(0);
 });
 it.each(["connect","beginPacket","seal"])("ends an aborted %s without COMMIT",async hangAt=>{
  const stop=new AbortController();mocked.plans.push({hangAt});const pending=stageSnapFinalPacket(intent(),payload,options(stop.signal));
  const assertion=expect(pending).rejects.toThrow(SNAP_FINALIZER_ERROR);await vi.advanceTimersByTimeAsync(0);stop.abort();await assertion;expect(queries()).not.toContain("commit");expect(mocked.clients[0].ended).toBe(1);
 });
 it("bounds a hanging connection by its absolute deadline",async()=>{
  mocked.plans.push({hangAt:"connect"});const pending=stageSnapFinalPacket(intent(),payload,options(undefined,100));const assertion=expect(pending).rejects.toThrow(SNAP_FINALIZER_ERROR);
  await vi.advanceTimersByTimeAsync(100);await assertion;expect(mocked.clients[0].ended).toBe(1);
 });
 it("returns commit_unknown when an unacknowledged COMMIT is aborted",async()=>{
  const stop=new AbortController();mocked.plans.push({hangAt:"commit"});const pending=stageSnapFinalPacket(intent(),payload,options(stop.signal));await vi.advanceTimersByTimeAsync(0);stop.abort();
  expect(await pending).toEqual({state:"commit_unknown",intent:intent()});expect(queries()).not.toContain("rollback");
 });
 it("bounds an unacknowledged COMMIT by deadline without issuing it twice",async()=>{
  mocked.plans.push({hangAt:"commit"});const pending=stageSnapFinalPacket(intent(),payload,options(undefined,100));await vi.advanceTimersByTimeAsync(100);
  expect(await pending).toEqual({state:"commit_unknown",intent:intent()});expect(queries().filter(sql=>sql==="commit")).toHaveLength(1);expect(queries()).not.toContain("rollback");expect(mocked.clients[0].ended).toBe(1);
 });
 it("retains an acknowledged COMMIT even if cancellation follows immediately",async()=>{
  let acknowledge!:(value:unknown)=>void;const commit=new Promise(resolve=>{acknowledge=resolve;}),stop=new AbortController();mocked.plans.push({commit});
  const pending=stageSnapFinalPacket(intent(),payload,options(stop.signal));await vi.advanceTimersByTimeAsync(0);acknowledge({rows:[]});stop.abort();expect(await pending).toEqual({state:"stored",binding:binding()});
 });
 it("hard-closes a hanging idle end without delaying known COMMIT or key zeroing",async()=>{
  let used:Uint8Array|undefined;const seal=packetCrypto.sealSnapFinalPacket;
  vi.spyOn(packetCrypto,"sealSnapFinalPacket").mockImplementation((bytes,key,b,now)=>{used=key;return seal(bytes,key,b,now);});
  mocked.plans.push({hangEnd:true});expect(await stageSnapFinalPacket(intent(),payload,options())).toEqual({state:"stored",binding:binding()});
  expect(mocked.clients[0].destroyed).toBe(1);expect(mocked.clients[0].ended).toBe(1);expect([...used!].every(byte=>byte===0)).toBe(true);
 });
 it("bounds hanging rollback/end and zeros the key at the absolute deadline",async()=>{
  let used:Uint8Array|undefined;const seal=packetCrypto.sealSnapFinalPacket;
  vi.spyOn(packetCrypto,"sealSnapFinalPacket").mockImplementation((bytes,key,b,now)=>{used=key;return seal(bytes,key,b,now);});
  mocked.plans.push({errorAt:"seal",hangAt:"rollback",hangEnd:true});
  const pending=stageSnapFinalPacket(intent(),payload,options(undefined,100)),assertion=expect(pending).rejects.toThrow(SNAP_FINALIZER_ERROR);
  await vi.advanceTimersByTimeAsync(100);await assertion;expect(mocked.clients[0].destroyed).toBe(1);expect([...used!].every(byte=>byte===0)).toBe(true);expect(queries()).not.toContain("commit");
 });
});

describe("closed direct construction (actual renderer, synthetic scoped SQL replies)",()=>{
 beforeEach(()=>{vi.useRealTimers();vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(time);});
 it("constructs from DB facts, seals/evidences once atomically and copies caller inputs before awaits",async()=>{
  const store:Store={},value=directInput();mocked.plans.push(directPlan({store}));
  const pending=finalize(value);value.intent.requestVersion++;value.template.fill(0);value.completion.certifications[0].strokes[0][0].x=0.99;
  expect(await pending).toEqual({state:"stored",binding:directBinding(),construction:construction()});
  const calls=queries();expect(calls.indexOf("begin")).toBeLessThan(calls.findIndex(q=>q.includes("parent_get_snap_direct_context")));
  expect(calls.findIndex(q=>q.includes("parent_seal_snap"))).toBeLessThan(calls.findIndex(q=>q.includes("parent_record_snap_direct_construction")));
  const completed=mocked.clients[0].calls.find(call=>call.text.includes("parent_finish_snap_direct_completion"))!;
  expect(completed.values).toEqual([directData.intent.packetId,directData.intent.requestId,2,directData.intent.authorizationId,construction().verificationId]);
  expect(calls.findIndex(q=>q.includes("parent_record_snap_direct_construction"))).toBeLessThan(calls.indexOf(completed.text));
  expect(calls.indexOf(completed.text)).toBeLessThan(calls.indexOf("commit"));
  expect(store.operation).toBe("77777777-7777-4777-8777-777777777777");
  expect(calls.filter(q=>q==="commit")).toHaveLength(1);expect(calls).not.toContain("rollback");expect(store.construction).toEqual(construction());
  const e=store.value!,clear=packetCrypto.openSnapFinalPacket({binding:e.binding,iv:Buffer.from(e.iv,"base64"),tag:Buffer.from(e.tag,"base64"),ciphertext:Buffer.from(e.ciphertext,"base64")},fixtureKey,time);
  expect(clear.length===directData.rendered.bytes!.length&&clear.every((byte,index)=>byte===directData.rendered.bytes![index])).toBe(true);clear.fill(0);
  for(const canary of ["900000001","strokes",fixtureKey.toString("base64")])expect(JSON.stringify(mocked.clients[0].calls)).not.toContain(canary);
 });
 it("regenerates and binds an initial filing with an explicitly blank identifier before preparing its exact operation",async()=>{
  const value=directInput();value.completion.identifiers[0]={personId:value.completion.identifiers[0].personId,kind:"provide_to_agency_later"};
  const rendered=await directRenderer.renderSnapDirectCompletion(value.template,directData.trusted,value.completion,time);
  expect(rendered.bytes).not.toBeNull();if(!rendered.bytes)throw new Error("Synthetic initial filing missing");
  value.intent={...value.intent,contentSha256:rendered.contentSha256,byteLength:rendered.byteLength};
  const b={...directBinding(),...value.intent},proof={...construction(),contentSha256:rendered.contentSha256};
  const store:Store={};mocked.plans.push(directPlan({store,binding:b,construction:proof,directContext:{...directContext(),intent:value.intent}}));
  expect(await finalize(value)).toEqual({state:"stored",binding:b,construction:proof});
  const e=store.value!,clear=packetCrypto.openSnapFinalPacket({binding:e.binding,iv:Buffer.from(e.iv,"base64"),tag:Buffer.from(e.tag,"base64"),ciphertext:Buffer.from(e.ciphertext,"base64")},fixtureKey,time);
  expect(Buffer.from(clear)).toEqual(Buffer.from(rendered.bytes));clear.fill(0);rendered.bytes.fill(0);
  expect(queries().some(q=>q.includes("parent_finish_snap_direct_completion"))).toBe(true);
  expect(JSON.stringify(mocked.clients[0].calls)).not.toContain("provide_to_agency_later");
 });
 it.each(Object.keys(intent()))("rejects foreign/malformed DB intent %s before key creation",async field=>{
  const context=directContext();Reflect.set(context.intent,field,field==="requestVersion"?3:field==="byteLength"?1:"different");mocked.plans.push(directPlan({directContext:context}));
  await expect(finalize()).rejects.toThrow(SNAP_FINALIZER_ERROR);expect(queries()).toContain("rollback");expect(queries().some(q=>q.includes("parent_begin_snap"))).toBe(false);
 });
 it.each(["context","snapshot","preparedAt","future","unknown"])("rejects changed %s provenance before key creation",async field=>{
  const context=directContext();
  if(field==="context")context.context.snapshotHash="f".repeat(64);
  if(field==="snapshot")context.snapshot.request_id=context.snapshot.id;
  if(field==="preparedAt")context.preparedAt=time.toISOString();
  if(field==="future")context.preparedAt=context.snapshot.created_at=new Date(time.getTime()+1000).toISOString();
  if(field==="unknown")Reflect.set(context,"privateDebug","PRIVATE_CONTEXT_CANARY");
  mocked.plans.push(directPlan({directContext:context}));await expect(finalize()).rejects.toThrow(SNAP_FINALIZER_ERROR);
  expect(queries()).toContain("rollback");expect(queries().some(q=>q.includes("parent_begin_snap"))).toBe(false);
 });
 it.each(["knownfact","identifier","stroke","unsignedhash","source"])("rejects changed %s rather than recording a false construction",async field=>{
  const context=directContext(),value=directInput();
  if(field==="knownfact")context.snapshot.details.screening!.lowCashAndIncome=!context.snapshot.details.screening!.lowCashAndIncome;
  if(field==="identifier")value.completion.identifiers[0]={personId:value.completion.identifiers[0].personId,kind:"ssn",value:"900000009"};
  if(field==="stroke")value.completion.certifications[0].strokes[0][0].x=0.9;
  if(field==="unsignedhash")value.completion.unsignedContentSha256="f".repeat(64);
  if(field==="source")value.template[100]^=1;
  mocked.plans.push(directPlan({directContext:context}));await expect(finalize(value)).rejects.toThrow(SNAP_FINALIZER_ERROR);
  expect(queries().some(q=>q.includes("parent_begin_snap")||q.includes("parent_record_snap"))).toBe(false);expect(queries()).toContain("rollback");
 });
 it("checks freshness at the real operation time rather than snapshot creation",async()=>{
  const context=directContext();for(const proof of Object.values(context.snapshot.provenance)){proof.confirmedAt="2026-09-25T12:00:00Z";proof.asOf="2026-09-25";}
  vi.setSystemTime(new Date("2026-11-20T20:35:00.000Z"));mocked.plans.push(directPlan({directContext:context}));
  await expect(finalize()).rejects.toThrow(SNAP_FINALIZER_ERROR);expect(queries().some(q=>q.includes("parent_begin_snap"))).toBe(false);
 });
 it("rolls back packet and evidence together and wipes rendered bytes/key if recording fails",async()=>{
  let clear:Uint8Array|undefined,key:Uint8Array|undefined;const render=directRenderer.renderSnapDirectCompletion,seal=packetCrypto.sealSnapFinalPacket;
  vi.spyOn(directRenderer,"renderSnapDirectCompletion").mockImplementation(async(...args)=>{const result=await render(...args);clear=result.bytes??undefined;return result;});
  vi.spyOn(packetCrypto,"sealSnapFinalPacket").mockImplementation((bytes,k,b,now)=>{key=k;return seal(bytes,k,b,now);});
  const store:Store={};mocked.plans.push(directPlan({store,errorAt:"construction"}));await expect(finalize()).rejects.toThrow(SNAP_FINALIZER_ERROR);
  expect(queries()).toContain("rollback");expect(queries()).not.toContain("commit");expect(store).toEqual({});
  expect(clear?.every(b=>b===0)).toBe(true);expect(key?.every(b=>b===0)).toBe(true);
 });
 it("reconciles a lost COMMIT after restart only when both packet and construction exist",async()=>{
  const store:Store={};mocked.plans.push(directPlan({store,lostCommit:true}));
  expect(await finalize()).toEqual({state:"commit_unknown",intent:directData.intent});expect(queries()).not.toContain("rollback");
  mocked.plans.push(directPlan({store}));expect(await reconcileSnapDirectCompletion(directData.intent,options())).toEqual({state:"stored",binding:directBinding(),construction:construction()});
  expect(queries(1).some(q=>q.includes("parent_read_snap_final_packet"))).toBe(true);expect(queries(1).some(q=>q.includes("parent_read_snap_direct_construction"))).toBe(true);
  expect(queries(1).some(q=>q.includes("parent_read_snap_direct_operation"))).toBe(true);
  expect(queries(1).findIndex(q=>q.includes("parent_get_snap_direct_context"))).toBeLessThan(queries(1).findIndex(q=>q.includes("parent_read_snap_final_packet")));
  expect(queries(1).some(q=>q.includes("parent_begin_snap")||q.includes("parent_seal_snap")||q.includes("parent_record_snap")||q.includes("parent_finish_snap"))).toBe(false);
  delete store.construction;mocked.plans.push(directPlan({store}));expect((await reconcileSnapDirectCompletion(directData.intent,options())).state).toBe("commit_unknown");
 });
 it.each(["denied","malformed"])("rolls back bytes, construction and continuation together when operation is %s",async failure=>{
  const store:Store={};mocked.plans.push(directPlan({store,...failure==="denied"?{errorAt:"operation"}:{operation:"PRIVATE_INVALID_OPERATION"}}));
  await expect(finalize()).rejects.toThrow(SNAP_FINALIZER_ERROR);
  expect(queries()).toContain("rollback");expect(queries()).not.toContain("commit");expect(store).toEqual({});
 });
 it.each(["absent","denied","malformed"])("keeps a saved packet unresolved when canonical operation is %s without repairing it",async failure=>{
  const store:Store={};mocked.plans.push(directPlan({store}));await finalize();
  mocked.plans.push(directPlan({store,...failure==="denied"?{errorAt:"readOperation"}:{readOperation:failure==="absent"?null:"PRIVATE_INVALID_OPERATION"}}));
  expect(await reconcileSnapDirectCompletion(directData.intent,options())).toEqual({state:"commit_unknown",intent:directData.intent});
  expect(queries(1).some(q=>q.includes("parent_finish_snap")||q.includes("parent_seal_snap")||q.includes("parent_record_snap"))).toBe(false);
 });
 it.each(["authority_denied","foreign_intent","changed_snapshot","invalid_reply"])("keeps %s recovery unresolved before any protected packet/key read",async failure=>{
  const store:Store={};mocked.plans.push(directPlan({store}));await finalize();
  const context=directContext();
  if(failure==="foreign_intent")context.intent.authorizationId="99999999-9999-4999-8999-999999999999";
  if(failure==="changed_snapshot")context.context.snapshotHash="f".repeat(64);
  if(failure==="invalid_reply")Reflect.set(context,"privateDebug","PRIVATE_CONTEXT_CANARY");
  const open=vi.spyOn(packetCrypto,"openSnapFinalPacket");mocked.plans.push(directPlan({store,...failure==="authority_denied"?{errorAt:"directContext"}:{directContext:context}}));
  expect(await reconcileSnapDirectCompletion(directData.intent,options())).toEqual({state:"commit_unknown",intent:directData.intent});
  expect(queries(1).some(q=>q.includes("parent_get_snap_direct_context"))).toBe(true);
  expect(queries(1).some(q=>q.includes("parent_read_snap")||q.includes("parent_begin_snap")||q.includes("parent_seal_snap")||q.includes("parent_record_snap"))).toBe(false);
  expect(open).not.toHaveBeenCalled();expect(mocked.clients[1].destroyed).toBe(1);
 });
 it("replays a stored exact completion read-only and rejects changed entries before any reconciliation",async()=>{
  const store:Store={};mocked.plans.push(directPlan({store}));await finalize();
  mocked.plans.push(directPlan({store,directContext:{...directContext(),state:"stored"}}));expect(await finalize()).toEqual({state:"stored",binding:directBinding(),construction:construction()});
  expect(queries(1).some(q=>q.includes("parent_read_snap_direct_construction"))).toBe(true);
  expect(queries(1).some(q=>q.includes("parent_begin_snap")||q.includes("parent_seal_snap")||q.includes("parent_record_snap"))).toBe(false);
  const value=directInput();value.completion.identifiers[0]={personId:value.completion.identifiers[0].personId,kind:"ssn",value:"900000009"};
  mocked.plans.push(directPlan({store,directContext:{...directContext(),state:"stored"}}));await expect(finalize(value)).rejects.toThrow(SNAP_FINALIZER_ERROR);
  expect(queries(2).some(q=>q.includes("parent_read_snap"))).toBe(false);
 });
 it.each(["packetId","snapshotId","snapshotHash","contentSha256","validatorVersion","source","requiredPersonalActs","verifiedAt","expiresAt","unknown"])("never reconciles tampered %s evidence",async field=>{
  const store:Store={};mocked.plans.push(directPlan({store}));await finalize();
  const proof:Record<string,unknown>={...construction()};proof[field]=field==="source"?{...construction().source,templateSha256:"f".repeat(64)}:field==="requiredPersonalActs"?[]:field==="verifiedAt"?new Date(time.getTime()+1).toISOString():field==="expiresAt"?time.toISOString():"PRIVATE_EVIDENCE_CANARY";
  mocked.plans.push(directPlan({store,readConstruction:proof}));expect((await reconcileSnapDirectCompletion(directData.intent,options())).state).toBe("commit_unknown");
  expect(queries(1).some(q=>q.includes("parent_begin_snap")||q.includes("parent_record_snap"))).toBe(false);
 });
 it("bounds an aborted renderer and wipes a late private result without key creation",async()=>{
  let finish!:(value:directRenderer.SnapDirectCompletionResult)=>void;
  const rendering=vi.spyOn(directRenderer,"renderSnapDirectCompletion").mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const stop=new AbortController();mocked.plans.push(directPlan());const pending=finalize(directInput(),stop.signal),assertion=expect(pending).rejects.toThrow(SNAP_FINALIZER_ERROR);
  await vi.waitFor(()=>expect(rendering).toHaveBeenCalledOnce());stop.abort();await assertion;
  const late=structuredClone(directData.rendered);finish(late);await Promise.resolve();await Promise.resolve();
  expect(late.bytes?.every(b=>b===0)).toBe(true);expect(mocked.clients[0].destroyed).toBe(1);expect(queries().some(q=>q.includes("parent_begin_snap"))).toBe(false);
 });
 it("bounds a hanging COMMIT once, retains unknown state and wipes its private buffers",async()=>{
  vi.useFakeTimers();vi.setSystemTime(time);const rendered=structuredClone(directData.rendered);
  vi.spyOn(directRenderer,"renderSnapDirectCompletion").mockResolvedValue(rendered);mocked.plans.push(directPlan({hangAt:"commit"}));
  const pending=finalize(directInput(),undefined,100);await vi.advanceTimersByTimeAsync(0);expect(queries()).toContain("commit");await vi.advanceTimersByTimeAsync(100);
  expect(await pending).toEqual({state:"commit_unknown",intent:directData.intent});expect(queries().filter(q=>q==="commit")).toHaveLength(1);expect(queries()).not.toContain("rollback");expect(rendered.bytes?.every(b=>b===0)).toBe(true);
 });
});
