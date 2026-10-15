import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { findCanaryFiles } from "./secret-canary.mjs";

it("finds synthetic leakage across binary chunk boundaries and skips external symlinks", () => {
  const root = mkdtempSync(join(tmpdir(), "caselink-canary-"));
  try {
    mkdirSync(join(root, "build"));
    writeFileSync(join(root, "external"), "synthetic-canary");
    symlinkSync(join(root, "external"), join(root, "build", "link"));
    writeFileSync(join(root, "build", "clean"), "public configuration only");
    expect(findCanaryFiles(join(root, "build"), ["synthetic-canary"])).toEqual([]);
    writeFileSync(join(root, "build", "bundle"), Buffer.concat([Buffer.alloc(65530), Buffer.from("synthetic-canary")]));
    expect(findCanaryFiles(join(root, "build"), ["synthetic-canary"])).toEqual([join(root, "build", "bundle")]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
