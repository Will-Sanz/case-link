import { test, expect, signIn, createPlan } from "./helpers";

test.use({ timezoneId: "Pacific/Auckland" });

test("saved meeting history hydrates identically across server and browser timezones", async ({ page, local }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const staff = await local.staff();
  await signIn(page, staff);
  const familyId = await createPlan(page);
  await local.db.query(`insert into public.case_progress_updates
    (id, family_id, plan_id, author_id, occurred_on, summary, plan_changes, created_at)
    select gen_random_uuid(), family_id, id, $2, '2026-10-18', 'The family agreed on a practical next step.', '[]', '2026-10-19T03:30:00Z'
    from public.plans where family_id = $1`, [familyId, staff.id]);
  await page.reload();
  await expect(page.getByText(/^Saved Oct 18, 2026, 11:30 PM/)).toBeVisible();
  await page.getByRole("button", { name: "Record meeting progress", exact: true }).click();
  await expect(page.getByLabel("What changed since the last meeting?", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
