import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
/** @returns {Record<string, string | undefined>} */
export function parentTestEnvironment(useLocalServices = false) {
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

  if (useLocalServices) {
    assert.ok(
      process.env.CASELINK_SUPABASE_CLI,
      "Set CASELINK_SUPABASE_CLI for actual local service tests.",
    );
    const status = JSON.parse(
      execFileSync(
        process.env.CASELINK_SUPABASE_CLI,
        [
          "status",
          "--workdir",
          resolve(import.meta.dirname, "../tmp/parent-runtime"),
          "--output",
          "json",
        ],
        {
          encoding: "utf8",
          env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
          stdio: ["ignore", "pipe", "pipe"],
        },
      ),
    );
    assert.equal(
      status.API_URL,
      "http://127.0.0.1:55321",
      "Actual tests must use the isolated local API.",
    );
    const database = new URL(status.DB_URL);
    assert.equal(database.hostname, "127.0.0.1");
    assert.equal(database.port, "55322");
    assert.equal(
      status.MAILPIT_URL ?? status.INBUCKET_URL,
      "http://127.0.0.1:55324",
    );
    const key = status.ANON_KEY;
    assert.equal(
      JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role,
      "anon",
      "Only the public local API key belongs in the web runtime.",
    );
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY = key;
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = key;
  }

  return env;
}
