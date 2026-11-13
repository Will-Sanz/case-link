// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PecoApplicationFormFields, PecoApplicationNotice } from "./peco-application-form";
import { pecoApplicationFieldsValueSchema, type PecoApplicationFields } from "@/lib/parent/peco-application-fields";

afterEach(cleanup);
function Form({ initial = {} }: { initial?: PecoApplicationFields }) {
  const [value, setValue] = useState(initial);
  return <><PecoApplicationNotice/><PecoApplicationFormFields value={value} onChange={setValue}/><output data-testid="saved-value">{JSON.stringify(value)}</output></>;
}
const value = () => JSON.parse(screen.getByTestId("saved-value").textContent!);
describe("PECO grouped private preparation fields", () => {
  it("puts the full notice before inputs and invents no journey, enrollment, household or service address", () => {
    const { container } = render(<Form/>);
    const notice = screen.getByRole("region", { name: "PECO private information notice" });
    expect(notice.compareDocumentPosition(screen.getByLabelText("PECO account number")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notice.children).toHaveLength(1);
    for (const name of ["What PECO CAP help is needed?", "Is this account already enrolled in CAP?", "PECO service ZIP code", "PECO service state", "Is this the full household list?", "PECO text update preference"])
      expect((screen.getByLabelText(name) as HTMLInputElement).value).toBe("");
    expect(value()).toEqual({});
    expect(container.querySelector("input[type=number]")).toBeNull();
    expect(screen.queryByLabelText(/Social Security number|ITIN|signature|password|income amount|payment/i)).toBeNull();
  });
  it("keeps applicant identity stable while correcting or clearing names and preserves unresolved CAP routing", () => {
    render(<Form/>);
    fireEvent.change(screen.getByLabelText("Applicant first name"), { target: { value: "Alex" } });
    const id = value().applicant.id;
    fireEvent.change(screen.getByLabelText("Applicant first name"), { target: { value: "Corrected" } });
    fireEvent.change(screen.getByLabelText("Applicant last name"), { target: { value: "Example" } });
    fireEvent.change(screen.getByLabelText("Applicant first name"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("What PECO CAP help is needed?"), { target: { value: "unknown" } });
    expect(value()).toEqual({ journey: "unknown", applicant: { id, lastName: "Example" } });
    expect(pecoApplicationFieldsValueSchema.safeParse(value()).success).toBe(true);
  });
  it("keeps person IDs internal and distinct while same-age members change or others are removed", () => {
    render(<Form/>);
    fireEvent.click(screen.getByRole("button", { name: "Add a household member" }));
    const first = value().householdMembers[0].id;
    expect(document.activeElement).toBe(screen.getByLabelText("Household member 1 first name"));
    fireEvent.change(screen.getByLabelText("Household member 1 first name"), { target: { value: "Alex" } });
    fireEvent.change(screen.getByLabelText("Household member 1 date of birth"), { target: { value: "1990-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Add a household member" }));
    const second = value().householdMembers[1].id;
    expect(first).not.toBe(second);
    fireEvent.change(screen.getByLabelText("Household member 2 date of birth"), { target: { value: "1990-01-01" } });
    fireEvent.change(screen.getByLabelText("Household member 1 first name"), { target: { value: "Corrected" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove household member 2" }));
    expect(value().householdMembers).toEqual([{ id: first, firstName: "Corrected", dateOfBirth: "1990-01-01" }]);
    expect(screen.queryByRole("textbox", { name: /identifier|uuid/i })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add a household member" }));
  });
  it("allows an explicitly complete one-person roster without inferring names or income", () => {
    render(<Form/>);
    fireEvent.change(screen.getByLabelText("Is this the full household list?"), { target: { value: "true" } });
    expect(value()).toEqual({ householdComplete: true, applicant: { id: expect.any(String) }, householdMembers: [] });
    expect(pecoApplicationFieldsValueSchema.safeParse(value()).success).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Add a household member" }));
    expect(value().householdComplete).toBeUndefined();
    expect(value().applicant.income).toBeUndefined();
  });
  it("records separate same-type income sources with stable IDs and clears hidden sources after an explicit change", () => {
    render(<Form/>);
    fireEvent.change(screen.getByLabelText("Applicant income sources"), { target: { value: "sources" } });
    expect(pecoApplicationFieldsValueSchema.safeParse(value()).success).toBe(false);
    fireEvent.change(screen.getByLabelText("Add applicant income source"), { target: { value: "employment" } });
    fireEvent.change(screen.getByLabelText("Add applicant income source"), { target: { value: "employment" } });
    const first = value().applicant.income.sources[0].id, second = value().applicant.income.sources[1].id;
    expect(first).not.toBe(second);
    fireEvent.change(screen.getByLabelText("Applicant income source 1"), { target: { value: "pension" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove applicant income source 2" }));
    expect(value().applicant.income.sources).toEqual([{ id: first, kind: "pension" }]);
    expect(pecoApplicationFieldsValueSchema.safeParse(value()).success).toBe(true);
    fireEvent.change(screen.getByLabelText("Applicant income sources"), { target: { value: "unknown" } });
    expect(value().applicant.income).toEqual({ state: "unknown", sources: [] });
    expect(screen.queryByLabelText("Applicant income source 1")).toBeNull();
    fireEvent.change(screen.getByLabelText("Applicant income sources"), { target: { value: "" } });
    expect(value().applicant.income).toBeUndefined();
  });
  it("normalizes phone formatting without enrolling in text updates or copying the routing ZIP", () => {
    render(<Form/>);
    fireEvent.change(screen.getByLabelText("Mobile phone number"), { target: { value: "2155550101" } });
    fireEvent.blur(screen.getByLabelText("Mobile phone number"));
    expect(value()).toEqual({ cellPhone: "215-555-0101" });
    fireEvent.change(screen.getByLabelText("PECO text update preference"), { target: { value: "false" } });
    expect(value().smsUpdates).toBe(false);
    fireEvent.change(screen.getByLabelText("PECO account number"), { target: { value: "1234567890" } });
    expect(pecoApplicationFieldsValueSchema.safeParse(value()).success).toBe(true);
    expect(value().address).toBeUndefined();
  });
  it("asks member income only for a known adult and clears the inventory after a child DOB correction", () => {
    render(<Form initial={{ householdMembers: [{ id: crypto.randomUUID() }] }}/>);
    expect(screen.queryByLabelText("Household member 1 income sources")).toBeNull();
    fireEvent.change(screen.getByLabelText("Household member 1 date of birth"), { target: { value: "1990-01-01" } });
    fireEvent.change(screen.getByLabelText("Household member 1 income sources"), { target: { value: "sources" } });
    fireEvent.change(screen.getByLabelText("Add household member 1 income source"), { target: { value: "employment" } });
    expect(value().householdMembers[0].income.sources).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Household member 1 date of birth"), { target: { value: "2020-01-01" } });
    expect(value().householdMembers[0].income).toBeUndefined();
    expect(screen.queryByLabelText("Household member 1 income sources")).toBeNull();
    expect(pecoApplicationFieldsValueSchema.safeParse(value()).success).toBe(true);
  });
  it("disables every private control while a save is pending", () => {
    render(<PecoApplicationFormFields value={{ householdMembers: [{ id: crypto.randomUUID() }] }} onChange={() => undefined} disabled/>);
    const group = within(screen.getByRole("group", { name: "PECO CAP preparation answers" }));
    for (const control of [...group.getAllByRole("textbox"), ...group.getAllByRole("combobox"), ...group.getAllByRole("button")]) expect(control.matches(":disabled")).toBe(true);
  });
});
