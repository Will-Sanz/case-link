// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupportRequest } from "@/lib/parent/domain";
import { SNAP_APPLICATION_NOTICE_VERSION } from "@/lib/parent/constants";
import { SNAP_APPLICATION_SOURCE, type SnapApplicationFields } from "@/lib/parent/snap-application-fields";
import { snapApplicationLeaves, type SnapApplicationSnapshot } from "@/lib/parent/snap-application-snapshot";
import { buildMandate, initialIntake } from "./intake";
import { SnapApplicationNotice, SnapApplicationReview } from "./snap-application-review";
import styles from "./parent.module.css";
const prepared = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("./snap-protected-application", () => ({ SnapProtectedApplication: (props: unknown) => { prepared.render(props); return <div role="region" aria-label="Prepared SNAP application fixture"/>; } }));

const requestId="11111111-1111-4111-8111-111111111111",snapshotId="22222222-2222-4222-8222-222222222222",personId="33333333-3333-4333-8333-333333333333";
function request(): SupportRequest {
  const intake={...initialIntake,zip:"19104",needs:["snap_new"] as SupportRequest["intake"]["needs"]};
  return {id:requestId,household_id:personId,status:"active",intake,mandate:buildMandate(intake,["snap-pa"],"prepare_only","ask_me","2099-12-01T12:00:00Z"),plan:null,required_actions:[],version:2,created_at:"2026-11-03T12:00:00Z",updated_at:"2026-11-03T12:00:00Z",documents:[]};
}
function snapshot(): SnapApplicationSnapshot {
  const details={applicant:{firstName:"Maria",lastName:"Rivera"},household:[{id:personId,firstName:"Maria",lastName:"Rivera",relationship:"SELF"}],zip:"19104",income:{month:"2026-10",hasIncome:false}};
  return {id:snapshotId,request_id:requestId,revision:1,base_version:1,request_version:2,details,
    provenance:Object.fromEntries(Object.keys(snapApplicationLeaves(details)).map(path=>[path,{source:"parent" as const,confirmedAt:"2026-11-03T12:00:00Z",asOf:"2026-11-03",...(path.startsWith('income.')?{period:'2026-10'}:{})}])),
    source:SNAP_APPLICATION_SOURCE,notice_version:SNAP_APPLICATION_NOTICE_VERSION,created_at:"2026-11-03T12:00:00+00:00",idempotency_key:personId};
}
function completeSnapshot(stale: string[] = []): SnapApplicationSnapshot {
  const details: SnapApplicationFields = {applicant:{firstName:'Maria',lastName:'Rivera'},address:{street:'123 Synthetic Lane',city:'Philadelphia',state:'PA'},zip:'19104',county:'Philadelphia',language:'en',interpreter:false,
    household:[{id:personId,firstName:'Maria',lastName:'Rivera',relationship:'SELF',dateOfBirth:'1988-04-15',sex:'female',student:false,requestingSnap:true,citizen:true}],
    income:{month:'2026-11',hasIncome:false},screening:{lowCashAndIncome:false,migrantOrSeasonal:false,belowShelterCosts:false},
    history:{fleeingOrProbation:{answer:false},welfareFraud:{answer:false},otherStateDisqualification:{answer:false}},expenseClaims:{household:'do_not_claim',medical:'not_applicable'}};
  return withDetails(details,stale);
}
function withDetails(details: SnapApplicationFields, stale: string[] = []): SnapApplicationSnapshot {
  return {...snapshot(),details,provenance:Object.fromEntries(Object.keys(snapApplicationLeaves(details)).map(path=>[path,{source:'parent' as const,
    confirmedAt:stale.includes(path)?'2026-09-01T12:00:00Z':'2026-11-03T12:00:00Z',asOf:stale.includes(path)?'2026-09-01':'2026-11-03',...(path.startsWith('income.')?{period:details.income!.month}:{})}]))};
}
const json=(body:unknown,status=200)=>({ok:status<400,status,json:async()=>body});
const authorization=(enabled=true)=>({authorization:{issuedAt:"2026-11-03T12:00:00Z",expiresAt:"2099-12-01T12:00:00Z",snapApplication:{collectionEnabled:enabled,noticeVersion:enabled?SNAP_APPLICATION_NOTICE_VERSION:null}}});
function api(options:{saved?:unknown;gate?:unknown;getStatus?:number;post?:(init:RequestInit)=>unknown}={}){
  const fetch=vi.fn(async(url:string,init?:RequestInit)=>{
    if(url.endsWith("/authorization-window"))return json(options.gate??authorization());
    if(init?.method==="POST")return options.post ? options.post(init) : json({ok:true,snapshotId:"44444444-4444-4444-8444-444444444444"});
    return json({ok:!options.getStatus,snapshot:options.saved??snapshot(),error:"This saved application is unavailable."},options.getStatus??200);
  });vi.stubGlobal("fetch",fetch);return fetch;
}
beforeEach(()=>{prepared.render.mockClear();vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-03T15:00:00Z'));});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.useRealTimers();});
describe("owned exact SNAP application review",()=>{
  it('shows the next personal step before the full saved-answer recap',async()=>{
    api({saved:completeSnapshot()});render(<SnapApplicationReview request={request()}/>);
    const personal=await screen.findByRole('region',{name:'Prepared SNAP application fixture'});
    const summary=screen.getByRole('region',{name:'Applicant and contact summary'});
    expect(personal.compareDocumentPosition(summary)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it('corrects only the address without asking for unchanged application answers again',async()=>{
    const saved=completeSnapshot(),fetch=api({saved});render(<SnapApplicationReview request={request()}/>);
    fireEvent.click(await screen.findByRole('button',{name:'Change address'}));
    await waitFor(()=>expect(document.activeElement).toBe(screen.getByLabelText('Your address')));
    expect(screen.queryByLabelText('Your first name')).toBeNull();expect(screen.queryByLabelText('Your date of birth')).toBeNull();
    expect(screen.queryByLabelText('Does anyone have income received or expected this month?')).toBeNull();
    expect(screen.queryByText('A telephone is optional. Leave it blank if none is available.')).toBeNull();
    expect((screen.getByLabelText('ZIP code') as HTMLInputElement).value).toBe('19104');
    fireEvent.change(screen.getByLabelText('Your address'),{target:{value:'2 Example Street'}});
    fireEvent.click(screen.getByRole('button',{name:'Save application changes'}));await screen.findByText(/application answers are saved as a new revision/);
    const body=JSON.parse(fetch.mock.calls.find(([,init])=>init?.method==='POST')![1]!.body as string);
    expect(body.details).toEqual({...saved.details,address:{...saved.details.address,street:'2 Example Street'}});
    expect(body.expectedVersion).toBe(2);expect(body.confirmedPaths).toBeUndefined();
  });
  it('keeps an address correction when opening other saved answers and canceling preserves the original',async()=>{
    const fetch=api({saved:completeSnapshot()});render(<SnapApplicationReview request={request()}/>);
    fireEvent.click(await screen.findByRole('button',{name:'Change address'}));
    fireEvent.change(screen.getByLabelText('Your address'),{target:{value:'2 Example Street'}});
    fireEvent.click(screen.getByRole('button',{name:'Change other saved answers'}));
    expect(screen.getByLabelText('Your first name')).toBeTruthy();expect((screen.getByLabelText('Your address') as HTMLInputElement).value).toBe('2 Example Street');
    fireEvent.click(screen.getByRole('button',{name:'Cancel editing'}));
    expect(screen.getByText('123 Synthetic Lane, Philadelphia, PA, 19104')).toBeTruthy();
    expect(fetch.mock.calls.some(([,init])=>init?.method==='POST')).toBe(false);
  });
  it.each(['paused','permission','expired'] as const)('offers no address correction when %s',async kind=>{
    const value=request();if(kind==='paused')value.status='paused';if(kind==='expired')value.mandate.expiresAt='2026-11-01T00:00:00Z';
    api({saved:completeSnapshot(),gate:authorization(kind!=='permission')});render(<SnapApplicationReview request={value}/>);
    await screen.findByText('123 Synthetic Lane, Philadelphia, PA, 19104');
    expect(screen.queryByRole('button',{name:'Change address'})).toBeNull();
  });

  it.each(['fetch','body'] as const)('bounds a stalled correction %s and retains the same frozen retry',async kind=>{
    vi.useFakeTimers();
    const fetch=api({post:()=>kind==='fetch'?new Promise(()=>{}):{ok:true,status:201,json:()=>new Promise(()=>{})}});
    render(<SnapApplicationReview request={request()}/>);await act(async()=>{});fireEvent.click(screen.getByRole('button',{name:'Correct application answers'}));
    fireEvent.change(screen.getByLabelText('Your first name'),{target:{value:'Retained'}});fireEvent.click(screen.getByRole('button',{name:'Save application changes'}));
    await act(async()=>{await vi.advanceTimersByTimeAsync(30000);});
    expect(screen.getByRole('button',{name:'Retry the same save'})).toBeTruthy();expect((screen.getByLabelText('Your first name') as HTMLInputElement).value).toBe('Retained');
    fireEvent.click(screen.getByRole('button',{name:'Retry the same save'}));
    const posts=fetch.mock.calls.filter(([,init])=>init?.method==='POST').map(([,init])=>init!);
    expect(posts).toHaveLength(2);expect(posts[0].body).toBe(posts[1].body);expect(posts[0].headers).toEqual(posts[1].headers);
  });
  it('closes correction controls at the known mandate expiry without a poll',async()=>{
    vi.useFakeTimers();
    const value=request();value.mandate.expiresAt=new Date(Date.now()+1000).toISOString();const fetch=api();
    render(<SnapApplicationReview request={value}/>);await act(async()=>{});fireEvent.click(screen.getByRole('button',{name:'Correct application answers'}));
    await act(async()=>{await vi.advanceTimersByTimeAsync(1000);});
    expect(screen.queryByLabelText('Your first name')).toBeNull();expect(screen.getByText(/permission has expired/i)).toBeTruthy();
    expect(fetch.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(0);
  });
  it.each(['version','unmount'] as const)('ignores a late correction reply after %s changes',async kind=>{
    let finish!:(value:unknown)=>void;const onChange=vi.fn();api({post:()=>new Promise(resolve=>{finish=resolve;})});
    const view=render(<SnapApplicationReview request={request()} onChange={onChange}/>);fireEvent.click(await screen.findByRole('button',{name:'Correct application answers'}));
    fireEvent.click(screen.getByRole('button',{name:'Save application changes'}));
    if(kind==='unmount')view.unmount();else{
      view.rerender(<SnapApplicationReview request={{...request(),version:3}} onChange={onChange}/>);
      fireEvent.click(await screen.findByRole('button',{name:'Load latest saved application'}));fireEvent.click(await screen.findByRole('button',{name:'Correct application answers'}));
      fireEvent.change(screen.getByLabelText('Your first name'),{target:{value:'Current draft'}});
    }
    await act(async()=>{finish(json({ok:true,snapshotId}));});expect(onChange).toHaveBeenCalledTimes(kind==='version'?1:0);
    if(kind==='version')expect((screen.getByLabelText('Your first name') as HTMLInputElement).value).toBe('Current draft');
  });
  it('preserves a pending correction across same-value background request clones',async()=>{
    let finish!:(value:unknown)=>void;const onChange=vi.fn();const fetch=api({post:()=>new Promise(resolve=>{finish=resolve;})});
    const value=request(),view=render(<SnapApplicationReview request={value} onChange={onChange}/>);fireEvent.click(await screen.findByRole('button',{name:'Correct application answers'}));
    fireEvent.click(screen.getByRole('button',{name:'Save application changes'}));
    view.rerender(<SnapApplicationReview request={{...structuredClone(value),updated_at:'2026-11-03T15:01:00Z'}} onChange={onChange}/>);
    expect(screen.getByRole('button',{name:'Saving application answers…'})).toBeTruthy();
    await act(async()=>{finish(json({ok:true,snapshotId}));});expect(onChange).toHaveBeenCalledOnce();expect(fetch.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);
  });
  it('does not revive a cancelled pending save when its previous permission scope returns',async()=>{
    let finish!:(value:unknown)=>void;const changed=vi.fn(),fetch=api({post:()=>new Promise(resolve=>{finish=resolve;})});
    const value=request(),view=render(<SnapApplicationReview request={value} onChange={changed}/>);
    fireEvent.click(await screen.findByRole('button',{name:'Correct application answers'}));fireEvent.click(screen.getByRole('button',{name:'Save application changes'}));
    view.rerender(<SnapApplicationReview request={{...value,mandate:{...value.mandate,expiresAt:new Date(Date.parse(value.mandate.expiresAt)-1000).toISOString()}}} onChange={changed}/>);
    view.rerender(<SnapApplicationReview request={value} onChange={changed}/>);
    expect(screen.queryByRole('button',{name:'Saving application answers…'})).toBeNull();
    expect(screen.getByRole('button',{name:'Retry the same save'}).matches(':disabled')).toBe(false);
    expect(fetch.mock.calls.find(([,init])=>init?.method==='POST')![1]!.signal?.aborted).toBe(true);
    await act(async()=>{finish(json({ok:true,snapshotId}));});expect(changed).not.toHaveBeenCalled();
  });
  it('bounds a stalled private-access recheck without discarding the retained draft',async()=>{
    const fetch=api({post:()=>json({ok:false,error:'Permission changed.'},403)});render(<SnapApplicationReview request={request()}/>);
    fireEvent.click(await screen.findByRole('button',{name:'Correct application answers'}));fireEvent.change(screen.getByLabelText('Your first name'),{target:{value:'Retained'}});
    fireEvent.click(screen.getByRole('button',{name:'Save application changes'}));await screen.findByRole('button',{name:'Check private application access again'});
    const original=fetch.getMockImplementation()!;fetch.mockImplementation(async(url:string,init?:RequestInit)=>url.endsWith('/authorization-window')?new Promise(()=>{}):original(url,init));
    vi.useFakeTimers();fireEvent.click(screen.getByRole('button',{name:'Check private application access again'}));await act(async()=>{await vi.advanceTimersByTimeAsync(30000);});
    expect(screen.getByRole('button',{name:'Check private application access again'}).matches(':disabled')).toBe(false);expect(fetch.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);
  });
  it('mounts prepared-file return review only for current complete saved answers, without requesting intake again',async()=>{
    const saved=completeSnapshot(),changed=vi.fn();const fetch=api({saved});render(<SnapApplicationReview request={request()} onChange={changed}/>);
    await screen.findByRole('region',{name:'Prepared SNAP application fixture'});
    expect(prepared.render).toHaveBeenLastCalledWith(expect.objectContaining({request:expect.objectContaining({id:requestId,version:2}),snapshot:saved,onChange:changed}));
    expect(fetch.mock.calls.some(([,init])=>init?.method==='POST')).toBe(false);
    fireEvent.click(screen.getByRole('button',{name:'Correct application answers'}));
    expect(screen.queryByRole('region',{name:'Prepared SNAP application fixture'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Cancel editing'}));
    await screen.findByRole('region',{name:'Prepared SNAP application fixture'});
  });
  it.each(['incomplete','stale','closed','canonical','resolved_canonical'] as const)('does not mount prepared-file review for %s answers or scope',async kind=>{
    const saved=kind==='incomplete'?snapshot():completeSnapshot(kind==='stale'?['county']:[]),value=request();
    if(kind==='canonical'||kind==='resolved_canonical')value.required_actions=[{id:'synthetic-final-review',need:'snap_new',reason:'submission_review',field:'snap_final_submit',resolver:'parent',title:'Review application',explanation:'Synthetic canonical review fixture',...(kind==='resolved_canonical'?{resolved:true}:{})}];
    const fetch=api({saved,gate:authorization(kind!=='closed')});render(<SnapApplicationReview request={value}/>);
    await screen.findByText(/Saved revision 1/);
    expect(prepared.render).not.toHaveBeenCalled();expect(screen.queryByRole('region',{name:'Prepared SNAP application fixture'})).toBeNull();
    expect(fetch.mock.calls.some(([,init])=>init?.method==='POST')).toBe(false);
  });
  it('keeps the notice prose and inline links in one paragraph inside the shared flex notice',()=>{
    render(<SnapApplicationNotice/>);
    const paragraph=screen.getByRole('link',{name:'SNAP data notice'}).closest('p');
    expect(paragraph?.parentElement?.classList.contains(styles.notice)).toBe(true);
    expect(paragraph?.classList.contains(styles.notice)).toBe(false);
    expect(paragraph?.contains(screen.getByRole('link',{name:'reviewed Pennsylvania SNAP form'}))).toBe(true);
    expect(paragraph?.textContent).toContain('CaseLink saves these answers');
  });
  it('opens only the missing application question and focuses its existing control',async()=>{
    const value=completeSnapshot();delete value.details.county;delete value.provenance.county;
    const fetch=api({saved:value});render(<SnapApplicationReview request={request()} answerRequest={1}/>);
    const county=await screen.findByLabelText('County');await waitFor(()=>expect(document.activeElement).toBe(county));
    expect(screen.queryByLabelText('Your first name')).toBeNull();expect(screen.queryByLabelText('Your date of birth')).toBeNull();expect(screen.queryByRole('button',{name:/Still correct/})).toBeNull();
    fireEvent.change(county,{target:{value:'Philadelphia'}});fireEvent.click(screen.getByRole('button',{name:'Save application changes'}));await screen.findByText(/application answers are saved as a new revision/);
    const [url,init]=fetch.mock.calls.find(([,init])=>init?.method==='POST')!;expect(url).toContain('/snap-application');
    const body=JSON.parse(init!.body as string);expect(body.action).toBeUndefined();expect(body.confirmedPaths).toBeUndefined();expect(body.expectedVersion).toBe(2);
  });
  it('confirms only the genuinely stale SELF alias without renewing a fresh applicant name',async()=>{
    const stale=`household.${personId}.firstName`,fetch=api({saved:completeSnapshot([stale])});
    render(<SnapApplicationReview request={request()} answerRequest={1}/>);await screen.findByLabelText('Your first name');
    expect(screen.getAllByLabelText('Your first name')).toHaveLength(1);expect(screen.queryByLabelText('Your last name')).toBeNull();expect(screen.queryByLabelText('Your date of birth')).toBeNull();
    expect(document.body.textContent).not.toContain(personId);expect(screen.queryByLabelText(/People in your household|relationship to the applicant/)).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Still correct: Your first name'}));fireEvent.click(screen.getByRole('button',{name:'Save application changes'}));await screen.findByText(/application answers are saved as a new revision/);
    const body=JSON.parse(fetch.mock.calls.find(([,init])=>init?.method==='POST')![1]!.body as string);
    expect(body.confirmedPaths).toEqual([stale]);expect(body.details.applicant.firstName).toBe('Maria');expect(body.details.household[0].firstName).toBe('Maria');
  });
  it('maps both stale applicant and SELF names to one still-correct answer and freezes its exact retry',async()=>{
    const paths=['applicant.firstName',`household.${personId}.firstName`];let posts=0;
    const fetch=api({saved:completeSnapshot(paths),post:()=>{if(++posts===1)throw new Error('lost response');return json({snapshotId});}});
    render(<SnapApplicationReview request={request()} answerRequest={1}/>);fireEvent.click(await screen.findByRole('button',{name:'Still correct: Your first name'}));
    fireEvent.click(screen.getByRole('button',{name:'Save application changes'}));await screen.findByRole('button',{name:'Retry the same save'});
    expect(screen.getByRole('button',{name:'Still correct: Your first name'}).matches(':disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'Retry the same save'}));await screen.findByText(/application answers are saved as a new revision/);
    const attempts=fetch.mock.calls.filter(([,init])=>init?.method==='POST').map(([,init])=>init!);expect(attempts[0].body).toBe(attempts[1].body);expect(attempts[0].headers).toEqual(attempts[1].headers);
    expect(JSON.parse(attempts[0].body as string).confirmedPaths).toEqual(paths);
  });
  it('uses stable person and payment paths without displaying them or repeating fresh sibling facts',async()=>{
    const otherId='55555555-5555-4555-8555-555555555555',incomeId='66666666-6666-4666-8666-666666666666';
    const value=completeSnapshot();value.details.household!.push({id:otherId,firstName:'Leo',lastName:'Rivera',relationship:'Child',dateOfBirth:'2018-04-15',sex:'male',student:true,requestingSnap:false});
    value.details.income={month:'2026-11',hasIncome:true,entries:[{id:incomeId,personId:otherId,source:'Gift',amount:20,frequency:'Once',status:'received'}]};
    const path=`household.${otherId}.relationship`,fetch=api({saved:withDetails(value.details,[path])});
    render(<SnapApplicationReview request={request()} answerRequest={1}/>);
    await screen.findByLabelText('Person 2 relationship to you');expect(screen.queryByLabelText('Person 2 first name')).toBeNull();expect(screen.queryByLabelText('Your first name')).toBeNull();
    expect(screen.queryByLabelText('Payment 1 amount before taxes ($)')).toBeNull();expect(screen.queryByLabelText('Payment 1 type or source')).toBeNull();
    expect(document.body.textContent).not.toContain(otherId);expect(document.body.textContent).not.toContain(incomeId);
    fireEvent.click(screen.getByRole('button',{name:'Still correct: Person 2 relationship to you'}));
    fireEvent.change(screen.getByLabelText('Payment 1 actual or expected date'),{target:{value:'2026-11-02'}});
    fireEvent.click(screen.getByRole('button',{name:'Save application changes'}));await screen.findByText(/application answers are saved as a new revision/);
    const body=JSON.parse(fetch.mock.calls.find(([,init])=>init?.method==='POST')![1]!.body as string);
    expect(body.confirmedPaths).toEqual([path]);expect(body.details.income.entries[0]).toMatchObject({id:incomeId,personId:otherId,amount:20,date:'2026-11-02'});
  });
  it('uses the real array choice control for a stale utilities answer without requesting fresh expense facts',async()=>{
    const value=completeSnapshot();value.details.expenseClaims={household:'claim',housing:[],medical:'not_applicable'};
    value.details.expenses={childSupport:false,mealsIncludedInRent:false,heat:false,housingAssistance:false,outsidePayer:false,airConditioning:false,care:false,utilities:['electric']};
    const fetch=api({saved:withDetails(value.details,['expenses.utilities'])});render(<SnapApplicationReview request={request()} answerRequest={1}/>);
    await screen.findByLabelText('Electric');expect((screen.getByLabelText('Electric') as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByLabelText('Do you pay for heat?')).toBeNull();expect(screen.queryByLabelText('Medical expense deduction')).toBeNull();expect(screen.queryByLabelText('Rent')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Still correct: Utilities paid each month, even partly'}));fireEvent.click(screen.getByRole('button',{name:'Save application changes'}));await screen.findByText(/application answers are saved as a new revision/);
    expect(JSON.parse(fetch.mock.calls.find(([,init])=>init?.method==='POST')![1]!.body as string).confirmedPaths).toEqual(['expenses.utilities']);
  });
  it('requires new current-month income answers instead of reaffirming or retagging old payments',async()=>{
    const value=completeSnapshot();value.details.income={month:'2026-10',hasIncome:true,entries:[{id:snapshotId,personId,source:'Employment',amount:250,frequency:'Weekly',status:'received',date:'2026-10-20'}]};
    const fetch=api({saved:withDetails(value.details)});render(<SnapApplicationReview request={request()} answerRequest={1}/>);
    await screen.findByText(/saved income answers are for 2026-10/);expect(screen.queryByRole('button',{name:/Still correct/})).toBeNull();expect(screen.queryByLabelText('Payment 1 amount before taxes ($)')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Enter this month’s income'}));
    fireEvent.change(screen.getByLabelText('Does anyone have income received or expected this month?'),{target:{value:'no'}});
    fireEvent.click(screen.getByRole('button',{name:'Save application changes'}));await screen.findByText(/application answers are saved as a new revision/);
    const body=JSON.parse(fetch.mock.calls.find(([,init])=>init?.method==='POST')![1]!.body as string);expect(body.details.income).toEqual({month:'2026-11',hasIncome:false});expect(body.confirmedPaths).toBeUndefined();
    expect(value.details.income.entries![0].date).toBe('2026-10-20');expect(value.details.income.month).toBe('2026-10');
  });
  it('reveals newly applicable missing answers when an outdated history answer changes',async()=>{
    api({saved:completeSnapshot(['history.welfareFraud.answer'])});render(<SnapApplicationReview request={request()} answerRequest={1}/>);
    fireEvent.change(await screen.findByLabelText('Has anyone been convicted of welfare fraud?'),{target:{value:'yes'}});
    expect(screen.getByLabelText('Names for the welfare fraud answer')).toBeTruthy();expect(screen.getByLabelText('Date for the welfare fraud answer')).toBeTruthy();expect(screen.getByLabelText('State for the welfare fraud answer')).toBeTruthy();
    expect(screen.queryByRole('button',{name:'Still correct: Has anyone been convicted of welfare fraud?'})).toBeNull();
  });
  it('does not expose or edit values whose snapshot provenance is incomplete',async()=>{
    api({saved:{...completeSnapshot(),provenance:{}}});render(<SnapApplicationReview request={request()} answerRequest={1}/>);
    await screen.findByText(/verified saved application revision is unavailable/);expect(document.body.textContent).not.toContain('Maria');expect(screen.queryByLabelText('Your first name')).toBeNull();
  });
  it('does not ask fresh facts again when a saved worker question is already satisfied',async()=>{
    const fetch=api({saved:completeSnapshot()});render(<SnapApplicationReview request={request()} answerRequest={1}/>);
    await screen.findByText(/No additional application answers are currently needed/);expect(screen.queryByRole('form',{name:'Correct SNAP application answers'})).toBeNull();
    expect(fetch.mock.calls.some(([,init])=>init?.method==='POST')).toBe(false);
  });
  it("shows the owned current revision and original period without an approve or invented Submit action",async()=>{
    api();render(<SnapApplicationReview request={request()}/>);
    await screen.findByText(/Saved revision 1/);
    expect(screen.getByText(/Matches your current request/)).toBeTruthy();
    expect(screen.getByText("2026-10")).toBeTruthy();
    expect(screen.queryByRole("button",{name:/submit|approve/i})).toBeNull();
    expect(screen.getByText(/Saving answers does not submit an application/)).toBeTruthy();
    expect(document.body.textContent).not.toContain(personId);
  });
  it.each([authorization(false),{}, {authorization:{snapApplication:{collectionEnabled:true,noticeVersion:"unknown"}}}])("keeps saved answers readable but renders no editing fields when collection is closed or unproved %j",async gate=>{
    api({gate});render(<SnapApplicationReview request={request()}/>);
    await screen.findByText(/Saved revision 1/);
    expect(screen.queryByRole("button",{name:"Correct application answers"})).toBeNull();
    expect(screen.queryByLabelText("Your first name")).toBeNull();
    expect(screen.getByText("19104",{exact:false})).toBeTruthy();
  });
  it("does not show a different request's private values",async()=>{
    api({saved:{...snapshot(),request_id:personId}});render(<SnapApplicationReview request={request()}/>);
    await screen.findByText(/verified saved application revision is unavailable/);
    expect(document.body.textContent).not.toContain("Maria");
  });
  it("permits the freshly checked latest answers after ordinary request versions change",async()=>{
    api();render(<SnapApplicationReview request={{...request(),version:3}}/>);
    await screen.findByText(/Latest saved answers checked for this request/);
    expect(screen.getByRole("button",{name:"Correct application answers"})).toBeTruthy();
  });
  it("keeps a snapshot belonging to a newer request version read-only",async()=>{
    api({saved:{...snapshot(),request_version:3}});render(<SnapApplicationReview request={request()}/>);
    await screen.findByText(/Updated request is loading/);
    expect(screen.queryByRole("button",{name:"Correct application answers"})).toBeNull();
    expect(screen.queryByLabelText("Your first name")).toBeNull();
  });
  it("rechecks the latest private snapshot after pause and resume and saves with the current request version",async()=>{
    const fetch=api();const view=render(<SnapApplicationReview request={request()}/>);
    await screen.findByRole('button',{name:'Correct application answers'});
    view.rerender(<SnapApplicationReview request={{...request(),version:3,status:'paused'}}/>);
    await screen.findByText(/Latest saved answers checked for this request/);expect(screen.queryByRole('button',{name:'Correct application answers'})).toBeNull();
    view.rerender(<SnapApplicationReview request={{...request(),version:4}}/>);
    fireEvent.click(await screen.findByRole('button',{name:'Correct application answers'}));fireEvent.change(screen.getByLabelText('Your first name'),{target:{value:'Marie'}});
    fireEvent.click(screen.getByRole('button',{name:'Save application changes'}));await screen.findByText(/application answers are saved as a new revision/);
    const [,init]=fetch.mock.calls.find(([,init])=>init?.method==='POST')!;const body=JSON.parse(init!.body as string);
    expect(body.expectedVersion).toBe(4);expect(body.details.income.month).toBe('2026-10');
    expect(fetch.mock.calls.some(([url])=>url.includes('requestVersion=3'))).toBe(true);
    expect(fetch.mock.calls.some(([url])=>url.includes('requestVersion=4'))).toBe(true);
  });
  it("ignores an old in-flight snapshot response after a newer private correction is loaded",async()=>{
    let releaseOld!:(value:unknown)=>void;const old=new Promise(resolve=>{releaseOld=resolve;});
    const newer={...snapshot(),id:'44444444-4444-4444-8444-444444444444',revision:2,request_version:4,
      details:{...snapshot().details,applicant:{firstName:'Nora',lastName:'Rivera'},household:[{...snapshot().details.household![0],firstName:'Nora'}]}};
    const fetch=api();fetch.mockImplementation(async(url:string)=>url.endsWith('/authorization-window')?json(authorization()):url.includes('requestVersion=3')?await old:json({snapshot:url.includes('requestVersion=4')?newer:snapshot()}));
    const view=render(<SnapApplicationReview request={request()}/>);await screen.findByText(/Saved revision 1/);
    view.rerender(<SnapApplicationReview request={{...request(),version:3}}/>);await screen.findByRole('status',{name:'Loading saved SNAP application'});
    view.rerender(<SnapApplicationReview request={{...request(),version:4}}/>);await screen.findByText(/Saved revision 2/);
    releaseOld(json({snapshot:snapshot()}));await waitFor(()=>expect(screen.queryByText(/Saved revision 1/)).toBeNull());
    fireEvent.click(screen.getByRole('button',{name:'Correct application answers'}));expect((screen.getByLabelText('Your first name') as HTMLInputElement).value).toBe('Nora');
  });
  it("retains an unsaved draft across a request-version change until the parent explicitly loads the latest saved answers",async()=>{
    api();const view=render(<SnapApplicationReview request={request()}/>);fireEvent.click(await screen.findByRole('button',{name:'Correct application answers'}));
    fireEvent.change(screen.getByLabelText('Your first name'),{target:{value:'Unsaved'}});view.rerender(<SnapApplicationReview request={{...request(),version:3}}/>);
    await screen.findByText(/request changed while you were editing/);expect(screen.queryByRole('button',{name:'Correct application answers'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Load latest saved application'}));fireEvent.click(await screen.findByRole('button',{name:'Correct application answers'}));
    expect((screen.getByLabelText('Your first name') as HTMLInputElement).value).toBe('Maria');
  });
  it("does not offer new collection under an expired mandate",async()=>{
    api();const value=request();value.mandate.expiresAt='2000-01-01T12:00:00Z';render(<SnapApplicationReview request={value}/>);
    await screen.findByText(/Saved revision 1/);expect(screen.queryByRole('button',{name:'Correct application answers'})).toBeNull();
  });
  it.each(["paused","cancelled","closed"] as const)("preserves reading while %s without allowing new collection",async status=>{
    api();render(<SnapApplicationReview request={{...request(),status}}/>);
    await screen.findByText(/Saved revision 1/);expect(screen.queryByRole("button",{name:"Correct application answers"})).toBeNull();
  });
  it("saves a single version-bound correction and keeps names aligned without refreshing the original income period",async()=>{
    const fetch=api(),onChange=vi.fn();render(<SnapApplicationReview request={request()} onChange={onChange}/>);
    fireEvent.click(await screen.findByRole("button",{name:"Correct application answers"}));
    const first=screen.getByLabelText("Your first name");fireEvent.change(first,{target:{value:"Marie"}});
    expect(document.activeElement).toBe(first);
    fireEvent.click(screen.getByRole("button",{name:"Save application changes"}));
    await waitFor(()=>expect(onChange).toHaveBeenCalledOnce());
    const [,init]=fetch.mock.calls.find(([,init])=>init?.method==="POST")!;
    const body=JSON.parse(init!.body as string);
    expect(body.expectedVersion).toBe(2);expect(body.noticeVersion).toBe(SNAP_APPLICATION_NOTICE_VERSION);
    expect(body.details.applicant.firstName).toBe("Marie");expect(body.details.household[0].firstName).toBe("Marie");
    expect(body.details.income.month).toBe("2026-10");
    expect((init!.headers as Record<string,string>)["Idempotency-Key"]).toMatch(/^[\da-f-]{36}$/);
  });
  it("freezes an uncertain save and retries the exact same payload and key",async()=>{
    let posts=0;const fetch=api({post:()=>{if(++posts===1)throw new Error("connection lost");return json({ok:true,snapshotId});}});
    render(<SnapApplicationReview request={request()}/>);fireEvent.click(await screen.findByRole("button",{name:"Correct application answers"}));
    fireEvent.change(screen.getByLabelText("Your first name"),{target:{value:"Marie"}});fireEvent.click(screen.getByRole("button",{name:"Save application changes"}));
    await screen.findByRole("button",{name:"Retry the same save"});
    expect(screen.getByLabelText("Your first name").matches(":disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button",{name:"Retry the same save"}));
    await screen.findByText(/application answers are saved as a new revision/);
    const attempts=fetch.mock.calls.filter(([,init])=>init?.method==="POST").map(([,init])=>init);
    expect(attempts).toHaveLength(2);expect(attempts[0]!.body).toBe(attempts[1]!.body);expect(attempts[0]!.headers).toEqual(attempts[1]!.headers);
  });
  it("keeps an unreadable HTTP-successful correction uncertain and reuses its key",async()=>{
    let posts=0;const fetch=api({post:()=>++posts===1?{ok:true,status:201,json:async()=>{throw new Error('truncated JSON');}}:json({ok:true,snapshotId})});
    render(<SnapApplicationReview request={request()}/>);fireEvent.click(await screen.findByRole('button',{name:'Correct application answers'}));
    fireEvent.change(screen.getByLabelText('Your first name'),{target:{value:'Marie'}});fireEvent.click(screen.getByRole('button',{name:'Save application changes'}));
    await screen.findByRole('button',{name:'Retry the same save'});expect(screen.getByLabelText('Your first name').matches(':disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'Retry the same save'}));await screen.findByText(/application answers are saved as a new revision/);
    const attempts=fetch.mock.calls.filter(([,init])=>init?.method==='POST').map(([,init])=>init!);
    expect(attempts[0].body).toBe(attempts[1].body);expect(attempts[0].headers).toEqual(attempts[1].headers);
  });
  it("retains unsaved answers on a version conflict until an explicit reload",async()=>{
    api({post:()=>json({ok:false,error:"The request changed. Reload it."},409)});render(<SnapApplicationReview request={request()}/>);
    fireEvent.click(await screen.findByRole("button",{name:"Correct application answers"}));fireEvent.change(screen.getByLabelText("Your first name"),{target:{value:"Unsaved"}});
    fireEvent.click(screen.getByRole("button",{name:"Save application changes"}));await screen.findByText(/Your unsaved draft is still here/);
    expect((screen.getByLabelText("Your first name") as HTMLInputElement).value).toBe("Unsaved");
    fireEvent.click(screen.getByRole("button",{name:"Load latest saved application"}));await screen.findByRole("button",{name:"Correct application answers"});
    expect(screen.queryByLabelText("Your first name")).toBeNull();
  });
  it("does not collect further edits after the server withdraws collection permission",async()=>{
    const fetch=api({post:()=>json({ok:false,error:"Its permission has changed."},403)});render(<SnapApplicationReview request={request()}/>);
    fireEvent.click(await screen.findByRole("button",{name:"Correct application answers"}));fireEvent.click(screen.getByRole("button",{name:"Save application changes"}));
    await screen.findByText(/Its permission has changed/);
    expect(screen.queryByLabelText("Your first name")).toBeNull();
    expect(fetch.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(1);
  });
  it("rechecks restored access and a fresh snapshot before resuming the retained draft",async()=>{
    let posts=0;const fetch=api({post:()=>++posts===1?json({ok:false,error:'Permission changed.'},403):json({ok:true,snapshotId})});
    render(<SnapApplicationReview request={request()}/>);fireEvent.click(await screen.findByRole('button',{name:'Correct application answers'}));
    fireEvent.change(screen.getByLabelText('Your first name'),{target:{value:'Retained'}});fireEvent.click(screen.getByRole('button',{name:'Save application changes'}));
    fireEvent.click(await screen.findByRole('button',{name:'Check private application access again'}));
    await screen.findByLabelText('Your first name');expect((screen.getByLabelText('Your first name') as HTMLInputElement).value).toBe('Retained');
    expect(fetch.mock.calls.some(([url])=>url.includes('read=1'))).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'Save application changes'}));await screen.findByText(/application answers are saved as a new revision/);
  });
  it("treats missing owned history as an empty saved-record state",async()=>{
    api({getStatus:404});render(<SnapApplicationReview request={request()}/>);
    await screen.findByText(/No full SNAP application answers are saved/);
    expect(screen.queryByRole("button",{name:"Correct application answers"})).toBeNull();
  });
});
