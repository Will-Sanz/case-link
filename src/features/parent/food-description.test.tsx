// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FoodDescription } from "./food-description";
import { FoodAssessment } from "./food-assessment";
import { FoodAssessmentQuestions } from "./food-assessment-questions";
import { foodAssessmentCopy } from "@/lib/parent/food-assessment-copy";
import { ParentLanguageSelector, ParentLocaleProvider } from "./parent-locale";
import type { FoodDescriptionProposal } from "@/lib/parent/food-description-view";
import { foodDescriptionCopy } from "@/lib/parent/food-description-copy";
import { getProgram } from "@/lib/parent/programs";
import type { FoodDescriptionArchive } from "@/lib/parent/food-description-draft";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("./sign-in", () => ({ ParentSignIn: (props: { onSignedIn?: () => Promise<void> }) => <button onClick={() => void props.onSignedIn?.()}>Synthetic sign-in only</button> }));
const owner = "00000000-0000-4000-8000-000000000001", other = "00000000-0000-4000-8000-000000000002", id = "00000000-0000-4000-8000-000000000003";
let available: boolean, signedIn: boolean, archive: FoodDescriptionArchive, fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
let loseQueueAck: boolean, dropQueueWrite: boolean, queuedBodies: string[], resolveBodies: string[], loseResolveAck: boolean, nextDraftId: string;
let resultView: {state:string;proposedAnswers:{foodForTwoDays:string;benefitHistory:string;existingIssue:FoodDescriptionProposal["proposedAnswers"]["existingIssue"]};needIds:string[];questionIds:string[];existingRequests:{requestId:string;needIds:string[]}[];excludedNeedIds:string[];outOfScope:FoodDescriptionProposal["outOfScope"];conflicts?:FoodDescriptionProposal["conflicts"];executionGranted:false};
const onProposed = vi.fn(), onManual = vi.fn(), onReset = vi.fn();
const draft = (): FoodDescriptionArchive["drafts"][number] => ({ id, revision: 0, state: "empty", noticeVersion: "food-description-2026-11-18.v1", consentedAt: new Date().toISOString(), createdAt: new Date().toISOString(), contentExpiresAt: new Date(Date.now()+86400000).toISOString(), metadataExpiresAt: new Date(Date.now()+172800000).toISOString(), input: null, projection: null, selection: null, queueKey: null, sameChargedContext: false, usage: [] });
const renderTool = () => render(<ParentLocaleProvider initialLocale="en"><ParentLanguageSelector/><FoodDescription onProposed={onProposed} onManual={onManual} onReset={onReset}/></ParentLocaleProvider>);
beforeEach(() => {
  vi.clearAllMocks(); available = true; signedIn = true; loseQueueAck = false; dropQueueWrite = false; queuedBodies = []; nextDraftId=id; resolveBodies=[]; loseResolveAck=false; resultView={state:"proposal",proposedAnswers:{foodForTwoDays:"no",benefitHistory:"never",existingIssue:null},needIds:["food_now","snap_new"],questionIds:[],existingRequests:[],excludedNeedIds:[],outOfScope:null,executionGranted:false}; archive = { ownerId: owner, available: true, drafts: [] };
  fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/availability")) return Response.json({ ok: true, available });
    if (!signedIn) return Response.json({ ok: false, error: "Sign in" }, { status: 401 });
    if (!init?.method && url.includes("?draft=")) return Response.json({ok:true,result:resultView});
    if (!init?.method) return Response.json({ ok: true, archive });
    const body = JSON.parse(String(init.body));
    if (body.action === "create") { let current=archive.drafts.find(d=>!["cancelled","expired"].includes(d.state)); if(!current){current={...draft(),id:nextDraftId};archive.drafts.unshift(current);}return Response.json({ ok: true, draftId: current.id, revision: 0 }); }
    if (body.action === "queue") {
      queuedBodies.push(String(init.body)); if (!dropQueueWrite) archive.drafts[0] = { ...archive.drafts[0], revision: 1, state: "queued", input: body.input, queueKey: body.idempotencyKey };
      if (loseQueueAck) { loseQueueAck = false; throw new Error("synthetic lost acknowledgement"); }
      return Response.json({ ok: true, draftId: id, revision: 1 });
    }
    if (body.action === "resolve") {
      if (!resolveBodies.length) { archive.drafts[0].revision=2; resultView={...resultView,state:"proposal",questionIds:[],proposedAnswers:body.answers,needIds:["food_now","snap_new"]}; }
      resolveBodies.push(String(init.body)); if(loseResolveAck){loseResolveAck=false;throw new Error("synthetic lost clarification acknowledgement");}
      return Response.json({ok:true,draftId:id,revision:2});
    }
    if (body.action === "cancel") { archive.drafts[0] = { ...archive.drafts[0], state: "cancelled", input: null, projection: null, selection: null }; return Response.json({ ok: true, cancelled: true }); }
    throw new Error("unexpected synthetic endpoint");
  }); vi.stubGlobal("fetch", fetcher);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function openEmpty() {
  fireEvent.click(await screen.findByRole("button", { name: "Open my private description draft" }));
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Open my private description draft" }));
  return await screen.findByLabelText("Describe only the food help you need");
}
it("default closure leaves the manual entry unblocked and never offers or sends prose", async () => {
  available = false; archive.available = false; const view = renderTool();
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2)); expect(view.container.querySelector("textarea")).toBeNull(); expect(screen.queryByRole("heading", { name: /Optional:/ })).toBeNull(); expect(fetcher.mock.calls.every(([, init]) => !init?.method)).toBe(true);
});
it("creates the owned consent draft before exposing the editor; sending remains a separate explicit action", async () => {
  renderTool(); fireEvent.click(await screen.findByRole("button", { name: "Open my private description draft" }));
  expect(screen.queryByRole("textbox")).toBeNull(); expect((screen.getByRole("button", { name: "Open my private description draft" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Open my private description draft" }));
  const editor = await screen.findByLabelText("Describe only the food help you need"); await waitFor(() => expect(document.activeElement).toBe(editor));
  const creates = fetcher.mock.calls.filter(([, init]) => init?.method === "POST"); expect(creates).toHaveLength(1); expect(JSON.parse(String(creates[0][1]!.body))).toMatchObject({ action: "create", expectedOwnerId: owner, consentAccepted: true }); expect(queuedBodies).toEqual([]);
  fireEvent.change(editor, { target: { value: "Food help tomorrow" } }); expect(queuedBodies).toEqual([]);
});
it("blocks known private input locally without sending a description", async () => {
  renderTool(); const editor = await openEmpty(); fireEvent.change(editor, { target: { value: "My password is private" } }); fireEvent.click(screen.getByRole("button", { name: "Send this description" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("Remove private information")); expect(queuedBodies).toEqual([]);
});
it("freezes the complete unknown body/key across a screen-language change and retries only that attempt", async () => {
  renderTool(); const editor = await openEmpty(); fireEvent.change(editor, { target: { value: "Food help tomorrow" } }); loseQueueAck = true; dropQueueWrite = true;
  fireEvent.click(screen.getByRole("button", { name: "Send this description" })); await screen.findByRole("button", { name: "Retry the same saved attempt" });
  expect(queuedBodies).toHaveLength(1); const original = queuedBodies[0];
  fireEvent.change(screen.getByLabelText(/Screen language/), { target: { value: "es" } });
  dropQueueWrite = false; fireEvent.click(screen.getByRole("button", { name: "Reintentar el mismo intento guardado" }));
  await waitFor(() => expect(queuedBodies).toHaveLength(2)); expect(queuedBodies[1]).toBe(original); expect(JSON.parse(original).input.screenLocale).toBe("en");
  expect(onProposed).not.toHaveBeenCalled();
});
it("rechecks current ownership before any prose upload and clears a changed account's local text", async () => {
  renderTool(); const editor = await openEmpty(); fireEvent.change(editor, { target: { value: "Food help tomorrow" } }); archive.ownerId = other; archive.drafts = [];
  fireEvent.click(screen.getByRole("button", { name: "Send this description" })); await waitFor(() => expect(onReset).toHaveBeenCalled()); expect(queuedBodies).toEqual([]); expect(screen.queryByDisplayValue("Food help tomorrow")).toBeNull();
});
it("retains rights/cancel controls after collection closure and never requeues a charged unknown", async () => {
  available = false; archive.available = false; archive.drafts = [{ ...draft(), state: "unknown", revision: 1, input: { description: "Food help tomorrow", screenLocale: "en" } }];
  renderTool(); fireEvent.click(await screen.findByRole("button", { name: /Open this saved draft/ }));
  expect(screen.queryByRole("textbox")).toBeNull(); expect(screen.getByRole("link", { name: "Download retained descriptions" }).getAttribute("href")).toBe("/api/parent/food-description?download=1");
  fireEvent.click(screen.getByRole("button", { name: "Cancel and clear this description" }));
  await waitFor(() => expect(archive.drafts[0].state).toBe("cancelled")); expect(queuedBodies).toEqual([]); expect(fetcher.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
});

it("successful sign-in only checks ownership and never automatically creates or sends a description", async () => {
  signedIn = false; renderTool(); fireEvent.click(await screen.findByRole("button", { name: "Sign in to use this optional tool" }));
  signedIn = true; fireEvent.click(screen.getByRole("button", { name: "Synthetic sign-in only" }));
  await screen.findByRole("checkbox"); expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false); expect(queuedBodies).toEqual([]);
});

it("allows the last reserved proposal to continue when new prose capacity is exhausted",async()=>{
  available=false;archive.available=false;archive.drafts=[{...draft(),state:"result",revision:1,input:{description:"Food help tomorrow",screenLocale:"en"},selection:{needIds:[],selections:[],assertions:[],exclusions:[],questionIds:[],outOfScope:null}}];
  renderTool();fireEvent.click(await screen.findByRole("button",{name:/Open this saved draft/}));
  await waitFor(()=>expect(onProposed).toHaveBeenCalledWith(expect.objectContaining({source:{draftId:id,revision:1},executionGranted:false})));
  expect(queuedBodies).toEqual([]);
});

it("automatically confirms a lost committed acknowledgement with an owned read, even after the last capacity slot",async()=>{
  renderTool();const editor=await openEmpty();fireEvent.change(editor,{target:{value:"Food help tomorrow"}});loseQueueAck=true;
  fireEvent.click(screen.getByRole("button",{name:"Send this description"}));
  await waitFor(()=>expect(queuedBodies).toHaveLength(1));archive.available=false;
  await screen.findByText("Your description is saved for its bounded private interpretation. No service request or program action has started.");
  expect(screen.queryByRole("button",{name:"Retry the same saved attempt"})).toBeNull();
  expect(queuedBodies).toHaveLength(1);expect(onProposed).not.toHaveBeenCalled();
});

it("keeps optional unresolved questions available without taking focus from ready food and reconciles the same zero-call clarification across locale changes",async()=>{
  const selectFocus=vi.spyOn(HTMLSelectElement.prototype,"focus");
  archive.drafts=[{...draft(),state:"result",revision:1,input:{description:"Food help",screenLocale:"en"}}];
  resultView={...resultView,state:"needs_clarification",proposedAnswers:{foodForTwoDays:"no",benefitHistory:"not_sure",existingIssue:null},needIds:["food_now"],questionIds:["benefitHistory"]};
  renderTool();fireEvent.click(await screen.findByRole("button",{name:/Open this saved draft/}));
  const history=await screen.findByLabelText(/Do you get help paying/);expect(selectFocus).not.toHaveBeenCalled();
  expect(screen.queryByLabelText(/Do you have enough food/)).toBeNull();
  expect(onProposed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ needIds: ["food_now"], questionIds: ["benefitHistory"], source: { draftId: id, revision: 1 } }));
  fireEvent.change(history,{target:{value:"never"}});loseResolveAck=true;fireEvent.click(screen.getByRole("button",{name:"Use these routing answers"}));
  await screen.findByRole("button",{name:"Check the same saved routing answers"});expect(resolveBodies).toHaveLength(1);
  fireEvent.change(screen.getByLabelText(/Screen language/),{target:{value:"es"}});
  fireEvent.click(screen.getByRole("button",{name:"Consultar las mismas respuestas guardadas"}));
  await waitFor(()=>expect(onProposed).toHaveBeenCalledWith(expect.objectContaining({source:{draftId:id,revision:2},needIds:["food_now","snap_new"]})));
  expect(resolveBodies).toHaveLength(2);expect(resolveBodies[0]).toBe(resolveBodies[1]);expect(queuedBodies).toHaveLength(0);
  expect(JSON.parse(resolveBodies[0]).changedQuestionIds).toEqual(["benefitHistory"]);
});

it("still focuses the first indispensable question when no selected work is ready",async()=>{
  archive.drafts=[{...draft(),state:"result",revision:1,input:{description:"Food help",screenLocale:"en"}}];
  resultView={...resultView,state:"needs_clarification",proposedAnswers:{foodForTwoDays:"not_sure",benefitHistory:"not_sure",existingIssue:null},needIds:["food_now"],questionIds:["foodForTwoDays","benefitHistory"]};
  renderTool();fireEvent.click(await screen.findByRole("button",{name:/Open this saved draft/}));
  const food=await screen.findByLabelText(/Do you have enough food/);await waitFor(()=>expect(document.activeElement).toBe(food));
  expect(onProposed).not.toHaveBeenCalled();expect(resolveBodies).toEqual([]);expect(queuedBodies).toEqual([]);
});

it("does not resend unchanged charged prose for only a new key or screen locale",async()=>{
  archive.drafts=[{...draft(),state:"unknown",revision:1,sameChargedContext:true,input:{description:"Food help",screenLocale:"en"}}];
  renderTool();fireEvent.click(await screen.findByRole("button",{name:/Open this saved draft/}));fireEvent.click(screen.getByRole("button",{name:"Edit this description"}));
  fireEvent.change(screen.getByLabelText(/Screen language/),{target:{value:"es"}});fireEvent.click(screen.getByRole("button",{name:"Enviar esta descripción"}));
  await screen.findByRole("alert");expect(queuedBodies).toHaveLength(0);
});

it("clears local description content and proposals at the original deadline even offline and on page resumption",async()=>{
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-11-18T15:00:00Z"));
  archive.drafts=[{...draft(),state:"unknown",revision:1,input:{description:"Expired local food text",screenLocale:"en"}}];
  renderTool();fireEvent.click(await screen.findByRole("button",{name:/Open this saved draft/}));
  expect(screen.getByText("Expired local food text")).toBeTruthy();
  fetcher.mockRejectedValue(new Error("offline"));
  await act(async()=>{vi.setSystemTime(new Date("2026-11-19T15:00:01Z"));window.dispatchEvent(new Event("pageshow"));});
  await waitFor(()=>expect(screen.queryByText("Expired local food text")).toBeNull());expect(onReset).toHaveBeenCalled();expect(queuedBodies).toHaveLength(0);
});

it("keeps a manual exit available during optional sign-in without collecting or sending prose",async()=>{
  signedIn=false;renderTool();fireEvent.click(await screen.findByRole("button",{name:"Sign in to use this optional tool"}));
  expect(screen.getByRole("button",{name:"Synthetic sign-in only"})).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Use guided questions"}));expect(onManual).toHaveBeenCalled();
  expect(screen.queryByRole("textbox")).toBeNull();expect(queuedBodies).toHaveLength(0);
});

it("blocks a late pre-expiry result from restoring a proposal, then permits an explicitly consented new draft without extending the old deadline",async()=>{
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-11-18T15:00:00Z"));
  const deadline=new Date(Date.now()+1000).toISOString();
  archive.drafts=[{...draft(),state:"result",revision:1,contentExpiresAt:deadline,input:{description:"Old food text",screenLocale:"en"}}];
  let finish!:(value:Response)=>void;const original=fetcher.getMockImplementation()!;
  fetcher.mockImplementation((input,init)=>!init?.method&&String(input).includes("?draft=")?new Promise(resolve=>{finish=resolve;}):original(input,init));
  renderTool();fireEvent.click(await screen.findByRole("button",{name:/Open this saved draft/}));await waitFor(()=>expect(finish).toBeTypeOf("function"));
  archive.drafts[0]={...archive.drafts[0],state:"expired",input:null,projection:null,selection:null};
  await act(async()=>{vi.setSystemTime(new Date("2026-11-18T15:00:02Z"));window.dispatchEvent(new Event("pageshow"));finish(Response.json({ok:true,result:resultView}));});
  await waitFor(()=>expect(screen.queryByText("Old food text")).toBeNull());expect(onProposed).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button",{name:"Open a current or new private draft"}));
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  nextDraftId="00000000-0000-4000-8000-000000000004";fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByRole("button",{name:"Open my private description draft"}));
  await screen.findByLabelText("Describe only the food help you need");expect(archive.drafts[0].id).toBe(nextDraftId);
  expect(archive.drafts.find(d=>d.id===id)?.contentExpiresAt).toBe(deadline);expect(queuedBodies).toHaveLength(0);
});

it("drops an already-expired initial content cache before it can be opened, even when the cleanup read is offline",async()=>{
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-11-18T15:00:00Z"));
  archive.drafts=[{...draft(),state:"unknown",revision:1,contentExpiresAt:"2026-11-18T14:59:59Z",input:{description:"Already expired canary",screenLocale:"en"}}];
  let reads=0;const original=fetcher.getMockImplementation()!;
  fetcher.mockImplementation((input,init)=>!init?.method&&String(input).endsWith("/food-description")&&++reads>1?Promise.reject(new Error("offline")):original(input,init));
  renderTool();await waitFor(()=>expect(onReset).toHaveBeenCalled());
  expect(screen.queryByText("Already expired canary")).toBeNull();expect(screen.queryByRole("textbox")).toBeNull();expect(onProposed).not.toHaveBeenCalled();expect(queuedBodies).toHaveLength(0);
});

it("does not restore a late optional result after the family has chosen guided questions",async()=>{
  archive.drafts=[{...draft(),state:"result",revision:1,input:{description:"Food help tomorrow",screenLocale:"en"}}];
  let finish!:(value:Response)=>void;const original=fetcher.getMockImplementation()!;
  fetcher.mockImplementation((input,init)=>!init?.method&&String(input).includes("?draft=")?new Promise(resolve=>{finish=resolve;}):original(input,init));
  renderTool();fireEvent.click(await screen.findByRole("button",{name:/Open this saved draft/}));await waitFor(()=>expect(finish).toBeTypeOf("function"));
  fireEvent.click(screen.getByRole("button",{name:"Use guided questions"}));expect(onManual).toHaveBeenCalledOnce();
  await act(async()=>{finish(Response.json({ok:true,result:resultView}));});
  expect(onProposed).not.toHaveBeenCalled();expect(screen.queryByText("Food help tomorrow")).toBeNull();
});

it("reopens the retained result with a new owned automatic read after leaving for manual questions, without another model request",async()=>{
  archive.drafts=[{...draft(),state:"result",revision:1,input:{description:"Food help tomorrow",screenLocale:"en"}}];
  let finish!:(value:Response)=>void;let reads=0;const original=fetcher.getMockImplementation()!;
  fetcher.mockImplementation((input,init)=>!init?.method&&String(input).includes("?draft=")?(++reads,new Promise(resolve=>{finish=resolve;})):original(input,init));
  renderTool();fireEvent.click(await screen.findByRole("button",{name:/Open this saved draft/}));await waitFor(()=>expect(reads).toBe(1));
  fireEvent.click(screen.getByRole("button",{name:"Use guided questions"}));await act(async()=>{finish(Response.json({ok:true,result:resultView}));});
  fireEvent.click(screen.getByRole("button",{name:/Open this saved draft/}));await waitFor(()=>expect(reads).toBe(2));
  await act(async()=>{finish(Response.json({ok:true,result:resultView}));});await waitFor(()=>expect(onProposed).toHaveBeenCalledOnce());
  expect(queuedBodies).toHaveLength(0);expect(fetcher.mock.calls.some(([,init])=>init?.method==="DELETE")).toBe(false);
});

it("keeps a guided-question exit when the earlier draft creation acknowledgement arrives late",async()=>{
  const original=fetcher.getMockImplementation()!;let finishCreate!:(value:Response)=>void;
  fetcher.mockImplementation(async(input,init)=>{
    const response=await original(input,init);
    if(init?.method==="POST"&&JSON.parse(String(init.body)).action==="create")return new Promise<Response>(resolve=>{finishCreate=resolve;});
    return response;
  });
  renderTool();fireEvent.click(await screen.findByRole("button",{name:"Open my private description draft"}));
  fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByRole("button",{name:"Open my private description draft"}));
  await waitFor(()=>expect(finishCreate).toBeTypeOf("function"));
  fireEvent.click(screen.getByRole("button",{name:"Use guided questions"}));expect(onManual).toHaveBeenCalledOnce();
  await act(async()=>{finishCreate(Response.json({ok:true,draftId:id,revision:0}));});
  expect(screen.queryByLabelText("Describe only the food help you need")).toBeNull();
  expect(queuedBodies).toEqual([]);expect(onProposed).not.toHaveBeenCalled();
});

it("automatically reconciles a clarification committed before manual exit when its saved draft is reopened",async()=>{
  archive.drafts=[{...draft(),state:"result",revision:1,input:{description:"Food help",screenLocale:"en"}}];
  resultView={...resultView,state:"needs_clarification",proposedAnswers:{foodForTwoDays:"no",benefitHistory:"not_sure",existingIssue:null},needIds:["food_now"],questionIds:["benefitHistory"]};
  const original=fetcher.getMockImplementation()!;let finishPatch!:(value:Response)=>void;
  fetcher.mockImplementation(async(input,init)=>{const response=await original(input,init);if(init?.method==="PATCH")return new Promise<Response>(resolve=>{finishPatch=resolve;});return response;});
  renderTool();fireEvent.click(await screen.findByRole("button",{name:/Open this saved draft/}));
  const history=await screen.findByLabelText(/Do you get help paying/);fireEvent.change(history,{target:{value:"applied"}});fireEvent.click(screen.getByRole("button",{name:"Use these routing answers"}));
  await waitFor(()=>expect(finishPatch).toBeTypeOf("function"));expect(archive.drafts[0].revision).toBe(2);
  fireEvent.click(screen.getByRole("button",{name:"Use guided questions"}));await act(async()=>{finishPatch(Response.json({ok:true,draftId:id,revision:2}));});
  fireEvent.click(screen.getByRole("button",{name:/Open this saved draft/}));
  await waitFor(()=>expect(onProposed).toHaveBeenCalledWith(expect.objectContaining({source:{draftId:id,revision:2},proposedAnswers:{foodForTwoDays:"no",benefitHistory:"applied",existingIssue:null}})));
  expect(resolveBodies).toHaveLength(1);expect(queuedBodies).toHaveLength(0);
});

it.each(["en", "es"] as const)("shows the complete current routing choice beside native selects in %s without implying it was saved", locale => {
  const c=foodAssessmentCopy[locale],onChange=vi.fn();
  const view=render(<ParentLocaleProvider initialLocale={locale}><FoodAssessmentQuestions answers={{foodForTwoDays:"no",benefitHistory:"receiving",existingIssue:"card"}} onChange={onChange}/></ParentLocaleProvider>);
  for(const text of [c.no,c.receiving,c.card])expect(screen.getByText(text,{selector:"p"})).toBeTruthy();
  view.rerender(<ParentLocaleProvider initialLocale={locale}><FoodAssessmentQuestions answers={{foodForTwoDays:"yes",benefitHistory:"applied",existingIssue:null}} onChange={onChange}/></ParentLocaleProvider>);
  for(const text of [c.yes,c.applied])expect(screen.getByText(text,{selector:"p"})).toBeTruthy();
  expect(screen.queryByText(c.card,{selector:"p"})).toBeNull();expect(onChange).not.toHaveBeenCalled();expect(queuedBodies).toHaveLength(0);expect(resolveBodies).toHaveLength(0);
});

it.each(["en", "es"] as const)("keeps food unanswered while exposing the independently ready SNAP-only proposal (%s)", async language => {
  const description = language === "en" ? "I now want help with my first SNAP application as well as food today." : "Ahora también quiero ayuda con mi primera solicitud de SNAP, además de comida para hoy.";
  archive.drafts = [{ ...draft(), state: "result", revision: 2, input: { description, screenLocale: language } }];
  resultView = { ...resultView, state: "needs_clarification", proposedAnswers: { foodForTwoDays: "not_sure", benefitHistory: "never", existingIssue: null }, needIds: ["food_now", "snap_new"], questionIds: ["foodForTwoDays"] };
  renderTool(); fireEvent.click(await screen.findByRole("button", { name: /Open this saved draft/ }));
  await screen.findByLabelText(foodAssessmentCopy.en.enough);
  if (language === "es") fireEvent.change(screen.getByLabelText(/Screen language/), { target: { value: "es" } });
  const answer = await screen.findByLabelText(foodAssessmentCopy[language].enough) as HTMLSelectElement;
  expect(answer.value).toBe(""); expect(answer.required).toBe(true); expect(answer.checkValidity()).toBe(false);
  expect(onProposed).toHaveBeenCalledWith(expect.objectContaining({ state: "needs_clarification", needIds: ["snap_new"], questionIds: ["foodForTwoDays"], source: { draftId: id, revision: 2 } }));
  expect(resolveBodies).toEqual([]); expect(queuedBodies).toEqual([]);
});

it.each((["en", "es"] as const).flatMap(language => (["manual", "needs_clarification", "proposal"] as const).map(state => ({ language, state }))))("shows direct WIC choices with honest limits while preserving independent food work ($language/$state)", async ({ language, state }) => {
  archive.drafts = [{ ...draft(), state: "result", revision: 1, input: { description: language === "en" ? "I need WIC support." : "Necesito apoyo de WIC.", screenLocale: language } }];
  resultView = { ...resultView, state, outOfScope: "wic", proposedAnswers: { foodForTwoDays: state === "proposal" ? "no" : "not_sure", benefitHistory: "not_sure", existingIssue: null },
    needIds: state === "manual" ? [] : ["food_now"], questionIds: state === "needs_clarification" ? ["foodForTwoDays"] : [] };
  renderTool(); fireEvent.click(await screen.findByRole("button", { name: /Open this saved draft/ }));
  if (language === "es") fireEvent.change(screen.getByLabelText(/Screen language/), { target: { value: "es" } });
  const region = await screen.findByRole("region", { name: language === "en" ? "WIC support" : "Apoyo de WIC" });
  const links = [...region.querySelectorAll("a")];
  expect(links.map(link => link.getAttribute("href"))).toEqual(["/get-support?need=wic_new", "/get-support?need=wic_continuing", getProgram("wic-pa")!.officialUrl]);
  expect(links.map(link => link.textContent)).toEqual(language === "en" ? ["Apply for WIC", "Continue WIC support", "Official WIC appointment guidance"] : ["Solicitar WIC", "Continuar el apoyo de WIC", "Orientación oficial sobre citas de WIC"]);
  expect(region.closest("[lang]")?.getAttribute("lang")).toBe(language);
  expect(region.textContent).toContain(language === "en" ? "separate WIC notice" : "aviso de WIC por separado");
  expect(region.textContent).toContain(language === "en" ? "does not send a pre-application, book an appointment or confirm enrollment" : "no envía una presolicitud, reserva una cita ni confirma la inscripción");
  if (state === "needs_clarification") expect((screen.getByLabelText(foodAssessmentCopy[language].enough) as HTMLSelectElement).value).toBe("");
  if (state === "manual") {
    expect(screen.queryByText(foodAssessmentCopy[language].history)).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(region.querySelector("h3")));
  }
  expect(queuedBodies).toEqual([]); expect(resolveBodies).toEqual([]);
  expect(onProposed).toHaveBeenCalledTimes(state === "proposal" ? 1 : 0);
  expect(archive.drafts[0].input?.screenLocale).toBe(language);
});

it.each(["en", "es"] as const)("shows the existing public outside-area food fallback directly (%s)", async language => {
  archive.drafts = [{ ...draft(), state: "result", revision: 1, input: { description: language === "en" ? "I need food support outside Pennsylvania." : "Necesito apoyo alimentario fuera de Pensilvania.", screenLocale: language } }];
  resultView = { ...resultView, state: "manual", outOfScope: "outside_pa", proposedAnswers: { foodForTwoDays: "not_sure", benefitHistory: "not_sure", existingIssue: null }, needIds: [], questionIds: [] };
  renderTool(); fireEvent.click(await screen.findByRole("button", { name: /Open this saved draft/ }));
  if (language === "es") fireEvent.change(screen.getByLabelText(/Screen language/), { target: { value: "es" } });
  const link = await screen.findByRole("link", { name: language === "en" ? "Find a food bank outside this area" : "Buscar un banco de alimentos fuera de esta zona" });
  expect(link.getAttribute("href")).toBe("https://www.feedingamerica.org/need-help-find-food");
  expect(link.closest("[lang]")?.getAttribute("lang")).toBe(language);
  await waitFor(() => expect(document.activeElement).toBe(link.closest("section")?.querySelector("h3")));
  expect(screen.getByText(language === "en" ? /These connected options do not cover the area you described/ : /Estas opciones conectadas no cubren la zona que describió/)).toBeTruthy();
  expect(screen.queryByLabelText(foodAssessmentCopy[language].enough)).toBeNull(); expect(screen.queryByLabelText(foodAssessmentCopy[language].history)).toBeNull();
  expect(onProposed).not.toHaveBeenCalled(); expect(queuedBodies).toEqual([]); expect(resolveBodies).toEqual([]);
  expect(screen.getByRole("button", { name: foodDescriptionCopy[language].manual })).toBeTruthy();
});

it.each(["en", "es"] as const)("exposes the ready SNAP path through the actual guide without inventing a food answer or an extra click (%s)", async language => {
  const selectFocus = vi.spyOn(HTMLSelectElement.prototype, "focus");
  archive.drafts = [{ ...draft(), state: "result", revision: 2, input: { description: language === "en" ? "My first SNAP application and food today." : "Mi primera solicitud de SNAP y comida para hoy.", screenLocale: language } }];
  resultView = { ...resultView, state: "needs_clarification", proposedAnswers: { foodForTwoDays: "not_sure", benefitHistory: "never", existingIssue: null }, needIds: ["food_now", "snap_new"], questionIds: ["foodForTwoDays"] };
  const onChoose = vi.fn();
  render(<ParentLocaleProvider initialLocale={language}><FoodAssessment onChoose={onChoose} descriptionOptions={{}}/></ParentLocaleProvider>);
  fireEvent.click(await screen.findByRole("button", { name: name => name.startsWith(foodDescriptionCopy[language].resume) }));
  const choice = await screen.findByRole("button", { name: foodAssessmentCopy[language].titles.snap_new });
  expect(screen.getByText(foodDescriptionCopy[language].readyOptions)).toBeTruthy();
  const resultHeading = screen.getByRole("heading", { name: foodAssessmentCopy[language].results });
  await waitFor(() => expect(document.activeElement).toBe(resultHeading));
  expect(selectFocus).not.toHaveBeenCalled();
  const tool = screen.getByRole("region", { name: foodDescriptionCopy[language].title });
  expect((within(tool).getByLabelText(foodAssessmentCopy[language].enough) as HTMLSelectElement).value).toBe("");
  expect(screen.queryByRole("button", { name: foodAssessmentCopy[language].both })).toBeNull();
  expect(screen.queryByRole("button", { name: foodAssessmentCopy[language].titles.food_now })).toBeNull();
  fireEvent.click(choice);
  expect(onChoose).toHaveBeenCalledExactlyOnceWith({ needs: ["snap_new"], answers: { foodForTwoDays: "not_sure", benefitHistory: "never", existingIssue: null }, descriptionSource: { draftId: id, revision: 2 } });
  expect(resolveBodies).toEqual([]); expect(queuedBodies).toEqual([]);
  fireEvent.click(within(tool).getByRole("button", { name: foodDescriptionCopy[language].edit }));
  await waitFor(() => expect(screen.queryByRole("button", { name: foodAssessmentCopy[language].titles.snap_new })).toBeNull());
});

it.each([
  { name: "food only", needs: ["food_now"], questions: ["foodForTwoDays"] },
  { name: "unknown history", needs: ["food_now", "snap_new"], questions: ["foodForTwoDays", "benefitHistory"] },
  { name: "unresolved issue", needs: ["food_now", "snap_problem"], questions: ["foodForTwoDays", "existingIssue"] },
  { name: "incompatible benefit", needs: ["food_now", "snap_new"], questions: ["foodForTwoDays"], history: "applied" },
  { name: "multiple benefit paths", needs: ["food_now", "snap_new", "snap_pending"], questions: ["foodForTwoDays"], expectedNeeds: ["snap_new"] },
  { name: "typed conflict", needs: ["food_now", "snap_new"], questions: ["foodForTwoDays"], conflicts: ["benefitHistory"] as const },
])("respects readiness limits for $name", async ({ needs, questions, conflicts, history, expectedNeeds }) => {
  archive.drafts = [{ ...draft(), state: "result", revision: 1, input: { description: "Food help", screenLocale: "en" } }];
  resultView = { ...resultView, state: "needs_clarification", needIds: needs, questionIds: questions, conflicts: conflicts ? [...conflicts] : [],
    proposedAnswers: { foodForTwoDays: "not_sure", benefitHistory: history ?? (needs.includes("snap_problem") ? "receiving" : "never"), existingIssue: needs.includes("snap_problem") ? "not_sure" : null } };
  renderTool(); fireEvent.click(await screen.findByRole("button", { name: /Open this saved draft/ }));
  await screen.findByLabelText(foodAssessmentCopy.en.enough);
  if (expectedNeeds) expect(onProposed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ needIds: expectedNeeds, questionIds: questions }));
  else expect(onProposed).not.toHaveBeenCalled();
  expect(resolveBodies).toEqual([]); expect(queuedBodies).toEqual([]);
});

