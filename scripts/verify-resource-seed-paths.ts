/**
 * Sanity checks for resource seed CSV resolution and sample parse (no DB).
 * Run: npx tsx scripts/verify-resource-seed-paths.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseResourceCsvFromPath } from "../src/lib/db/resource-import/parse-resource-file";
import {
  RESOURCE_SEED_PRIVATE_BASENAME,
  RESOURCE_SEED_SAMPLE_BASENAME,
  resolveDefaultResourceSeedCsvPath,
} from "../src/lib/db/resource-import/resolve-seed-csv-path";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function test(name: string, fn: () => void) {
  try {
    fn();
    console.info(`ok: ${name}`);
  } catch (e) {
    console.error(`fail: ${name}`, e);
    process.exit(1);
  }
}

test("prefers private when both exist", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "caselink-seed-"));
  const dataDir = path.join(tmp, "data");
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(dataDir, RESOURCE_SEED_SAMPLE_BASENAME), "x");
  const priv = path.join(dataDir, RESOURCE_SEED_PRIVATE_BASENAME);
  fs.writeFileSync(priv, "y");
  const r = resolveDefaultResourceSeedCsvPath(tmp);
  assert.equal(r.source, "private");
  assert.equal(r.absolutePath, priv);
});

test("falls back to sample when private missing", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "caselink-seed-"));
  const dataDir = path.join(tmp, "data");
  fs.mkdirSync(dataDir);
  const sample = path.join(dataDir, RESOURCE_SEED_SAMPLE_BASENAME);
  fs.writeFileSync(sample, "x");
  const r = resolveDefaultResourceSeedCsvPath(tmp);
  assert.equal(r.source, "sample");
  assert.equal(r.absolutePath, sample);
});

test("repo sample CSV exists and parses", () => {
  const samplePath = path.join(repoRoot, "data", RESOURCE_SEED_SAMPLE_BASENAME);
  assert.ok(fs.existsSync(samplePath), `missing ${samplePath}`);
  const parsed = parseResourceCsvFromPath(samplePath);
  assert.ok(parsed.rows.length >= 1, "expected at least one row");
  assert.equal(parsed.issues.length, 0, `parse issues: ${JSON.stringify(parsed.issues)}`);
  const r0 = parsed.rows[0];
  assert.ok(r0.programName.includes("Demo") || r0.officeOrDepartment.includes("Sample"));
});

test("repo default resolution uses sample when private absent", () => {
  const privPath = path.join(repoRoot, "data", RESOURCE_SEED_PRIVATE_BASENAME);
  if (fs.existsSync(privPath)) {
    const r = resolveDefaultResourceSeedCsvPath(repoRoot);
    assert.equal(r.source, "private");
    return;
  }
  const r = resolveDefaultResourceSeedCsvPath(repoRoot);
  assert.equal(r.source, "sample");
  assert.ok(fs.existsSync(r.absolutePath));
});

console.info("verify-resource-seed-paths: all checks passed");
