import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

export function totp(secret: string, time = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.replaceAll("=", "").toUpperCase()].map(character => {
    const value = alphabet.indexOf(character);
    assert.ok(value >= 0, "the synthetic factor secret uses base32");
    return value.toString(2).padStart(5, "0");
  }).join("");
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map(byte => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 30000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, "0");
}
assert.equal(totp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59000), "287082", "test authenticator matches the RFC 6238 SHA-1 vector");
const usedCounters = new Map<string, number>();
export async function freshTotp(secret: string) {
  const previous = usedCounters.get(secret);
  if (previous !== undefined && Math.floor(Date.now() / 30000) <= previous) await delay((previous + 1) * 30000 - Date.now() + 50);
  usedCounters.set(secret, Math.floor(Date.now() / 30000));
  return totp(secret);
}
