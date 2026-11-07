import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import source from "../../../data/verified-forms/snap-pa600fs-2019.json";
const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn() }));
vi.mock("./auth", () => ({ requireParentSession: mocks.session }));
import { authorizeSnapPacket, getSnapPacketAuthorization } from "./snap-packet-data";
import type { SnapPacketAuthorizationResult } from "./snap-packet-contract";

const owner="11111111-1111-4111-8111-111111111111",requestId="22222222-2222-4222-8222-222222222222";
const packetId="abcdefab-cdef-4abc-8def-abcdefabcdef",snapshotId="44444444-4444-4444-8444-444444444444";
const now=new Date("2026-11-04T21:00:00.000Z");
function input(){return{packetId,expectedVersion:3,snapshotId,snapshotHash:"a".repeat(64),contentSha256:"b".repeat(64),byteLength:512,
 policyVersion:"synthetic-policy-1",retentionPolicyVersion:"synthetic-retention-1",subjectIds:[owner],authorityDeclared:true as const};}
function scope(){const {packetId,expectedVersion,snapshotId,snapshotHash}=input();return{packetId,expectedVersion,snapshotId,snapshotHash};}
function result():SnapPacketAuthorizationResult{return{
 intent:{format:"caselink-snap-final-packet-v1",packetId,ownerId:owner,requestId,requestVersion:3,recipient:"snap-pa",need:"snap_new",purpose:"snap_final_application_packet",
  authorizationId:"55555555-5555-4555-8555-555555555555",policyVersion:input().policyVersion,retentionPolicyVersion:input().retentionPolicyVersion,
  templateId:source.id,templateVersion:source.version,templateSha256:source.sha256,snapshotId,snapshotHash:input().snapshotHash,contentSha256:input().contentSha256,byteLength:512},
 authorizationExpiresAt:"2026-11-04T21:05:00.000Z",subjectIds:[owner],authorityDeclaration:"parent_declared_household_data_authority",consentedAt:"2026-11-04T20:59:00.000Z",state:"authorized"};}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(now);vi.clearAllMocks();mocks.session.mockResolvedValue({supabase:{rpc:mocks.rpc},user:{id:owner,email:"synthetic@example.invalid"}});mocks.rpc.mockResolvedValue({data:result(),error:null});});
afterEach(()=>vi.useRealTimers());

