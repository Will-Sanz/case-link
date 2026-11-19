import { describe, expect, it } from "vitest";
import { documentCaptureError, documentUploadReceipt, documentUploadReceiptSchema, pendingDocumentUpload, type DocumentUploadRecord } from "./document-upload";
import { fixtureIntake, fixtureRequest } from "./test-fixtures";
const at = new Date("2026-11-18T12:00:00Z");
const record: DocumentUploadRecord = { id:"11111111-1111-4111-8111-111111111111",request_id:"22222222-2222-4222-8222-222222222222",upload_key:"33333333-3333-4333-8333-333333333333",
  filename:"Aviso.pdf",media_type:"application/pdf",size_bytes:24,status:"uploaded",expires_at:"2026-11-25T12:00:00Z",created_at:"2026-11-18T12:00:00Z",consented_at:"2026-11-18T12:00:00Z",consent_version:"2026-10-25",upload_confirmed_at:null,object_path:"private/OriginalPathCanary",upload_sha256:"a".repeat(64) };
describe("document upload display contract",()=>{
  it("returns only owned display metadata and keeps pending distinct from a confirmed transfer",()=>{
    const pending=documentUploadReceipt(record,at);expect(pending.state).toBe("pending");
    expect(JSON.stringify(pending)).not.toMatch(/OriginalPathCanary|upload_sha256|consented_at|digest|verified/i);
    expect(documentUploadReceipt({...record,upload_confirmed_at:at.toISOString()},at).state).toBe("confirmed");
    expect(documentUploadReceiptSchema.safeParse({...pending,document:{...pending.document,object_path:"private"}}).success).toBe(false);
  });
  it("does not acknowledge expired or removed bytes as a fresh upload or change their original dates",()=>{
    const old={...record,upload_confirmed_at:at.toISOString(),expires_at:"2026-11-18T11:59:59Z"};
    expect(documentUploadReceipt(old,at).state).toBe("expired");
    expect(documentUploadReceipt({...old,status:"raw_deleted"},at).state).toBe("removed");
    expect(documentUploadReceipt(old,at).document.expires_at).toBe(old.expires_at);
  });
  it("recognizes unconfirmed legacy and keyed transfers without treating missing metadata as confirmation",()=>{
    expect(pendingDocumentUpload(record)).toBe(true);
    expect(pendingDocumentUpload({...record,upload_key:null})).toBe(true);
    expect(pendingDocumentUpload({...record,upload_confirmed_at:at.toISOString()})).toBe(false);
  });
  it("preserves ordinary, WIC-only and private utility capture boundaries",()=>{
    const ordinary=fixtureRequest({intake:fixtureIntake({needs:["food_now"],utilityProviders:[]})});
    expect(documentCaptureError(ordinary)).toBeNull();
    expect(documentCaptureError({...ordinary,status:"closed"})).toContain("permission has changed");
    expect(documentCaptureError({...ordinary,intake:{...ordinary.intake,needs:["wic_new"]}})).toContain("WIC document processing");
    expect(documentCaptureError({...ordinary,has_peco_application_details:true})).toContain("Private PECO");
    expect(documentCaptureError({...ordinary,has_water_application_details:true})).toContain("protected utility");
  });
});
