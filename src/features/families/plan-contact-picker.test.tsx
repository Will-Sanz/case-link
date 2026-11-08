/** @vitest-environment jsdom */
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlanContactPicker } from "./plan-contact-picker";
import { contactsForResourceIds, planResourceCatalog, type PlanContact } from "@/lib/matching/plan-resources";
import { directoryCase, directoryId, directoryStamp } from "../../../tests/fixtures/directory-case";

const choices = contactsForResourceIds([directoryId],planResourceCatalog(directoryCase().resourceMatches));
function Editor({ initial }: {initial: PlanContact[]}) {
  const [value,setValue] = useState(initial);
  return <><PlanContactPicker choices={choices} value={value} onChange={setValue}/><output data-testid="value">{JSON.stringify(value)}</output></>;
}
describe("directory selection", () => {
  it("restores references without silently changing a source, and allows an explicit removal", () => {
    render(<Editor initial={[{source_resource_id:directoryId,source_updated_at:directoryStamp}]}/>);
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/215-555-0148/)).toBeTruthy();
    expect(screen.getByTestId("value").textContent).not.toContain("215-555");
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByTestId("value").textContent).toBe("[]");
    fireEvent.click(screen.getByRole("checkbox"));
    expect(JSON.parse(screen.getByTestId("value").textContent!)).toEqual(choices);
  });
  it.each(["legacy","changed"])("preserves a %s contact until the person explicitly replaces or removes it", kind => {
    const contact = kind === "legacy" ? {name:"Previous office"} : {...choices[0],source_updated_at:"2020-01-01T00:00:00Z"};
    render(<Editor initial={[contact]}/>);
    expect(screen.getByText(/needs a current directory source/)).toBeTruthy();
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect(JSON.parse(screen.getByTestId("value").textContent!)).toEqual([contact]);
    fireEvent.click(screen.getByRole("button",{name:/Remove/}));
    fireEvent.click(screen.getByRole("checkbox"));
    expect(JSON.parse(screen.getByTestId("value").textContent!)).toEqual(choices);
  });
});
