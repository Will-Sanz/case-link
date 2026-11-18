import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { utilityPreparedAad, utilityPreparedBindingSchema, type UtilityPreparedBinding } from "./utility-protected-operation";

export const UTILITY_PREPARED_ARTIFACT_ERROR = "The private utility draft could not be verified.";
const sealedSchema = z.object({ binding: utilityPreparedBindingSchema,
  iv: z.instanceof(Uint8Array).refine(value => value.length === 12), tag: z.instanceof(Uint8Array).refine(value => value.length === 16),
  ciphertext: z.instanceof(Uint8Array),
}).strict();
export type SealedUtilityPreparedArtifact = z.infer<typeof sealedSchema>;
function check(key: Uint8Array, binding: UtilityPreparedBinding, now: Date) {
  const reference = binding.operation.packet.protectedUtilityPacket;
  if (!(key instanceof Uint8Array) || key.length !== 32 || !Number.isFinite(now.getTime()) ||
    Date.parse(reference.preparedAt) > now.getTime() || Date.parse(reference.expiresAt) <= now.getTime()) throw new Error();
}
function checkPdf(bytes: Uint8Array, binding: UtilityPreparedBinding) {
  const reference = binding.operation.packet.protectedUtilityPacket;
  if (!(bytes instanceof Uint8Array) || bytes.length !== reference.byteLength || Buffer.from(bytes.subarray(0, 5)).toString("ascii") !== "%PDF-" ||
    !timingSafeEqual(createHash("sha256").update(bytes).digest(), Buffer.from(reference.contentSha256, "hex"))) throw new Error();
}

/** Trusted isolated preparation only. Current scope is checked independently before and after awaited work. */
export function sealUtilityPreparedArtifact(bytes: Uint8Array, key: Uint8Array, input: unknown, now: Date): SealedUtilityPreparedArtifact {
  try {
    const binding = utilityPreparedBindingSchema.parse(input);
    check(key, binding, now); checkPdf(bytes, binding);
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    cipher.setAAD(utilityPreparedAad(binding));
    return { binding, iv, ciphertext: Buffer.concat([cipher.update(bytes), cipher.final()]), tag: cipher.getAuthTag() };
  } catch { throw new Error(UTILITY_PREPARED_ARTIFACT_ERROR); }
}

export function openUtilityPreparedArtifact(input: unknown, key: Uint8Array, now: Date): Uint8Array {
  let bytes: Buffer | undefined;
  try {
    const { binding, iv, tag, ciphertext } = sealedSchema.parse(input);
    check(key, binding, now);
    if (ciphertext.length !== binding.operation.packet.protectedUtilityPacket.byteLength) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    decipher.setAAD(utilityPreparedAad(binding)); decipher.setAuthTag(tag);
    bytes = Buffer.concat([decipher.update(ciphertext), decipher.final()]); checkPdf(bytes, binding);
    return bytes;
  } catch { bytes?.fill(0); throw new Error(UTILITY_PREPARED_ARTIFACT_ERROR); }
}
