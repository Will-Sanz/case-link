import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { z } from "zod";

export const REQUIRED_CHECKS = [
  { name: "verify", appId: 15368 },
  { name: "database-security", appId: 15368 },
  { name: "analyze", appId: 15368 },
  { name: "CodeQL", appId: 57789 },
] as const;
const checkSchema = z.object({ id: z.number().int(), name: z.string(), head_sha: z.string(), status: z.string(), conclusion: z.string().nullable(), app: z.object({ id: z.number().int() }) });

export function releaseCheckFailures(sha: string, pages: unknown): string[] {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Supply the exact 40-character candidate commit SHA.");
  const runs = z.array(z.object({ check_runs: z.array(checkSchema) })).parse(pages).flatMap(page => page.check_runs);
  return REQUIRED_CHECKS.flatMap(required => {
    const latest = runs.filter(run => run.name === required.name && run.app.id === required.appId && run.head_sha === sha).sort((a, b) => b.id - a.id)[0];
    return latest?.status === "completed" && latest.conclusion === "success" ? [] : [`${required.name}: ${latest ? `${latest.status}/${latest.conclusion ?? "pending"}` : "missing for this commit and trusted check provider"}`];
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sha = process.argv[2] ?? "";
  assert.match(sha, /^[a-f0-9]{40}$/, "Supply the exact candidate commit SHA.");
  const pages = JSON.parse(execFileSync("gh", ["api", `repos/Will-Sanz/case-link/commits/${sha}/check-runs?per_page=100`, "--paginate", "--slurp"], { encoding: "utf8" }));
  const failures = releaseCheckFailures(sha, pages);
  if (failures.length) { console.error(`Release blocked for ${sha}:\n${failures.join("\n")}`); process.exitCode = 1; }
  else console.info(`Required repository checks passed for ${sha}. Hosted verification and named launch approvals are still required; this command does not deploy.`);
}
