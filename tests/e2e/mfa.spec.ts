import { freshTotp, totp } from "../../scripts/test-support/totp";
import { test, expect, activate, accessible } from "./helpers";

test("administrators enroll and verify an authenticator, including bad codes and returning sign-in", async ({ page, local }) => {
  const staff = await local.staff(false, "admin");
  async function enterPassword() {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(staff.email);
    await page.getByLabel("Password", { exact: true }).fill(staff.password);
    await activate(page, page.getByRole("button", { name: "Sign in", exact: true }));
    await expect(page).toHaveURL(/\/verify-account/);
  }
  await enterPassword();
  await activate(page, page.getByRole("button", { name: "Set up an authenticator", exact: true }));
  const secret = (await page.locator("details code").textContent())!.trim();
  await accessible(page);
  await page.getByLabel("Authenticator code").fill(totp(secret) === "000000" ? "000001" : "000000");
  await activate(page, page.getByRole("button", { name: "Verify code", exact: true }));
  await expect(page.getByRole("alert").filter({ hasText: "couldn't confirm verification" })).toBeVisible();
  await page.getByLabel("Authenticator code").fill(await freshTotp(secret));
  await activate(page, page.getByRole("button", { name: "Verify code", exact: true }));
  await expect(page).toHaveURL(/\/families$/);
  await page.goto("/profile");
  await activate(page, page.getByRole("button", { name: "Sign out", exact: true }));
  await expect(page).toHaveURL(/\/login/);
  await enterPassword();
  await expect(page.getByRole("button", { name: "Set up an authenticator", exact: true })).toHaveCount(0);
  await accessible(page);
  await page.getByLabel("Authenticator code").fill(await freshTotp(secret));
  await activate(page, page.getByRole("button", { name: "Verify code", exact: true }));
  await expect(page).toHaveURL(/\/families$/);
  await expect(page.getByRole("heading", { name: "Families", exact: true })).toBeVisible();
});
