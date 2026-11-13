// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WicApplicationFormFields, WicApplicationNotice } from "./wic-application-form";
import type { WicApplicationFields } from "@/lib/parent/wic-application-fields";

afterEach(cleanup);
function Form({ initial = {} }: { initial?: WicApplicationFields }) {
  const [value, setValue] = useState(initial);
  return <><WicApplicationNotice/><WicApplicationFormFields value={value} onChange={setValue}/><output data-testid="saved-value">{JSON.stringify(value)}</output></>;
}
describe("WIC grouped private fields", () => {
  it("shows the full notice before private inputs without adding unrelated or invented answers", () => {
    const { container } = render(<Form/>);
    const notice = screen.getByRole("region", { name: "WIC private information notice" });
    expect(notice.compareDocumentPosition(screen.getByLabelText("Contact first name")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notice.children).toHaveLength(1);
    expect((screen.getByLabelText("Contact postal ZIP code") as HTMLInputElement).value).toBe("");
    expect(container.querySelector("input[type=number]")).toBeNull();
    expect(screen.queryByLabelText(/race|ethnicity|Medical Assistance|income|Social Security|signature/i)).toBeNull();
    expect((screen.getByLabelText("WIC application status") as HTMLInputElement).value).toBe("");
  });
  it("copies contact identity only after the explicit same-person choice and follows later contact edits", () => {
    render(<Form initial={{ beneficiaries: "mother", contact: { firstName: "Contact", lastName: "Example", dateOfBirth: "1990-01-01" } }}/>);
    expect((screen.getByLabelText("Mother first name") as HTMLInputElement).value).toBe("");
    const choice = screen.getByRole("checkbox", { name: /The mother is the contact person/ });
    fireEvent.click(choice);
    expect((screen.getByLabelText("Mother first name") as HTMLInputElement).value).toBe("Contact");
    expect((screen.getByLabelText("Mother date of birth") as HTMLInputElement).value).toBe("1990-01-01");
    fireEvent.change(screen.getByLabelText("Contact first name"), { target: { value: "Updated" } });
    expect((screen.getByLabelText("Mother first name") as HTMLInputElement).value).toBe("Updated");
    fireEvent.change(screen.getByLabelText("Mother first name"), { target: { value: "Different" } });
    expect((choice as HTMLInputElement).checked).toBe(false);
    fireEvent.change(screen.getByLabelText("Contact first name"), { target: { value: "Other" } });
    expect((screen.getByLabelText("Mother first name") as HTMLInputElement).value).toBe("Different");
  });
  it("keeps child IDs internal and stable while names are corrected or other children removed", () => {
    render(<Form initial={{ beneficiaries: "children" }}/>);
    fireEvent.click(screen.getByRole("button", { name: "Add a child" }));
    const first = JSON.parse(screen.getByTestId("saved-value").textContent!).children[0].id;
    fireEvent.change(screen.getByLabelText("Child 1 first name"), { target: { value: "Alex" } });
    fireEvent.click(screen.getByRole("button", { name: "Add a child" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove child 2" }));
    expect(JSON.parse(screen.getByTestId("saved-value").textContent!).children[0]).toEqual({ id: first, firstName: "Alex" });
    expect(screen.queryByRole("textbox", { name: /identifier|uuid/i })).toBeNull();
    expect((screen.getByLabelText("Child 1 last name") as HTMLInputElement).value).toBe("");
  });
  it("clears hidden maternal/child branches and pregnancy dates instead of keeping stale private values", () => {
    render(<Form initial={{ beneficiaries: "mother_and_children", mother: { status: "pregnant", expectedDeliveryDate: "2027-01-01" }, children: [{ id: crypto.randomUUID(), firstName: "Child" }] }}/>);
    fireEvent.change(screen.getByLabelText("Mother’s WIC status"), { target: { value: "postpartum" } });
    expect(screen.queryByLabelText("Expected delivery date")).toBeNull();
    expect(JSON.parse(screen.getByTestId("saved-value").textContent!).mother.expectedDeliveryDate).toBeUndefined();
    fireEvent.change(screen.getByLabelText("Who is applying for WIC?"), { target: { value: "children" } });
    expect(JSON.parse(screen.getByTestId("saved-value").textContent!).mother).toBeUndefined();
    fireEvent.change(screen.getByLabelText("Who is applying for WIC?"), { target: { value: "mother" } });
    expect(JSON.parse(screen.getByTestId("saved-value").textContent!).children).toBeUndefined();
  });
  it("disables every private control while a save is pending", () => {
    render(<WicApplicationFormFields value={{ beneficiaries: "children" }} onChange={() => undefined} disabled/>);
    for (const control of within(screen.getByRole("group", { name: "WIC pre-application answers" })).getAllByRole("textbox")) expect(control.matches(":disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Add a child" }).matches(":disabled")).toBe(true);
  });
});