it.each(["proposal", "needs_clarification"])("keeps outside-area help separate from local SNAP choices despite an upstream %s state", async state => {
  archive.drafts = [{ ...draft(), state: "result", revision: 1, input: { description: "We live outside Pennsylvania and want help with a first SNAP application.", screenLocale: "en" } }];
  resultView = { ...resultView, state, outOfScope: "outside_pa", proposedAnswers: { foodForTwoDays: "not_sure", benefitHistory: "never", existingIssue: null }, needIds: ["food_now", "snap_new"], questionIds: state === "proposal" ? [] : ["foodForTwoDays"] };
  const choose = vi.fn();
  render(<ParentLocaleProvider initialLocale="en"><FoodAssessment onChoose={choose} descriptionOptions={{}}/></ParentLocaleProvider>);
  fireEvent.click(await screen.findByRole("button", { name: name => name.startsWith(foodDescriptionCopy.en.resume) }));
  await screen.findByRole("link", { name: "Find a food bank outside this area" });
  await waitFor(() => expect(screen.queryByRole("button", { name: foodAssessmentCopy.en.titles.snap_new })).toBeNull());
  expect(screen.queryByRole("button", { name: foodAssessmentCopy.en.submit })).toBeNull();
  expect(choose).not.toHaveBeenCalled(); expect(resolveBodies).toEqual([]); expect(queuedBodies).toEqual([]);
});

