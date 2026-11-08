import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { MAX_SNAP_PACKET_BYTES as MAX_BYTES, snapFinalPacketBindingSchema, type SnapFinalPacketBinding } from "./snap-packet-contract";
export { SNAP_FINAL_PACKET_FORMAT, snapFinalPacketBindingSchema, type SnapFinalPacketBinding } from "./snap-packet-contract";

export const SNAP_FINAL_PACKET_ERROR = "The SNAP final packet could not be verified.";
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const packetSchema = z.object({
  binding: snapFinalPacketBindingSchema,
  iv: z.instanceof(Uint8Array).refine(value => value.byteLength === 12),
  tag: z.instanceof(Uint8Array).refine(value => value.byteLength === 16),
  ciphertext: z.instanceof(Uint8Array).refine(value => value.byteLength >= 1 && value.byteLength <= MAX_BYTES),
}).strict();
export type SnapFinalPacket = z.infer<typeof packetSchema>;

/** Matches PostgreSQL's compact array_to_json(text[]) encoding; every entry is a string. */
export function snapFinalPacketAad(input: unknown): Uint8Array {
  try {
    const b = snapFinalPacketBindingSchema.parse(input);
    return Buffer.from(JSON.stringify([b.format,b.packetId,b.ownerId,b.requestId,String(b.requestVersion),b.recipient,b.need,b.purpose,
      b.authorizationId,b.policyVersion,b.retentionPolicyVersion,b.templateId,b.templateVersion,b.templateSha256,b.snapshotId,
      b.snapshotHash,b.contentSha256,String(b.byteLength),b.expiresAt]), "utf8");
  } catch { throw new Error(SNAP_FINAL_PACKET_ERROR); }
}

function checkKeyAndExpiry(key: Uint8Array, binding: SnapFinalPacketBinding, now: Date) {
  if (!(key instanceof Uint8Array) || key.byteLength !== 32 || !(now instanceof Date) || !Number.isFinite(now.getTime())
    || Date.parse(binding.expiresAt) <= now.getTime()) throw new Error(SNAP_FINAL_PACKET_ERROR);
}

/** Cryptography only: the caller supplies the Vault key and establishes readiness, authority and protected key access. */
export function sealSnapFinalPacket(bytes: Uint8Array, key: Uint8Array, input: unknown, now: Date): SnapFinalPacket {
  try {
    const binding = snapFinalPacketBindingSchema.parse(input);
    checkKeyAndExpiry(key, binding, now);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== binding.byteLength || sha256(bytes) !== binding.contentSha256)
      throw new Error(SNAP_FINAL_PACKET_ERROR);
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    cipher.setAAD(snapFinalPacketAad(binding));
    const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
    return { binding, iv, tag: cipher.getAuthTag(), ciphertext };
  } catch { throw new Error(SNAP_FINAL_PACKET_ERROR); }
}

export function openSnapFinalPacket(input: unknown, key: Uint8Array, now: Date): Uint8Array {
  try {
    const { binding, iv, tag, ciphertext } = packetSchema.parse(input);
    checkKeyAndExpiry(key, binding, now);
    if (ciphertext.byteLength !== binding.byteLength) throw new Error(SNAP_FINAL_PACKET_ERROR);
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    decipher.setAAD(snapFinalPacketAad(binding)); decipher.setAuthTag(tag);
    const bytes = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (sha256(bytes) !== binding.contentSha256) { bytes.fill(0); throw new Error(SNAP_FINAL_PACKET_ERROR); }
    return bytes;
  } catch { throw new Error(SNAP_FINAL_PACKET_ERROR); }
}
