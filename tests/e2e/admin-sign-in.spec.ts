import { test, expect, activate, accessible } from "./helpers";

test.use({ locale: "en-GB", timezoneId: "Pacific/Auckland" });

test("invited administrators use password-only sign-in on first and returning visits", async ({ page, local }) => {
  const browserErrors: string[] = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  const staff = await local.staff(false, "admin");
  async function enterPassword() {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(staff.email);
    await page.getByLabel("Password", { exact: true }).fill(staff.password);
    await activate(page, page.getByRole("button", { name: "Sign in", exact: true }));
    await expect(page).toHaveURL(/\/families$/);
    await expect(page.getByRole("heading", { name: "Families", exact: true })).toBeVisible();
  }
  await enterPassword();
  await page.goto("/verify-account?next=https://example.test");
  await expect(page).toHaveURL(/\/families$/);
  await page.goto("/profile");
  await expect(page.getByRole("link", { name: "Manage two-step verification" })).toHaveCount(0);
  await accessible(page);
  expect(browserErrors).toEqual([]);
  await activate(page, page.getByRole("button", { name: "Sign out", exact: true }));
  await expect(page).toHaveURL(/\/login/);
  await enterPassword();
  await accessible(page);
  expect(browserErrors).toEqual([]);
});