describe("owned SNAP packet metadata SDK",()=>{
 it("uses the active parent's RPC with the exact declared intent and no applicant values",async()=>{
  expect(await authorizeSnapPacket(requestId,input())).toEqual(result());
  expect(mocks.session).toHaveBeenCalledExactlyOnceWith();expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("parent_authorize_snap_final_packet",{
   p_request_id:requestId,p_expected_version:3,p_snapshot_id:snapshotId,p_snapshot_hash:input().snapshotHash,p_packet_id:packetId,p_content_sha256:input().contentSha256,p_byte_length:512,
   p_policy_version:input().policyVersion,p_retention_policy_version:input().retentionPolicyVersion,p_subject_ids:[owner],p_authority_declared:true});
 });
 it("recovers exact metadata without beginning encryption, creating an operation or inferring upload absence",async()=>{
  expect(await getSnapPacketAuthorization(requestId,scope())).toEqual(result());
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("parent_get_snap_final_packet_authorization",{p_request_id:requestId,p_packet_id:packetId,p_expected_version:3});
 });
 it.each(["authorized","stored"] as const)("preserves honest %s metadata on exact replay",async state=>{
  mocks.rpc.mockResolvedValue({data:{...result(),state},error:null});
  expect(await authorizeSnapPacket(requestId,input())).toEqual({...result(),state});expect(await authorizeSnapPacket(requestId,input())).toEqual({...result(),state});
 });
 it("canonicalizes UUID input before comparing the canonical database reply",async()=>{
  expect(await authorizeSnapPacket(requestId,{...input(),packetId:packetId.toUpperCase()})).toEqual(result());
  expect(mocks.rpc.mock.calls[0][1].p_packet_id).toBe(packetId);
 });
 it.each([
  {expectedVersion:0},{expectedVersion:2147483648},{byteLength:0},{byteLength:10485761},{contentSha256:"B".repeat(64)},
  {authorityDeclared:false},{subjectIds:[]},{subjectIds:[owner,owner]},{policyVersion:"Not published"},{ownerId:owner},{signature:"PRIVATE-CANARY"},{ssn:"123-45-6789"},
 ])("rejects malformed/extra metadata before using a session: %j",async change=>{
  await expect(authorizeSnapPacket(requestId,{...input(),...change})).rejects.toThrow("parent_invalid_input");expect(mocks.session).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it("rejects invalid path and unknown recovery fields before using a session",async()=>{
  await expect(getSnapPacketAuthorization("invalid",scope())).rejects.toThrow("parent_invalid_input");
  await expect(getSnapPacketAuthorization(requestId,{...scope(),rawFile:"PRIVATE-CANARY"})).rejects.toThrow("parent_invalid_input");expect(mocks.session).not.toHaveBeenCalled();
 });
 it("preserves genuine session denial and makes no RPC call",async()=>{
  mocks.session.mockRejectedValue(new Error("Sign in again"));await expect(authorizeSnapPacket(requestId,input())).rejects.toThrow("Sign in again");expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it("copies input scope before awaiting the session",async()=>{
  const value=input(),promise=authorizeSnapPacket(requestId,value);value.byteLength=999;value.subjectIds.push(packetId);
  expect(await promise).toEqual(result());expect(mocks.rpc.mock.calls[0][1].p_byte_length).toBe(512);expect(mocks.rpc.mock.calls[0][1].p_subject_ids).toEqual([owner]);
 });
 it.each(["ownerId","requestId","requestVersion","packetId","snapshotId","snapshotHash","templateId","templateVersion","templateSha256","contentSha256","byteLength","policyVersion","retentionPolicyVersion"] as const)("does not return an authorization with a different %s",async field=>{
  const value=result(),intent={...value.intent,[field]:field==="requestVersion"?4:field==="byteLength"?513:field.endsWith("Hash")||field.endsWith("Sha256")?"c".repeat(64):field.endsWith("Id")?"66666666-6666-4666-8666-666666666666":"different-policy"};
  mocks.rpc.mockResolvedValue({data:{...value,intent},error:null});await expect(authorizeSnapPacket(requestId,input())).rejects.toThrow("CaseLink could not confirm");
 });
 it.each(["ownerId","requestId","requestVersion","packetId","snapshotId","snapshotHash"] as const)("also matches recovery %s to the active owner and requested scope",async field=>{
  const value=result();mocks.rpc.mockResolvedValue({data:{...value,intent:{...value.intent,[field]:field==="requestVersion"?4:field==="snapshotHash"?"c".repeat(64):"66666666-6666-4666-8666-666666666666"}},error:null});
  await expect(getSnapPacketAuthorization(requestId,scope())).rejects.toThrow("CaseLink could not confirm");
 });
 it.each([
  null,{}, { ...result(),subjectIds:[packetId] },{...result(),state:"complete"},{...result(),keyBase64:"PRIVATE-CANARY"},
  {...result(),intent:{...result().intent,signature:"PRIVATE-CANARY"}}, {...result(),authorizationExpiresAt:"2026-11-04T20:59:30.000Z"},
  {...result(),consentedAt:"2026-11-04T21:01:00.000Z"},{...result(),authorizationExpiresAt:"2027-01-01T00:00:00.000Z"},
 ])("does not confirm missing, private, stale or invalid replies %#",async data=>{
  mocks.rpc.mockResolvedValue({data,error:null});const error=await authorizeSnapPacket(requestId,input()).catch(error=>error as Error);
  expect(error).toBeInstanceOf(Error);expect((error as Error).message).toContain("CaseLink could not confirm");expect((error as Error).message).not.toContain("PRIVATE-CANARY");
 });
 it.each([["42501","This request is unavailable"],["23514","parent_invalid_input"],["08006","CaseLink could not confirm"]])("keeps %s denial details private",async(code,message)=>{
  mocks.rpc.mockResolvedValue({data:null,error:{code,message:"PRIVATE-ERROR-CANARY"}});await expect(authorizeSnapPacket(requestId,input())).rejects.toThrow(message);
 });
 it("keeps thrown transport errors private and does not retry an uncertain write",async()=>{
  mocks.rpc.mockRejectedValue(new Error("PRIVATE-TRANSPORT-CANARY"));await expect(authorizeSnapPacket(requestId,input())).rejects.toThrow("CaseLink could not confirm");expect(mocks.rpc).toHaveBeenCalledTimes(1);
 });
});
