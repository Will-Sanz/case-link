/**
 * Create an admin user in Supabase auth + app_users.
 * Requires SUPABASE_SERVICE_ROLE_KEY.
 *
 * Usage: npx tsx scripts/create-admin-user.ts [email] [password]
 * Default: admin@example.com / admin
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { createClient } from "@supabase/supabase-js";

const defaultEmail = "admin@example.com";
const defaultPassword = "admin";

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

  const { data: user, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError) {
    if (createError.message.includes("already been registered")) {
      console.info("User already exists. Looking up and ensuring admin role...");
      const { data } = await supabase.auth.admin.listUsers({ perPage: 1000 });
      const found = data?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
      if (!found) {
        console.error("Could not find existing user by email.");
        process.exit(1);
      }
      const { error: upsertErr } = await supabase.from("app_users").upsert(
        { id: found.id, email: found.email!, role: "admin" },
        { onConflict: "id" }
      );
      if (upsertErr) {
        console.error("Upsert app_users failed:", upsertErr.message);
        process.exit(1);
      }
      console.info(`Admin user ready: ${email} / ${password}`);
      return;
    }
    console.error("Create user failed:", createError.message);
    process.exit(1);
  }

  if (!user.user) {
    console.error("No user returned.");
    process.exit(1);
  }

  await supabase.from("app_users").insert({
    id: user.user.id,
    email: user.user.email!,
    role: "admin",
  });

  console.info(`Admin user created: ${email} / ${password}`);
}

main();
