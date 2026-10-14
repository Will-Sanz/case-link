import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { test as base, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { inviteUser } from "../../scripts/invite-user-operation";
import { localStack, TEST_ORIGIN, MAIL_ORIGIN } from "./local-stack.mjs";

const local = localStack();
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

function harness(db: Client) {
  const operator = createClient(local.API_URL, local.SERVICE_ROLE_KEY, options);
  const users: string[] = [];
  return {
    db, users, operator,
    async staff(invite = false, role: "case_manager" | "admin" = "case_manager") {
      const email = `browser-${randomUUID()}@example.test`;
      const password = `${randomUUID()}-Synthetic!1`;
      let id: string;
      if (invite) {
        const result = await inviteUser(operator, { email, role, siteOrigin: MAIL_ORIGIN, actorLabel: "Browser test", reason: "Synthetic invitation journey" });
        id = result.userId;
      } else {
        const result = await operator.auth.admin.createUser({ email, password, email_confirm: true });
        expect(result.error).toBeNull();
        id = result.data.user!.id;
        users.push(id);
        const granted = await operator.rpc("operator_set_user_role", { p_target_user_id: id, p_role: role, p_actor_label: "Browser test", p_reason: "Synthetic browser journey", p_action: "user.invited" });
        expect(granted.error).toBeNull();
      }
      if (!users.includes(id)) users.push(id);
      return { id, email, password };
    },
    async emailLink(email: string, type: "invite" | "recovery") {
      const subject = type === "invite" ? "You're invited to CaseLink" : "Reset your password — CaseLink";
      for (let attempt = 0; attempt < 30; attempt++) {
        const response = await fetch(`${local.MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
        const { messages } = await response.json() as { messages: { ID: string }[] };
        for (const message of messages) {
          const mail = await (await fetch(`${local.MAILPIT_URL}/api/v1/message/${message.ID}`)).json() as { Subject: string; HTML: string };
          if (mail.Subject !== subject) continue;
          for (const link of mail.HTML.matchAll(/href="([^"]+)"/g)) {
            const url = new URL(link[1].replaceAll("&amp;", "&"));
            if (new URLSearchParams(url.hash.slice(1)).get("type") !== type) continue;
            expect(url.origin).toBe(MAIL_ORIGIN);
            expect(url.search).toBe("");
            // Keep the canonical mail link assertion; map only its port to the isolated browser server.
            // The hosted domain/redirect rehearsal remains a separate release gate.
            url.port = new URL(TEST_ORIGIN).port;
            return url.href;
          }
        }
        await delay(100);
      }
      throw new Error("The expected synthetic account email did not arrive");
    },
  };
}

export const test = base.extend<{ local: ReturnType<typeof harness> }>({
  local: async ({ context }, provide) => {
    const db = new Client({ connectionString: local.DB_URL });
    await db.connect();
    const state = harness(db);
    writeFileSync("tmp/e2e/provider-control.json", "{}\n");
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      return ["127.0.0.1", "localhost"].includes(url.hostname) ? route.continue() : route.abort();
    });
    try { await provide(state); }
    finally {
      for (const page of context.pages()) await page.close();
      await db.query("delete from public.families where created_by_id = any($1::uuid[])", [state.users]);
      for (const id of state.users) expect((await state.operator.auth.admin.deleteUser(id)).error).toBeNull();
      await db.query("delete from public.security_audit_log where target_user_id = any($1::uuid[])", [state.users]);
      await db.end();
      writeFileSync("tmp/e2e/provider-control.json", "{}\n");
    }
  },
});
export { expect };
export { TEST_ORIGIN };

export async function accessible(page: Page) {
  await expect(page).toHaveTitle(/CaseLink/);
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(result.violations.map(v => ({ id: v.id, impact: v.impact, targets: v.nodes.map(n => n.target) }))).toEqual([]);
}

/** Reach and activate the control using real Tab/Enter events. */
export async function activate(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  await expect(target).toBeEnabled();
  for (let i = 0; i < 100; i++) {
    if (await target.evaluate(element => element === document.activeElement)) {
      await page.keyboard.press("Enter");
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error("The control could not be reached by keyboard");
}

export async function signIn(page: Page, staff: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(staff.email);
  await page.getByLabel("Password", { exact: true }).fill(staff.password);
  await activate(page, page.getByRole("button", { name: "Sign in", exact: true }));
  await expect(page).toHaveURL(/\/families$/);
  await expect(page.getByRole("heading", { name: "Families", exact: true })).toBeVisible();
}

export async function createFamily(page: Page, label = "Family 014", barriers = ["Housing instability"]) {
  await page.goto("/families/new");
  await page.getByLabel("Family label", { exact: true }).fill(label);
  for (const barrier of barriers) await activate(page, page.getByRole("button", { name: barrier, exact: true }));
  await page.getByLabel("Short description (optional)").fill("The family prefers a phone discussion after school. Agree the next step together.");
  await accessible(page);
  await activate(page, page.getByRole("button", { name: "Create family and continue" }));
  await expect(page).toHaveURL(/\/families\/[^/]+\/overview$/);
  return page.url().split("/").at(-2)!;
}

export async function createPlan(page: Page) {
  const familyId = await createFamily(page);
  await activate(page, page.getByRole("button", { name: "Draft action plan", exact: true }));
  await expect(page).toHaveURL(new RegExp(`/families/${familyId}/plan$`), { timeout: 45_000 });
  await expect(page.getByRole("button", { name: "Edit action", exact: true })).toHaveCount(3);
  return familyId;
}

export async function reviewPlan(page: Page) {
  await activate(page, page.getByRole("button", { name: "Mark plan reviewed", exact: true }));
  await activate(page, page.getByRole("button", { name: "Confirm dates and mark reviewed", exact: true }));
  await expect(page.getByRole("main").getByRole("link", { name: "Review PDF", exact: true })).toBeVisible();
}
