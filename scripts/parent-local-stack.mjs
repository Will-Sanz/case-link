import assert from "node:assert/strict";
import {
  mkdirSync,
  chmodSync,
  copyFileSync,
  cpSync,
  lstatSync,
  unlinkSync,
  realpathSync,
  existsSync,
} from "node:fs";
import { resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function safeLocalStackOutput(output) {
  return String(output ?? "")
    .split(/\r?\n/)
    .filter(
      (line) =>
        !/\b(?:key|secret|token|password)\b|(?:ANON|SERVICE_ROLE|JWT|S3|PUBLISHABLE|SECRET)_[A-Z_]+|sb_(?:secret|publishable)_|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|postgres(?:ql)?:\/\//i.test(
          line,
        ),
    )
    .join("\n");
}

function main() {
  const root = resolve(import.meta.dirname, "..");
  const runtime = resolve(root, "tmp/parent-runtime");
  mkdirSync(resolve(runtime, "supabase"), { recursive: true, mode: 0o700 });
  chmodSync(runtime, 0o700);
  chmodSync(resolve(runtime, "supabase"), 0o700);
  copyFileSync(
    resolve(root, "supabase/parent/config.toml"),
    resolve(runtime, "supabase/config.toml"),
  );
  for (const folder of ["migrations", "email-templates"]) {
    const destination = resolve(runtime, "supabase", folder);
    // Current CLI rejects templates that resolve outside its project root.
    if (existsSync(destination) && lstatSync(destination).isSymbolicLink())
      unlinkSync(destination);
    cpSync(resolve(root, "supabase", folder), destination, { recursive: true });
    assert.ok(
      realpathSync(destination).startsWith(`${realpathSync(runtime)}${sep}`),
      "Local service assets must stay inside the synthetic runtime.",
    );
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
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
  });
  process.stdout.write(safeLocalStackOutput(result.stdout));
  process.stderr.write(safeLocalStackOutput(result.stderr));
  process.exitCode = result.status ?? 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
