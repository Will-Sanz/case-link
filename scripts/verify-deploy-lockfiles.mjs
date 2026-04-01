#!/usr/bin/env node
/**
 * Deployment lockfile checks (matches Vercel: `npm ci` in vercel.json).
 * - Reject pnpm-lock.yaml: Vercel previously picked pnpm and failed with
 *   ERR_PNPM_OUTDATED_LOCKFILE when it was stale vs package.json.
 * - Ensure package-lock.json exists and matches package.json via `npm ci --dry-run`
 *   (same validation `npm ci` uses on the server).
 */
import { execSync } from "node:child_process";
import fs from "node:fs";

const pkgLock = "package-lock.json";
const pnpmLock = "pnpm-lock.yaml";

if (!fs.existsSync(pkgLock)) {
  console.error(
    "verify-deploy-lockfiles: missing package-lock.json. Run npm install and commit the lockfile.",
  );
  process.exit(1);
}

if (fs.existsSync(pnpmLock)) {
  console.error(
    "verify-deploy-lockfiles: pnpm-lock.yaml is present.\n" +
      "This repo uses npm on Vercel (vercel.json installCommand). A stale pnpm lock caused\n" +
      "ERR_PNPM_OUTDATED_LOCKFILE. Remove pnpm-lock.yaml unless you fully maintain it with pnpm.",
  );
  process.exit(1);
}

try {
  execSync("npm ci --dry-run --ignore-scripts --no-audit --no-fund --silent", {
    stdio: "inherit",
  });
} catch {
  console.error(
    "\nverify-deploy-lockfiles: npm ci --dry-run failed. package-lock.json may be out of sync\n" +
      "with package.json. Run: npm install\n" +
      "Then commit package-lock.json.",
  );
  process.exit(1);
}

console.log("verify-deploy-lockfiles: ok.");
