// @vitest-environment jsdom
import type { Page } from "@playwright/test";
import { afterEach, expect, it, vi } from "vitest";
import {
  COMPASS_HOUSEHOLD_ENTRY,
  COMPASS_HOUSEHOLD_HEADING,
  compassHouseholdEntryObserved,
} from "./compass-household-entry";

function fixture(url = COMPASS_HOUSEHOLD_ENTRY) {
  document.body.innerHTML = `<main><h1>${COMPASS_HOUSEHOLD_HEADING}</h1>
    <input id="firstName" type="text" required maxlength="11">
    <input id="lastName" type="text" required maxlength="14">
    <input id="dob-datepicker-date" type="text" required>
    <input id="gender_male" type="radio" required>
    <input id="gender_female" type="radio" required>
    <input id="midName" type="text"><input type="hidden" id="provider-session">
    </main>`;
  let selected = "";
  const inspect = vi.fn(async (read: (elements: Element[]) => unknown) =>
    read([...document.querySelectorAll(selected)]),
  );
  const visible = vi.fn(async () => true);
  const page = {
    url: () => url,
    getByRole: vi.fn(() => ({ isVisible: visible })),
    locator: vi.fn((selector: string) => {
      selected = selector;
      return { evaluateAll: inspect };
    }),
  } as unknown as Page;
  return { page, inspect, visible };
}
afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});
it("recognizes the manually observed entry using public metadata without reading input values", async () => {
  const { page, inspect } = fixture();
  const value = vi.spyOn(HTMLInputElement.prototype, "value", "get");
  expect(await compassHouseholdEntryObserved(page)).toBe(true);
  expect(value).not.toHaveBeenCalled();
  await expect(inspect.mock.results[0].value).resolves.not.toContainEqual(
    expect.objectContaining({ id: "provider-session" }),
  );
  expect(page.getByRole).toHaveBeenCalledWith("heading", {
    name: COMPASS_HOUSEHOLD_HEADING,
    exact: true,
  });
});
it.each([
  "https://example.test/intake/#/applynow/household/householdDetails",
  "https://www.compass.dhs.pa.gov/intake/#/applynow/household",
  `${COMPASS_HOUSEHOLD_ENTRY}?different=screen`,
  "https://www.compass.dhs.pa.gov/intake/#/applynow/gettingstarted/familysafety",
])(
  "does not infer verified entry from a different origin or household-like URL: %s",
  async (url) => {
    const { page, inspect } = fixture(url);
    expect(await compassHouseholdEntryObserved(page)).toBe(false);
    expect(inspect).not.toHaveBeenCalled();
  },
);
it("rejects an absent/hidden heading and changed required fields", async () => {
  const { page, visible, inspect } = fixture();
  visible.mockResolvedValueOnce(false);
  expect(await compassHouseholdEntryObserved(page)).toBe(false);
  expect(inspect).not.toHaveBeenCalled();
  document.getElementById("lastName")!.removeAttribute("required");
  expect(await compassHouseholdEntryObserved(page)).toBe(false);
  document.getElementById("lastName")!.setAttribute("required", "");
  document
    .getElementById("dob-datepicker-date")!
    .setAttribute("type", "hidden");
  expect(await compassHouseholdEntryObserved(page)).toBe(false);
});
it("does not confirm a screen that navigated away during observation", async () => {
  const { page, inspect } = fixture();
  const original = page.url;
  inspect.mockImplementationOnce(async (read) => {
    const result = read([
      ...document.querySelectorAll('main input:not([type="hidden"])'),
    ]);
    page.url = () => "https://www.compass.dhs.pa.gov/intake/#/unknown";
    return result;
  });
  expect(await compassHouseholdEntryObserved(page)).toBe(false);
  page.url = original;
});