it.each(["en", "es"] as const)("corrects a ready SNAP interpretation without a model call or a fabricated food confirmation (%s)", async language => {
  archive.drafts = [{ ...draft(), state: "result", revision: 2, input: { description: "My first SNAP application.", screenLocale: language } }];
  resultView = { ...resultView, state: "needs_clarification", proposedAnswers: { foodForTwoDays: "not_sure", benefitHistory: "never", existingIssue: null }, needIds: ["food_now", "snap_new"], questionIds: ["foodForTwoDays"] };
  const ordinary = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (body?.action !== "resolve") return ordinary(url, init);
    resolveBodies.push(String(init!.body)); archive.drafts[0].revision = 3;
    resultView = { ...resultView, proposedAnswers: body.answers, needIds: ["food_now", "snap_pending"], questionIds: ["foodForTwoDays"] };
    return Response.json({ ok: true, draftId: id, revision: 3 });
  });
  const choose = vi.fn();
  render(<ParentLocaleProvider initialLocale={language}><FoodAssessment onChoose={choose} descriptionOptions={{}}/></ParentLocaleProvider>);
  fireEvent.click(await screen.findByRole("button", { name: name => name.startsWith(foodDescriptionCopy[language].resume) }));
  await screen.findByRole("button", { name: foodAssessmentCopy[language].titles.snap_new });
  const tool = screen.getByRole("region", { name: foodDescriptionCopy[language].title });
  fireEvent.click(within(tool).getByRole("button", { name: foodDescriptionCopy[language].changeAnswers }));
  await waitFor(() => expect(screen.queryByRole("button", { name: foodAssessmentCopy[language].titles.snap_new })).toBeNull());
  fireEvent.change(within(tool).getByLabelText(foodAssessmentCopy[language].history), { target: { value: "applied" } });
  fireEvent.click(within(tool).getByRole("button", { name: foodDescriptionCopy[language].resolve }));
  const pending = await screen.findByRole("button", { name: foodAssessmentCopy[language].titles.snap_pending });
  expect(resolveBodies).toHaveLength(1); expect(queuedBodies).toEqual([]);
  expect(JSON.parse(resolveBodies[0])).toMatchObject({ expectedOwnerId: owner, draftId: id, expectedRevision: 2, changedQuestionIds: ["benefitHistory"], answers: { foodForTwoDays: "not_sure", benefitHistory: "applied", existingIssue: null } });
  expect((within(tool).getByLabelText(foodAssessmentCopy[language].enough) as HTMLSelectElement).value).toBe("");
  fireEvent.click(pending);
  expect(choose).toHaveBeenCalledExactlyOnceWith({ needs: ["snap_pending"], answers: { foodForTwoDays: "not_sure", benefitHistory: "applied", existingIssue: null }, descriptionSource: { draftId: id, revision: 3 } });
});

