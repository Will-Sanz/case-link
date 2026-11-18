// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import axe from "axe-core";
import { PgwApplicationFormFields, PgwApplicationNotice } from "./pgw-application-form";
import { pgwApplicationFieldsValueSchema, type PgwApplicationFields } from "@/lib/parent/pgw-application-fields";
afterEach(cleanup);
function Form({ initial = {} }: { initial?: PgwApplicationFields }) {
  const [value, setValue] = useState(initial);
  return <><PgwApplicationNotice/><PgwApplicationFormFields value={value} onChange={setValue}/><output data-testid="saved-value">{JSON.stringify(value)}</output></>;
}
const value = () => JSON.parse(screen.getByTestId("saved-value").textContent!);
describe("PGW grouped private preparation fields", () => {
  it("puts the notice before fields, leaves actual journeys unknown and omits customer DOB, identifiers and signatures", () => {
    const { container } = render(<Form/>);
    const notice = screen.getByRole("region", { name: "PGW private information notice" });
    expect(notice.compareDocumentPosition(screen.getByLabelText("PGW account number")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(value()).toEqual({});
    for (const label of ["What PGW CRP help is needed?", "What is this account’s CRP enrollment?", "Is the customer of record under 18?", "Is this the full household list?", "PGW service ZIP code"])
      expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe("");
    expect(container.querySelector('input[type="date"]')).toBeNull();
    expect(screen.queryByLabelText(/Social Security|identifier|passport|student ID|signature|password|payment/i)).toBeNull();
  });
  it("saves an explicitly partial returning or pending journey without making it a new application", () => {
    render(<Form/>);
    fireEvent.change(screen.getByLabelText("What PGW CRP help is needed?"), { target: { value: "reenrollment" } });
    fireEvent.change(screen.getByLabelText("What is this account’s CRP enrollment?"), { target: { value: "previously_enrolled" } });
    fireEvent.change(screen.getByLabelText("PGW account number"), { target: { value: "FICT/PGW.02" } });
    expect(value()).toEqual({ journey: "reenrollment", currentCrpState: "previously_enrolled", accountNumber: "FICT/PGW.02" });
    expect(pgwApplicationFieldsValueSchema.safeParse(value()).success).toBe(true);
    fireEvent.change(screen.getByLabelText("What PGW CRP help is needed?"), { target: { value: "pending" } });
    expect(value().journey).toBe("pending");
  });
  it("preserves internal customer and distinct household IDs across name corrections and row removal", () => {
    render(<Form/>);
    fireEvent.change(screen.getByLabelText("Customer first name"), { target: { value: "Alex" } }); const customer = value().customer.id;
    fireEvent.change(screen.getByLabelText("Customer first name"), { target: { value: "Corrected" } });
    fireEvent.click(screen.getByRole("button", { name: "Add a household member" })); const first = value().householdMembers[0].id;
    expect(document.activeElement).toBe(screen.getByLabelText("Household member 1 first name"));
    fireEvent.click(screen.getByRole("button", { name: "Add a household member" })); const second = value().householdMembers[1].id;
    expect(new Set([customer, first, second]).size).toBe(3);
    fireEvent.click(screen.getByRole("button", { name: "Remove household member 2" }));
    expect(value().customer.id).toBe(customer); expect(value().householdMembers).toEqual([{ id: first }]);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add a household member" }));
    expect(screen.queryByRole("textbox", { name: /UUID|record ID/i })).toBeNull();
  });
  it("asks actual income sources for children and preserves the inventory when a birth date is corrected", () => {
    render(<Form initial={{ householdMembers: [{ id: crypto.randomUUID() }] }}/>);
    fireEvent.change(screen.getByLabelText("Household member 1 date of birth"), { target: { value: "2020-01-01" } });
    fireEvent.change(screen.getByLabelText("Household member 1 income sources"), { target: { value: "sources" } });
    fireEvent.change(screen.getByLabelText("Add household member 1 income source"), { target: { value: "social_security" } });
    fireEvent.change(screen.getByLabelText("Add household member 1 income source"), { target: { value: "social_security" } });
    const sources = value().householdMembers[0].income.sources; expect(sources[0].id).not.toBe(sources[1].id);
    fireEvent.change(screen.getByLabelText("Household member 1 date of birth"), { target: { value: "2021-01-01" } });
    expect(value().householdMembers[0].income.sources).toEqual(sources);
    expect(pgwApplicationFieldsValueSchema.safeParse(value()).success).toBe(true);
    fireEvent.change(screen.getByLabelText("Household member 1 income sources"), { target: { value: "unknown" } });
    expect(value().householdMembers[0].income).toEqual({ state: "unknown", sources: [] });
  });
  it("shows adult no-income explanations only for the actual age answer and clears the hidden explanation after correction", () => {
    render(<Form/>);
    fireEvent.change(screen.getByLabelText("Customer income sources"), { target: { value: "none" } });
    expect(screen.queryByLabelText("Customer brief no-income situation")).toBeNull();
    fireEvent.change(screen.getByLabelText("Is the customer of record under 18?"), { target: { value: "false" } });
    fireEvent.change(screen.getByLabelText("Customer brief no-income situation"), { target: { value: "Between jobs" } });
    fireEvent.change(screen.getByLabelText("Is the customer of record under 18?"), { target: { value: "true" } });
    expect(value().customer.income).toEqual({ state: "none", sources: [] });
    expect(screen.queryByLabelText("Customer brief no-income situation")).toBeNull();
  });
  it("keeps all words in multiline no-income and living-expense answers while saving line breaks as spaces", () => {
    render(<Form initial={{ customer: { id: crypto.randomUUID(), under18: false, income: { state: "none", sources: [] } }, zeroIncomePast30Days: true }}/>);
    fireEvent.change(screen.getByLabelText("Customer brief no-income situation"), { target: { value: "Between jobs.\r\nUsing savings." } });
    fireEvent.change(screen.getByLabelText("How does the household pay for food?"), { target: { value: "SNAP\nFood pantry" } });
    expect(value().customer.income.noIncomeSituation).toBe("Between jobs. Using savings.");
    expect(value().livingExpenses.food).toBe("SNAP Food pantry");
    expect(pgwApplicationFieldsValueSchema.safeParse(value()).success).toBe(true);
  });
  it("records applicable outside support separately, handles cents exactly and never signs for the supporter", () => {
    render(<Form/>);
    fireEvent.change(screen.getByLabelText("Does someone outside this household provide financial support?"), { target: { value: "true" } });
    fireEvent.change(screen.getByLabelText("Outside supporter first name"), { target: { value: "Sam" } }); const id = value().outsideSupport.supporter.id;
    fireEvent.change(screen.getByLabelText("Outside support monthly amount"), { target: { value: "0.29" } });
    expect(value().outsideSupport.supporter).toMatchObject({ id, firstName: "Sam", monthlyAmountCents: 29 });
    fireEvent.change(screen.getByLabelText("Outside support monthly amount"), { target: { value: "12.345" } });
    expect((screen.getByLabelText("Outside support monthly amount") as HTMLInputElement).value).toBe("12.345");
    expect(pgwApplicationFieldsValueSchema.safeParse(value()).success).toBe(false);
    fireEvent.change(screen.getByLabelText("Outside support monthly amount"), { target: { value: "12.34" } });
    expect(value().outsideSupport.supporter.monthlyAmountCents).toBe(1234);
    expect(pgwApplicationFieldsValueSchema.safeParse(value()).success).toBe(true); expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.change(screen.getByLabelText("Does someone outside this household provide financial support?"), { target: { value: "false" } });
    expect(value().outsideSupport).toEqual({ receives: false }); expect(screen.queryByLabelText("Outside supporter first name")).toBeNull();
  });
  it("does not infer household zero income and removes only explicitly inapplicable explanations or assistance amounts", () => {
    render(<Form/>);
    fireEvent.change(screen.getByLabelText("Is this the full household list?"), { target: { value: "true" } });
    expect(value().householdMembers).toEqual([]); expect(value().customer.id).toBeTruthy(); expect(value().zeroIncomePast30Days).toBeUndefined();
    fireEvent.change(screen.getByLabelText("Did the entire household have no income in the past 30 days?"), { target: { value: "true" } });
    fireEvent.change(screen.getByLabelText("How does the household pay for food?"), { target: { value: "SNAP" } });
    fireEvent.change(screen.getByLabelText("Does the household receive SNAP?"), { target: { value: "true" } });
    fireEvent.change(screen.getByLabelText("SNAP monthly amount"), { target: { value: "0.00" } });
    expect(value()).toMatchObject({ zeroIncomePast30Days: true, livingExpenses: { food: "SNAP" }, snap: { receives: true, monthlyAmountCents: 0 } });
    fireEvent.change(screen.getByLabelText("Did the entire household have no income in the past 30 days?"), { target: { value: "false" } });
    expect(value().livingExpenses).toBeUndefined(); expect(value().snap.monthlyAmountCents).toBe(0);
    fireEvent.change(screen.getByLabelText("Does the household receive SNAP?"), { target: { value: "false" } });
    expect(value().snap).toEqual({ receives: false });
  });
  it("normalizes actual contact formatting and disables all private controls while pending", () => {
    const { unmount } = render(<Form/>);
    fireEvent.change(screen.getByLabelText("PGW contact phone"), { target: { value: "2155550101" } }); fireEvent.blur(screen.getByLabelText("PGW contact phone"));
    expect(value()).toEqual({ phone: "215-555-0101" }); unmount();
    render(<PgwApplicationFormFields value={{ householdMembers: [{ id: crypto.randomUUID() }], outsideSupport: { receives: true }, snap: { receives: true } }} onChange={() => undefined} disabled/>);
    const group = within(screen.getByRole("group", { name: "PGW CRP preparation answers" }));
    for (const control of [...group.getAllByRole("textbox"), ...group.getAllByRole("combobox"), ...group.getAllByRole("button")]) expect(control.matches(":disabled")).toBe(true);
  });
  it("labels the full household, income, supporter and amount controls accessibly", async () => {
    const { container } = render(<main><Form initial={{ customer: { id: crypto.randomUUID(), under18: false, income: { state: "none", sources: [] } },
      householdMembers: [{ id: crypto.randomUUID(), dateOfBirth: "2020-01-01", income: { state: "sources", sources: [{ id: crypto.randomUUID(), kind: "social_security" }] } }],
      outsideSupport: { receives: true }, snap: { receives: true }, housingSubsidy: { receives: true } }}/></main>);
    const result = await axe.run(container, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] }, rules: { "color-contrast": { enabled: false } } });
    expect(result.violations.map(finding => finding.id)).toEqual([]);
  });
});
