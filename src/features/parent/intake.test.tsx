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
import { ParentIntake } from "./intake";
import { SNAP_APPLICATION_NOTICE_VERSION } from "@/lib/parent/constants";

const navigation=vi.hoisted(()=>({push:vi.fn(),refresh:vi.fn()}));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));
const response = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
});
beforeEach(() => {
  navigation.push.mockClear();navigation.refresh.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      response(
        url.endsWith("/account")
          ? {
              account: {
                email: "synthetic@example.test",
                preferences: { language: "en", contactPreference: "in_app" },
              },
            }
          : { capabilities: [] },
      ),
    ),
  );
});

const snapWindow=(enabled=true)=>({authorization:{issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),snapApplication:{collectionEnabled:enabled,noticeVersion:enabled?SNAP_APPLICATION_NOTICE_VERSION:null}}});
function snapApi(gate:unknown=snapWindow(),post?:(init:RequestInit)=>unknown){
  const fetch=vi.fn(async(url:string,init?:RequestInit)=>{
    if(url.endsWith('/authorization-window'))return response(gate);
    if(url.endsWith('/account'))return response({account:{email:'synthetic@example.test',preferences:{language:'en',contactPreference:'in_app'}}});
    if(url.endsWith('/requests')&&init?.method==='POST')return post?post(init):response({request:{id:'11111111-1111-4111-8111-111111111111'}});
    return response({capabilities:[]});
  });vi.stubGlobal('fetch',fetch);return fetch;
}
function answerSnap(path:string,value:string){
  const input=document.querySelector(`[data-snap-path="${path}"]`);
  if(!input)throw new Error(`Missing application control: ${path}`);
  fireEvent.change(input,{target:{value}});
}
async function completeSnap(){
  await screen.findByLabelText('Your first name');
  answerSnap('applicant.firstName','Maria');answerSnap('applicant.lastName','Rivera');answerSnap('address.street','123 Synthetic Lane');
  answerSnap('address.city','Philadelphia');answerSnap('address.state','PA');answerSnap('zip','19104');answerSnap('county','Philadelphia');answerSnap('language','en');answerSnap('interpreter','no');
  fireEvent.change(screen.getByLabelText('Your date of birth'),{target:{value:'1988-04-15'}});
  fireEvent.change(screen.getByLabelText('Your sex, as requested on the form'),{target:{value:'female'}});
  fireEvent.change(screen.getByLabelText('Are you a student?'),{target:{value:'no'}});
  fireEvent.change(screen.getByLabelText('Are you applying for SNAP?'),{target:{value:'yes'}});
  fireEvent.change(screen.getByLabelText('Are you a U.S. citizen?'),{target:{value:'yes'}});
  answerSnap('income.hasIncome','no');
  for(const path of ['screening.lowCashAndIncome','screening.migrantOrSeasonal','screening.belowShelterCosts','history.fleeingOrProbation.answer','history.welfareFraud.answer','history.otherStateDisqualification.answer'])answerSnap(path,'no');
  answerSnap('expenseClaims.household','do_not_claim');answerSnap('expenseClaims.medical','not_applicable');
  const adult=screen.getByLabelText(/I’m 18 or older/) as HTMLInputElement;
  if(!adult.checked)fireEvent.click(adult);
}
describe('full SNAP intake before background work',()=>{
  it('shows only the two remaining steps when SNAP was already chosen',async()=>{
    snapApi();render(<ParentIntake initialNeed="snap_new"/>);await screen.findByLabelText('Your first name');
    expect(screen.getByRole('heading',{level:1,name:'Apply for SNAP'})).toBeTruthy();
    const progress=screen.getByRole('list',{name:'Support request steps'});
    expect(within(progress).getAllByRole('listitem')).toHaveLength(2);
    expect(progress.querySelector('[aria-current="step"]')?.textContent).toBe('1Application details');
    await completeSnap();fireEvent.click(screen.getByRole('button',{name:'Continue'}));
    expect(progress.querySelector('[aria-current="step"]')?.textContent).toBe('2Your permission');
    fireEvent.click(screen.getByRole('button',{name:'Back'}));
    expect((screen.getByLabelText('Your first name') as HTMLInputElement).value).toBe('Maria');
  });
  it('restores the full support steps when a direct SNAP visitor chooses another need',async()=>{
    snapApi();render(<ParentIntake initialNeed="snap_new"/>);await screen.findByLabelText('Your first name');
    fireEvent.click(screen.getByRole('button',{name:'Back'}));
    fireEvent.click(screen.getByRole('checkbox',{name:/Apply for SNAP/}));
    fireEvent.click(screen.getByRole('checkbox',{name:'Electric bill'}));
    fireEvent.click(screen.getByRole('button',{name:'Continue'}));
    const progress=screen.getByRole('list',{name:'Support request steps'});
    expect(within(progress).getAllByRole('listitem')).toHaveLength(3);
    expect(progress.querySelector('[aria-current="step"]')?.textContent).toBe('2Household details');
    expect(screen.queryByRole('heading',{level:1,name:'Apply for SNAP'})).toBeNull();
  });

  it.each(['expired','missing issuedAt'])('does not start support from an %s authorization quote',async kind=>{
    const gate=snapWindow();if(kind==='expired')gate.authorization.expiresAt=new Date(Date.now()-1000).toISOString();else Reflect.deleteProperty(gate.authorization,'issuedAt');
    const fetch=snapApi(gate);render(<ParentIntake initialNeed="snap_new"/>);await completeSnap();fireEvent.click(screen.getByRole('button',{name:'Continue'}));fireEvent.click(screen.getByLabelText(/I authorize/));
    fireEvent.click(screen.getByRole('button',{name:'Start getting support'}));await screen.findByRole('alert');
    expect(fetch.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(0);expect(navigation.push).not.toHaveBeenCalled();
  });
  it.each(['authorization','fetch','body'] as const)('bounds a stalled start %s without silently starting another request',async kind=>{
    const fetch=snapApi();render(<ParentIntake initialNeed="snap_new"/>);await completeSnap();fireEvent.click(screen.getByRole('button',{name:'Continue'}));
    fireEvent.click(screen.getByLabelText(/I authorize/));const original=fetch.getMockImplementation()!;
    fetch.mockImplementation(async(url:string,init?:RequestInit)=>{
      if(kind==='authorization'&&url.endsWith('/authorization-window'))return new Promise(()=>{});
      if(init?.method==='POST')return kind==='fetch'?new Promise(()=>{}):{ok:true,status:201,json:()=>new Promise(()=>{})};
      return original(url,init);
    });
    vi.useFakeTimers();fireEvent.click(screen.getByRole('button',{name:'Start getting support'}));await act(async()=>{});
    await act(async()=>{await vi.advanceTimersByTimeAsync(30000);});
    expect(screen.getByRole('button',{name:'Start getting support'}).matches(':disabled')).toBe(false);expect(navigation.push).not.toHaveBeenCalled();
    expect(fetch.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(kind==='authorization'?0:1);
    if(kind!=='authorization')expect(screen.getByText(/Retry the same request before changing/)).toBeTruthy();
    vi.useRealTimers();
  });
  it('does not navigate from a late start reply after the intake closes',async()=>{
    let finish!:(value:unknown)=>void;snapApi(snapWindow(),()=>new Promise(resolve=>{finish=resolve;}));
    const view=render(<ParentIntake initialNeed="snap_new"/>);await completeSnap();fireEvent.click(screen.getByRole('button',{name:'Continue'}));fireEvent.click(screen.getByLabelText(/I authorize/));
    fireEvent.click(screen.getByRole('button',{name:'Start getting support'}));await act(async()=>{});view.unmount();
    await act(async()=>{finish(response({request:{id:'11111111-1111-4111-8111-111111111111'}}));});expect(navigation.push).not.toHaveBeenCalled();expect(navigation.refresh).not.toHaveBeenCalled();
  });
  it.each([snapWindow(false),{}, {authorization:{snapApplication:{collectionEnabled:true,noticeVersion:'wrong'}}}])('collects no new private application fields unless the server proves this purpose %j',async gate=>{
    const fetch=snapApi(gate);render(<ParentIntake initialNeed="snap_new"/>);
    await screen.findByLabelText('Household ZIP code');
    expect(screen.queryByLabelText('Your first name')).toBeNull();expect(screen.queryByLabelText('Your date of birth')).toBeNull();
    expect(screen.getByRole('link',{name:'Open official SNAP help'})).toBeTruthy();
    expect(screen.getByRole('link',{name:'apply directly with Pennsylvania SNAP'}).getAttribute('href')).toBe('https://www.compass.dhs.pa.gov/intake/#/getstarted');
    expect(fetch.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(0);
  });
  it('does not render private fields while the collection status is unresolved',async()=>{
    let resolveGate!:(value:unknown)=>void;const pendingGate=new Promise(resolve=>{resolveGate=resolve;});
    const fetch=snapApi();fetch.mockImplementation(async(url:string)=>url.endsWith('/authorization-window')?response(await pendingGate):response(url.endsWith('/account')?{account:{email:'synthetic@example.test'}}:{capabilities:[]}));
    render(<ParentIntake initialNeed="snap_new"/>);await screen.findByRole('status',{name:'Checking SNAP application availability'});
    expect(screen.queryByLabelText('Your first name')).toBeNull();
    expect(screen.queryByLabelText('Household ZIP code')).toBeNull();
    expect((screen.getByRole('button',{name:'Continue'}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'Continue'}));expect(screen.queryByLabelText(/I authorize/)).toBeNull();resolveGate(snapWindow());
    await screen.findByLabelText('Your first name');
  });
  it('asks applicant names once and sends one atomic full-details start only after the bounded authorization',async()=>{
    const fetch=snapApi();render(<ParentIntake initialNeed="snap_new"/>);await completeSnap();
    expect(screen.getAllByLabelText('Your first name')).toHaveLength(1);
    expect(screen.queryByLabelText('People in your household')).toBeNull();expect(screen.queryByLabelText('Household income before taxes ($)')).toBeNull();
    expect(screen.queryByLabelText(/Social Security number/)).toBeNull();expect(screen.queryByLabelText(/Signature/)).toBeNull();
    expect(fetch.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button',{name:'Continue'}));
    expect(screen.queryByRole('checkbox',{name:/Pennsylvania SNAP/})).toBeNull();
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    fireEvent.click(screen.getByLabelText(/I authorize/));fireEvent.click(screen.getByRole('button',{name:'Start getting support'}));
    await waitFor(()=>expect(navigation.push).toHaveBeenCalledWith('/support/11111111-1111-4111-8111-111111111111'));
    const posts=fetch.mock.calls.filter(([,init])=>init?.method==='POST');expect(posts).toHaveLength(1);
    const body=JSON.parse(posts[0][1]!.body as string);
    expect(body.kind).toBe('snap_application');expect(body.noticeVersion).toBe(SNAP_APPLICATION_NOTICE_VERSION);
    expect(body.details.applicant).toMatchObject({firstName:'Maria',lastName:'Rivera'});expect(body.details.household[0]).toMatchObject({firstName:'Maria',lastName:'Rivera',relationship:'SELF'});
    expect(body.intake.householdSize).toBe(1);expect(body.intake.incomeAmount).toBeNull();expect(body.details.income.hasIncome).toBe(false);
    expect(body.details.phone).toBeUndefined();expect(body.mandate.accepted).toBe(true);expect(body.mandate.recipientIds).toEqual(['snap-pa']);
  });
  it('keeps unknown required answers unknown and does not queue incomplete full-detail work',async()=>{
    const fetch=snapApi();render(<ParentIntake initialNeed="snap_new"/>);await screen.findByLabelText('Your first name');
    fireEvent.click(screen.getByLabelText(/I’m 18 or older/));
    fireEvent.click(screen.getByRole('button',{name:'Continue'}));await screen.findByRole('alert');
    expect((screen.getByLabelText('Are you a student?') as HTMLSelectElement).value).toBe('');
    expect(fetch.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(0);
  });
  it('preserves full SNAP answers and combined utility inputs when going back without duplicate aggregate questions',async()=>{
    snapApi();render(<ParentIntake initialNeed="snap_new"/>);await screen.findByLabelText('Your first name');
    answerSnap('applicant.firstName','Maria');answerSnap('zip','19104');fireEvent.click(screen.getByRole('button',{name:'Back'}));
    fireEvent.click(screen.getByRole('checkbox',{name:'Electric bill'}));fireEvent.click(screen.getByRole('button',{name:'Continue'}));
    expect((screen.getByLabelText('Your first name') as HTMLInputElement).value).toBe('Maria');
    expect((screen.getByLabelText('ZIP code') as HTMLInputElement).value).toBe('19104');expect(screen.getByLabelText('PECO')).toBeTruthy();
    expect(screen.queryByLabelText('Household income before taxes ($)')).toBeNull();
  });
  it('retries an uncertain atomic start with the identical payload and key',async()=>{
    let posts=0;const fetch=snapApi(snapWindow(),()=>{if(++posts===1)throw new Error('response lost');return response({request:{id:'11111111-1111-4111-8111-111111111111'}});});
    render(<ParentIntake initialNeed="snap_new"/>);await completeSnap();fireEvent.click(screen.getByRole('button',{name:'Continue'}));fireEvent.click(screen.getByLabelText(/I authorize/));
    fireEvent.click(screen.getByRole('button',{name:'Start getting support'}));await screen.findByText(/Retry the same request before changing/);
    expect((screen.getByRole('button',{name:'Back'}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'Start getting support'}));await waitFor(()=>expect(navigation.push).toHaveBeenCalled());
    const attempts=fetch.mock.calls.filter(([,init])=>init?.method==='POST').map(([,init])=>init!);
    expect(attempts).toHaveLength(2);expect(attempts[0].body).toBe(attempts[1].body);expect(attempts[0].headers).toEqual(attempts[1].headers);
  });
  it('rechecks collection permission before the first write and does not substitute a generic request when it closes',async()=>{
    let windows=0;const fetch=snapApi();fetch.mockImplementation(async(url:string,init?:RequestInit)=>{
      if(url.endsWith('/authorization-window'))return response(snapWindow(++windows===1));
      if(url.endsWith('/account'))return response({account:{email:'synthetic@example.test'}});
      if(init?.method==='POST')throw new Error('No POST is authorized after closure');
      return response({capabilities:[]});
    });
    render(<ParentIntake initialNeed="snap_new"/>);await completeSnap();fireEvent.click(screen.getByRole('button',{name:'Continue'}));fireEvent.click(screen.getByLabelText(/I authorize/));fireEvent.click(screen.getByRole('button',{name:'Start getting support'}));
    await screen.findByText(/Private SNAP application collection is currently unavailable/);
    expect(fetch.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(0);
    expect(navigation.push).not.toHaveBeenCalled();
  });
  it('returns to full SNAP questions before any write when collection opens at final authorization',async()=>{
    let windows=0;const fetch=snapApi();fetch.mockImplementation(async(url:string,init?:RequestInit)=>{
      if(url.endsWith('/authorization-window'))return response(snapWindow(++windows>1));
      if(url.endsWith('/account'))return response({account:{email:'synthetic@example.test'}});
      if(init?.method==='POST')return response({request:{id:'11111111-1111-4111-8111-111111111111'}});
      return response({capabilities:[]});
    });
    render(<ParentIntake initialNeed="snap_new"/>);
    fireEvent.change(await screen.findByLabelText('Household ZIP code'),{target:{value:'19104'}});
    fireEvent.click(screen.getByLabelText(/I’m 18 or older/));fireEvent.click(screen.getByRole('button',{name:'Continue'}));
    fireEvent.click(screen.getByLabelText(/I authorize/));fireEvent.click(screen.getByRole('button',{name:'Start getting support'}));
    await screen.findByLabelText('Your first name');
    expect(fetch.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(0);
    expect(screen.queryByLabelText(/I authorize/)).toBeNull();expect(navigation.push).not.toHaveBeenCalled();
    await completeSnap();fireEvent.click(screen.getByRole('button',{name:'Continue'}));
    expect((screen.getByLabelText(/I authorize/) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByLabelText(/I authorize/));fireEvent.click(screen.getByRole('button',{name:'Start getting support'}));
    await waitFor(()=>expect(navigation.push).toHaveBeenCalled());
    const posts=fetch.mock.calls.filter(([,init])=>init?.method==='POST');expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0][1]!.body as string).kind).toBe('snap_application');
  });
  it('keeps private fields closed when availability cannot be checked',async()=>{
    const fetch=snapApi();fetch.mockImplementation(async(url:string)=>{
      if(url.endsWith('/authorization-window'))throw new Error('unavailable');
      return response(url.endsWith('/account')?{account:{email:'synthetic@example.test'}}:{capabilities:[]});
    });
    render(<ParentIntake initialNeed="snap_new"/>);await screen.findByRole('button',{name:'Check application availability again'});
    expect(screen.queryByLabelText('Your first name')).toBeNull();expect(screen.queryByLabelText('Your date of birth')).toBeNull();
  });
  it.each(['unreadable','missing id','invalid id'])('keeps an uncertain successful start frozen when the response has %s',async problem=>{
    let posts=0;const fetch=snapApi(snapWindow(),()=>{
      if(++posts>1)return response({request:{id:'11111111-1111-4111-8111-111111111111'}});
      return problem==='unreadable'?{ok:true,status:201,json:async()=>{throw new Error('truncated JSON');}}:response({request:problem==='missing id'?{}:{id:'not-a-request'}});
    });
    render(<ParentIntake initialNeed="snap_new"/>);await completeSnap();fireEvent.click(screen.getByRole('button',{name:'Continue'}));fireEvent.click(screen.getByLabelText(/I authorize/));
    fireEvent.click(screen.getByRole('button',{name:'Start getting support'}));await screen.findByText(/Retry the same request before changing/);
    expect((screen.getByRole('button',{name:'Back'}) as HTMLButtonElement).disabled).toBe(true);expect(navigation.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Start getting support'}));await waitFor(()=>expect(navigation.push).toHaveBeenCalled());
    const attempts=fetch.mock.calls.filter(([,init])=>init?.method==='POST').map(([,init])=>init!);
    expect(attempts[0].body).toBe(attempts[1].body);expect(attempts[0].headers).toEqual(attempts[1].headers);
  });
  it.each([401,403])('closes private entry immediately after a start is denied with %s, even if cached collection was open',async status=>{
    snapApi(snapWindow(),()=>({ok:false,status,json:async()=>({ok:false,error:'Permission changed.'})}));
    render(<ParentIntake initialNeed="snap_new"/>);await completeSnap();fireEvent.click(screen.getByRole('button',{name:'Continue'}));fireEvent.click(screen.getByLabelText(/I authorize/));
    fireEvent.click(screen.getByRole('button',{name:'Start getting support'}));await waitFor(()=>expect((screen.getByRole('button',{name:'Back'}) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button',{name:'Back'}));expect(screen.queryByLabelText('Your first name')).toBeNull();expect(screen.queryByLabelText('Your date of birth')).toBeNull();
    expect(screen.getByRole('button',{name:'Check application availability again'})).toBeTruthy();
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("one coherent upfront support intake", () => {
  it.each(['wic_new','wic_continuing'])('keeps private WIC questions closed for %s while retaining official access',async need=>{
    render(<ParentIntake initialNeed={need}/>);await screen.findByLabelText('Household ZIP code');
    expect(screen.queryByLabelText('Any children under five?')).toBeNull();expect(screen.queryByLabelText('Pregnant or postpartum?')).toBeNull();
    expect(screen.getByText(/Private WIC questions are not available/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Household ZIP code'),{target:{value:'19104'}});fireEvent.click(screen.getByLabelText(/I’m 18 or older/));fireEvent.click(screen.getByRole('button',{name:'Continue'}));
    expect(screen.getAllByRole('link',{name:'Open official program'}).some(link=>link.getAttribute('href')?.includes('wic'))).toBe(true);
  });
  it.each(['snap_pending','wic_continuing'])('does not advertise unrelated submit or follow-up capability for %s',async need=>{
    const original=globalThis.fetch;
    vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>url.endsWith('/capabilities')?response({capabilities:[{programId:need.startsWith('snap')?'snap-pa':'wic-pa',enabled:true,actions:['submit','follow_up']}]}):original(url,init)));
    render(<ParentIntake initialNeed={need}/>);fireEvent.change(await screen.findByLabelText('Household ZIP code'),{target:{value:'19104'}});fireEvent.click(screen.getByLabelText(/I’m 18 or older/));fireEvent.click(screen.getByRole('button',{name:'Continue'}));
    expect(screen.queryByText('Permitted actions available')).toBeNull();expect(screen.getAllByText('Prepare only · nothing sent').length).toBeGreaterThan(0);
  });
  it("offers separate food services before account access or household collection", () => {
    render(<ParentIntake initialNeed="food" />);
    expect(screen.getByRole("link", { name: "Find food now" }).getAttribute("href")).toBe("https://www.phila.gov/food/");
    expect(screen.getByRole("link", { name: "Apply for SNAP" }).getAttribute("href")).toBe("/get-support?need=snap_new");
    expect(screen.getByRole("link", { name: "Check a pending application" }).getAttribute("href")).toBe("/get-support?need=snap_pending");
    expect(screen.getByRole("link", { name: "Renew SNAP" }).getAttribute("href")).toBe("/get-support?need=snap_renewal");
    expect(screen.getByRole("link", { name: "Apply for WIC" }).getAttribute("href")).toBe("/get-support?need=wic_new");
    expect(screen.getByRole("link", { name: /Not sure, or need more than one/ }).getAttribute("href")).toBe("/get-support");
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByLabelText("Household ZIP code")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("still requires an explicit choice in the combined support form", async () => {
    render(<ParentIntake />);
    await screen.findByRole("checkbox", { name: /Apply for SNAP/ });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Choose at least one kind of support",
    );
    expect(
      screen.getByText(/This does not start a SNAP application/),
    ).toBeTruthy();
  });
  it.each(["food_now", "snap_new", "snap_renewal", "snap_pending", "snap_problem", "wic_new", "wic_continuing"])(
    "preselects only the explicitly chosen %s service", async (need) => {
      render(<ParentIntake initialNeed={need} />);
      await screen.findByRole("heading", { name: "Your household details, in one place" });
      expect(screen.queryByRole("checkbox", { name: /Food for now/ })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      const selected = screen.getAllByRole("checkbox").filter(input => (input as HTMLInputElement).checked);
      expect(selected).toHaveLength(1);
      expect(selected[0].closest("label")?.textContent).toContain({
        food_now: "Food for now", snap_new: "Apply for SNAP", snap_renewal: "Renew SNAP", snap_pending: "Check a SNAP application", snap_problem: "Help with SNAP benefits", wic_new: "Apply for WIC", wic_continuing: "Continue WIC support",
      }[need]);
    },
  );
  it("collects available SNAP household and income facts together before permission, preserving answers on back", async () => {
    render(<ParentIntake initialNeed="snap_new" />);
    await screen.findByLabelText("Household ZIP code");
    expect(
      screen.getByRole("heading", {
        name: "Your household details, in one place",
      }),
    ).toBeTruthy();
    const size = screen.getByLabelText("People in your household");
    const income = screen.getByLabelText("Household income before taxes ($)");
    expect(size.closest("details")).toBeNull();
    expect(income.closest("details")).toBeNull();
    fireEvent.change(screen.getByLabelText("Household ZIP code"), {
      target: { value: "19104" },
    });
    fireEvent.change(size, { target: { value: "4" } });
    fireEvent.change(income, { target: { value: "0" } });
    fireEvent.change(
      screen.getByLabelText("How often is that amount received?"),
      { target: { value: "monthly" } },
    );
    fireEvent.click(screen.getByLabelText(/I’m 18 or older/));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      screen.getByRole("checkbox", { name: /Pennsylvania SNAP/ }),
    ).toBeTruthy();
    expect(screen.getByText(/Applications are not connected yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(
      (screen.getByLabelText("People in your household") as HTMLInputElement)
        .value,
    ).toBe("4");
    expect(
      (
        screen.getByLabelText(
          "Household income before taxes ($)",
        ) as HTMLInputElement
      ).value,
    ).toBe("0");
    expect(screen.queryByLabelText(/Social Security/)).toBeNull();
    expect(screen.getByText(/Names, addresses, dates of birth/)).toBeTruthy();
  });
  it("does not carry an unsubmitted SNAP draft into a different food service", async () => {
    const view = render(<ParentIntake initialNeed="snap_new" />);
    fireEvent.change(await screen.findByLabelText("Household ZIP code"), { target: { value: "19104" } });
    fireEvent.change(screen.getByLabelText("Household income before taxes ($)"), { target: { value: "680" } });
    view.rerender(<ParentIntake initialNeed="food_now" />);
    expect((await screen.findByLabelText("Household ZIP code") as HTMLInputElement).value).toBe("");
    expect(screen.queryByLabelText("Household income before taxes ($)")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect((screen.getByRole("checkbox", { name: /Food for now/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: /Apply for SNAP/ }) as HTMLInputElement).checked).toBe(false);
  });
  it("can add food-now support through Back without losing the explicit SNAP choice or household draft", async () => {
    render(<ParentIntake initialNeed="snap_new" />);
    fireEvent.change(await screen.findByLabelText("Household ZIP code"), { target: { value: "19104" } });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Food for now/ }));
    expect((screen.getByRole("checkbox", { name: /Apply for SNAP/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect((screen.getByLabelText("Household ZIP code") as HTMLInputElement).value).toBe("19104");
    expect(screen.getByLabelText("Household income before taxes ($)")).toBeTruthy();
  });
  it("does not collect income or health information just to find food today", async () => {
    render(<ParentIntake initialNeed="food_now" />);
    await screen.findByLabelText("Household ZIP code");
    expect(
      screen.queryByLabelText("Household income before taxes ($)"),
    ).toBeNull();
    expect(screen.queryByLabelText("Pregnant or postpartum?")).toBeNull();
    expect(screen.getByLabelText("Household ZIP code")).toBeTruthy();
  });
  it("keeps utility questions visible in the same bundle and can proceed with unknown optional facts", async () => {
    render(<ParentIntake initialNeed="utilities" />);
    const electricity = await screen.findByRole("checkbox", {
      name: "Electric bill",
    });
    expect((electricity as HTMLInputElement).checked).toBe(false);
    fireEvent.click(electricity);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      screen
        .getByRole("group", { name: "Your utility information" })
        .closest("details"),
    ).toBeNull();
    expect(screen.getByLabelText("PECO")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Household ZIP code"), {
      target: { value: "19104" },
    });
    fireEvent.click(screen.getByLabelText(/I’m 18 or older/));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() =>
      expect(screen.getByText("Named programs for this request")).toBeTruthy(),
    );
  });
});
