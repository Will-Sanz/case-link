import { test, expect, activate, signIn, createPlan } from "./helpers";

test("a lost session recovers this account's draft while sign-out and account switching clear it", async ({ page, context, local }) => {
  const staff = await local.staff();
  const other = await local.staff();
  await signIn(page, staff);
  const familyId = await createPlan(page);
  const planUrl = page.url();
  let article = page.locator("article[id^=step-]").first();
  await activate(page, article.getByRole("button", { name: "Edit action", exact: true }));
  await article.getByRole("textbox", { name: "Action 1", exact: true }).fill("Recover this agreed preparation task");
  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith("caselink:local-action-draft:")).length)).toBe(1);
  await local.db.query("delete from auth.sessions where user_id=$1", [staff.id]);
  await context.clearCookies();
  page.once("dialog", dialog => dialog.accept());
  await page.reload();
  await expect(page).toHaveURL(/\/login/);
  await signIn(page, staff);
  await page.goto(planUrl);
  await activate(page, page.getByRole("button", { name: "Restore edit", exact: true }));
  article = page.locator("article[id^=step-]").first();
  await expect(article.getByRole("textbox", { name: "Action 1", exact: true })).toHaveValue("Recover this agreed preparation task");
  page.once("dialog", dialog => dialog.accept());
  await page.goto("/profile");
  await activate(page, page.getByRole("button", { name: "Sign out", exact: true }));
  await expect(page).toHaveURL(/\/login/);
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith("caselink:local-action-draft:")))).toEqual([]);
  await signIn(page, other);
  for (const section of ["plan", "assistant"]) {
    await page.goto(`/families/${familyId}/${section}`);
    await expect(page.getByText("Recover this agreed preparation task", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Restore edit", exact: true })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Message the assistant" })).toHaveCount(0);
  }
  await page.goto("/profile");
  await activate(page, page.getByRole("button", { name: "Sign out", exact: true }));
  await signIn(page, staff);
  await page.goto(planUrl);
  await expect(page.getByRole("button", { name: "Restore edit", exact: true })).toHaveCount(0);
  await expect(page.getByText("Recover this agreed preparation task", { exact: true })).toHaveCount(0);
});
