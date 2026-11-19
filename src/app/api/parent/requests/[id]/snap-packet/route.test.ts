import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import source from "../../../../../../../data/verified-forms/snap-pa600fs-2019.json";
const mocks=vi.hoisted(()=>({session:vi.fn(),rpc:vi.fn()}));
vi.mock("@/lib/parent/auth",()=>({requireParentSession:mocks.session}));
import { GET,POST } from "./route";

const site="https://caselink.test",owner="11111111-1111-4111-8111-111111111111",requestId="22222222-2222-4222-8222-222222222222";
const packetId="33333333-3333-4333-8333-333333333333",snapshotId="44444444-4444-4444-8444-444444444444";
const path=`${site}/api/parent/requests/${requestId}/snap-packet`;
function input(){return{packetId,expectedVersion:3,snapshotId,snapshotHash:"a".repeat(64),contentSha256:"b".repeat(64),byteLength:512,
 policyVersion:"synthetic-policy-1",retentionPolicyVersion:"synthetic-retention-1",subjectIds:[owner],authorityDeclared:true};}
function result(){return{
 intent:{format:"caselink-snap-final-packet-v1",packetId,ownerId:owner,requestId,requestVersion:3,recipient:"snap-pa",need:"snap_new",purpose:"snap_final_application_packet",
  authorizationId:"55555555-5555-4555-8555-555555555555",policyVersion:input().policyVersion,retentionPolicyVersion:input().retentionPolicyVersion,
  templateId:source.id,templateVersion:source.version,templateSha256:source.sha256,snapshotId,snapshotHash:input().snapshotHash,contentSha256:input().contentSha256,byteLength:512},
 authorizationExpiresAt:"2026-11-04T21:05:00.000Z",subjectIds:[owner],authorityDeclaration:"parent_declared_household_data_authority",consentedAt:"2026-11-04T20:59:00.000Z",state:"authorized"};}
const context=(id=requestId)=>({params:Promise.resolve({id})});
const foreignReadHeaders:Record<string,string>[]=[{origin:"https://other.test"},{"sec-fetch-site":"cross-site"},{"sec-fetch-site":"same-site"}];
function post(body:unknown=input(),headers:Record<string,string>={origin:site,"content-type":"application/json"},url=path){return new Request(url,{method:"POST",headers,body:JSON.stringify(body)});}
function get(query=`packetId=${packetId}&expectedVersion=3&snapshotId=${snapshotId}&snapshotHash=${input().snapshotHash}`,headers:Record<string,string>={}){return new Request(`${path}?${query}`,{headers});}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-04T21:00:00.000Z"));vi.clearAllMocks();vi.stubEnv("NEXT_PUBLIC_SITE_URL",site);
 vi.spyOn(console,"error").mockImplementation(()=>{});mocks.session.mockResolvedValue({supabase:{rpc:mocks.rpc},user:{id:owner,email:"synthetic@example.invalid"}});mocks.rpc.mockResolvedValue({data:result(),error:null});});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});

