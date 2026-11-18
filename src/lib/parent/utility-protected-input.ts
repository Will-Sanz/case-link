import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { utilityProtectedBindingSchema, utilityProtectedInputAad, type UtilityProtectedBinding } from "./utility-protected-input-contract";

export const UTILITY_PROTECTED_INPUT_ERROR = "The protected utility information could not be verified.";
const sealedSchema = z.object({
  binding: utilityProtectedBindingSchema,
  iv: z.instanceof(Uint8Array).refine(value => value.byteLength === 12),
  tag: z.instanceof(Uint8Array).refine(value => value.byteLength === 16),
  ciphertext: z.instanceof(Uint8Array),
}).strict();
export type SealedUtilityProtectedInput = z.infer<typeof sealedSchema>;
export function utilityProtectedContentDigest(bytes: Uint8Array, key: Uint8Array): string {
  if (!(key instanceof Uint8Array) || key.byteLength !== 32 || !(bytes instanceof Uint8Array) || !bytes.byteLength)
    throw new Error(UTILITY_PROTECTED_INPUT_ERROR);
  return createHmac("sha256", key).update(bytes).digest("hex");
}
function matchesDigest(bytes: Uint8Array, key: Uint8Array, digest: string): boolean {
  return timingSafeEqual(Buffer.from(utilityProtectedContentDigest(bytes, key), "hex"), Buffer.from(digest, "hex"));
}
function check(key: Uint8Array, binding: UtilityProtectedBinding, now: Date) {
  if (!(key instanceof Uint8Array) || key.byteLength !== 32 || !Number.isFinite(now.getTime()) ||
    Date.parse(binding.consentedAt) > now.getTime() || Date.parse(binding.expiresAt) <= now.getTime())
    throw new Error(UTILITY_PROTECTED_INPUT_ERROR);
}

/** The isolated caller obtains the independent object key and current authority before and after this operation. */
export function sealUtilityProtectedInput(bytes: Uint8Array, key: Uint8Array, input: unknown, now: Date): SealedUtilityProtectedInput {
  try {
    const binding = utilityProtectedBindingSchema.parse(input);
    check(key, binding, now);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== binding.byteLength || !matchesDigest(bytes, key, binding.contentDigest))
      throw new Error();
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    cipher.setAAD(utilityProtectedInputAad(binding));
    const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
    return { binding, iv, tag: cipher.getAuthTag(), ciphertext };
  } catch { throw new Error(UTILITY_PROTECTED_INPUT_ERROR); }
}

export function openUtilityProtectedInput(input: unknown, key: Uint8Array, now: Date): Uint8Array {
  let bytes: Buffer | undefined;
  try {
    const { binding, iv, tag, ciphertext } = sealedSchema.parse(input);
    check(key, binding, now);
    if (ciphertext.byteLength !== binding.byteLength) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    decipher.setAAD(utilityProtectedInputAad(binding)); decipher.setAuthTag(tag);
    bytes = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (!matchesDigest(bytes, key, binding.contentDigest)) throw new Error();
    return bytes;
  } catch { bytes?.fill(0); throw new Error(UTILITY_PROTECTED_INPUT_ERROR); }
}

/** Private owner/program-scoped matching only; never persist or export a bare hash of a small secret. */
export function utilityProtectedAccountFingerprint(key: Uint8Array, ownerId: string, programId: string, normalizedAccount: string): string {
  try {
    if (!(key instanceof Uint8Array) || key.byteLength !== 32 || !z.uuid().safeParse(ownerId).success ||
      !["peco-cap", "pgw-crp", "pwd-tap"].includes(programId) || normalizedAccount.length < 1 || normalizedAccount.length > 256)
      throw new Error();
    return createHmac("sha256", key).update(JSON.stringify(["utility-account-v1", ownerId.toLowerCase(), programId, normalizedAccount])).digest("hex");
  } catch { throw new Error(UTILITY_PROTECTED_INPUT_ERROR); }
}
