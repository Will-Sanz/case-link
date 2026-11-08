// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SnapApplicationFormFields, SnapApplicationSummary } from "./snap-application-form";
import { snapApplicationFieldsValueSchema, type SnapApplicationFields } from "@/lib/parent/snap-application-fields";

const personId="11111111-1111-4111-8111-111111111111";
const otherId="22222222-2222-4222-8222-222222222222";
const incomeId="33333333-3333-4333-8333-333333333333";
const changed=vi.fn();
const fixture=():SnapApplicationFields=>({
  applicant:{firstName:"Maria",lastName:"Rivera"},zip:"19104",language:"en",
  household:[{id:personId,firstName:"Maria",lastName:"Rivera",relationship:"SELF",requestingSnap:true,citizen:true}],
  income:{month:"2026-10",hasIncome:true,entries:[{id:incomeId,personId,source:"Employment",amount:680.005,frequency:"Irregular",status:"expected",date:"2026-10-20"}]},
});
function Harness({initial={},disabled=false}:{initial?:SnapApplicationFields;disabled?:boolean}){
  const [value,setValue]=useState(initial);
  return <SnapApplicationFormFields value={value} disabled={disabled} onChange={next=>{setValue(next);changed(next);}} />;
}
const change=(label:string|RegExp,value:string)=>fireEvent.change(screen.getByLabelText(label),{target:{value}});
const latest=():SnapApplicationFields=>changed.mock.calls.at(-1)![0];
beforeEach(()=>{vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-11-03T21:00:00Z"));changed.mockClear();});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();});

describe("applicable controlled SNAP fields",()=>{
  it("starts blank without changing supplied values or adding a second name, count, aggregate-income or protected question",()=>{
    render(<Harness />);
    expect(changed).not.toHaveBeenCalled();
    expect(screen.getAllByLabelText("Your first name")).toHaveLength(1);
    expect(screen.getAllByLabelText("Your last name")).toHaveLength(1);
    expect(screen.queryByLabelText(/Social Security|signature|password|EBT PIN|race|voter/i)).toBeNull();
    expect(screen.queryByLabelText("People in your household")).toBeNull();
    expect(screen.queryByLabelText("Household income before taxes ($)")).toBeNull();
    expect((screen.getByLabelText(/Would you like to report household expenses/) as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText("Medical expense deduction") as HTMLSelectElement).value).toBe("");
    expect(screen.queryByRole("button",{name:/submit|approve/i})).toBeNull();
  });
  it("mirrors the applicant into SELF without asking twice or changing the existing stable record",()=>{
    const value=fixture();render(<Harness initial={value} />);
    change("Your first name","Maya");
    expect(latest().applicant?.firstName).toBe("Maya");
    expect(latest().household?.[0]).toMatchObject({id:personId,firstName:"Maya",lastName:"Rivera",relationship:"SELF"});
    expect(latest().householdSize).toBe(1);
    change("Your first name","");
    expect(latest().applicant?.firstName).toBeUndefined();
    expect(latest().household?.[0].firstName).toBeUndefined();
    expect((screen.getByLabelText("Your first name") as HTMLInputElement).value).toBe("");
  });
  it("reuses the exact same SELF names when applicant fields are absent or partial before a name edit",()=>{
    const value=fixture();value.applicant={firstName:"Maria"};value.household![0].middleInitial="A";
    render(<Harness initial={value} />);
    expect((screen.getByLabelText("Your last name") as HTMLInputElement).value).toBe("Rivera");
    change("Your first name","Maya");
    expect(latest().applicant).toEqual({firstName:"Maya",lastName:"Rivera",middleInitial:"A"});
    expect(latest().household![0]).toMatchObject({id:personId,firstName:"Maya",lastName:"Rivera",middleInitial:"A"});
  });
  it("creates SELF only after an edit and keeps focus while the first stable UUID is assigned",()=>{
    render(<Harness />);const birth=screen.getByLabelText("Your date of birth");birth.focus();
    change("Your date of birth","1988-04-15");
    expect(document.activeElement).toBe(birth);
    const id=latest().household![0].id;expect(id).toMatch(/^[a-f0-9-]{36}$/);
    change("Your first name","Maria");expect(latest().household![0].id).toBe(id);
    expect(screen.getByLabelText("Your date of birth").getAttribute("data-snap-path")).toBe(`household.${id}.dateOfBirth`);
  });
  it("adds people without inferring a roster from a saved count and preserves payments when their person is removed",()=>{
    const value=fixture();value.householdSize=6;value.household!.push({id:otherId,firstName:"Leo",lastName:"Rivera",relationship:"Child"});value.income!.entries![0].personId=otherId;
    render(<Harness initial={value} />);
    expect(screen.queryByLabelText("Person 3 first name")).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"Add another person"}));
    expect(latest().householdSize).toBe(3);expect(latest().household?.[2].firstName).toBeUndefined();
    const addedId=latest().household![2].id;
    change("Person 3 first name","New name");expect(latest().household![2].id).toBe(addedId);
    fireEvent.click(screen.getByRole("button",{name:"Remove person 2"}));
    expect(latest().householdSize).toBe(2);expect(latest().household![1].id).toBe(addedId);
    expect(latest().income!.entries![0]).toMatchObject({id:incomeId,source:"Employment",amount:680.005});
    expect(latest().income!.entries![0].personId).toBeUndefined();
    expect(snapApplicationFieldsValueSchema.safeParse(latest()).success).toBe(true);
  });
  it("asks citizenship only for selected applicants and clears it when selection changes",()=>{
    render(<Harness initial={fixture()} />);
    expect(screen.getByLabelText("Are you a U.S. citizen?")).toBeTruthy();
    change("Are you applying for SNAP?","no");
    expect(screen.queryByLabelText("Are you a U.S. citizen?")).toBeNull();
    expect(latest().household![0].citizen).toBeUndefined();
    change("Are you applying for SNAP?","yes");change("Are you a U.S. citizen?","no");
    expect(screen.getByText(/requires noncitizen applicant documentation/)).toBeTruthy();
    change("Are you applying for SNAP?","");expect(latest().household![0].citizen).toBeUndefined();
  });
  it("does not refresh historical income on render or an unrelated edit",()=>{
    render(<Harness initial={fixture()} />);expect(changed).not.toHaveBeenCalled();
    change("Your first name","Maya");expect(latest().income?.month).toBe("2026-10");
    change("Payment 1 type or source","Self employment");expect(latest().income?.month).toBe("2026-10");
    fireEvent.click(screen.getByRole("button",{name:"Enter this month’s income"}));expect(latest().income).toEqual({month:"2026-11"});
    expect(document.activeElement).toBe(screen.getByLabelText("Does anyone have income received or expected this month?"));
  });
  it("pins a new income period on the explicit current-month answer without inventing payment rows",()=>{
    render(<Harness />);change("Does anyone have income received or expected this month?","no");
    expect(latest().income).toEqual({month:"2026-11",hasIncome:false,entries:undefined});
    expect(screen.queryByRole("button",{name:"Add an income payment"})).toBeNull();
  });
  it("keeps stable payment IDs, exact zero/decimal amounts, explicit expected status and unknown values distinct",()=>{
    const value=fixture();value.income=undefined;render(<Harness initial={value} />);
    change("Does anyone have income received or expected this month?","yes");
    fireEvent.click(screen.getByRole("button",{name:"Add an income payment"}));const id=latest().income!.entries![0].id;
    change("Payment 1 amount before taxes ($)","0");change("How often payment 1 is received","Irregular");
    change("Payment 1 received or expected?","expected");change("Payment 1 actual or expected date","2026-11-20");
    expect(latest().income!.entries![0]).toMatchObject({id,amount:0,frequency:"Irregular",status:"expected",date:"2026-11-20"});
    change("Payment 1 amount before taxes ($)","680.005");expect(latest().income!.entries![0].amount).toBe(680.005);
    change("Payment 1 amount before taxes ($)","");expect(latest().income!.entries![0].amount).toBeUndefined();
    change("Does anyone have income received or expected this month?","");expect(latest().income!.entries![0].id).toBe(id);
    change("Does anyone have income received or expected this month?","no");expect(latest().income!.entries).toBeUndefined();
  });
  it("keeps expense unknowns distinct from No and clears child answers only when the condition becomes false",()=>{
    render(<Harness />);change(/Would you like to report household expenses/,"claim");
    change(/Does anyone pay for childcare/,"yes");change("Childcare or adult care amount per month ($)","0");change("Who receives care?","Leo");
    expect(latest().expenses).toMatchObject({care:true,careMonthlyAmount:0,careRecipient:"Leo"});
    change(/Does anyone pay for childcare/,"");expect(latest().expenses?.careMonthlyAmount).toBe(0);
    change(/Does anyone pay for childcare/,"no");expect(latest().expenses?.careMonthlyAmount).toBeUndefined();expect(latest().expenses?.careRecipient).toBeUndefined();
    expect(latest().expenses?.heat).toBeUndefined();
    change(/Does anyone in your home get housing assistance/,"yes");change("What kind of housing assistance?","Rental assistance");change("Do you get a utility allowance?","no");
    change(/Does anyone in your home get housing assistance/,"no");expect(latest().expenses?.housingAssistanceKind).toBeUndefined();expect(latest().expenses?.utilityAllowance).toBeUndefined();
    change(/Does anyone in your home pay child support/,"yes");change("Is the child support court ordered?","yes");change(/Does anyone in your home pay child support/,"no");expect(latest().expenses?.courtOrdered).toBeUndefined();
    change(/Is there anyone outside of your household/,"yes");change("Amount paid toward those expenses ($)","0");change(/Is there anyone outside of your household/,"no");expect(latest().expenses?.outsideAmount).toBeUndefined();
  });
  it("records deliberate deduction elections without silently erasing an unknown choice or medical answers",()=>{
    const value=fixture();value.expenseClaims={household:"claim",housing:["rent"],medical:"claim"};value.expenses={rent:500,medical:["dental"]};
    render(<Harness initial={value} />);change(/Would you like to report household expenses/,"");expect(latest().expenses?.rent).toBe(500);
    change(/Would you like to report household expenses/,"do_not_claim");
    expect(latest().expenses?.rent).toBeUndefined();expect(latest().expenseClaims?.housing).toBeUndefined();expect(latest().expenses?.medical).toEqual(["dental"]);
    expect(latest().expenses?.heat).toBeUndefined();
  });
  it("distinguishes unanswered utility/housing lists from explicit none, preserving zero until a cost is deselected",()=>{
    render(<Harness />);change(/Would you like to report household expenses/,"claim");
    expect(latest().expenses).toBeUndefined();
    fireEvent.click(screen.getByLabelText("Other utility"));change("Other utility expense","Other fuel");fireEvent.click(screen.getByLabelText("Other utility"));
    expect(latest().expenses?.utilities).toEqual([]);expect(latest().expenses?.otherUtility).toBeUndefined();
    fireEvent.click(screen.getByLabelText("Rent"));change("Rent per month ($)","0");expect(latest().expenses?.rent).toBe(0);
    fireEvent.click(screen.getByLabelText("Rent"));expect(latest().expenses?.rent).toBeUndefined();
    fireEvent.click(screen.getByLabelText("None of these housing costs"));expect(latest().expenseClaims?.housing).toBeUndefined();
    fireEvent.click(screen.getByLabelText("None of these housing costs"));expect(latest().expenseClaims?.housing).toEqual([]);
    fireEvent.click(screen.getByLabelText("None of these utilities"));expect(latest().expenses?.utilities).toBeUndefined();
    fireEvent.click(screen.getByLabelText("None of these utilities"));expect(latest().expenses?.utilities).toEqual([]);
  });
  it("collects only selected medical types, clearing them when the deduction does not apply",()=>{
    render(<Harness />);expect(screen.queryByLabelText("Dental bills")).toBeNull();
    change("Medical expense deduction","claim");fireEvent.click(screen.getByLabelText("Other medical expense"));change("Describe the other medical expense","A qualifying expense");
    expect(latest().expenses?.medical).toEqual(["other"]);expect(latest().expenses?.otherMedical).toBe("A qualifying expense");
    expect(screen.queryByLabelText(/Medical amount|Diagnosis|Disability diagnosis/)).toBeNull();
    change("Medical expense deduction","not_applicable");expect(latest().expenses?.medical).toBeUndefined();expect(latest().expenses?.otherMedical).toBeUndefined();
  });
  it("asks exact applicable history details and does not add a date/state to the third question",()=>{
    render(<Harness />);change(/Has anyone been convicted of welfare fraud/,"yes");
    change("Names for the welfare fraud answer","Maria Rivera");change("Date for the welfare fraud answer","2020-05-01");change("State for the welfare fraud answer","PA");
    change(/Has anyone been convicted of welfare fraud/,"no");expect(latest().history?.welfareFraud).toEqual({answer:false});
    change(/Have you or anyone in your household been disqualified/,"yes");expect(screen.getByLabelText("Names for the other-state disqualification answer")).toBeTruthy();
    expect(screen.queryByLabelText(/Date for the other-state|State for the other-state/)).toBeNull();
  });
  it("keeps optional contact blank and removes only inapplicable language answers",()=>{
    render(<Harness />);expect((screen.getByLabelText("Home phone, if available") as HTMLInputElement).required).toBe(false);
    change("Preferred application language","other");change("Other preferred language","French");change("Do you need an interpreter?","yes");change("Interpreter language","French");
    change("Preferred application language","en");expect(latest().otherLanguage).toBeUndefined();
    change("Do you need an interpreter?","no");expect(latest().interpreterLanguage).toBeUndefined();
    expect(latest().address).toBeUndefined();expect(latest().phone).toBeUndefined();
  });
  it("collects representative contact details only when chosen and never presents designation as complete",()=>{
    render(<Harness />);expect(screen.queryByLabelText("Representative name")).toBeNull();
    fireEvent.click(screen.getByLabelText(/I want to provide details of a real authorized representative/));change("Representative name","Jamie Sample");
    expect(latest().authorizedRepresentative?.name).toBe("Jamie Sample");expect(screen.getByText(/contact details do not appoint/i)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/I want to provide details of a real authorized representative/));expect(latest().authorizedRepresentative).toBeUndefined();
  });
  it("uses a native disabled boundary for read-only or saving states",()=>{
    render(<Harness disabled initial={fixture()} />);
    for(const control of screen.getAllByRole("textbox"))expect(control.closest("fieldset[disabled]")).not.toBeNull();
    expect(screen.getByRole("button",{name:"Add another person"}).closest("fieldset[disabled]")).not.toBeNull();
  });
  it("moves keyboard focus into a newly added person, preserves typing focus and returns to Add after removal",()=>{
    render(<Harness initial={fixture()} />);const add=screen.getByRole("button",{name:"Add another person"});add.focus();fireEvent.click(add);
    const first=screen.getByLabelText("Person 2 first name");expect(document.activeElement===first).toBe(true);
    change("Person 2 first name","Leo");expect(document.activeElement===first).toBe(true);
    const remove=screen.getByRole("button",{name:"Remove person 2"});remove.focus();fireEvent.click(remove);
    expect(document.activeElement===add).toBe(true);
  });
  it("moves keyboard focus into a newly added payment and back to Add after its removal",()=>{
    render(<Harness initial={fixture()} />);const add=screen.getByRole("button",{name:"Add an income payment"});add.focus();fireEvent.click(add);
    const person=screen.getByLabelText("Person receiving payment 2");expect(document.activeElement===person).toBe(true);
    change("Person receiving payment 2",personId);expect(document.activeElement===person).toBe(true);
    const remove=screen.getByRole("button",{name:"Remove payment 2"});remove.focus();fireEvent.click(remove);
    expect(document.activeElement===add).toBe(true);
  });
  it("returns focus to the income question if removing the last payment hides the Add button",()=>{
    const value=fixture();value.income!.hasIncome=undefined;render(<Harness initial={value} />);
    const remove=screen.getByRole("button",{name:"Remove payment 1"});remove.focus();fireEvent.click(remove);
    expect(screen.queryByRole("button",{name:"Add an income payment"})).toBeNull();
    expect(document.activeElement===screen.getByLabelText("Does anyone have income received or expected this month?")).toBe(true);
  });
});

