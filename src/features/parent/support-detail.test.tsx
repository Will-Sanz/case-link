// @vitest-environment jsdom
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupportRequest } from "@/lib/parent/domain";
import { initialIntake, buildMandate } from "./intake";
import { SupportDetail } from "./support-detail";
import { buildSupportPlan } from "@/lib/parent/planning";
import { getProgram, SNAP_NEW_APPLICATION_URL } from "@/lib/parent/programs";
import { fixtureNow, fixtureProtectedSnapOperation } from "@/lib/parent/test-fixtures";
import { SNAP_APPLICATION_NOTICE_VERSION } from "@/lib/parent/constants";
import { SNAP_APPLICATION_SOURCE } from "@/lib/parent/snap-application-fields";
import { snapApplicationLeaves } from "@/lib/parent/snap-application-snapshot";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
const requestId = "11111111-1111-4111-8111-111111111111";
const fixture = (): SupportRequest => ({
  id: requestId,
  household_id: "22222222-2222-4222-8222-222222222222",
  status: "active",
  intake: { ...initialIntake, needs: ["electricity"], zip: "19104" },
  mandate: buildMandate(
    initialIntake,
    ["peco-cap"],
    "prepare_only",
    "ask_me",
    "2026-11-24T12:00:00.000Z",
  ),
  plan: null,
  required_actions: [],
  version: 1,
  created_at: "2026-10-25T12:00:00Z",
  updated_at: "2026-10-25T12:00:00Z",
  events: [],
  documents: [],
});
const response = (request: SupportRequest) => ({
  ok: true,
  status: 200,
  json: async () => ({
    ok: true,
    request,
    operations: [],
    historyLimited: false,
  }),
});
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(fixtureNow);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function openSection(name: RegExp) {
  await act(async () => {});
  const checklist = screen.getByRole("navigation", { name: "Your application checklist" });
  fireEvent.click(within(checklist).getByRole("link", { name }));
}

