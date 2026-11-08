import { parentConfigurationIssues } from "../src/lib/parent/configuration";

/** Public source settings only; inherited secrets and all other env-file values stay out of Next. */
export function parentConnectedEnvironment(
  source: Record<string, string>,
  approval: Record<string, string | undefined>,
  system: Record<string, string | undefined> = process.env,
): NodeJS.ProcessEnv {
  if (
    system.VERCEL ||
    ["production", "preview"].includes(system.VERCEL_ENV ?? "")
  )
    throw new Error(
      "Connected parent access cannot run in a hosted deployment.",
    );
  const env: NodeJS.ProcessEnv = {
    ...Object.fromEntries(Object.keys(source).map((key) => [key, ""])),
    ...Object.fromEntries(
      ["PATH", "HOME", "TMPDIR", "CI"].map((key) => [key, system[key]]),
    ),
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    CASELINK_PRODUCT: "parent",
    CASELINK_ENVIRONMENT: "connected",
    VERCEL_ENV: "development",
    CASELINK_PARENT_ACCOUNT_MODE: "existing",
    CASELINK_PARENT_CONNECTED_APPROVED:
      approval.CASELINK_PARENT_CONNECTED_APPROVED,
    CASELINK_PARENT_PRODUCTION_SUPABASE_URL:
      approval.CASELINK_PARENT_PRODUCTION_SUPABASE_URL,
    CASELINK_SCHOOL_SUPABASE_URL:
      approval.CASELINK_PARENT_PRODUCTION_SUPABASE_URL,
    CASELINK_PARENT_RECOVERY_SITE_URL:
      approval.CASELINK_PARENT_RECOVERY_SITE_URL,
    NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3200",
    NEXT_PUBLIC_SUPABASE_URL: source.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: source.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    CASELINK_PARENT_EMAIL_CODE_ENABLED: "0",
    OPENAI_DEBUG: "0",
    OPENAI_PAYLOAD_DEBUG: "0",
    PLAN_REGENERATE_DEBUG: "0",
    PLAN_REFINE_DEBUG: "0",
  };
  // The public client prefers the anon field; both must contain only the same approved public credential.
  if (!env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const issues = parentConfigurationIssues(env);
  if (issues.length)
    throw new Error(
      `Connected parent configuration is not approved: ${issues.join("; ")}`,
    );
  return env;
}
