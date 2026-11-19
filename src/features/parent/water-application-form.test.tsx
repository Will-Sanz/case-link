// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WaterApplicationFormFields, WaterApplicationNotice } from "./water-application-form";
import { assessWaterApplicationFields, waterApplicationFieldsValueSchema, type WaterApplicationFields } from "@/lib/parent/water-application-fields";

const now = new Date("2026-11-13T22:20:00Z");
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
function Form({ initial = {} }: { initial?: WaterApplicationFields }) {
  const [value, setValue] = useState(initial);
  return <><WaterApplicationNotice/><WaterApplicationFormFields value={value} onChange={setValue}/><output data-testid="saved-value">{JSON.stringify(value)}</output></>;
}
const value = () => JSON.parse(screen.getByTestId("saved-value").textContent!);
describe("water grouped private reference preparation", () => {
  it("places meaningful notice before inputs without collecting protected account access or choosing an application", () => {
    const { container } = render(<Form/>);
    const notice = screen.getByRole("region", { name: "Water private information notice" });
    expect(notice.compareDocumentPosition(screen.getByLabelText("Applicant full name")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notice.children).toHaveLength(1);
    expect(notice.textContent).toContain("SAMPLE – Do Not Submit");
    for (const label of ["What water assistance help is needed?", "Have you already started or sent a City water assistance application?", "Is this the full household list?", "Water property address"])
      expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe("");
    expect(value()).toEqual({});
    expect(container.querySelector("input[type=number]")).toBeNull();
    expect(screen.queryByLabelText(/water access code|application id|social security|tax id|signature|password|medical|abuse/i)).toBeNull();
  });
  it("keeps applicant identity stable and never infers gross income or an existing City status", () => {
    render(<Form/>);
    fireEvent.change(screen.getByLabelText("Applicant full name"), { target: { value: "Alex Example" } });
    const id = value().applicant.id;
    fireEvent.change(screen.getByLabelText("Applicant full name"), { target: { value: "Corrected" } });
    fireEvent.change(screen.getByLabelText("What water assistance help is needed?"), { target: { value: "pending" } });
    fireEvent.change(screen.getByLabelText("Have you already started or sent a City water assistance application?"), { target: { value: "submitted" } });
    expect(value()).toEqual({ applicant: { id, name: "Corrected" }, journey: "pending", existingApplication: "submitted" });
    expect(assessWaterApplicationFields(value(), now)).toMatchObject({ submissionReady: false, providerStatus: "unverified" });
    expect(screen.getByText(/This records your report/)).toBeTruthy();
  });
  it("uses exact dollar strings and permits a partial applicant, including a minor with a separate gross box", () => {
    render(<Form/>);
    fireEvent.change(screen.getByLabelText("Applicant date of birth"), { target: { value: "2009-01-01" } });
    fireEvent.change(screen.getByLabelText("Applicant gross monthly income in dollars"), { target: { value: "12.3" } });
    expect(value().applicant.grossMonthlyIncome).toBe("12.3");
    expect(waterApplicationFieldsValueSchema.parse(value()).applicant?.grossMonthlyIncome).toBe("12.30");
    expect(assessWaterApplicationFields(value(), now).householdIncome).toEqual([{ subjectId: value().applicant.id, amount: "12.30", basis: "parent_answer" }]);
  });
  it("keeps member UUIDs internal and stable across corrections and removal", () => {
    render(<Form/>);
    fireEvent.click(screen.getByRole("button", { name: "Add a household member" }));
    const first = value().householdMembers[0].id;
    expect(document.activeElement).toBe(screen.getByLabelText("Household member 1 full name"));
    fireEvent.change(screen.getByLabelText("Household member 1 full name"), { target: { value: "First Child" } });
    fireEvent.click(screen.getByRole("button", { name: "Add a household member" }));
    expect(value().householdMembers[1].id).not.toBe(first);
    fireEvent.click(screen.getByRole("button", { name: "Remove household member 2" }));
    expect(value().householdMembers).toEqual([{ id: first, name: "First Child" }]);
    expect(screen.queryByLabelText(/UUID|identifier/i)).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add a household member" }));
  });
  it("shows no income questions for an unknown or under18 other member and derives only the sample reference zero", () => {
    render(<Form initial={{ householdMembers: [{ id: crypto.randomUUID() }] }}/>);
    expect(screen.queryByLabelText("Household member 1 gross monthly income in dollars")).toBeNull();
    fireEvent.change(screen.getByLabelText("Household member 1 date of birth"), { target: { value: "2020-01-01" } });
    expect(screen.queryByLabelText("Household member 1 income sources")).toBeNull();
    expect(value().householdMembers[0].grossMonthlyIncome).toBeUndefined();
    expect(assessWaterApplicationFields(value(), now).householdIncome).toEqual([{ subjectId: value().householdMembers[0].id, amount: "0.00", basis: "sample_under_18_instruction" }]);
  });
  it("preserves previously supplied answers when a DOB correction changes reference treatment", () => {
    const id = crypto.randomUUID();
    render(<Form initial={{ householdMembers: [{ id, dateOfBirth: "1990-01-01", grossMonthlyIncome: "123.45", income: { state: "unknown", sources: [] } }] }}/>);
    fireEvent.change(screen.getByLabelText("Household member 1 date of birth"), { target: { value: "2020-01-01" } });
    expect(value().householdMembers[0]).toMatchObject({ id, grossMonthlyIncome: "123.45", income: { state: "unknown" } });
    expect(assessWaterApplicationFields(value(), now).householdIncome[0].amount).toBe("0.00");
  });
  it("records separate same-type sources with stable IDs and clears the list after an explicit inventory change", () => {
    render(<Form/>);
    fireEvent.change(screen.getByLabelText("Applicant income sources"), { target: { value: "sources" } });
    expect(waterApplicationFieldsValueSchema.safeParse(value()).success).toBe(false);
    fireEvent.change(screen.getByLabelText("Add applicant income source"), { target: { value: "employment" } });
    fireEvent.change(screen.getByLabelText("Add applicant income source"), { target: { value: "employment" } });
    const [first, second] = value().applicant.income.sources;
    expect(first.id).not.toBe(second.id);
    fireEvent.change(screen.getByLabelText("Applicant income source 1"), { target: { value: "pension" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove applicant income source 2" }));
    expect(value().applicant.income.sources).toEqual([{ id: first.id, kind: "pension" }]);
    fireEvent.change(screen.getByLabelText("Applicant income sources"), { target: { value: "unknown" } });
    expect(value().applicant.income).toEqual({ state: "unknown", sources: [] });
    expect(waterApplicationFieldsValueSchema.safeParse(value()).success).toBe(true);
  });
  it("allows an explicitly complete single-person household without invented identity or income", () => {
    render(<Form/>);
    fireEvent.change(screen.getByLabelText("Is this the full household list?"), { target: { value: "true" } });
    expect(value()).toEqual({ householdComplete: true, applicant: { id: expect.any(String) }, householdMembers: [] });
    fireEvent.click(screen.getByRole("button", { name: "Add a household member" }));
    expect(value().householdComplete).toBeUndefined();
  });
  it("clears hidden conditional support details only after an explicit support choice", () => {
    render(<Form/>);
    const childLabel = "Does someone in the household receive child support?", outsideLabel = "Does anyone in the household receive financial support from someone outside the household?";
    fireEvent.change(screen.getByLabelText(childLabel), { target: { value: "yes" } });
    fireEvent.change(screen.getByLabelText("Monthly child support in dollars"), { target: { value: "25.10" } });
    fireEvent.change(screen.getByLabelText(outsideLabel), { target: { value: "yes" } });
    fireEvent.click(screen.getByRole("button", { name: "Add an outside supporter" }));
    const id = value().outsideSupporters[0].id;
    expect(document.activeElement).toBe(screen.getByLabelText("Outside supporter 1 full name"));
    fireEvent.change(screen.getByLabelText("Outside supporter 1 full name"), { target: { value: "Supporter Example" } });
    fireEvent.change(screen.getByLabelText("Outside supporter 1 support frequency"), { target: { value: "other" } });
    fireEvent.change(screen.getByLabelText("Outside supporter 1 other frequency"), { target: { value: "Each school term" } });
    expect(value().outsideSupporters[0]).toMatchObject({ id, name: "Supporter Example", frequencyDescription: "Each school term" });
    fireEvent.change(screen.getByLabelText("Outside supporter 1 support frequency"), { target: { value: "monthly" } });
    expect(value().outsideSupporters[0].frequencyDescription).toBeUndefined();
    fireEvent.change(screen.getByLabelText(childLabel), { target: { value: "unknown" } });
    fireEvent.change(screen.getByLabelText(outsideLabel), { target: { value: "no" } });
    expect(value().childSupportMonthlyAmount).toBeUndefined(); expect(value().outsideSupporters).toBeUndefined();
    expect(waterApplicationFieldsValueSchema.safeParse(value()).success).toBe(true);
  });
  it("keeps property address independent of routing and normalizes only an entered phone", () => {
    render(<Form/>);
    fireEvent.change(screen.getByLabelText("Daytime phone number"), { target: { value: "2155550101" } });
    fireEvent.blur(screen.getByLabelText("Daytime phone number"));
    expect(value()).toEqual({ phone: "215-555-0101" });
    fireEvent.change(screen.getByLabelText("Water property address"), { target: { value: "123 Fictional Ave, Philadelphia PA 19147" } });
    expect(value().propertyAddress).toContain("19147"); expect(value().zip).toBeUndefined();
  });
  it("disables all private controls during a save", () => {
    render(<WaterApplicationFormFields value={{ householdMembers: [{ id: crypto.randomUUID() }], outsideIncomeSupport: "yes", outsideSupporters: [{ id: crypto.randomUUID() }] }} onChange={() => undefined} disabled/>);
    const group = within(screen.getByRole("group", { name: "Water assistance preparation answers" }));
    for (const control of [...group.getAllByRole("textbox"), ...group.getAllByRole("combobox"), ...group.getAllByRole("button")]) expect(control.matches(":disabled")).toBe(true);
  });
  it("asks applicable financial explanations together from the applicant's supplied zero without asking again", () => {
    render(<Form/>);
    const outside = "Does anyone in the household receive financial support from someone outside the household?";
    fireEvent.change(screen.getByLabelText("Applicant gross monthly income in dollars"), { target: { value: "0" } });
    expect(screen.queryByLabelText("How does the applicant pay for food?")).toBeNull();
    fireEvent.change(screen.getByLabelText(outside), { target: { value: "no" } });
    for (const label of ["How does the applicant pay for food?", "How does the applicant pay for housing?", "How does the applicant pay for utility service?"])
      expect(screen.getByLabelText(label)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("How does the applicant pay for food?"), { target: { value: "Using savings\nA household adult buys groceries" } });
    expect(value().livingExpenses.food).toBe("Using savings A household adult buys groceries");
    expect(waterApplicationFieldsValueSchema.safeParse(value()).success).toBe(true);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByLabelText("Does the applicant report zero income for this application?")).toBeNull();
    fireEvent.change(screen.getByLabelText(outside), { target: { value: "yes" } });
    expect(screen.queryByLabelText("How does the applicant pay for food?")).toBeNull();
    expect(value().livingExpenses).toBeUndefined(); expect(value().zeroIncomeClaim).toBeUndefined();
  });
  it("does not infer an applicant zero-income claim from a minor household member's sample amount", () => {
    render(<Form initial={{ householdMembers: [{ id: crypto.randomUUID(), dateOfBirth: "2020-01-01" }] }}/>);
    expect(screen.queryByLabelText("How does the applicant pay for food?")).toBeNull();
    expect(value().zeroIncomeClaim).toBeUndefined(); expect(value().livingExpenses).toBeUndefined();
  });
  it("preserves explanations during unfinished amount typing and clears them only when leaving the applicable facts", () => {
    render(<Form initial={{ applicant: { id: crypto.randomUUID(), grossMonthlyIncome: "0.00" }, outsideIncomeSupport: "no", livingExpenses: { food: "Using savings" } }}/>);
    fireEvent.change(screen.getByLabelText("Applicant gross monthly income in dollars"), { target: { value: "0." } });
    expect(value().livingExpenses.food).toBe("Using savings");
    fireEvent.change(screen.getByLabelText("Applicant gross monthly income in dollars"), { target: { value: "0.00" } });
    expect((screen.getByLabelText("How does the applicant pay for food?") as HTMLTextAreaElement).value).toBe("Using savings");
    fireEvent.change(screen.getByLabelText("Applicant gross monthly income in dollars"), { target: { value: "1.00" } });
    expect(value().livingExpenses).toBeUndefined();
    expect(screen.queryByLabelText("How does the applicant pay for food?")).toBeNull();
  });
});
