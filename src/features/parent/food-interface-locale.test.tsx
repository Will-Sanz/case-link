// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SupportPartners } from "./support-partners";
import { SupportDetail } from "./support-detail";
import { ParentIntake } from "./intake";
import { ParentLocaleProvider } from "./parent-locale";
import { ApplicationWorkspace } from "./application-workspace";
import { SupportActivity } from "./support-activity";
import { fixtureRequest } from "@/lib/parent/test-fixtures";
import { getProgram } from "@/lib/parent/programs";
import { OUTCOME_LABELS } from "@/lib/parent/domain";
import { within } from "@testing-library/react";
import { parentText, type ParentLocale } from "@/lib/parent/locale";
const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
const owner="11111111-1111-4111-8111-111111111111";
const needs=["food_now","snap_pending","snap_renewal","snap_problem"] as const;
const languages=["en","es"] as const;
const text=(locale:ParentLocale,value:string)=>parentText(locale,value);
const response=(body:unknown)=>({ok:true,status:200,json:async()=>body});
function api(post?:()=>unknown){const fetcher=vi.fn(async(url:string,init?:RequestInit)=>{
 if(url.endsWith("/account"))return response({account:{id:owner,email:"synthetic@example.invalid",preferences:{language:"en",contactPreference:"in_app"}}});
 if(url.endsWith("/authorization-window"))return response({authorization:{issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()}});
 if(url.endsWith("/intake-defaults"))return response({ownerId:owner,zip:{sourceRequestId:owner,sourceVersion:1,value:"19104",confirmedAt:"2026-11-01T12:00:00Z",expiresAt:new Date(Date.now()+86400000).toISOString()}});
 if(url.endsWith("/requests")&&init?.method==="POST")return post?post():response({request:{id:owner}});
 return response({capabilities:[]});
});vi.stubGlobal("fetch",fetcher);return fetcher;}
beforeEach(()=>{vi.clearAllMocks();window.history.replaceState(null,"","/");});afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe("ordinary food screens keep their selected display language",()=>{
 it.each(needs.flatMap(need=>languages.map(locale=>({need,locale}))))("localizes $need intake and exact permission in $locale without changing service preferences",async({need,locale})=>{
  api();render(<ParentLocaleProvider initialLocale={locale}><ParentIntake initialNeed={need}/></ParentLocaleProvider>);
  const field=await screen.findByLabelText(locale==="es"?"Código postal del hogar":"Household ZIP code");
  await waitFor(()=>expect((field as HTMLInputElement).value).toBe("19104"));
  expect(field.closest("form")?.lang).toBe(locale);
  expect((screen.getByLabelText(text(locale,"Preferred service language")) as HTMLSelectElement).value).toBe("en");
  const date=new Date("2026-11-01T12:00:00Z").toLocaleDateString(locale==="es"?"es-US":"en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"America/New_York"});
  expect(screen.getByText((_,node)=>node?.tagName==="P"&&!!node.textContent?.startsWith(text(locale,"We filled your ZIP code from your saved information, provided"))&&!!node.textContent.includes(date))).toBeTruthy();
  fireEvent.click(screen.getByLabelText(locale==="es"?/Tengo 18 años/:/I’m 18 or older/));
  fireEvent.click(screen.getByRole("button",{name:locale==="es"?"Continuar":"Continue"}));
  const permission=screen.getByRole("checkbox",{name:locale==="es"?/Autorizo/:/I authorize/});
  expect(permission.closest("form")?.lang).toBe(locale);
  expect(screen.getByText(text(locale,"Your personal decisions stay yours"))).toBeTruthy();
  expect(screen.getByRole("button",{name:locale==="es"?"Comenzar a recibir apoyo":"Start getting support"})).toBeTruthy();
 });
 it("keeps the exact ordinary food attempt frozen while Spanish retry controls stay readable",async()=>{
  const fetcher=api(()=>{throw new Error("synthetic_lost_ack");});render(<ParentLocaleProvider initialLocale="es"><ParentIntake initialNeed="food_now"/></ParentLocaleProvider>);
  const zip=await screen.findByLabelText("Código postal del hogar");await waitFor(()=>expect((zip as HTMLInputElement).value).toBe("19104"));fireEvent.click(screen.getByLabelText(/Tengo 18 años/));fireEvent.click(screen.getByRole("button",{name:"Continuar"}));fireEvent.click(screen.getByRole("checkbox",{name:/Autorizo/}));
  fireEvent.click(screen.getByRole("button",{name:"Comenzar a recibir apoyo"}));
  await screen.findByText((_,node)=>node?.tagName==="SPAN"&&!!node.textContent?.startsWith(text("es","The save result has not been confirmed. Retry the same request before changing answers or starting another request.")));
  expect((screen.getByRole("button",{name:"Atrás"}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button",{name:"Comenzar a recibir apoyo"}));await waitFor(()=>expect(fetcher.mock.calls.filter(([,i])=>i?.method==="POST")).toHaveLength(2));
  const attempts=fetcher.mock.calls.filter(([,i])=>i?.method==="POST");expect(attempts[0][1]?.body).toBe(attempts[1][1]?.body);expect(attempts[0][1]?.headers).toEqual(attempts[1][1]?.headers);
  expect(JSON.parse(String(attempts[0][1]?.body)).intake.language).toBe("en");
 });
 it.each(needs.flatMap(need=>languages.map(locale=>({need,locale}))))("localizes $need return-use checklist, counts and history recovery in $locale",({need,locale})=>{
  const request=fixtureRequest();request.intake.needs=[need];request.required_actions=[{id:"personal",need,reason:"personal_step",title:"Original source title",explanation:"Original source explanation",resolved:false}];
  const history={data:{operations:[],historyLimited:false},loading:false,error:null,reload:vi.fn()};
  render(<ParentLocaleProvider initialLocale={locale}><ApplicationWorkspace request={request} history={history}><section id="your-next-steps">Original retained content</section></ApplicationWorkspace></ParentLocaleProvider>);
  const nav=screen.getByRole("navigation",{name:text(locale,"Your application checklist")});expect(nav.lang).toBe(locale);
  const detail=locale==="es"?"Pasos personales que requieren su atención: 1. Abra Sus próximos pasos para continuar.":"One personal step needs your attention. Open Your next steps to continue.";
  expect(screen.getByText(detail).closest("[lang]")?.getAttribute("lang")).toBe(locale);
 });
 it.each(needs.flatMap(need=>languages.map(locale=>({need,locale}))))("localizes $need retained packet and outcome controls in $locale",({need,locale})=>{
  const request=fixtureRequest();request.intake.needs=[need];request.mandate.recipientIds=[];
  render(<ParentLocaleProvider initialLocale={locale}><SupportActivity request={request} onChange={vi.fn()} history={{data:{operations:[{id:"synthetic-operation",need,program_id:"snap-pa",state:"prepared",created_at:request.created_at,artifact_id:null}],historyLimited:false},loading:false,error:null,reload:vi.fn()}}/></ParentLocaleProvider>);
  expect(screen.getByRole("heading",{name:text(locale,"Recorded packets & receipts")}).closest("[lang]")?.getAttribute("lang")).toBe(locale);
  expect(screen.getByRole("link",{name:text(locale,"Download recorded information")}).getAttribute("href")).toContain("/operations/synthetic-operation/export");
  expect(screen.getByLabelText(text(locale,"What did you receive or hear, and when?"))).toBeTruthy();
 });
 it("localizes saved and retry report states without translating the family's report",async()=>{
  const request=fixtureRequest();request.intake.needs=["snap_pending"];const fetcher=vi.fn<(url:string,init?:RequestInit)=>Promise<ReturnType<typeof response>>>(async()=>response({ok:true}));vi.stubGlobal("fetch",fetcher);
  render(<ParentLocaleProvider initialLocale="es"><SupportActivity request={request} onChange={vi.fn()} history={{data:{operations:[],historyLimited:false},loading:false,error:null,reload:vi.fn()}}/></ParentLocaleProvider>);
  fireEvent.change(screen.getByLabelText(text("es","What did you receive or hear, and when?")),{target:{value:"Original family wording kept exact."}});
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:text("es","Save my report")})));
  expect(screen.getByRole("status").textContent).toBe(text("es","Your report is saved as information from you. It does not replace a program’s recorded receipt or decision."));
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).reference).toBe("Original family wording kept exact.");
 });
});

