import type { Page } from "@playwright/test";

export const COMPASS_HOUSEHOLD_ENTRY =
  "https://www.compass.dhs.pa.gov/intake/#/applynow/household/householdDetails";
export const COMPASS_HOUSEHOLD_HEADING =
  "Let's start by filling out details for the first person in the household.";

/** Recognizes the observed blank entry screen, never identity verification or a completed application. */
export async function compassHouseholdEntryObserved(
  page: Page,
): Promise<boolean> {
  if (page.url() !== COMPASS_HOUSEHOLD_ENTRY) return false;
  if (
    !(await page
      .getByRole("heading", { name: COMPASS_HOUSEHOLD_HEADING, exact: true })
      .isVisible())
  )
    return false;
  // Only public field definitions cross this boundary; never read values or hidden inputs.
  const fields = await page
    .locator('main input:not([type="hidden"])')
    .evaluateAll((elements) =>
      elements.map((element) => ({
        id: element.id,
        type: element.getAttribute("type"),
        required: element.hasAttribute("required"),
      })),
    );
  return (
    page.url() === COMPASS_HOUSEHOLD_ENTRY &&
    [
      ["firstName", "text"],
      ["lastName", "text"],
      ["dob-datepicker-date", "text"],
      ["gender_male", "radio"],
      ["gender_female", "radio"],
    ].every(([id, type]) =>
      fields.some(
        (field) => field.id === id && field.type === type && field.required,
      ),
    )
  );
}
