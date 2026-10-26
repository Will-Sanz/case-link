import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("scans regular source files despite an untracked nested repository and never prints secret values", () => {
  const cwd = mkdtempSync(resolve(tmpdir(), "caselink-secret-scan-"));
  try {
    execFileSync("git", ["init", "--quiet", cwd]);
    mkdirSync(resolve(cwd, "external"));
    execFileSync("git", ["init", "--quiet", resolve(cwd, "external")]);
    writeFileSync(resolve(cwd, "README.md"), "Synthetic fixture only.");
    const scanner = resolve("scripts/scan-tracked-secrets.mjs");
    expect(
      spawnSync(process.execPath, [scanner], { cwd, encoding: "utf8" }).status,
    ).toBe(0);
    const canary = ["sk", "-", "A".repeat(32)].join("");
    writeFileSync(resolve(cwd, "key.txt"), canary);
    const result = spawnSync(process.execPath, [scanner], {
      cwd,
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("key.txt:1");
    expect(result.stderr).not.toContain(canary);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