it.each(needs.flatMap(need=>languages.map(locale=>({need,locale}))))("keeps $need saved status, receipt and correction controls in $locale",async({need,locale})=>{
 const request=fixtureRequest();request.intake.needs=[need];request.events=[];request.documents=[];
 vi.stubGlobal("fetch",vi.fn(async(url:string)=>url.includes("/food-sites?")?response({sites:[],checkedAt:"2026-11-18T12:00:00Z",moreSitesAvailable:false}):response({request,operations:[],historyLimited:false})));
 render(<ParentLocaleProvider initialLocale={locale}><SupportDetail requestId={request.id}/></ParentLocaleProvider>);
 const nav=await screen.findByRole("navigation",{name:text(locale,"Your application checklist")});
 fireEvent.click(nav.querySelector('a[href="#application-programs"]')!);
 expect(screen.getByRole("heading",{name:text(locale,"Program progress")}).closest("[lang]")?.getAttribute("lang")).toBe(locale);
 expect(screen.getByText(text(locale,"Preparation is pending. A saved request is not an application or a confirmed appointment. You can use official programs directly while you wait."))).toBeTruthy();
 fireEvent.click(nav.querySelector('a[href="#application-receipts"]')!);
 expect(screen.getByRole("heading",{name:text(locale,"Activity & receipts")})).toBeTruthy();
 expect(screen.getByText(text(locale,"No additional activity recorded yet. We won’t mark a request sent or received without evidence."))).toBeTruthy();
 fireEvent.click(nav.querySelector('a[href="#application-controls"]')!);
 expect(screen.getByRole("heading",{name:locale==="es"?"Sus datos":"Your details"})).toBeTruthy();
 fireEvent.click(screen.getByText(locale==="es"?"Corregir datos del hogar o de facturas":"Correct household or bill information"));
 expect(screen.getByLabelText(locale==="es"?"Código postal":"ZIP code")).toBeTruthy();
 expect(screen.getByRole("button",{name:locale==="es"?"Guardar la corrección":"Save correction"})).toBeTruthy();
});
it.each(languages)("keeps application-record loading/error and paused recovery localized in %s",locale=>{
 const request=fixtureRequest();request.intake.needs=["snap_pending"];
 const data={operations:[],historyLimited:false},reload=vi.fn();
 const view=render(<ParentLocaleProvider initialLocale={locale}><ApplicationWorkspace request={request} history={{data,loading:true,error:null,reload}}>{null}</ApplicationWorkspace></ParentLocaleProvider>);
 expect(screen.getByText(text(locale,"Checking application records…"))).toBeTruthy();
 view.rerender(<ParentLocaleProvider initialLocale={locale}><ApplicationWorkspace request={request} history={{data,loading:false,error:new Error("Original provider error"),reload}}>{null}</ApplicationWorkspace></ParentLocaleProvider>);
 fireEvent.click(screen.getByRole("button",{name:text(locale,"Check application records again")}));expect(reload).toHaveBeenCalledTimes(1);
 view.rerender(<ParentLocaleProvider initialLocale={locale}><ApplicationWorkspace request={{...request,status:"paused"}} history={{data,loading:false,error:null,reload}}>{null}</ApplicationWorkspace></ParentLocaleProvider>);
 expect(screen.getByText(text(locale,"Work is paused or finished"))).toBeTruthy();
});
it("keeps a utility-only interface on its existing language boundary",async()=>{
 api();render(<ParentLocaleProvider initialLocale="es"><ParentIntake initialNeed="electricity"/></ParentLocaleProvider>);
 expect((await screen.findByLabelText("Household ZIP code")).closest("form")?.lang).toBe("en");
});