describe("readable SNAP application summary",()=>{
  it("shows exact amounts, expected dates and applicable values without metadata IDs or submission claims",()=>{
    const value=fixture();value.expenseClaims={household:"claim",housing:["rent"],medical:"not_applicable"};value.expenses={rent:0,utilities:[],care:false};value.history={welfareFraud:{answer:true,names:"Maria Rivera",date:"2020-05-01",state:"PA"}};
    value.authorizedRepresentative={name:"Jamie Sample",address:{city:"Philadelphia"}};render(<SnapApplicationSummary value={value} />);
    expect(screen.getByText("$680.005")).toBeTruthy();expect(screen.getByText("Expected, not yet received")).toBeTruthy();expect(screen.getByText("Expected date")).toBeTruthy();
    expect(screen.getByText("Rent: $0 per month")).toBeTruthy();expect(screen.getByText("None of the listed utilities")).toBeTruthy();expect(screen.getByText("Does not apply to the household")).toBeTruthy();
    expect(within(screen.getByRole("region",{name:"Applicant and contact summary"})).getAllByText("Not supplied (optional)")).toHaveLength(2);
    expect(document.body.textContent).not.toContain(personId);expect(document.body.textContent).not.toContain(incomeId);
    expect(document.body.textContent).not.toMatch(/ready to submit|application complete|submission confirmed/i);
    expect(screen.getByText(/do not establish a signed designation/)).toBeTruthy();
  });
  it("distinguishes absent answers from no income and deliberate deduction decline",()=>{
    const view=render(<SnapApplicationSummary value={{}} />);expect(screen.getByText("No household members listed")).toBeTruthy();expect(screen.getAllByText("No choice supplied")).toHaveLength(2);
    view.rerender(<SnapApplicationSummary value={{income:{month:"2026-11",hasIncome:false},expenseClaims:{household:"do_not_claim",medical:"do_not_claim"}}} />);
    expect(screen.getByText("No income reported for this month.")).toBeTruthy();expect(screen.getByText("You chose not to seek these deductions")).toBeTruthy();expect(screen.getByText("You chose not to seek this deduction")).toBeTruthy();
  });
});
