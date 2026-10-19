import { expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { decryptBackup, encryptBackup, recoverArchive } from "./backup-archive";

it("recovers the original binary archive after serialization", () => {
  const key = randomBytes(32), archive = randomBytes(32768);
  const payload = Buffer.from(JSON.stringify({ archive: archive.toString("base64"), archiveSha256: createHash("sha256").update(archive).digest("hex") }));
  const encrypted = encryptBackup(payload, key, "synthetic-project", "2026-10-15");
  expect(recoverArchive(JSON.parse(JSON.stringify(encrypted)), key)).toEqual(archive);
});

it("rejects damaged ciphertext, the wrong key, changed metadata and an invalid archive hash", () => {
  const key = randomBytes(32);
  const encrypted = encryptBackup(Buffer.from("Synthetic backup"), key, "synthetic-project", "2026-10-15");
  const damaged = Buffer.from(encrypted.ciphertext, "base64"); damaged[0] ^= 1;
  expect(() => decryptBackup({ ...encrypted, ciphertext: damaged.toString("base64") }, key)).toThrow();
  expect(() => decryptBackup(encrypted, randomBytes(32))).toThrow();
  expect(() => decryptBackup({ ...encrypted, project: "another-project" }, key)).toThrow();
  expect(() => decryptBackup({ ...encrypted, version: 2 }, key)).toThrow();
  const invalid = encryptBackup(Buffer.from(JSON.stringify({ archive: "AA==", archiveSha256: "invalid" })), key, "synthetic-project", "2026-10-15");
  expect(() => recoverArchive(invalid, key)).toThrow("Archive integrity mismatch");
});