it.each(["en", "es"] as const)("exposes only ready food through the actual guide while SNAP history remains unanswered (%s)", async language => {
  archive.drafts = [{ ...draft(), state: "result", revision: 2, input: { description: language === "en" ? "We have no food today." : "No tenemos comida hoy.", screenLocale: language } }];
  resultView = { ...resultView, state: "needs_clarification", proposedAnswers: { foodForTwoDays: "no", benefitHistory: "not_sure", existingIssue: null }, needIds: ["food_now"], questionIds: ["benefitHistory"] };
  const choose = vi.fn();
  render(<ParentLocaleProvider initialLocale={language}><FoodAssessment onChoose={choose} descriptionOptions={{}}/></ParentLocaleProvider>);
  fireEvent.click(await screen.findByRole("button", { name: name => name.startsWith(foodDescriptionCopy[language].resume) }));
  const option = await screen.findByRole("button", { name: foodAssessmentCopy[language].titles.food_now });
  const tool = screen.getByRole("region", { name: foodDescriptionCopy[language].title });
  expect((within(tool).getByLabelText(foodAssessmentCopy[language].history) as HTMLSelectElement).value).toBe("");
  expect(screen.queryByRole("button", { name: foodAssessmentCopy[language].both })).toBeNull();
  for (const need of ["snap_new", "snap_pending", "snap_renewal", "snap_problem"] as const) expect(screen.queryByRole("button", { name: foodAssessmentCopy[language].titles[need] })).toBeNull();
  fireEvent.click(option);
  expect(choose).toHaveBeenCalledExactlyOnceWith({ needs: ["food_now"], answers: { foodForTwoDays: "no", benefitHistory: "not_sure", existingIssue: null }, descriptionSource: { draftId: id, revision: 2 } });
  expect(resolveBodies).toEqual([]); expect(queuedBodies).toEqual([]);
});