async function refreshSupport() {
  const previous = screen.getByRole("navigation", { name: "Your application checklist" }).querySelector('a[aria-current="location"]')!;
  await openSection(/Overview/);
  const status = screen.getByText("Work status & updates").closest("details")!;
  if (!status.open) fireEvent.click(screen.getByText("Work status & updates"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh support progress" }));
  await act(async () => {});
  fireEvent.click(previous);
}

describe("support detail", () => {
  it.each(["waiting", "needs_parent"] as const)("automatically shows the finished SNAP draft and slows checks after queued/running becomes %s", async ending => {
    vi.useFakeTimers();
    const request=fixture();request.intake.needs=["snap_new"];
    request.mandate=buildMandate(request.intake,["snap-pa"],"prepare_only","ask_me","2026-11-24T12:00:00.000Z");
    let state="queued",ready=false,reads=0;
    const fetcher=vi.fn(async(url:string,init?:RequestInit)=>{
      expect(init?.method??"GET").toBe("GET");
      if(url===`/api/parent/requests/${requestId}`){reads++;return {ok:true,status:200,json:async()=>({request,progress:{state,summary:"Recorded worker progress",updatedAt:request.updated_at,nextRunAt:null,canContinueAfterClosing:true}})};}
      if(url.endsWith("/operations"))return {ok:true,status:200,json:async()=>({historyLimited:false,operations:ready?[{id:"prepared-operation",request_id:requestId,request_version:request.version,program_id:"snap-pa",need:"snap_new",action:"prepare",state:"prepared",created_at:request.created_at,artifact_id:"prepared-artifact",form:{preparation_only:true}}]:[]})};
      return response(request);
    });
    vi.stubGlobal("fetch",fetcher);await act(async()=>{render(<SupportDetail requestId={requestId}/>);});
    expect(reads).toBe(1);expect(screen.queryByRole("button",{name:"View prepared draft"})).toBeNull();
    state="running";await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});expect(reads).toBe(2);
    state=ending;ready=true;await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
    await openSection(/Your application/);
    expect(reads).toBe(3);expect(screen.getByRole("button",{name:"View prepared draft"})).toBeTruthy();
    await act(async()=>{await vi.advanceTimersByTimeAsync(29999);});expect(reads).toBe(3);
    await act(async()=>{await vi.advanceTimersByTimeAsync(1);});expect(reads).toBe(4);
    expect(fetcher.mock.calls.some(([,init])=>(init as RequestInit|undefined)?.method==="POST")).toBe(false);
  });
  it.each(["active", "paused", "cancelled"] as const)("does not refresh hidden or stopped %s work",async status=>{
    vi.useFakeTimers();const request={...fixture(),status};let hidden=true,reads=0;
    const visibility=vi.spyOn(document,"visibilityState","get").mockImplementation(()=>hidden?"hidden":"visible");
    vi.stubGlobal("fetch",vi.fn(async(url:string)=>{
      if(url===`/api/parent/requests/${requestId}`){reads++;return {ok:true,status:200,json:async()=>({request,progress:{state:"running",summary:"Recorded worker progress",updatedAt:request.updated_at,nextRunAt:null,canContinueAfterClosing:true}})};}
      return response(request);
    }));
    try{
      await act(async()=>{render(<SupportDetail requestId={requestId}/>);});expect(reads).toBe(1);
      await act(async()=>{await vi.advanceTimersByTimeAsync(60000);});expect(reads).toBe(1);
      hidden=false;await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});expect(reads).toBe(status==="active"?2:1);
    }finally{visibility.mockRestore();}
  });
  it("stops fast checks when the current worker-progress read fails",async()=>{
    vi.useFakeTimers();const request=fixture();let reads=0;
    vi.stubGlobal("fetch",vi.fn(async(url:string)=>{
      if(url===`/api/parent/requests/${requestId}`){reads++;return reads===2?{ok:false,status:500,json:async()=>({error:"Progress unavailable"})}:{ok:true,status:200,json:async()=>({request,progress:{state:"running",summary:"Recorded worker progress",updatedAt:request.updated_at,nextRunAt:null,canContinueAfterClosing:true}})};}
      return response(request);
    }));
    await act(async()=>{render(<SupportDetail requestId={requestId}/>);});
    await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});expect(reads).toBe(2);
    await act(async()=>{await vi.advanceTimersByTimeAsync(29999);});expect(reads).toBe(2);
    await act(async()=>{await vi.advanceTimersByTimeAsync(1);});expect(reads).toBe(3);
  });
  it("lets a pending worker-progress read finish across five-second checks without aborting it",async()=>{
    vi.useFakeTimers();const request=fixture();let reads=0,finish!:(value:unknown)=>void,signal:AbortSignal|undefined;
    const running=()=>({ok:true,status:200,json:async()=>({request,progress:{state:"running",summary:"Recorded worker progress",updatedAt:request.updated_at,nextRunAt:null,canContinueAfterClosing:true}})});
    vi.stubGlobal("fetch",vi.fn(async(url:string,init?:RequestInit)=>{
      if(url===`/api/parent/requests/${requestId}`){reads++;if(reads===2){signal=init?.signal??undefined;return new Promise(resolve=>{finish=resolve;});}return running();}
      return response(request);
    }));
    await act(async()=>{render(<SupportDetail requestId={requestId}/>);});
    await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});expect(reads).toBe(2);
    await act(async()=>{await vi.advanceTimersByTimeAsync(20000);});expect(reads).toBe(2);expect(signal?.aborted).toBe(false);
    await act(async()=>{finish(running());});expect(signal?.aborted).toBe(false);
  });

  it('locks the exact ordinary correction while saving, including the disclosure toggle',async()=>{
    const request=fixture();let finish!:(value:unknown)=>void;
    const fetch=vi.fn(async(_url:string,init?:RequestInit)=>init?.method==='POST'?new Promise(resolve=>{finish=resolve;}):response(request));
    vi.stubGlobal('fetch',fetch);render(<SupportDetail requestId={requestId}/>); await openSection(/Details & controls/);fireEvent.click(await screen.findByText('Correct household or bill information'));
    const input=screen.getByLabelText('ZIP code');fireEvent.change(input,{target:{value:'19105'}});fireEvent.click(screen.getByRole('button',{name:'Save correction'}));
    expect(input.matches(':disabled')).toBe(true);fireEvent.change(input,{target:{value:'19106'}});fireEvent.click(screen.getByText('Correct household or bill information'));
    expect(screen.getByText('Correct household or bill information').closest('details')!.open).toBe(true);
    await act(async()=>{finish(response({...request,version:2,intake:{...request.intake,zip:'19105'}}));});
    expect((screen.getByLabelText('ZIP code') as HTMLInputElement).value).toBe('19105');expect(screen.getByText(/Your correction is saved/)).toBeTruthy();
    expect(JSON.parse(String(fetch.mock.calls.find(([,init])=>init?.method==='POST')![1]!.body)).intake.zip).toBe('19105');
  });
  it('preserves owner correction of a paused request after its service mandate expires',async()=>{
    const request=fixture();request.status='paused';request.mandate.expiresAt='2000-01-01T00:00:00Z';
    const fetch=vi.fn(async(_url:string,init?:RequestInit)=>response(init?.method==='POST'?{...request,version:2}:request));
    vi.stubGlobal('fetch',fetch);render(<SupportDetail requestId={requestId}/>); await openSection(/Details & controls/);fireEvent.click(await screen.findByText('Correct household or bill information'));
    fireEvent.click(screen.getByRole('button',{name:'Save correction'}));await screen.findByText(/Your correction is saved/);
    expect(fetch.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);
  });
  it.each([0,1])('does not claim an ordinary correction saved from non-advanced reply version %i',async version=>{
    const request=fixture();vi.stubGlobal('fetch',vi.fn(async(_url:string,init?:RequestInit)=>response(init?.method==='POST'?{...request,version}:request)));
    render(<SupportDetail requestId={requestId}/>); await openSection(/Details & controls/);fireEvent.click(await screen.findByText('Correct household or bill information'));fireEvent.click(screen.getByRole('button',{name:'Save correction'}));
    await screen.findByText(/correction result is not confirmed/);expect(screen.queryByText(/Your correction is saved/)).toBeNull();
  });
  it.each(['fetch','body'] as const)('bounds a stalled ordinary correction %s and keeps its draft',async kind=>{
    const request=fixture(),fetch=vi.fn(async(_url:string,init?:RequestInit)=>init?.method==='POST'?
      kind==='fetch'?new Promise(()=>{}):{ok:true,status:200,json:()=>new Promise(()=>{})}:response(request));
    vi.stubGlobal('fetch',fetch);render(<SupportDetail requestId={requestId}/>); await openSection(/Details & controls/);fireEvent.click(await screen.findByText('Correct household or bill information'));
    fireEvent.change(screen.getByLabelText('ZIP code'),{target:{value:'19105'}});vi.useFakeTimers();fireEvent.click(screen.getByRole('button',{name:'Save correction'}));
    await act(async()=>{await vi.advanceTimersByTimeAsync(30000);});
    expect(screen.getByRole('button',{name:'Save correction'}).matches(':disabled')).toBe(false);expect((screen.getByLabelText('ZIP code') as HTMLInputElement).value).toBe('19105');
    expect(fetch.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);expect(screen.getByText(/correction result is not confirmed/)).toBeTruthy();
  });
  it.each(['version','unmount'] as const)('ignores a late ordinary correction after %s changes',async kind=>{
    let finish!:(value:unknown)=>void;let current=fixture();
    const fetch=vi.fn(async(_url:string,init?:RequestInit)=>init?.method==='POST'?new Promise(resolve=>{finish=resolve;}):response(current));
    vi.stubGlobal('fetch',fetch);const view=render(<SupportDetail requestId={requestId}/>); await openSection(/Details & controls/);fireEvent.click(await screen.findByText('Correct household or bill information'));
    fireEvent.click(screen.getByRole('button',{name:'Save correction'}));
    if(kind==='unmount')view.unmount();else{
      current={...current,version:2};await refreshSupport();await act(async()=>{});
      fireEvent.click(screen.getByText('Correct household or bill information'));fireEvent.click(screen.getByText('Correct household or bill information'));
      fireEvent.change(screen.getByLabelText('ZIP code'),{target:{value:'19105'}});
    }
    expect(fetch.mock.calls.find(([,init])=>init?.method==='POST')![1]!.signal?.aborted).toBe(true);
    const before=fetch.mock.calls.length;await act(async()=>{finish(response(current));});expect(fetch.mock.calls).toHaveLength(before);
    if(kind==='version')expect((screen.getByLabelText('ZIP code') as HTMLInputElement).value).toBe('19105');
  });
  it.each([
    { kind: "current", version: 2, current: true, ready: true, next: "parent" },
    { kind: "blocked", version: 2, current: true, ready: false, next: "caselink" },
    { kind: "stale", version: 1, current: true, ready: true, next: "pending" },
    { kind: "uncurrent", version: 2, current: false, ready: true, next: "pending" },
  ])("describes the exact no-plan $kind prepared application without inventing parent readiness", async ({ version, current, ready, next }) => {
    const request = fixture(); request.intake.needs = ["snap_new"]; request.version = 2;
    request.required_actions = [{ id: "final", need: "snap_new", reason: "submission_review", field: "snap_final_submit", resolver: "parent", title: "Choose final SNAP Submit", explanation: "Review this exact application." }];
    const review = fixtureProtectedSnapOperation({ requestId, requestVersion: version, protectedPacketCurrent: current, protectedParentSubmitReady: ready, snapSubmissionAuthorized: false });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/snap-submission")) return { ok: true, status: 200, json: async () => ({ review }) };
      if (url.endsWith("/operations")) return { ok: true, status: 200, json: async () => ({ operations: [], historyLimited: false }) };
      if (url.startsWith("/protected/")) return { ok: false, status: 403, json: async () => ({ error: "Unavailable" }) };
      return response(request);
    }));
    render(<SupportDetail requestId={requestId}/>); await openSection(/Program progress/); const programs = (await screen.findByRole("heading", { name: "Program progress" })).parentElement!;
    if (next === "pending") {
      await waitFor(() => expect(screen.queryByText("Loading your exact application")).toBeNull());
      expect(within(programs).getByText(/Preparation is pending\./)).toBeTruthy();
      expect(within(programs).queryByText(/The exact SNAP application is prepared/)).toBeNull();
    } else {
      await waitFor(() => expect(within(programs).getByText(/The exact SNAP application is prepared/)).toBeTruthy());
      expect(within(programs).queryByText(/Preparation is pending/)).toBeNull();
      if (next === "parent") expect(within(programs).getByRole("link", { name: "Your application review" }).getAttribute("href")).toBe("#snap-final-review");
      else {
        expect(within(programs).getByText(/CaseLink must resolve its remaining submission requirements/)).toBeTruthy();
        expect(within(programs).queryByRole("link", { name: "Your application review" })).toBeNull();
        expect(within(programs).getByText("Next:").parentElement!.textContent).toBe("Next: CaseLink");
      }
    }
    expect(within(programs).queryByText(/Submit decision recorded/)).toBeNull();
    expect(within(programs).queryByText(/An agency submission is recorded/)).toBeNull();
  });
  it.each([
    { kind: "decision", otherNeed: false },
    { kind: "executing", otherNeed: false },
    { kind: "decision", otherNeed: true },
  ])("keeps no-plan $kind SNAP delivery progress current while preserving otherNeed=$otherNeed", async ({ kind, otherNeed }) => {
    const request = fixture(); request.intake.needs = otherNeed ? ["snap_new", "electricity"] : ["snap_new"];
    request.required_actions = [{ id: "final", need: "snap_new", reason: "submission_review", field: "snap_final_submit", resolver: "parent", title: "Choose final SNAP Submit", explanation: "Review this exact application." }];
    const review = fixtureProtectedSnapOperation({ requestId, requestVersion: request.version, snapSubmissionAuthorized: kind === "decision" });
    const operation = { id: review.operationId, request_id: requestId, request_version: request.version, program_id: "snap-pa", need: "snap_new", action: "submit", state: "executing", artifact_id: null, protected_packet: review.packet.protectedSnapPacket, created_at: request.created_at };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/snap-submission")) return { ok: kind === "decision", status: kind === "decision" ? 200 : 403, json: async () => kind === "decision" ? { review } : { error: "Unavailable" } };
      if (url.endsWith("/operations")) return { ok: true, status: 200, json: async () => ({ operations: kind === "executing" ? [operation] : [], historyLimited: false }) };
      if (url.startsWith("/protected/")) return { ok: false, status: 403, json: async () => ({ error: "Unavailable" }) };
      return response(request);
    }));
    render(<SupportDetail requestId={requestId}/>); await openSection(/Program progress/); const programs = (await screen.findByRole("heading", { name: "Program progress" })).parentElement!;
    await waitFor(() => expect(within(programs).getByText(kind === "decision" ? /Your decision to send the exact SNAP application is recorded/ : /A delivery attempt is recorded/)).toBeTruthy());
    expect(within(programs).getByText("Next:").parentElement!.textContent).toBe("Next: CaseLink");
    expect(within(programs).queryByText(/Preparation is pending\./)).toBeNull();
    expect(!!within(programs).queryByText(/Preparation is pending for your other selected support/)).toBe(otherNeed);
    expect(within(programs).queryByText(/An agency submission is recorded/)).toBeNull();
    expect(screen.queryByText("SNAP application complete")).toBeNull();
  });
  it.each([
    { mismatch: "request", change: { request_id: "33333333-3333-4333-8333-333333333333" } },
    { mismatch: "version", change: { request_version: 0 } },
    { mismatch: "program", change: { program_id: "peco-cap" } },
    { mismatch: "action", change: { action: "follow_up" } },
    { mismatch: "need", change: { need: "snap_renewal" } },
    { mismatch: "reference", change: { protected_packet: { raw: "PRIVATE-CANARY" } } },
  ])("keeps no-plan preparation pending for a mismatched $mismatch attempt", async ({ change }) => {
    const request = fixture(); request.intake.needs = ["snap_new"];
    const review = fixtureProtectedSnapOperation({ requestId, requestVersion: request.version });
    const operation = { id: review.operationId, request_id: requestId, request_version: request.version, program_id: "snap-pa", need: "snap_new", action: "submit", state: "executing", artifact_id: null, protected_packet: review.packet.protectedSnapPacket, created_at: request.created_at, ...change };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/operations") ? { ok: true, status: 200, json: async () => ({ operations: [operation], historyLimited: false }) } : response(request)));
    render(<SupportDetail requestId={requestId}/>); await openSection(/Program progress/); const programs = (await screen.findByRole("heading", { name: "Program progress" })).parentElement!;
    await waitFor(() => expect(screen.queryByText("Checking application records…")).toBeNull());
    expect(within(programs).getByText(/Preparation is pending\./)).toBeTruthy();
    expect(within(programs).queryByText(/A delivery attempt is recorded/)).toBeNull();
    expect(within(programs).queryByText(/Submit decision recorded/)).toBeNull();
  });
  it.each([
    ["agency_submitted", "Application submitted", "Agency response"],
    ["assistance_approved", "Assistance approved", "Program follow-up"],
    ["support_received", "Support received", "No further step recorded"],
    ["declined", "Declined", "Review the recorded decision and follow-up"],
  ])("preserves a real no-plan %s receipt ahead of an owned Submit decision", async (state, label, next) => {
    const request = fixture(); request.intake.needs = ["snap_new"];
    request.required_actions = [{ id: "final", need: "snap_new", reason: "submission_review", field: "snap_final_submit", resolver: "parent", title: "Choose final SNAP Submit", explanation: "Review this exact application." }];
    const review = fixtureProtectedSnapOperation({ requestId, requestVersion: request.version, snapSubmissionAuthorized: true });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/snap-submission")) return { ok: true, status: 200, json: async () => ({ review }) };
      if (url.endsWith("/operations")) return { ok: true, status: 200, json: async () => ({ operations: [{ id: review.operationId, request_id: requestId, request_version: request.version, program_id: "snap-pa", need: "snap_new", action: "submit", state, created_at: request.created_at, evidence: { source: "agency_receipt", reference: "Synthetic exact agency record", recordedAt: request.created_at } }], historyLimited: false }) };
      if (url.startsWith("/protected/")) return { ok: false, status: 403, json: async () => ({ error: "Unavailable" }) };
      return response(request);
    }));
    render(<SupportDetail requestId={requestId}/>); await openSection(/Program progress/); const programs = (await screen.findByRole("heading", { name: "Program progress" })).parentElement!;
    await waitFor(() => expect(within(programs).getByText(`${label} is recorded. Open Activity & receipts for the exact evidence and any program instructions.`)).toBeTruthy());
    expect(within(programs).getByText("Next:").parentElement!.textContent).toBe(`Next: ${next}`);
    expect(within(programs).queryByText(/Your decision to send the exact SNAP application is recorded/)).toBeNull();
    expect(within(programs).queryByText(/Delivery result not confirmed/)).toBeNull();
    expect(within(programs).queryByText(/Preparation is pending/)).toBeNull();
  });
  it.each(["paused", "cancelled", "closed"] as const)("keeps no-plan %s recorded work historical without promising future delivery", async status => {
    const request = fixture(); request.intake.needs = ["snap_new"]; request.status = status;
    const review = fixtureProtectedSnapOperation({ requestId, requestVersion: request.version });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/operations") ? { ok: true, status: 200, json: async () => ({ operations: [{ id: review.operationId, request_id: requestId, request_version: request.version, program_id: "snap-pa", need: "snap_new", action: "submit", state: "executing", artifact_id: null, protected_packet: review.packet.protectedSnapPacket, created_at: request.created_at }], historyLimited: false }) } : response(request)));
    render(<SupportDetail requestId={requestId}/>); await openSection(/Program progress/); const programs = (await screen.findByRole("heading", { name: "Program progress" })).parentElement!;
    await waitFor(() => expect(within(programs).getByText(/Future SNAP application work is stopped/)).toBeTruthy());
    expect(within(programs).getByText("Next:").parentElement!.textContent).toBe("Next: Activity & receipts");
    expect(within(programs).queryByText(/CaseLink must confirm its result/)).toBeNull();
    expect(within(programs).queryByText(/Preparation is pending/)).toBeNull();
  });
  it("names the exact final-review task without a redundant Apply for SNAP eyebrow", async () => {
    const request = fixture(); request.intake.needs = ["snap_new"];
    request.required_actions = [{ id: "final", need: "snap_new", reason: "submission_review", field: "snap_final_submit", resolver: "parent", title: "Choose final SNAP Submit", explanation: "Review this exact application." }];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(request))); render(<SupportDetail requestId={requestId}/>); await openSection(/Your next steps/);
    const step = await screen.findByRole("region", { name: "Choose final SNAP Submit" });
    expect(within(step).queryByText("Apply for SNAP")).toBeNull();
  });
  it.each([false, true])("retires only the finished review task from an exact %s started-attempt or owned GET-confirmed Submit", async attempt => {
    const request = fixture(); request.intake.needs = ["snap_new"];
    request.required_actions = [{ id: "final", need: "snap_new", reason: "submission_review", field: "snap_final_submit", resolver: "parent", title: "Choose final SNAP Submit", explanation: "Review this exact application." }];
    request.mandate = buildMandate(request.intake, ["snap-pa"], "full", "ask_me", "2026-11-24T12:00:00.000Z");
    request.plan = buildSupportPlan(request, fixtureNow);
    const route = request.plan.routes.find(item => item.need === "snap_new" && item.programId === "snap-pa")!;
    route.summary = "Old preparation is still pending."; route.limitation = "Old connection limitation."; route.nextActor = "parent";
    const review = fixtureProtectedSnapOperation({ requestId, requestVersion: request.version, snapSubmissionAuthorized: !attempt, state: attempt ? "delivery_unknown" : "prepared" });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/snap-submission")) return { ok: true, status: 200, json: async () => ({ review }) };
      if (url.endsWith("/operations")) return { ok: true, status: 200, json: async () => ({ operations: attempt ? [{ id: review.operationId, request_id: requestId, request_version: request.version, program_id: "snap-pa", need: "snap_new", action: "submit", state: "delivery_unknown", artifact_id: null, protected_packet: review.packet.protectedSnapPacket }] : [], historyLimited: false }) };
      if (url.startsWith("/protected/")) return { ok: false, status: 403, json: async () => ({ error: "Unavailable" }) };
      return { ok: true, status: 200, json: async () => ({ request, progress: { state: "needs_parent", summary: "The old review task needs you.", updatedAt: request.updated_at, nextRunAt: null, canContinueAfterClosing: false }, available: false, session: null }) };
    }));
    render(<SupportDetail requestId={requestId}/>); await screen.findByText("Next: CaseLink");
    expect(screen.queryByRole("heading", { name: "Choose final SNAP Submit" })).toBeNull();
    expect(screen.queryByText("A step needs you")).toBeNull();
    expect(screen.queryByText("SNAP application complete")).toBeNull();
    await openSection(/Your next steps/);
    expect(screen.getByText(attempt ? /No repeated review is requested/ : /CaseLink owns the delivery check/)).toBeTruthy();
    await openSection(/Program progress/);
    const programs = screen.getByRole("heading", { name: "Program progress" }).parentElement!;
    expect(within(programs).queryByText("Old preparation is still pending.")).toBeNull();
    expect(within(programs).queryByText("Old connection limitation.")).toBeNull();
    expect(within(programs).queryByText("Your personal step")).toBeNull();
    expect(within(programs).getByText("CaseLink")).toBeTruthy();
  });
  it('opens the private grouped SNAP editor for its exact worker question and saves through the owned snapshot route',async()=>{
    vi.setSystemTime(new Date('2026-11-03T15:00:00Z'));
    const request=fixture();request.intake.needs=['snap_new'];request.mandate=buildMandate(request.intake,['snap-pa'],'prepare_only','ask_me','2026-11-24T12:00:00Z');
    request.required_actions=[{id:'snap-details',need:'snap_new',field:'snap_application_details',reason:'missing_fact',resolver:'parent',title:'Update your SNAP application answers',explanation:'A required application answer needs you.'}];
    const details={applicant:{firstName:'Maria',lastName:'Rivera'},household:[{id:request.household_id,firstName:'Maria',lastName:'Rivera',relationship:'SELF'}]};
    const snapshot={id:'33333333-3333-4333-8333-333333333333',request_id:requestId,revision:1,base_version:1,request_version:1,details,
      provenance:Object.fromEntries(Object.keys(snapApplicationLeaves(details)).map(path=>[path,{source:'parent',confirmedAt:'2026-11-03T12:00:00Z',asOf:'2026-11-03'}])),
      source:SNAP_APPLICATION_SOURCE,notice_version:SNAP_APPLICATION_NOTICE_VERSION,created_at:'2026-11-03T12:00:00Z',idempotency_key:request.household_id};
    const fetch=vi.fn(async(url:string,init?:RequestInit)=>{
      if(url.endsWith('/authorization-window'))return {ok:true,status:200,json:async()=>({authorization:{issuedAt:'2026-11-03T12:00:00Z',expiresAt:'2026-11-24T12:00:00Z',snapApplication:{collectionEnabled:true,noticeVersion:SNAP_APPLICATION_NOTICE_VERSION}}})};
      if(url.includes('/snap-application'))return {ok:true,status:200,json:async()=>init?.method==='POST'?{snapshotId:snapshot.id}:{snapshot}};
      return response(request);
    });vi.stubGlobal('fetch',fetch);render(<SupportDetail requestId={requestId}/>); await openSection(/Your next steps/);
    fireEvent.click(await screen.findByRole('link',{name:'Answer SNAP application questions'}));
    const form=await screen.findByRole('form',{name:'Correct SNAP application answers'});
    expect(screen.queryByRole('form',{name:'Household questions'})).toBeNull();expect(screen.queryByLabelText('Your answer')).toBeNull();
    await waitFor(()=>expect(document.activeElement).toBe(form.querySelector('input,select,button')));
    fireEvent.change(within(form).getByLabelText('County'),{target:{value:'Philadelphia'}});
    fireEvent.click(within(form).getByRole('button',{name:'Save application changes'}));await screen.findByText(/application answers are saved as a new revision/);
    const posts=fetch.mock.calls.filter(([,init])=>init?.method==='POST');expect(posts).toHaveLength(1);expect(posts[0][0]).toBe(`/api/parent/requests/${requestId}/snap-application`);
    const body=JSON.parse(posts[0][1]!.body as string);expect(body.expectedVersion).toBe(1);expect(body.details.county).toBe('Philadelphia');expect(body.action).toBeUndefined();
  });
  it.each(['snap_renewal','snap_pending'] as const)('does not send a %s worker field to the new-SNAP private editor',async need=>{
    const request=fixture();request.intake.needs=[need];request.required_actions=[{id:'other-snap-details',need,field:'snap_application_details',reason:'missing_fact',resolver:'parent',title:'Other SNAP question',explanation:'This is a different journey.'}];
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response(request)));render(<SupportDetail requestId={requestId}/>); await openSection(/Your next steps/);
    await screen.findByRole('heading',{name:'Other SNAP question'});expect(screen.queryByRole('link',{name:'Answer SNAP application questions'})).toBeNull();expect(screen.queryByLabelText('Your answer')).toBeNull();
  });
  it("offers one save for all known factual questions while personal steps stay separate", async () => {
    const request = fixture();
    request.intake.needs = ["electricity", "water"];
    request.required_actions = [
      { id: "electric-amount", need: "electricity", field: "amountDue", reason: "missing_fact", resolver: "parent", title: "What is due on this account?", explanation: "Enter the current bill amount." },
      { id: "water-amount", need: "water", field: "amountDue", reason: "missing_fact", resolver: "parent", title: "What is due on this account?", explanation: "Enter the current bill amount." },
      { id: "declaration", need: "electricity", reason: "personal_step", resolver: "parent", title: "Complete the program declaration", explanation: "This separate personal step requires the program's accepted process." },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(request)));
    render(<SupportDetail requestId={requestId} />); await openSection(/Your next steps/);
    await screen.findByRole("heading", { name: "Your next steps" });
    expect(screen.getAllByRole("button", { name: "Save all answers and continue" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Save and continue" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Complete the program declaration" })).toBeTruthy();
  });
  it("keeps both unsaved factual answers when a connected newer-version refresh clears the question list", async () => {
    const current = fixture();
    current.required_actions = [
      { id: "bill-amount", need: "electricity", field: "amountDue", reason: "missing_fact", resolver: "parent", title: "Bill amount", explanation: "Enter the current amount due." },
      { id: "household-count", need: "electricity", field: "householdSize", reason: "missing_fact", resolver: "parent", title: "Household count", explanation: "Enter the current household size." },
    ];
    const latest = { ...current, version: 2, required_actions: [] };
    let refreshed = false;
    const fetch = vi.fn<(url: string, options?: RequestInit) => Promise<ReturnType<typeof response>>>(
      async () => response(refreshed ? latest : current),
    );
    vi.stubGlobal("fetch", fetch);
    render(<SupportDetail requestId={requestId} />); await openSection(/Your next steps/);
    const amountRegion = await screen.findByRole("region", { name: "Electric bill Bill amount" });
    fireEvent.change(within(amountRegion).getByLabelText("Your answer"), { target: { value: "15" } });
    fireEvent.change(within(screen.getByRole("region", { name: "Electric bill Household count" })).getByLabelText("Your answer"), { target: { value: "4" } });
    refreshed = true;
    await refreshSupport();
    await screen.findByRole("button", { name: "Review latest questions" });
    expect((within(screen.getByRole("region", { name: "Electric bill Bill amount" })).getByLabelText("Your answer") as HTMLInputElement).value).toBe("15");
    expect((within(screen.getByRole("region", { name: "Electric bill Household count" })).getByLabelText("Your answer") as HTMLInputElement).value).toBe("4");
    expect(fetch.mock.calls.some((call) => call[1]?.method === "POST")).toBe(false);
  });
  it("looks up immediate food using its exact current ZIP rather than a utility mirror", async () => {
    const request = fixture();
    request.intake.needs = ["food_now", "electricity"];
    request.intake.zip = "19103";
    request.intake_need_scoped_fields = ["zip"];
    request.facts = [
      { need: "food_now", field: "zip", value: "19104", source: "parent", confirmedAt: fixtureNow.toISOString(), asOf: "2026-10-25" },
      { need: "electricity", field: "zip", value: "19103", source: "parent", confirmedAt: fixtureNow.toISOString(), asOf: "2026-10-25" },
    ];
    const fetch = vi.fn(async (url: string) => url.includes("/food-sites?")
      ? { ok: true, status: 200, json: async () => ({ sites: [], checkedAt: fixtureNow.toISOString(), moreSitesAvailable: false }) }
      : response(request));
    vi.stubGlobal("fetch", fetch);
    render(<SupportDetail requestId={requestId} />); await openSection(/Program progress/);
    await screen.findByRole("heading", { name: "Food locations near your ZIP" });
    await waitFor(() => expect(fetch.mock.calls.some(([url]) => url.includes("/food-sites?"))).toBe(true));
    expect(fetch.mock.calls.filter(([url]) => url.includes("/food-sites?")).map(([url]) => url))
      .toEqual(["/api/parent/food-sites?zip=19104"]);
  });
  it.each(["other_need", "expired", "excluded"])("keeps manual food lookup available without querying a %s saved ZIP", async (source) => {
    const request = fixture();
    request.intake.needs = ["food_now", "electricity"];
    request.intake.zip = "19103";
    request.intake_need_scoped_fields = source === "other_need" ? ["zip"] : [];
    if (source === "other_need") request.facts = [{ need: "electricity", field: "zip", value: "19103", source: "parent", confirmedAt: fixtureNow.toISOString(), asOf: "2026-10-25" }];
    if (source === "expired") request.intake_confirmed_at = { zip: "2026-01-01T00:00:00Z" };
    if (source === "excluded") request.mandate.allowedData = ["utility"];
    const fetch = vi.fn(async (url: string) => url.includes("/food-sites?")
      ? { ok: true, status: 200, json: async () => ({ sites: [], checkedAt: fixtureNow.toISOString(), moreSitesAvailable: false }) }
      : response(request));
    vi.stubGlobal("fetch", fetch);
    render(<SupportDetail requestId={requestId} />); await openSection(/Program progress/);
    const zip = await screen.findByLabelText("Philadelphia ZIP code");
    expect(fetch.mock.calls.some(([url]) => url.includes("/food-sites?"))).toBe(false);
    fireEvent.change(zip, { target: { value: "19105" } });
    fireEvent.click(screen.getByRole("button", { name: "Find food locations" }));
    await waitFor(() => expect(fetch.mock.calls.filter(([url]) => url.includes("/food-sites?")).map(([url]) => url))
      .toEqual(["/api/parent/food-sites?zip=19105"]));
  });
  it("does not ask for completion while paused and keeps resume and permission controls", async () => {
    const request = fixture();
    request.status = "paused";
    request.required_actions = [
      {
        id: "need-zip",
        need: "electricity",
        reason: "missing_fact",
        resolver: "parent",
        field: "zip",
        title: "Confirm the ZIP for this account",
        explanation: "A required routing fact.",
      },
    ];
    const fetch = vi.fn().mockResolvedValue(response(request));
    vi.stubGlobal("fetch", fetch);
    render(<SupportDetail requestId={requestId} />); await openSection(/Your next steps/);
    expect(
      await screen.findByText(
        "No new personal steps are requested while this request is paused or finished.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", {
        name: "Confirm the ZIP for this account",
      }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Save and continue" }),
    ).toBeNull();
    expect(screen.queryByText("Add a document or take a photo")).toBeNull();
    await openSection(/Details & controls/);
    expect(
      screen.getByRole("button", { name: "Change or renew permission" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resume support" }));
    await waitFor(() =>
      expect(fetch.mock.calls.some((call) => call[1]?.method === "POST")).toBe(
        true,
      ),
    );
    expect(
      JSON.parse(
        fetch.mock.calls.find((call) => call[1]?.method === "POST")![1].body,
      ),
    ).toEqual({ action: "resume" });
  });
  it.each([
    { need: "electricity", version: 1, preparationOnly: false, label: "Application prepared" },
    { need: "electricity", version: 1, preparationOnly: true, label: "Incomplete draft prepared" },
    { need: "gas", version: 1, preparationOnly: true, label: "Guidance ready" },
    { need: "electricity", version: 0, preparationOnly: true, label: "Guidance ready" },
  ])(
    "only shows a form prepared for the exact current need ($need, version $version)",
    async ({ need, version, preparationOnly, label }) => {
      const request = fixture();
      request.plan = buildSupportPlan(request, new Date(request.created_at));
      request.plan.routes[0].state = "prepared";
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) =>
          url.endsWith("/operations")
            ? {
                ok: true,
                status: 200,
                json: async () => ({
                  ok: true,
                  historyLimited: false,
                  operations: [
                    {
                      id: "form-operation",
                      program_id: request.plan!.routes[0].programId,
                      need,
                      request_version: version,
                      state: "prepared",
                      created_at: request.created_at,
                      artifact_id: "form-id",
                      form: { preparation_only: preparationOnly },
                    },
                  ],
                }),
              }
            : response(request),
        ),
      );
      render(<SupportDetail requestId={requestId} />); await openSection(/Program progress/);
      const article = (
        await screen.findByRole("heading", { name: /^Electric bill$/ })
      ).closest("article")!;
      await waitFor(() =>
        expect(within(article).getByText(label)).toBeTruthy(),
      );
      if (label !== "Application prepared")
        expect(within(article).queryByText("Application prepared")).toBeNull();
      await openSection(/Activity & receipts/);
      expect(
        await screen.findByRole("link", {
          name: preparationOnly ? "Download incomplete unsigned draft" : "Download this prepared form",
        }),
      ).toBeTruthy();
    },
  );
  it.each([
    { state: "agency_submitted", need: "snap_new", program: "snap-pa", version: 1, recorded: true, progressRecorded: true },
    { state: "agency_submitted", need: "snap_new", program: "snap-pa", version: 0, recorded: false, progressRecorded: false },
    { state: "agency_submitted", need: "snap_renewal", program: "snap-pa", version: 1, recorded: false, progressRecorded: false },
    { state: "agency_submitted", need: "snap_new", program: "peco-cap", version: 1, recorded: false, progressRecorded: false },
    { state: "sent", need: "snap_new", program: "snap-pa", version: 1, recorded: false, progressRecorded: true },
    { state: "prepared", need: "snap_new", program: "snap-pa", version: 1, recorded: false, progressRecorded: false },
  ])("uses exact current submission evidence in Program progress when no plan is saved: %j", async ({ state, need, program, version, recorded, progressRecorded }) => {
    const request = fixture();
    request.intake.needs = ["snap_new"];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/operations")
      ? {
          ok: true, status: 200,
          json: async () => ({ ok: true, historyLimited: false, operations: [{
            id: "recorded-attempt", program_id: program, need, request_version: version,
            state, created_at: request.created_at,
            evidence: { source: "agency_receipt", reference: "Exact submission test record", recordedAt: request.created_at },
          }] }),
        }
      : response(request)));
    render(<SupportDetail requestId={requestId} />); await openSection(/Program progress/);
    await screen.findByRole("heading", { name: "Program progress" });
    await waitFor(() => expect(screen.queryByText("Checking application records…")).toBeNull());
    const programs = document.getElementById("application-programs")!;
    expect(!!within(programs).queryByText("Apply for SNAP · Application submitted")).toBe(recorded);
    expect(!!within(programs).queryByText(/Preparation is pending/)).toBe(!progressRecorded);
    if (state === "sent") {
      expect(within(programs).getByText(/Sent is recorded/)).toBeTruthy();
      expect(within(programs).queryByText(/Application submitted/)).toBeNull();
    }
    if (recorded) {
      expect(within(programs).getByText(/A submission is separate from approval or receiving support/)).toBeTruthy();
      expect(screen.getByText("SNAP application complete")).toBeTruthy();
    }
  });
  it.each([
    ["agency_submitted", "Application submitted", "Agency response"],
    ["assistance_approved", "Assistance approved", "Program follow-up"],
    ["support_received", "Support received", "No further step recorded"],
    ["declined", "Declined", "Review the recorded decision and follow-up"],
  ].flatMap(([state, label, next]) => [
    { state, label, next, savedState: "prepared" },
    { state, label, next, savedState: state },
  ]))("replaces obsolete preparation instructions with recorded $state and saved $savedState", async ({ state, label, next, savedState }) => {
    const request = fixture();
    request.intake.needs = ["snap_new"];
    request.mandate.recipientIds = ["snap-pa"];
    request.plan = buildSupportPlan(request, fixtureNow);
    Object.assign(request.plan.routes[0], {
      state: savedState, summary: "Obsolete preparation summary", limitation: "Obsolete connection limitation",
      nextActor: "caselink", steps: ["Obsolete planned preparation step"],
    });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/operations")
      ? { ok: true, status: 200, json: async () => ({ ok: true, historyLimited: false, operations: [{
          id: "newer-receipt", program_id: "snap-pa", need: "snap_new", request_version: request.version,
          state, created_at: request.created_at,
          evidence: { source: "agency_receipt", reference: "Synthetic newer response", recordedAt: "2026-10-25T16:00:00+00:00" },
        }] }) }
      : response(request)));
    render(<SupportDetail requestId={requestId} />); await openSection(/Program progress/);
    await screen.findByRole("heading", { name: "Program progress" });
    const programs = document.getElementById("application-programs")!;
    await waitFor(() => expect(within(programs).getByText(label, { exact: true })).toBeTruthy());
    expect(within(programs).getByText(`${label} is recorded. Open Activity & receipts for the exact evidence and any program instructions.`)).toBeTruthy();
    expect(within(programs).getByText(next, { exact: false })).toBeTruthy();
    expect(within(programs).queryByText(/Obsolete/)).toBeNull();
    expect(within(programs).queryByText("See the planned steps")).toBeNull();
    if (state === "agency_submitted") {
      expect(screen.getByText(/Use the recorded submission and any official notices above/)).toBeTruthy();
      expect(screen.queryByText(/Check the application window and work status above for any website verification or other next step/)).toBeNull();
    }
  });
  it.each([
    "snap_new",
    "snap_renewal",
    "snap_pending",
    "snap_problem",
  ] as const)(
    "offers a new-application shortcut only for snap_new, preserving %s routing",
    async (need) => {
      const request = fixture();
      request.intake.needs = [need];
      request.mandate = buildMandate(
        request.intake,
        ["snap-pa"],
        "prepare_only",
        "ask_me",
        "2026-11-24T12:00:00.000Z",
      );
      request.plan =
        need === "snap_new"
          ? null
          : buildSupportPlan(request, new Date(request.updated_at));
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(request)));
      render(<SupportDetail requestId={requestId} />); await openSection(/Program progress/);
      await screen.findByRole("heading", { name: "Program progress" });
      if (need !== "snap_new")
        expect(
          screen
            .getByRole("link", { name: "Official program & direct access" })
            .getAttribute("href"),
        ).toBe(getProgram("snap-pa")!.officialUrl);
      if (need === "snap_new") await openSection(/Official website/);
      const shortcut =
        need === "snap_new"
          ? await screen.findByRole("link", {
              name: "Start a new SNAP application with DHS",
            })
          : screen.queryByRole("link", {
              name: "Start a new SNAP application with DHS",
            });
      expect(shortcut?.getAttribute("href") ?? null).toBe(
        need === "snap_new" ? SNAP_NEW_APPLICATION_URL : null,
      );
      if (need === "snap_new")
        expect(
          screen.getByText(/opening it does not file an application/),
        ).toBeTruthy();
    },
  );
  it("shows the parent's actual outcome and reference with attribution after reload", async () => {
    const request = fixture();
    request.events = [
      {
        id: "parent-report",
        request_id: requestId,
        kind: "parent.outcome_reported",
        actor: "parent",
        summary: "You reported an outcome for electricity.",
        created_at: request.updated_at,
        evidence: {
          need: "electricity",
          outcome: "support_received",
          reference: "Pantry pickup on Monday.",
          attribution: "parent_reported",
        },
      },
    ];
    request.events_truncated = true;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(request)));
    render(<SupportDetail requestId={requestId} />); await openSection(/Activity & receipts/);
    expect(
      await screen.findByText("Reported outcome: Support received"),
    ).toBeTruthy();
    expect(screen.getByText("Pantry pickup on Monday.")).toBeTruthy();
    await openSection(/Activity & receipts/);
    expect(screen.getByText("Parent reported")).toBeTruthy();
    expect(screen.getByText(/Showing the latest 200 updates/)).toBeTruthy();
  });
  it("corrects ordinary WIC routing without collecting private WIC answers", async () => {
    const request = fixture();
    request.intake.needs = ["wic_new"];
    const fetch = vi.fn(async(_url:string,init?:RequestInit)=>response(init?.method==='POST'?{...request,version:2,intake:{...request.intake,zip:'19105'}}:request));
    vi.stubGlobal("fetch", fetch);
    render(<SupportDetail requestId={requestId} />); await openSection(/Details & controls/);
    fireEvent.click(
      await screen.findByText("Correct household or bill information"),
    );
    expect(screen.queryByLabelText("Does your household include a child under five?")).toBeNull();
    expect(screen.queryByLabelText("Is anyone pregnant or recently postpartum?")).toBeNull();
    fireEvent.change(screen.getByLabelText('ZIP code'),{target:{value:'19105'}});
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    await screen.findByText(/Your correction is saved/);
    await waitFor(() =>
      expect(fetch.mock.calls.some((call) => call[1]?.method === "POST")).toBe(
        true,
      ),
    );
    const post = fetch.mock.calls.find((call) => call[1]?.method === "POST")!;
    expect(JSON.parse(String(post[1]!.body))).toMatchObject({
      action: "correct",
      intake: { zip:'19105',childrenUnderFive: null, pregnantOrPostpartum: null },
      version: 1,
    });
  });
  it('preserves legacy private WIC answers read-only without silently clearing them for a ZIP correction',async()=>{
    const request=fixture();request.intake={...request.intake,needs:['wic_new'],childrenUnderFive:false,pregnantOrPostpartum:true};
    const fetch=vi.fn().mockResolvedValue(response(request));vi.stubGlobal('fetch',fetch);render(<SupportDetail requestId={requestId}/>); await openSection(/Details & controls/);
    await screen.findByText(/safe update for your previously saved private WIC answers/);
    expect(screen.queryByText('Correct household or bill information')).toBeNull();expect(screen.queryByRole('button',{name:'Save correction'})).toBeNull();
    expect(screen.getByText('Previously saved child-under-five answer').nextElementSibling?.textContent).toBe('No');
    expect(screen.getByText('Previously saved pregnancy or postpartum answer').nextElementSibling?.textContent).toBe('Yes');
    expect(fetch.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(0);expect(request.intake.pregnantOrPostpartum).toBe(true);
  });
  it("offers wrapping permission choices and requires fresh consent after changing actions", async () => {
    const request = fixture();
    const fetchMock = vi.fn().mockImplementation(async (url: string) =>
      url.endsWith("/authorization-window")
        ? {
            ok: true,
            json: async () => ({
              ok: true,
              authorization: { expiresAt: "2026-11-24T12:00:00.000Z" },
            }),
          }
        : response(request),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<SupportDetail requestId={requestId} />); await openSection(/Details & controls/);
    fireEvent.click(
      await screen.findByRole("button", { name: "Change or renew permission" }),
    );
    const group = screen.getByRole("group", {
      name: "Actions within these limits",
    });
    expect(within(group).getAllByRole("radio")).toHaveLength(2);
    expect(within(group).queryByRole("combobox")).toBeNull();
    const consent = screen.getByLabelText(/I authorize these programs/);
    fireEvent.click(consent);
    fireEvent.click(
      within(group).getByRole("radio", {
        name: /^Prepare and carry out permitted steps/,
      }),
    );
    expect((consent as HTMLInputElement).checked).toBe(false);
    expect(
      (
        screen.getByRole("button", {
          name: "Save updated permission",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(consent);
    fireEvent.click(
      screen.getByRole("button", { name: "Save updated permission" }),
    );
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((call) => call[1]?.method === "POST"),
      ).toBe(true),
    );
    const post = fetchMock.mock.calls.find(
      (call) => call[1]?.method === "POST",
    )!;
    expect(JSON.parse(String(post[1].body)).mandate).toMatchObject({
      mode: "full",
      allowedActions: [
        "research",
        "prepare",
        "share",
        "submit",
        "schedule",
        "follow_up",
      ],
    });
  });
  it("shows the actual named recipient count and avoids repeating a route’s program name", async () => {
    const request = fixture();
    request.mandate.maxRecipients = 8;
    request.plan = buildSupportPlan(request, new Date(request.created_at));
    request.plan.routes[0].title = "PECO assistance programs";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(request)));
    render(<SupportDetail requestId={requestId} />); await openSection(/Program progress/);
    const heading = await screen.findByRole("heading", {
      name: /^Electric bill$/,
    });
    const article = heading.closest("article")!;
    expect(
      within(article).getAllByText("PECO assistance programs", { exact: true }),
    ).toHaveLength(1);
    expect(screen.getByText(/1 named program$/)).toBeTruthy();
    expect(screen.queryByText(/8 named programs/)).toBeNull();
  });
  it("opens and focuses permission changes from the exact required step", async () => {
    const request = fixture();
    request.required_actions = [
      {
        id: "permission-income",
        need: "electricity",
        reason: "expanded_permission",
        resolver: "parent",
        title: "Allow required income information",
        explanation: "The selected program requires this information.",
      },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(request)));
    render(<SupportDetail requestId={requestId} />); await openSection(/Your next steps/);
    fireEvent.click(
      await screen.findByRole("link", {
        name: /^Review permission$/,
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Permission for up to 30 days" }),
    ).toBeTruthy();
    expect(document.activeElement?.getAttribute("type")).toBe("checkbox");
    fireEvent.click(screen.getByLabelText(/I authorize these programs/));
    expect((document.activeElement as HTMLInputElement).checked).toBeDefined();
  });
  it("labels independent utility questions with the account they affect", async () => {
    const request = fixture();
    request.intake.needs = ["electricity", "gas"];
    request.required_actions = ["electricity", "gas"].map((need) => ({
      id: `authority-${need}`,
      need: need as "electricity" | "gas",
      reason: "missing_fact",
      resolver: "parent",
      field: "accountAuthority",
      title: "Can you act for this utility account?",
      explanation: "Your authority is needed for this account only.",
    }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(request)));
    render(<SupportDetail requestId={requestId} />); await openSection(/Your next steps/);
    expect(
      await screen.findByRole("region", {
        name: "Electric bill Can you act for this utility account?",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("region", {
        name: "Gas bill Can you act for this utility account?",
      }),
    ).toBeTruthy();
  });
  it("preserves an unsaved correction and original version while progress refreshes", async () => {
    const request = fixture();
    let reads = 0;
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith("/partners"))
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, partners: [] }),
        };
      if (url.endsWith("/assistant"))
        return {
          ok: true,
          status: 200,
          json: async () => ({
            messages: [],
            available: false,
            unavailableReason: "Assistant unavailable.",
            historyLimited: false,
          }),
        };
      if (url.endsWith("/operations"))
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, operations: [] }),
        };
      if (options?.method !== "POST") reads++;
      return response(reads > 1 ? { ...request, version: 2 } : request);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<SupportDetail requestId={requestId} />); await openSection(/Details & controls/);
    fireEvent.click(
      await screen.findByText("Correct household or bill information"),
    );
    const details = screen
      .getByText("Correct household or bill information")
      .closest("details")!;
    fireEvent(details, new Event("toggle"));
    fireEvent.change(screen.getByLabelText("ZIP code"), {
      target: { value: "19105" },
    });
    await refreshSupport();
    await waitFor(() => expect(reads).toBe(2));
    expect((screen.getByLabelText("ZIP code") as HTMLInputElement).value).toBe(
      "19105",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    await waitFor(() => expect(reads).toBe(3));
    const post = fetchMock.mock.calls.find(
      (call) => call[1]?.method === "POST",
    );
    expect(JSON.parse(String(post![1]!.body)).version).toBe(1);
    expect(JSON.parse(String(post![1]!.body)).intake.zip).toBe("19105");
  });
  it("requires a separate informed cancellation action before stopping support", async () => {
    const request = fixture();
    const fetchMock = vi.fn().mockResolvedValue(response(request));
    vi.stubGlobal("fetch", fetchMock);
    render(<SupportDetail requestId={requestId} />); await openSection(/Details & controls/);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Cancel request & withdraw permission",
      }),
    );
    expect(
      fetchMock.mock.calls.some((call) => call[1]?.method === "POST"),
    ).toBe(false);
    fireEvent.click(
      screen.getByRole("button", { name: "Yes, cancel this request" }),
    );
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((call) => call[1]?.method === "POST"),
      ).toBe(true),
    );
    const post = fetchMock.mock.calls.find(
      (call) => call[1]?.method === "POST",
    );
    expect(JSON.parse(post![1].body)).toEqual({ action: "cancel" });
  });
  it("keeps an unsaved correction after a network refresh failure and stops claiming a current running status", async () => {
    const request = fixture();
    let disconnected = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/assistant"))
          return {
            ok: true,
            status: 200,
            json: async () => ({
              messages: [],
              available: false,
              unavailableReason: "Unavailable.",
              historyLimited: false,
            }),
          };
        if (url.endsWith("/partners"))
          return {
            ok: true,
            status: 200,
            json: async () => ({ partners: [] }),
          };
        if (url.endsWith("/operations"))
          return {
            ok: true,
            status: 200,
            json: async () => ({ operations: [] }),
          };
        if (disconnected) throw new Error("Disconnected");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            request,
            progress: {
              state: "running",
              summary: "Recorded worker activity.",
              updatedAt: request.updated_at,
              nextRunAt: null,
              canContinueAfterClosing: true,
            },
          }),
        };
      }),
    );
    render(<SupportDetail requestId={requestId} />); await openSection(/Details & controls/);
    fireEvent.click(
      await screen.findByText("Correct household or bill information"),
    );
    fireEvent.change(screen.getByLabelText("ZIP code"), {
      target: { value: "19105" },
    });
    disconnected = true;
    await refreshSupport();
    await screen.findByRole("alert");
    expect((screen.getByLabelText("ZIP code") as HTMLInputElement).value).toBe(
      "19105",
    );
    await openSection(/Overview/);
    expect(
      screen.getByRole("heading", { name: "Status unavailable" }),
    ).toBeTruthy();
    expect(screen.queryByText("Recorded worker activity.")).toBeNull();
  });
  it("attributes evidence and keeps operator-owned connection work away from parent action cards", async () => {
    const request = fixture();
    request.required_actions = [
      {
        id: "connection",
        need: "electricity",
        resolver: "operator",
        reason: "execution_issue",
        title: "Verify program connection",
        explanation: "The service channel needs verification.",
      },
    ];
    request.events = [
      {
        id: "event",
        request_id: requestId,
        kind: "parent.reported",
        actor: "parent",
        summary: "An outcome was reported",
        created_at: request.created_at,
      },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(request)));
    render(<SupportDetail requestId={requestId} />); await openSection(/Your next steps/);
    expect(
      await screen.findByText("A CaseLink service step is unresolved"),
    ).toBeTruthy();
    await openSection(/Activity & receipts/);
    expect(screen.getByText("Parent reported")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Save and continue" }),
    ).toBeNull();
    expect(
      screen.queryByRole("link", { name: "Open the official program" }),
    ).toBeNull();
  });
});
