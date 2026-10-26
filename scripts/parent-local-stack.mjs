import { mkdirSync, copyFileSync, symlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
const root = resolve(import.meta.dirname, "..");
const runtime = resolve(root, "tmp/parent-runtime");
mkdirSync(resolve(runtime, "supabase"), { recursive: true });
copyFileSync(
  resolve(root, "supabase/parent/config.toml"),
  resolve(runtime, "supabase/config.toml"),
);
for (const folder of ["migrations", "email-templates"]) {
  const link = resolve(runtime, "supabase", folder);
  if (!existsSync(link))
    symlinkSync(resolve(root, "supabase", folder), link, "dir");
}
const cli = process.env.CASELINK_SUPABASE_CLI;
if (!cli)
  throw new Error(
    "Set CASELINK_SUPABASE_CLI to the installed Supabase executable.",
  );
const command = process.argv[2] ?? "start";
if (!["start", "stop", "status", "reset"].includes(command))
  throw new Error(
    "Use start, stop, status or reset for the isolated local parent stack.",
  );
const args = command === "reset" ? ["db", "reset", "--local"] : [command];
const result = spawnSync(cli, [...args, "--workdir", runtime], {
  stdio: "inherit",
  env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
});
process.exit(result.status ?? 1);