it.each(languages)("localizes food partner source notices but preserves original directory wording in %s",async locale=>{
 const request=fixtureRequest();request.intake.needs=["snap_pending"];request.mandate.recipientIds=["snap-pa"];
 vi.stubGlobal("fetch",vi.fn(async()=>response({partners:[{legacyResourceId:"synthetic",name:"Original directory wording",officialUrl:"https://example.invalid/original",programIds:["snap-pa"],sourceCheckedAt:"2026-11-01",directoryUpdatedAt:"2026-11-02T12:00:00Z"}]})));
 render(<ParentLocaleProvider initialLocale={locale}><SupportPartners request={request}/></ParentLocaleProvider>);
 expect(await screen.findByRole("heading",{name:locale==="es"?"Programas asociados existentes de CaseLink":"Existing CaseLink partners"})).toBeTruthy();
 expect(screen.getByRole("link",{name:"Original directory wording"}).getAttribute("href")).toBe("https://example.invalid/original");
 expect(screen.getByRole("link",{name:"Original directory wording"}).closest("[lang]")?.getAttribute("lang")).toBe("");
 expect(screen.getByText(text(locale,"Existing partner · direct contact available · automated delivery not connected"))).toBeTruthy();
});

it.each(languages)("keeps original recorded program wording and its source language separate in %s",async locale=>{
 const request=fixtureRequest();request.intake.needs=["snap_pending"];request.events=[];request.documents=[];
 request.plan={version:1,summary:"Original recorded wording",generatedAt:request.created_at,model:null,routes:[{need:"snap_pending",programId:"snap-pa",state:"prepared",title:"Original source title",summary:"Original provider wording remains exact.",limitation:null,nextActor:"agency",officialUrl:"https://example.invalid",sourceUrl:"https://example.invalid",steps:["Original provider instruction remains exact."]}]};
 vi.stubGlobal("fetch",vi.fn(async()=>response({request,operations:[],historyLimited:false})));
 render(<ParentLocaleProvider initialLocale={locale}><SupportDetail requestId={request.id}/></ParentLocaleProvider>);
 const nav=await screen.findByRole("navigation",{name:text(locale,"Your application checklist")});fireEvent.click(nav.querySelector('a[href="#application-programs"]')!);
 expect(screen.getByText("Original provider wording remains exact.").getAttribute("lang")).toBe("");
 expect(screen.getByText("Original provider instruction remains exact.").getAttribute("lang")).toBe("");
 if(locale==="es")expect(screen.getByText("El texto original registrado se conserva en el idioma de su fuente.")).toBeTruthy();
});

