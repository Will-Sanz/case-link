import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { localStack, TEST_ORIGIN } from "./local-stack.mjs";

const local = localStack();
mkdirSync("tmp/e2e", { recursive: true });
writeFileSync("tmp/e2e/provider-control.json", "{}\n");
// Every application credential is synthetic or local; no admin key is given to the web server.
const env = {
  ...Object.fromEntries(["PATH", "HOME", "TMPDIR", "CI", "CASELINK_SUPABASE_CLI", "PLAYWRIGHT_BROWSERS_PATH"]
    .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]])),
  NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", VERCEL_ENV: "preview",
  CASELINK_ENVIRONMENT: "test", CASELINK_TENANCY_MODE: "single-tenant", CASELINK_INVITE_ONLY: "1", CASELINK_HSTS: "1",
  NEXT_PUBLIC_SITE_URL: TEST_ORIGIN, NEXT_PUBLIC_APP_URL: TEST_ORIGIN,
  NEXT_PUBLIC_SUPABASE_URL: local.API_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: "unavailable-to-the-browser-test-app", DATABASE_URL: "unavailable-to-the-browser-test-app",
  OPENAI_API_KEY: "caselink-e2e-not-a-secret", OPENAI_MODEL_OVERRIDE: "", OPENAI_PLAN_MODEL: "",
  OPENAI_UI_MODEL: "", OPENAI_PLAN_PHASE_MODEL: "", OPENAI_PLAN_PHASE_THINKING_MODEL: "", OPENAI_THINKING_UI_MODEL: "",
  OPENAI_DEBUG: "0", OPENAI_PAYLOAD_DEBUG: "0", PLAN_REFINE_DEBUG: "0", PLAN_REGENERATE_DEBUG: "0",
  OPENAI_MAX_INPUT_CHARS: "120000", OPENAI_MAX_OUTPUT_TOKENS: "8192",
};
for (const args of [["run", "build"], ["exec", "playwright", "test", "--", ...process.argv.slice(2)]]) {
  const result = spawnSync("npm", args, { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
