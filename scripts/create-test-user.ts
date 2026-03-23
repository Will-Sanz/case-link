/**
 * Create a case_manager test user in Supabase auth + app_users.
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env.local (or .env).
 *
 * Usage:
 *   npx tsx scripts/create-test-user.ts
 *   npx tsx scripts/create-test-user.ts other@example.com otherpassword
 *
 * Default: test@example.com / test
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { createClient } from "@supabase/supabase-js";

const defaultEmail = "test@example.com";
const defaultPassword = "test";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const email = process.argv[2]?.trim() || defaultEmail;
  const password = process.argv[3]?.trim() || defaultPassword;

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError) {
    if (
      createError.message.includes("already been registered") ||
      createError.message.toLowerCase().includes("already registered")
    ) {
      console.info("User already exists in auth. Ensuring app_users row…");
      const { data } = await supabase.auth.admin.listUsers({ perPage: 1000 });
      const found = data?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
      if (!found) {
        console.error("Could not find existing user by email.");
        process.exit(1);
      }
      const { error: upsertErr } = await supabase.from("app_users").upsert(
        { id: found.id, email: found.email!.toLowerCase(), role: "case_manager" },
        { onConflict: "id" },
      );
      if (upsertErr) {
        console.error("Upsert app_users failed:", upsertErr.message);
        process.exit(1);
      }
      console.info(`Test user ready (existing): ${email}`);
      console.info("If login fails, reset the password in Supabase Dashboard → Authentication → Users.");
      return;
    }
    console.error("Create user failed:", createError.message);
    process.exit(1);
  }

  if (!created.user) {
    console.error("No user returned.");
    process.exit(1);
  }

  const { error: insertErr } = await supabase.from("app_users").insert({
    id: created.user.id,
    email: created.user.email!.toLowerCase(),
    role: "case_manager",
  });

  if (insertErr) {
    console.error("app_users insert failed:", insertErr.message);
    process.exit(1);
  }

  console.info(`Test user created: ${email} / ${password}`);
  console.info("Role: case_manager. Sign in at /login");
}

main();
