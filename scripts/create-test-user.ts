/** Create a case-manager account only in an explicitly named local/test environment. */
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { validateTestProvisioning } from "./provisioning-safety";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

async function main() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const email = requireEnv("CASELINK_TEST_EMAIL").toLowerCase();
  const password = requireEnv("CASELINK_TEST_PASSWORD");
  const environment = process.env.CASELINK_ENVIRONMENT;
  const issues = validateTestProvisioning({ environment, url, email, password });
  if (issues.length > 0) throw new Error(issues.join("; "));

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const created = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  if (!created.data.user) throw new Error("No user returned.");

  const profile = await supabase.rpc("operator_set_user_role", {
    p_target_user_id: created.data.user.id,
    p_role: "case_manager",
    p_actor_label: "local test provisioning",
    p_reason: "Create an explicit local/test case-manager account",
    p_action: "user.invited",
  });
  if (profile.error) throw profile.error;
  console.info(`Test case-manager created: ${email}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Test-user provisioning failed.");
  process.exit(1);
});
