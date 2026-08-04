import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const sourceRoot = join(repoRoot, "src");
const allowedFiles = new Set([
  "lib/ai/client.ts",
  "lib/ai/pdf-boundary-safety.test.ts",
]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

describe("PDF AI data boundary", () => {
  it("has no raw PDF analysis route or product caller for AI file inputs", () => {
    expect(existsSync(join(sourceRoot, "app/api/paperwork/analyze/route.ts"))).toBe(false);

    const rawFileInputToken = ["file", "Inputs"].join("");
    const callers = sourceFiles(sourceRoot)
      .filter((path) => !allowedFiles.has(relative(sourceRoot, path)))
      .filter((path) => readFileSync(path, "utf8").includes(rawFileInputToken))
      .map((path) => relative(sourceRoot, path));

    expect(callers).toEqual([]);
  });
});
