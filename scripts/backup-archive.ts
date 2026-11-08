import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export function encryptBackup(bytes: Buffer, key: Buffer, project: string, createdAt: string) {
  const header = { version: 1, algorithm: "aes-256-gcm" as const, project, createdAt };
  const iv = randomBytes(12);
  const cipher = createCipheriv(header.algorithm, key, iv);
  cipher.setAAD(Buffer.from(JSON.stringify(header)));
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return { ...header, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}

export function decryptBackup(record: ReturnType<typeof encryptBackup>, key: Buffer): Buffer {
  const { version, algorithm, project, createdAt } = record;
  if (version !== 1 || algorithm !== "aes-256-gcm") throw new Error("Unsupported backup format");
  const decipher = createDecipheriv(algorithm, key, Buffer.from(record.iv, "base64"));
  decipher.setAAD(Buffer.from(JSON.stringify({ version, algorithm, project, createdAt })));
  decipher.setAuthTag(Buffer.from(record.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(record.ciphertext, "base64")), decipher.final()]);
}

export function recoverArchive(record: ReturnType<typeof encryptBackup>, key: Buffer): Buffer {
  const payload = JSON.parse(decryptBackup(record, key).toString("utf8"));
  const archive = Buffer.from(payload.archive, "base64");
  if (createHash("sha256").update(archive).digest("hex") !== payload.archiveSha256) throw new Error("Archive integrity mismatch");
  return archive;
}
