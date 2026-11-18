// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SupportDocuments } from "./support-documents";
import { ParentLocaleProvider } from "./parent-locale";
import type { ParentDocument } from "@/lib/parent/domain";
vi.mock("next/navigation",()=>({useRouter:()=>({refresh(){}})}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.useRealTimers();});
const requestId="11111111-1111-4111-8111-111111111111",key="33333333-3333-4333-8333-333333333333";
const document:ParentDocument={id:"22222222-2222-4222-8222-222222222222",request_id:requestId,filename:"Aviso.pdf",media_type:"application/pdf",size_bytes:10,status:"uploaded",created_at:"2026-11-18T12:00:00Z",expires_at:"2026-11-25T12:00:00Z",upload_key:key,upload_confirmed_at:null};
function receipt(state="confirmed",uploadKey=key){return {ok:true,receipt:{state,document:{...document,upload_key:uploadKey,upload_confirmed_at:state==="confirmed"?"2026-11-18T12:00:01Z":null}}};}
function show(documents:ParentDocument[]=[],inactive=false,onChange=vi.fn()) {return render(<ParentLocaleProvider initialLocale="en"><SupportDocuments requestId={requestId} documents={documents} inactive={inactive} onChange={onChange}/></ParentLocaleProvider>);}
function choose(){fireEvent.click(screen.getByText("Add a document or take a photo"));fireEvent.click(screen.getByRole("checkbox"));const file=new File(["test bytes"],"Aviso.pdf",{type:"application/pdf"});fireEvent.change(screen.getByLabelText("Choose a bill or notice"),{target:{files:[file]}});return file;}
it("reconciles a committed upload after a lost acknowledgement without another file POST",async()=>{
  const changed=vi.fn(),fetcher=vi.fn().mockImplementation(async(url,init)=>{
    if(init.method==="POST")throw new TypeError("lost synthetic ACK");
    return Response.json(receipt("confirmed",new Headers(fetcher.mock.calls[0][1].headers).get("Idempotency-Key")!));
  });vi.stubGlobal("fetch",fetcher);show([],false,changed);choose();fireEvent.click(screen.getByRole("button",{name:"Upload privately"}));
  await waitFor(()=>expect(changed).toHaveBeenCalledTimes(1));expect(fetcher.mock.calls.filter(call=>call[1].method==="POST")).toHaveLength(1);
  expect(new Headers(fetcher.mock.calls[0][1].headers).get("Idempotency-Key")).toMatch(/^[a-f0-9-]{36}$/);
  expect((await screen.findByRole("status")).textContent).toContain("Document saved privately");
});
it("retries only the original file and key after status proves that the transfer is unfinished",async()=>{
  let posts=0;const fetcher=vi.fn().mockImplementation(async(url,init)=>{
    if(init.method==="POST"){if(++posts===1)throw new TypeError("lost ACK");return Response.json(receipt("confirmed",new Headers(init.headers).get("Idempotency-Key")!));}
    return Response.json({ok:false,error:"This upload is unavailable."},{status:404});
  });vi.stubGlobal("fetch",fetcher);show();const file=choose();fireEvent.click(screen.getByRole("button",{name:"Upload privately"}));
  await screen.findByRole("button",{name:"Retry this upload"});
  expect((screen.getByLabelText("Choose a bill or notice") as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button",{name:"Retry this upload"}));await screen.findByText("Document saved privately. Its processing status will appear here.");
  const attempts=fetcher.mock.calls.filter(call=>call[1].method==="POST");expect(attempts).toHaveLength(2);
  expect(new Headers(attempts[0][1].headers).get("Idempotency-Key")).toBe(new Headers(attempts[1][1].headers).get("Idempotency-Key"));expect(attempts[1][1].body.get("file")).toBe(file);
});
it("checks an owned pending storage object on return without asking for another copy or consent",async()=>{
  const changed=vi.fn(),fetcher=vi.fn().mockResolvedValue(Response.json(receipt()));vi.stubGlobal("fetch",fetcher);show([document],false,changed);
  expect(screen.getByText("Upload not confirmed")).toBeTruthy();fireEvent.click(screen.getByRole("button",{name:"Check upload Aviso.pdf"}));
  await waitFor(()=>expect(changed).toHaveBeenCalledTimes(1));const [url,init]=fetcher.mock.calls[0];expect(url).toBe(`/api/parent/requests/${requestId}/documents/${document.id}`);expect(JSON.parse(init.body)).toEqual({uploadKey:key});expect(screen.queryByRole("checkbox")?.getAttribute("checked")).not.toBe("");
});
it("keeps closed pending uploads readable and deletable without offering a new capture or confirmation",()=>{
  show([document],true);expect(screen.getByText("Upload not confirmed")).toBeTruthy();expect(screen.queryByRole("button",{name:"Check upload Aviso.pdf"})).toBeNull();expect(screen.getByRole("button",{name:"Delete Aviso.pdf"})).toBeTruthy();expect(screen.queryByText("Add a document or take a photo")).toBeNull();
});
it("never acknowledges a malformed success and bounds automatic reconciliation to six owned reads",async()=>{
  vi.useFakeTimers();const changed=vi.fn(),fetcher=vi.fn().mockImplementation(async(_url,init)=>init.method==="POST"?Response.json({ok:true}):Response.json({error:"Synthetic read unavailable"},{status:503}));vi.stubGlobal("fetch",fetcher);show([],false,changed);choose();fireEvent.click(screen.getByRole("button",{name:"Upload privately"}));
  await vi.advanceTimersByTimeAsync(0);expect(changed).not.toHaveBeenCalled();expect((screen.getByLabelText("Choose a bill or notice") as HTMLInputElement).disabled).toBe(true);
  const initialReads=fetcher.mock.calls.filter(call=>call[1].method!=="POST").length;
  await vi.advanceTimersByTimeAsync(60000);expect(fetcher.mock.calls.filter(call=>call[1].method!=="POST")).toHaveLength(initialReads+6);expect(fetcher.mock.calls.filter(call=>call[1].method==="POST")).toHaveLength(1);
});
it("drops the in-memory file and cancels owned reconciliation when the request viewer changes",async()=>{
  let resolve!:(value:Response)=>void;const changed=vi.fn(),fetcher=vi.fn().mockImplementation((_url,init)=>init.method==="POST"?new Promise<Response>(done=>{resolve=done;}):Promise.resolve(Response.json(receipt())));vi.stubGlobal("fetch",fetcher);
  const view=show([],false,changed);choose();fireEvent.click(screen.getByRole("button",{name:"Upload privately"}));const signal=fetcher.mock.calls[0][1].signal as AbortSignal;
  view.rerender(<ParentLocaleProvider initialLocale="en"><SupportDocuments requestId="44444444-4444-4444-8444-444444444444" documents={[]} inactive={false} onChange={changed}/></ParentLocaleProvider>);
  expect(signal.aborted).toBe(true);resolve(Response.json(receipt()));await Promise.resolve();expect(changed).not.toHaveBeenCalled();expect(screen.queryByText("Aviso.pdf")).toBeNull();expect(screen.queryByLabelText("Choose a bill or notice")).toBeNull();
});
it("reconciles after the bounded upload deadline even when its fetch promise never settles",async()=>{
  vi.useFakeTimers();const changed=vi.fn(),fetcher=vi.fn().mockImplementation(async(_url,init)=>{
    if(init.method==="POST")return new Promise<Response>(()=>{});
    return Response.json(receipt("confirmed",new Headers(fetcher.mock.calls[0][1].headers).get("Idempotency-Key")!));
  });vi.stubGlobal("fetch",fetcher);show([],false,changed);choose();fireEvent.click(screen.getByRole("button",{name:"Upload privately"}));
  await vi.advanceTimersByTimeAsync(119999);expect(fetcher).toHaveBeenCalledTimes(1);expect(changed).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);expect(changed).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls.filter(call=>call[1].method==="POST")).toHaveLength(1);
  expect((fetcher.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true);
});
it("releases a stalled receipt check after its deadline so a later owned read can recover",async()=>{
  vi.useFakeTimers();let reads=0,allowSuccess=false;const changed=vi.fn(),fetcher=vi.fn().mockImplementation(async(_url,init)=>{
    if(init.method==="POST")throw new TypeError("Synthetic lost ACK");
    if(++reads===1)return new Promise<Response>(()=>{});
    if(!allowSuccess)return Response.json({error:"Synthetic receipt read unavailable"},{status:503});
    return Response.json(receipt("confirmed",new Headers(fetcher.mock.calls[0][1].headers).get("Idempotency-Key")!));
  });vi.stubGlobal("fetch",fetcher);show([],false,changed);choose();fireEvent.click(screen.getByRole("button",{name:"Upload privately"}));
  await vi.advanceTimersByTimeAsync(0);expect(reads).toBe(1);await vi.advanceTimersByTimeAsync(30000);
  const check=screen.getByRole("button",{name:"Check upload status"}) as HTMLButtonElement;expect(check.disabled).toBe(false);allowSuccess=true;fireEvent.click(check);await vi.advanceTimersByTimeAsync(0);expect(changed).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls.filter(call=>call[1].method==="POST")).toHaveLength(1);
});
it("shows an old nonce-free upload as unconfirmed and checks its original document id on return",async()=>{
  const legacy={...document,upload_key:null},changed=vi.fn(),fetcher=vi.fn().mockResolvedValue(Response.json({ok:true,receipt:{state:"confirmed",document:{...legacy,upload_key:legacy.id,upload_confirmed_at:document.created_at}}}));vi.stubGlobal("fetch",fetcher);show([legacy],false,changed);
  expect(screen.getByText("Upload not confirmed")).toBeTruthy();fireEvent.click(screen.getByRole("button",{name:"Check upload Aviso.pdf"}));await waitFor(()=>expect(changed).toHaveBeenCalledTimes(1));expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({uploadKey:document.id});expect(fetcher.mock.calls[0][0]).toContain(`/documents/${document.id}`);
});
it("resumes an older unfinished transfer using its original id without asking for new consent or deletion",async()=>{
  const legacy={...document,upload_key:null};vi.stubGlobal("fetch",vi.fn().mockResolvedValue(Response.json({ok:true,receipt:{state:"pending",document:{...legacy,upload_key:legacy.id}}},{status:202})));show([legacy]);fireEvent.click(screen.getByRole("button",{name:"Check upload Aviso.pdf"}));
  const message=await screen.findByRole("status");expect(message.textContent).toContain("Choose the original file");expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);expect(screen.getByLabelText("Choose a bill or notice")).toBeTruthy();expect(screen.getByRole("button",{name:"Delete Aviso.pdf"})).toBeTruthy();
});
it("resends a missing legacy file under its existing document id without a new document nonce",async()=>{
  const legacy={...document,upload_key:null},changed=vi.fn(),fetcher=vi.fn().mockImplementation(async(url)=>Response.json({ok:true,receipt:{state:url.endsWith(legacy.id)?"pending":"confirmed",document:{...legacy,upload_key:legacy.id,upload_confirmed_at:url.endsWith(legacy.id)?null:legacy.created_at}}},{status:url.endsWith(legacy.id)?202:201}));vi.stubGlobal("fetch",fetcher);show([legacy],false,changed);
  fireEvent.click(screen.getByRole("button",{name:"Check upload Aviso.pdf"}));await screen.findByText(/Choose the original file/);const file=new File(["test bytes"],"Aviso.pdf",{type:"application/pdf"});fireEvent.change(screen.getByLabelText("Choose a bill or notice"),{target:{files:[file]}});fireEvent.click(screen.getByRole("button",{name:"Upload privately"}));await screen.findByText("Document saved privately. Its processing status will appear here.");
  const upload=fetcher.mock.calls.find(call=>call[1].body instanceof FormData)!;expect(new Headers(upload[1].headers).get("Idempotency-Key")).toBe(legacy.id);expect(upload[1].body.get("file")).toBe(file);
});
it("preserves a changed-body409 as a conflict rather than acknowledging an older receipt",async()=>{
  const changed=vi.fn(),fetcher=vi.fn().mockResolvedValue(Response.json({ok:false,error:"This file differs from the saved upload attempt. Check the existing upload before choosing another file."},{status:409}));vi.stubGlobal("fetch",fetcher);show([],false,changed);choose();fireEvent.click(screen.getByRole("button",{name:"Upload privately"}));
  expect((await screen.findByRole("alert")).textContent).toContain("differs from the saved upload attempt");expect(fetcher).toHaveBeenCalledTimes(1);expect(changed).not.toHaveBeenCalled();expect(screen.queryByRole("status")).toBeNull();expect(screen.getByText("Aviso.pdf")).toBeTruthy();
});
it.each([403,409])("ignores an older in-flight receipt read after an explicit resend returns%s",async status=>{
  vi.useFakeTimers();let posts=0,reads=0,finishOld!:(value:Response)=>void;
  const legacy={...document,upload_key:null},pending={ok:true,receipt:{state:"pending",document:{...legacy,upload_key:legacy.id}}},confirmed={ok:true,receipt:{state:"confirmed",document:{...legacy,upload_key:legacy.id,upload_confirmed_at:legacy.created_at}}};
  const fetcher=vi.fn().mockImplementation(async(_url,init)=>{
    if(init.body instanceof FormData){if(++posts===1)throw new TypeError("Synthetic lost ACK before adoption");return Response.json({error:status===403?"This request is unavailable, or its permission has changed.":"This file differs from the saved upload attempt. Check the existing upload before choosing another file."},{status});}
    if(init.method==="POST")return Response.json(pending,{status:202});
    if(++reads===2)return new Promise<Response>(resolve=>{finishOld=resolve;});
    return Response.json(reads===1?pending:confirmed);
  });vi.stubGlobal("fetch",fetcher);show([legacy]);fireEvent.click(screen.getByRole("button",{name:"Check upload Aviso.pdf"}));await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
  fireEvent.change(screen.getByLabelText("Choose a bill or notice"),{target:{files:[new File(["test bytes"],"Aviso.pdf",{type:"application/pdf"})]}});fireEvent.click(screen.getByRole("button",{name:"Upload privately"}));await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
  await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});expect(reads).toBe(2);const oldSignal=fetcher.mock.calls.filter(call=>call[1].method!=="POST")[1][1].signal as AbortSignal;
  fireEvent.click(screen.getByRole("button",{name:"Retry this upload"}));await act(async()=>{await vi.advanceTimersByTimeAsync(0);});finishOld(Response.json(confirmed));await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
  expect(posts).toBe(2);
  if(status===403)expect(screen.getByRole("status").textContent).toBe("The original upload was already saved. No new file was added.");
  else {expect(screen.getByRole("alert").textContent).toContain("differs from the saved upload attempt");expect(screen.queryByRole("status")).toBeNull();expect(screen.getByLabelText("Choose a bill or notice")).toBeTruthy();expect(reads).toBe(2);}
  expect(oldSignal.aborted).toBe(true);
});
it("does not poll-confirm an older receipt while an explicit retry write is still pending",async()=>{
  vi.useFakeTimers();let posts=0,reads=0,finishWrite!:(value:Response)=>void;const legacy={...document,upload_key:null};
  const originalFile=new File(["test bytes"],"Aviso.pdf",{type:"application/pdf"});
  const pending={ok:true,receipt:{state:"pending",document:{...legacy,upload_key:legacy.id}}},confirmed={ok:true,receipt:{state:"confirmed",document:{...legacy,upload_key:legacy.id,upload_confirmed_at:legacy.created_at}}};
  const fetcher=vi.fn().mockImplementation(async(_url,init)=>{
    if(init.body instanceof FormData){if(++posts===1)throw new TypeError("Synthetic lost ACK");return new Promise<Response>(resolve=>{finishWrite=resolve;});}
    if(init.method==="POST")return Response.json(pending,{status:202});return Response.json(++reads===1?pending:confirmed);
  });vi.stubGlobal("fetch",fetcher);show([legacy]);fireEvent.click(screen.getByRole("button",{name:"Check upload Aviso.pdf"}));await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
  fireEvent.change(screen.getByLabelText("Choose a bill or notice"),{target:{files:[originalFile]}});fireEvent.click(screen.getByRole("button",{name:"Upload privately"}));await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
  fireEvent.click(screen.getByRole("button",{name:"Retry this upload"}));await act(async()=>{await vi.advanceTimersByTimeAsync(5000);finishWrite(Response.json({error:"This file differs from the saved upload attempt. Check the existing upload before choosing another file."},{status:409}));});
  expect(screen.getByRole("alert").textContent).toContain("differs from the saved upload attempt");expect(screen.queryByRole("status")).toBeNull();expect((screen.getByLabelText("Choose a bill or notice") as HTMLInputElement).files?.[0]).toBe(originalFile);expect(reads).toBe(1);expect(posts).toBe(2);
});
