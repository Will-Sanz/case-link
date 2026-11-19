import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "vitest";

// Hook repository settings must never reach commands operating on disposable repositories.
const fixtureEnvironment = (inherited: NodeJS.ProcessEnv) => {
  const env = { ...inherited };
  for (const name of Object.keys(env)) if (name.startsWith("GIT_")) delete env[name];
  return env;
};

function checkScanner(inherited = process.env) {
  const env = fixtureEnvironment(inherited);
  const cwd = mkdtempSync(resolve(tmpdir(), "caselink-secret-scan-"));
  try {
    execFileSync("git", ["init", "--quiet", cwd], { env });
    expect(existsSync(resolve(cwd, ".git"))).toBe(true);
    mkdirSync(resolve(cwd, "external"));
    execFileSync("git", ["init", "--quiet", resolve(cwd, "external")], { env });
    expect(existsSync(resolve(cwd, "external/.git"))).toBe(true);
    writeFileSync(resolve(cwd, "README.md"), "Synthetic fixture only.");
    const scanner = resolve("scripts/scan-tracked-secrets.mjs");
    expect(
      spawnSync(process.execPath, [scanner], { cwd, env, encoding: "utf8" }).status,
    ).toBe(0);
    const canary = ["sk", "-", "A".repeat(32)].join("");
    writeFileSync(resolve(cwd, "key.txt"), canary);
    const result = spawnSync(process.execPath, [scanner], {
      cwd,
      env,
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("key.txt:1");
    expect(result.stderr).not.toContain(canary);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

it("scans regular source files despite an untracked nested repository and never prints secret values", () => {
  checkScanner();
});

it("preserves a linked-worktree hook's parent repository while initializing and scanning foreign fixtures", () => {
  const cwd = mkdtempSync(resolve(tmpdir(), "caselink-hook-parent-"));
  const env = fixtureEnvironment(process.env), parent = resolve(cwd, "parent"), worktree = resolve(cwd, "worktree");
  try {
    execFileSync("git", ["init", "--quiet", parent], { env });
    execFileSync("git", ["-C", parent, "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgSign=false", "-c", "user.name=Synthetic", "-c", "user.email=synthetic@example.test", "commit", "--allow-empty", "-qm", "Synthetic fixture"], { env });
    execFileSync("git", ["-C", parent, "-c", "core.hooksPath=/dev/null", "worktree", "add", "--quiet", "--detach", worktree], { env });
    const gitDir = readFileSync(resolve(worktree, ".git"), "utf8").trim().slice("gitdir: ".length);
    const config = resolve(parent, ".git/config"), before = readFileSync(config);
    try {
      checkScanner({ ...env, GIT_DIR: gitDir, GIT_INDEX_FILE: resolve(gitDir, "index") });
    } finally {
      expect(readFileSync(config)).toEqual(before);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