describe("v2 connected receipt and mixed-food language boundaries",()=>{
 it.each((["agency_submitted","assistance_approved","support_received","declined"] as const).flatMap(state=>languages.map(locale=>({state,locale}))))("localizes no-plan $state receipt next step in $locale",async({state,locale})=>{
  const request=fixtureRequest();request.intake.needs=["snap_new"];request.events=[];request.documents=[];
  const operation={id:"synthetic-receipt",program_id:"snap-pa",need:"snap_new",request_version:request.version,state,created_at:request.created_at,evidence:{source:"agency_receipt",reference:"Original synthetic agency reference",recordedAt:request.created_at}};
  vi.stubGlobal("fetch",vi.fn(async(url:string)=>response(url.endsWith("/operations")?{operations:[operation],historyLimited:false}:{request,operations:[],historyLimited:false})));
  render(<ParentLocaleProvider initialLocale={locale}><SupportDetail requestId={request.id}/></ParentLocaleProvider>);
  const nav=await screen.findByRole("navigation",{name:text(locale,"Your application checklist")});fireEvent.click(nav.querySelector('a[href="#application-programs"]')!);
  const section=document.getElementById("application-programs")!;
  const next={agency_submitted:"Agency response",assistance_approved:"Program follow-up",support_received:"No further step recorded",declined:"Review the recorded decision and follow-up"}[state];
  expect(await within(section).findByText(next===text(locale,next)?next:text(locale,next),{exact:true})).toBeTruthy();
  expect(section.querySelector("li")?.textContent).toContain(text(locale,OUTCOME_LABELS[state]));
 });
 it.each(([ ["food_now","wic_new"], ["snap_pending","wic_continuing"] ] as const).flatMap(needs=>languages.map(locale=>({needs,locale}))))("localizes mixed food/WIC packet and report controls in $locale ($needs)",({needs,locale})=>{
  const request=fixtureRequest();request.intake.needs=[...needs];request.mandate.recipientIds=[];
  render(<ParentLocaleProvider initialLocale={locale}><SupportActivity request={request} onChange={vi.fn()} history={{data:{operations:[{id:"mixed",program_id:"wic-pa",need:"wic_new",state:"prepared",created_at:request.created_at}],historyLimited:false},loading:false,error:null,reload:vi.fn()}}/></ParentLocaleProvider>);
  expect(screen.getByRole("heading",{name:text(locale,"Recorded packets & receipts")}).closest("[lang]")?.getAttribute("lang")).toBe(locale);
  expect(screen.getByLabelText(text(locale,"What did you receive or hear, and when?"))).toBeTruthy();
 });
 it.each(languages)("marks the original known packet program name English in %s",locale=>{
  const request=fixtureRequest();request.intake.needs=["snap_pending"];
  render(<ParentLocaleProvider initialLocale={locale}><SupportActivity request={request} onChange={vi.fn()} history={{data:{operations:[{id:"marker",program_id:"snap-pa",need:"snap_pending",state:"prepared",created_at:request.created_at}],historyLimited:false},loading:false,error:null,reload:vi.fn()}}/></ParentLocaleProvider>);
  expect(screen.getByText(getProgram("snap-pa")!.name).getAttribute("lang")).toBe("en");
 });
 it.each(languages)("keeps the known original program title English in %s",async locale=>{
  const request=fixtureRequest();request.intake.needs=["snap_pending"];request.events=[];request.documents=[];
  const program=getProgram("snap-pa")!;request.plan={version:1,summary:"Plan",generatedAt:request.created_at,model:null,routes:[{need:"snap_pending",programId:program.id,state:"prepared",title:program.name,summary:program.description,limitation:null,nextActor:"caselink",officialUrl:program.officialUrl,sourceUrl:program.sourceUrl,steps:[]}]};
  vi.stubGlobal("fetch",vi.fn(async()=>response({request,operations:[],historyLimited:false})));
  render(<ParentLocaleProvider initialLocale={locale}><SupportDetail requestId={request.id}/></ParentLocaleProvider>);
  const nav=await screen.findByRole("navigation",{name:text(locale,"Your application checklist")});fireEvent.click(nav.querySelector('a[href="#application-programs"]')!);
  expect(within(document.getElementById("application-programs")!).getByText(program.name).getAttribute("lang")).toBe("en");
 });
});

