import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureRequest } from "@/lib/parent/test-fixtures";
import type { DocumentUploadRecord } from "@/lib/parent/document-upload";
const mocks = vi.hoisted(() => ({ session:vi.fn(),register:vi.fn(),confirm:vi.fn(),tryConfirm:vi.fn(),lookup:vi.fn(),upload:vi.fn(),request:vi.fn() }));
vi.mock("@/lib/parent/auth",()=>({requireParentSession:mocks.session}));
vi.mock("@/lib/parent/data",()=>({registerParentDocument:mocks.register,confirmParentDocumentUpload:mocks.confirm,
  tryConfirmParentDocumentUpload:mocks.tryConfirm,getParentDocumentUpload:mocks.lookup,getSupportRequest:mocks.request,PARENT_DOCUMENT_BUCKET:"parent-documents"}));
import { GET, POST } from "./requests/[id]/documents/route";
const id=fixtureRequest().id,documentId="79dac7b7-53ef-4606-97b7-cb539948b206",key="11111111-1111-4111-8111-111111111111";
const context={params:Promise.resolve({id})},origin="https://app.example.test",bytes="%PDF-SYNTHETIC-QUARANTINE";
let record:DocumentUploadRecord,stored:boolean;
function request(consent="1",uploadKey:string|null=key){
  const form=new FormData();form.set("consent",consent);form.set("file",new File([bytes],"synthetic.pdf",{type:"application/pdf"}));
  return new Request(`${origin}/api/parent/requests/${id}/documents`,{method:"POST",headers:{Origin:origin,...(uploadKey?{"Idempotency-Key":uploadKey}:{})},body:form});
}
beforeEach(()=>{
  vi.stubEnv("NEXT_PUBLIC_SITE_URL",origin);vi.clearAllMocks();stored=false;
  const now=new Date().toISOString();
  record={id:documentId,request_id:id,filename:"synthetic.pdf",media_type:"application/pdf",size_bytes:bytes.length,status:"uploaded",expires_at:new Date(Date.now()+604800000).toISOString(),created_at:now,consented_at:now,consent_version:"2026-10-25",upload_confirmed_at:null,upload_key:key,upload_sha256:createHash("sha256").update(bytes).digest("hex"),object_path:"private-synthetic-path"};
  mocks.request.mockResolvedValue(fixtureRequest());
  mocks.session.mockResolvedValue({supabase:{storage:{from:()=>({upload:mocks.upload})}}});
  mocks.register.mockImplementation(async()=>({document:{...record},existing:false}));
  mocks.lookup.mockImplementation(async()=>({...record}));
  mocks.upload.mockImplementation(async()=>{stored=true;return{error:null};});
  mocks.confirm.mockImplementation(async()=>{record.upload_confirmed_at=now;});
  mocks.tryConfirm.mockImplementation(async()=>{if(!stored)return false;record.upload_confirmed_at??=now;return true;});
});
afterEach(()=>vi.unstubAllEnvs());
describe("consented immutable upload recovery",()=>{
  it.each(["has_peco_application_details","has_pgw_application_details","has_water_application_details"])("denies a private utility request (%s) before reading any file",async flag=>{
    mocks.request.mockResolvedValue(fixtureRequest({[flag]:true}));const input=request();expect((await POST(input,context)).status).toBe(403);expect(input.bodyUsed).toBe(false);expect(mocks.register).not.toHaveBeenCalled();expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("fails closed before reading a file when private-purpose metadata is unavailable",async()=>{
    mocks.request.mockRejectedValue(new Error("database PrivateMarkerCanary"));const input=request(),response=await POST(input,context);
    expect(response.status).toBe(500);expect(input.bodyUsed).toBe(false);expect(await response.text()).not.toContain("PrivateMarkerCanary");expect(mocks.register).not.toHaveBeenCalled();
  });
  it("preserves separate document consent on an ordinary utility request",async()=>{
    const support=fixtureRequest();support.intake.needs=["electricity"];support.intake.utilityProviders=["peco"];support.mandate.allowedData=["household","income","utility"];
    mocks.request.mockResolvedValue(support);expect((await POST(request(),context)).status).toBe(201);expect(mocks.upload).toHaveBeenCalledOnce();
  });
  it.each(["wic_new","wic_continuing"] as const)("denies %s before parsing a file",async need=>{
    mocks.request.mockResolvedValue(fixtureRequest({intake:{...fixtureRequest().intake,needs:[need]}}));const input=request();expect((await POST(input,context)).status).toBe(403);expect(input.bodyUsed).toBe(false);expect(mocks.register).not.toHaveBeenCalled();
  });
  it("does not parse unavailable, closed or unkeyed uploads",async()=>{
    mocks.request.mockResolvedValueOnce(null);const absent=request();expect((await POST(absent,context)).status).toBe(404);expect(absent.bodyUsed).toBe(false);
    mocks.request.mockResolvedValueOnce(fixtureRequest({status:"closed"}));const closed=request();expect((await POST(closed,context)).status).toBe(403);expect(closed.bodyUsed).toBe(false);
    const unkeyed=request("1",null),response=await POST(unkeyed,context);expect(response.status).toBe(400);expect((await response.json()).error).toContain("check your document list");expect(unkeyed.bodyUsed).toBe(false);expect(mocks.register).not.toHaveBeenCalled();
  });
  it("binds server-computed bytes and confirms only after immutable storage, without exposing path or hash",async()=>{
    const result=await POST(request(),context);expect(result.status).toBe(201);expect(mocks.confirm).toHaveBeenCalledWith(id,documentId);
    expect(mocks.register.mock.invocationCallOrder[0]).toBeLessThan(mocks.upload.mock.invocationCallOrder[0]);expect(mocks.upload.mock.invocationCallOrder[0]).toBeLessThan(mocks.confirm.mock.invocationCallOrder[0]);
    expect(mocks.register.mock.calls[0][0]).toMatchObject({pageCount:null,uploadKey:key,uploadSha256:createHash("sha256").update(bytes).digest("hex")});
    const body=await result.json();expect(body.receipt.state).toBe("confirmed");expect(body.document.id).toBe(documentId);expect(JSON.stringify(body)).not.toMatch(/private-synthetic-path|upload_sha256/);
  });
  it("never starts storage without processing consent",async()=>{expect((await POST(request("0"),context)).status).toBe(400);expect(mocks.register).not.toHaveBeenCalled();});
  it("returns the confirmed original receipt without another storage call or confirmation",async()=>{
    record.upload_confirmed_at=record.created_at;mocks.register.mockImplementation(async()=>({document:{...record},existing:true}));
    const original={...record};expect((await POST(request(),context)).status).toBe(201);expect(mocks.upload).not.toHaveBeenCalled();expect(mocks.confirm).not.toHaveBeenCalled();expect(record).toEqual(original);
  });
  it("confirms existing pending stored bytes before attempting any repeat upload",async()=>{
    stored=true;mocks.register.mockImplementation(async()=>({document:{...record},existing:true}));
    expect((await POST(request(),context)).status).toBe(201);expect(mocks.tryConfirm).toHaveBeenCalledOnce();expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("reconciles an unknown storage acknowledgement instead of deleting successful bytes",async()=>{
    mocks.upload.mockImplementation(async()=>{stored=true;return{error:new Error("synthetic lost storage ACK")};});
    expect((await POST(request(),context)).status).toBe(201);expect(record.upload_confirmed_at).not.toBeNull();expect(mocks.tryConfirm).toHaveBeenCalledOnce();
  });
  it("keeps one quarantined attempt after a failed transfer so the same path can be resumed",async()=>{
    mocks.upload.mockResolvedValue({error:new Error("synthetic unavailable storage")});
    const response=await POST(request(),context);expect(response.status).toBe(503);expect((await response.json()).receipt.state).toBe("pending");expect(record.upload_confirmed_at).toBeNull();
  });
  it("keeps permission failure closed while preserving the original quarantine for deletion",async()=>{
    const failure=new Error("This request is unavailable, or its permission has changed.");mocks.confirm.mockRejectedValue(failure);mocks.tryConfirm.mockRejectedValue(failure);
    expect((await POST(request(),context)).status).toBe(403);expect(record.upload_confirmed_at).toBeNull();
  });
  it("does not upload after current request authority changed during pending reconciliation",async()=>{
    mocks.register.mockImplementation(async()=>({document:{...record},existing:true}));mocks.request.mockResolvedValueOnce(fixtureRequest()).mockResolvedValueOnce(fixtureRequest({status:"cancelled"}));
    expect((await POST(request(),context)).status).toBe(403);expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("does not revive an expired attempt or consume a new storage path",async()=>{
    record.expires_at=new Date(Date.now()-1).toISOString();mocks.register.mockImplementation(async()=>({document:{...record},existing:true}));
    expect((await POST(request(),context)).status).toBe(410);expect(mocks.upload).not.toHaveBeenCalled();expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it("reports a changed body/key conflict without uploading another copy",async()=>{
    mocks.register.mockRejectedValue(new Error("parent_document_upload_changed"));expect((await POST(request(),context)).status).toBe(409);expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("reads only a scoped owned receipt and hides private storage data",async()=>{
    const response=await GET(new Request(`${origin}/api/parent/requests/${id}/documents?uploadKey=${key}`),context);
    expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store");expect(mocks.lookup).toHaveBeenCalledWith(id,key);expect(await response.text()).not.toMatch(/private-synthetic-path|upload_sha256/);
    mocks.lookup.mockResolvedValue(null);expect((await GET(new Request(`${origin}/api/parent/requests/${id}/documents?uploadKey=${key}`),context)).status).toBe(404);
  });
});