describe("owned SNAP packet metadata HTTP routes",()=>{
 it("records only metadata and returns private no-store JSON without a completion claim",async()=>{
  const response=await POST(post(),context());expect(response.status).toBe(201);expect(await response.json()).toEqual({ok:true,authorization:result()});
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(mocks.rpc.mock.calls[0][0]).toBe("parent_authorize_snap_final_packet");expect(mocks.rpc).toHaveBeenCalledTimes(1);
 });
 it("allows normal same-origin GET without an Origin header and matches all four known metadata fields",async()=>{
  const response=await GET(get(),context());expect(response.status).toBe(200);expect(await response.json()).toEqual({ok:true,authorization:result()});
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("parent_get_snap_final_packet_authorization",{p_request_id:requestId,p_packet_id:packetId,p_expected_version:3});
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
 });
 it("keeps exact replay metadata and original expiry unchanged",async()=>{
  const first=await POST(post(),context()),second=await POST(post(),context());expect(await first.json()).toEqual(await second.json());expect(mocks.rpc).toHaveBeenCalledTimes(2);
 });
 it.each([undefined,"https://other.test"])("rejects a POST with missing or foreign origin before reading the body: %s",async origin=>{
  const incoming=post(input(),{"content-type":"application/json",...(origin?{origin}:{})}),body=vi.spyOn(incoming,"body","get");
  expect((await POST(incoming,context())).status).toBe(403);expect(body).not.toHaveBeenCalled();expect(mocks.session).not.toHaveBeenCalled();
 });
 it.each(foreignReadHeaders)("rejects explicitly cross-origin metadata reads before authentication: %j",async headers=>{
  expect((await GET(get(undefined,headers),context())).status).toBe(403);expect(mocks.session).not.toHaveBeenCalled();
 });
 it.each(["application/pdf","multipart/form-data; boundary=synthetic","image/png","text/plain"])("never reads a raw file or form body: %s",async type=>{
  const incoming=post(input(),{origin:site,"content-type":type}),body=vi.spyOn(incoming,"body","get"),form=vi.spyOn(incoming,"formData");
  expect((await POST(incoming,context())).status).toBe(400);expect(body).not.toHaveBeenCalled();expect(form).not.toHaveBeenCalled();expect(mocks.session).not.toHaveBeenCalled();
 });
 it.each([
  {ssn:"123-45-6789"},{signature:"PRIVATE-CANARY"},{file:"PRIVATE-CANARY"},{ownerId:owner},{expectedVersion:2147483648},{authorityDeclared:false},{subjectIds:[owner,owner]},
 ])("rejects unknown/private/invalid metadata with a fixed error: %j",async override=>{
  const response=await POST(post({...input(),...override}),context());expect(response.status).toBe(400);expect(await response.json()).toEqual({ok:false,error:"Check the information and try again."});expect(mocks.session).not.toHaveBeenCalled();
 });
 it("bounds JSON bytes and rejects query shadowing or an invalid path",async()=>{
  expect((await POST(post({...input(),extra:"x".repeat(5000)}),context())).status).toBe(400);
  expect((await POST(post(input(),undefined,`${path}?packetId=${owner}`),context())).status).toBe(400);
  expect((await POST(post(),context("not-a-request"))).status).toBe(400);expect(mocks.session).not.toHaveBeenCalled();
 });
 it.each([
  `packetId=${packetId}&expectedVersion=3&snapshotId=${snapshotId}&snapshotHash=${input().snapshotHash}&expectedVersion=4`,
  `packetId=${packetId}&expectedVersion=3&snapshotId=${snapshotId}&snapshotHash=${input().snapshotHash}&__proto__=PRIVATE-CANARY`,
  `packetId=${packetId}&expectedVersion=3&snapshotId=${snapshotId}&snapshotHash=${input().snapshotHash}&ssn=123-45-6789`,
  `packetId=${packetId}&expectedVersion=03&snapshotId=${snapshotId}&snapshotHash=${input().snapshotHash}`,
  `packetId=${packetId}&expectedVersion=2147483648&snapshotId=${snapshotId}&snapshotHash=${input().snapshotHash}`,
  `packetId=${packetId}&expectedVersion=3`, `packetId=${packetId}&expectedVersion=1e3`, `x=${"a".repeat(1100)}`,
 ])("rejects duplicate, unknown, missing or noncanonical query fields %#",async query=>{
  const response=await GET(get(query),context());expect(response.status).toBe(400);expect(await response.json()).toEqual({ok:false,error:"Check the information and try again."});expect(mocks.session).not.toHaveBeenCalled();
 });
 it("requires a current parent session for both metadata methods",async()=>{
  mocks.session.mockRejectedValue(new Error("Sign in again"));expect((await POST(post(),context())).status).toBe(401);expect((await GET(get(),context())).status).toBe(401);expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it("keeps closed purpose or ownership denials private without claiming success",async()=>{
  mocks.rpc.mockResolvedValue({data:null,error:{code:"42501",message:"PRIVATE-POLICY-OR-OWNER-CANARY"}});
  for(const response of [await POST(post(),context()),await GET(get(),context())]){expect(response.status).toBe(403);expect(await response.json()).toEqual({ok:false,error:"This support request is unavailable, or its permission has changed."});}
 });
 it.each(["ownerId","requestId","requestVersion","packetId","snapshotId","snapshotHash"])("never returns a mismatched %s from the provider reply",async field=>{
  const value=result();mocks.rpc.mockResolvedValue({data:{...value,intent:{...value.intent,[field]:field==="requestVersion"?4:field==="snapshotHash"?"c".repeat(64):"66666666-6666-4666-8666-666666666666"}},error:null});
  const response=await GET(get(),context());expect(response.status).toBe(500);expect((await response.json()).ok).toBe(false);
 });
 it("does not echo unexpected private fields or transport errors",async()=>{
  mocks.rpc.mockResolvedValue({data:{...result(),keyBase64:"PRIVATE-REPLY-CANARY"},error:null});
  const response=await POST(post(),context());expect(response.status).toBe(500);expect(JSON.stringify(await response.json())).not.toContain("PRIVATE-");
  mocks.rpc.mockRejectedValue(new Error("PRIVATE-TRANSPORT-CANARY"));const lost=await POST(post(),context());expect(lost.status).toBe(500);expect(JSON.stringify(await lost.json())).not.toContain("PRIVATE-");
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("PRIVATE-");
 });
});
