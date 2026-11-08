import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { recoverArchive } from "./backup-archive";

// Operator-only: creates a private archive; never connects to or replaces a database.
try {
  const [backupPath, outputPath] = process.argv.slice(2);
  if (!backupPath || !outputPath || process.argv.length !== 4) throw new Error("Provide an encrypted backup and a new output filename.");
  const record = JSON.parse(readFileSync(backupPath, "utf8"));
  if (!/^[a-z]{20}$/.test(record.project) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.createdAt)) throw new Error("Invalid backup identity.");
  const account = `${record.project}-${record.createdAt.replace(/[:.]/g, "-")}`;
  const result = spawnSync("/usr/bin/security", ["find-generic-password", "-s", "CaseLink database backup", "-wa", account], { encoding: "utf8", timeout: 8000, maxBuffer: 65536 });
  if (result.status !== 0) throw new Error("Recovery key is unavailable in this operator's Keychain.");
  const archive = recoverArchive(record, Buffer.from(result.stdout.trim(), "base64"));
  writeFileSync(outputPath, archive, { mode: 0o600, flag: "wx" });
  console.info("Verified archive recovered with private file permissions. No database was changed.");
} catch {
  console.error("Recovery did not complete. Check the backup, operator Keychain access, and an unused output filename. No database was changed.");
  process.exitCode = 1;
}