describe("v3 running and queued progress source language",()=>{
 const summary="CaseLink is working on an authorized planning step. Only recorded receipts confirm an external action.";
 it.each(languages.flatMap(locale=>(["running","queued"] as const).map(state=>({locale,state}))))("localizes a known $state summary before composing its $locale explanation",({locale,state})=>{
  const request=fixtureRequest();request.intake.needs=["food_now"];
  render(<ParentLocaleProvider initialLocale={locale}><ApplicationWorkspace request={request} progress={{state,summary,updatedAt:request.updated_at,nextRunAt:null,canContinueAfterClosing:true}} history={{data:{operations:[],historyLimited:false},loading:false,error:null,reload:vi.fn()}}>{null}</ApplicationWorkspace></ParentLocaleProvider>);
  const detail=screen.getByText((_,node)=>node?.tagName==="P"&&!!node.textContent?.startsWith(text(locale,summary)));
  expect(detail.closest("[lang]")?.getAttribute("lang")).toBe(locale);
  if(state==="running") { expect(detail.textContent).toContain(text(locale,"Program progress shows recorded next steps. Opening a public website does not mean CaseLink is filling in or submitting an application.")); expect(detail.textContent).not.toContain(text(locale,"The Official website section shows the official site connection and any recorded blocker.")); }
 });
 it.each(languages.flatMap(locale=>(["running","queued"] as const).map(state=>({locale,state}))))("preserves unknown $state narrative and language in $locale",({locale,state})=>{
  const request=fixtureRequest();request.intake.needs=["snap_pending"];
  const original='Family quote: “CaseLink is working on an authorized planning step.”';
  render(<ParentLocaleProvider initialLocale={locale}><ApplicationWorkspace request={request} progress={{state,summary:original,updatedAt:request.updated_at,nextRunAt:null,canContinueAfterClosing:false}} history={{data:{operations:[],historyLimited:false},loading:false,error:null,reload:vi.fn()}}>{null}</ApplicationWorkspace></ParentLocaleProvider>);
  expect(screen.getByText(original,{exact:true}).getAttribute("lang")).toBe("");
 });
});

it.each(languages)("keeps the real official-website running explanation for new SNAP in %s",locale=>{
 api();const request=fixtureRequest();request.intake.needs=["snap_new"];
 const summary="CaseLink is working on an authorized planning step. Only recorded receipts confirm an external action.";
 render(<ParentLocaleProvider initialLocale={locale}><ApplicationWorkspace request={request} progress={{state:"running",summary,updatedAt:request.updated_at,nextRunAt:null,canContinueAfterClosing:true}} history={{data:{operations:[],historyLimited:false},loading:false,error:null,reload:vi.fn()}}>{null}</ApplicationWorkspace></ParentLocaleProvider>);
 const detail=screen.getByText((_,node)=>node?.tagName==="P"&&!!node.textContent?.startsWith(text(locale,summary)));
 expect(detail.textContent).toContain(text(locale,"The Official website section shows the official site connection and any recorded blocker."));
});
