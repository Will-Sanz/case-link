import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { test, expect, signIn, accessible, TEST_ORIGIN } from "./helpers";
import { localStack } from "./local-stack.mjs";

test("administrator invites by private link or email; staff cannot invite or reuse the link", async ({ page, browser, local }) => {
  const administrator = await local.staff(false, "admin");
  await signIn(page, administrator); await page.goto("/profile");
  const section = page.getByRole("region", { name: "Invite a user", exact: true });
  const email = `invite-${randomUUID()}@example.test`;
  await section.getByLabel("Their email address").fill(email);
  await section.getByRole("button", { name: "Create invite link", exact: true }).click();
  const field = section.getByLabel("Invite link", { exact: true });
  await expect(field).toBeVisible(); const link = await field.inputValue();
  expect(new URL(link).origin).toBe(TEST_ORIGIN); expect(new URL(link).search).toBe("");
  const find = async (address: string) => {
    const result = await local.operator.auth.admin.listUsers({ perPage: 1000 }); expect(result.error).toBeNull();
    const user = result.data.users.find(user => user.email === address)!; expect(user).toBeTruthy(); local.users.push(user.id); return user;
  };
  await find(email); await accessible(page);
  const separate = await browser.newContext({ baseURL: TEST_ORIGIN });
  try {
    const recipient = await separate.newPage(); await recipient.goto(link);
    await recipient.getByRole("button", { name: "Continue to password setup" }).click();
    const password = `${randomUUID()}-Synthetic!1`;
    await recipient.getByLabel("New password", { exact: true }).fill(password);
    await recipient.getByLabel("Confirm new password", { exact: true }).fill(password);
    await recipient.getByRole("button", { name: "Update password", exact: true }).click();
    await expect(recipient).toHaveURL(/\/login\?message=password-reset-success$/);
    await signIn(recipient, { email, password }); await recipient.goto("/profile");
    await expect(recipient.getByRole("heading", { name: "Invite a user", exact: true })).toHaveCount(0);
    const stack = localStack(); const staffClient = createClient(stack.API_URL, stack.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await staffClient.auth.signInWithPassword({ email, password })).error).toBeNull();
    const denied = await staffClient.functions.invoke("invite-staff", { body: { email: "forbidden@example.test", delivery: "link" } });
    expect(denied.error?.context.status).toBe(403);
    const anonymous = await browser.newContext({ baseURL: TEST_ORIGIN });
    try {
      const reused = await anonymous.newPage();
      await reused.goto(link); await reused.getByRole("button", { name: "Continue to password setup" }).click();
      await expect(reused.getByRole("alert").filter({ hasText: /invalid|expired|already used/i })).toBeVisible();
    } finally { await anonymous.close(); }
  } finally { await separate.close(); }
  await section.getByRole("button", { name: "Create invite link", exact: true }).click();
  await expect(section.getByRole("status")).toContainText("already has an account");
  await expect(field).toHaveCount(0);
  const emailRecipient = `mail-invite-${randomUUID()}@example.test`;
  await section.getByLabel("Their email address").fill(emailRecipient);
  await section.getByRole("button", { name: "Send invitation email", exact: true }).click();
  await expect(section.getByRole("status")).toContainText("Invitation sent"); await find(emailRecipient);
  expect(await local.emailLink(emailRecipient, "invite")).toContain("/auth/callback#token_hash=");
  await accessible(page);
});
