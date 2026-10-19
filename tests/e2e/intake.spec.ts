import { PRESET_BARRIERS } from "../../src/lib/constants/intake-options";
import { test, expect, activate, accessible, signIn, createFamily } from "./helpers";

test("all intake barriers retain their wording and matching category when drafting a plan", async ({ page, local }) => {
  await signIn(page, await local.staff());
  const familyId = await createFamily(page, "Family 014", PRESET_BARRIERS.map(barrier => barrier.label));
  for (const barrier of PRESET_BARRIERS) await expect(page.getByText(barrier.label, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Mental health", exact: true })).toHaveAttribute("aria-pressed", "false");
  await accessible(page);
  const before = await local.db.query("select preset_key, label from public.family_barriers where family_id=$1 order by label", [familyId]);
  await activate(page, page.getByRole("button", { name: "Draft action plan", exact: true }));
  await expect(page).toHaveURL(new RegExp(`/families/${familyId}/plan$`), { timeout: 45_000 });
  await expect(page.getByRole("button", { name: "Edit action", exact: true })).toHaveCount(3);
  const after = await local.db.query("select preset_key, label from public.family_barriers where family_id=$1 order by label", [familyId]);
  expect(after.rows).toEqual(before.rows);
  expect(after.rows).toHaveLength(PRESET_BARRIERS.length);
});
