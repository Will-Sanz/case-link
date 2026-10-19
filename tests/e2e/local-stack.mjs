import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

export const TEST_ORIGIN = "http://127.0.0.1:3100";
export const MAIL_ORIGIN = "http://127.0.0.1:3000";

/** Never load .env files or accept remote test targets. Admin credentials stay in test processes. */
export function localStack() {
  const executable = process.env.CASELINK_SUPABASE_CLI || "npx";
  const args = process.env.CASELINK_SUPABASE_CLI ? [] : ["--yes", "supabase@2.111.0"];
  const local = JSON.parse(execFileSync(executable, [...args, "status", "--output", "json"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }));
  for (const [key, port] of [["API_URL", "54321"], ["DB_URL", "54322"], ["MAILPIT_URL", "54324"]]) {
    const url = new URL(local[key]);
    assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && url.port === port,
      "Browser tests require the isolated local CaseLink stack.");
  }
  return local;
}
