/** @returns {Record<string, string | undefined>} */
export function parentTestEnvironment() {
  const inherited = Object.fromEntries(
    [
      "PATH",
      "HOME",
      "TMPDIR",
      "CI",
      "PLAYWRIGHT_BROWSERS_PATH",
      "CASELINK_PARENT_SQL_FIXTURE_MODULE",
    ]
      .filter((key) => process.env[key] !== undefined)
      .map((key) => [key, process.env[key]]),
  );
  const env = {
    ...inherited,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    VERCEL_ENV: "development",
    CASELINK_PRODUCT: "parent",
    CASELINK_ENVIRONMENT: "test",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_synthetic",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic",
    NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3200",
    OPENAI_API_KEY: "",
    OPENAI_DEBUG: "0",
    OPENAI_PAYLOAD_DEBUG: "0",
  };
  for (const key of [
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SECRET_KEY",
    "DATABASE_URL",
    "POSTGRES_URL",
    "POSTGRES_URL_NON_POOLING",
    "CASELINK_PARENT_WORKER_DATABASE_URL",
    "CASELINK_PARENT_STORAGE_TOKEN",
    "RESEND_API_KEY",
  ])
    env[key] = "";

  return env;
}
