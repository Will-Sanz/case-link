import { test, expect, activate, accessible, signIn, TEST_ORIGIN } from "./helpers";

test("invitation, password setup, sign-in, separate-browser recovery, and reused link denial", async ({ page, browser, local }) => {
  const staff = await local.staff(true);
  const link = await local.emailLink(staff.email, "invite");
  await page.goto(link);
  await activate(page, page.getByRole("button", { name: "Continue to password setup" }));
  await expect(page.getByRole("heading", { name: "Set your password", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/reset-password\?mode=setup$/);
  await accessible(page);
  await page.getByLabel("New password", { exact: true }).fill(staff.password);
  await page.getByLabel("Confirm new password", { exact: true }).fill("A mismatched password!1");
  await activate(page, page.getByRole("button", { name: "Update password" }));
  await expect(page.locator("form").getByRole("alert")).toContainText(/match/);
  await page.getByLabel("Confirm new password", { exact: true }).fill(staff.password);
  await activate(page, page.getByRole("button", { name: "Update password" }));
  await expect(page).toHaveURL(/\/login\?message=password-reset-success$/);
  await accessible(page);
  await page.getByLabel("Email", { exact: true }).fill(staff.email);
  await page.getByLabel("Password", { exact: true }).fill("Wrong synthetic password!1");
  await activate(page, page.getByRole("button", { name: "Sign in", exact: true }));
  await expect(page.locator("form").getByRole("alert")).toBeVisible();
  await signIn(page, staff);
  await accessible(page);

  await page.goto("/forgot-password");
  await page.getByLabel("Email", { exact: true }).fill(staff.email);
  await activate(page, page.getByRole("button", { name: "Send reset link" }));
  await expect(page.getByRole("status")).toContainText("If an account exists");
  const recovery = await local.emailLink(staff.email, "recovery");
  const separate = await browser.newContext({ baseURL: TEST_ORIGIN });
  const reset = await separate.newPage();
  try {
    await reset.goto(recovery);
    await activate(reset, reset.getByRole("button", { name: "Continue to password setup" }));
    await expect(reset.getByLabel("New password", { exact: true })).toBeVisible();
    await expect(reset).toHaveURL(/\/reset-password\?mode=recovery$/);
    const replacement = staff.password + "Replacement";
    await reset.getByLabel("New password", { exact: true }).fill(replacement);
    await reset.getByLabel("Confirm new password", { exact: true }).fill(replacement);
    await activate(reset, reset.getByRole("button", { name: "Update password" }));
    await expect(reset).toHaveURL(/\/login\?message=password-reset-success$/);
    await page.goto("/families");
    await expect(page).toHaveURL(/\/login/);
    await signIn(reset, { ...staff, password: replacement });
    const anonymous = await browser.newContext({ baseURL: TEST_ORIGIN });
    try {
      const reused = await anonymous.newPage();
      await reused.goto(recovery);
      await activate(reused, reused.getByRole("button", { name: "Continue to password setup" }));
      await expect(reused.getByRole("alert").filter({ hasText: /invalid|expired|already used/i })).toBeVisible();
      expect(new URL(reused.url()).hash).toBe("");
    } finally { await anonymous.close(); }
  } finally { await separate.close(); }
  await page.goto("/signup");
  await expect(page).toHaveURL(/\/request-demo$/);
});
