import { createCipheriv, createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { SNAP_DRAFT_CONTRACT } from "./snap-draft";
import {
  SNAP_FINAL_PACKET_ERROR, SNAP_FINAL_PACKET_FORMAT, openSnapFinalPacket, sealSnapFinalPacket,
  snapFinalPacketAad, type SnapFinalPacketBinding,
} from "./snap-final-packet";

const now = new Date("2026-11-04T20:00:00.000Z");
const bytes = new TextEncoder().encode("SYNTHETIC_PRIVATE_PACKET_CANARY: not a PDF or ready application");
const key = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const sha256 = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function binding(): SnapFinalPacketBinding {
  return {
    format: SNAP_FINAL_PACKET_FORMAT, packetId: uuid(1), ownerId: uuid(2), requestId: uuid(3), requestVersion: 2,
    recipient: "snap-pa", need: "snap_new", purpose: "snap_final_application_packet", authorizationId: uuid(4),
    policyVersion: "synthetic-policy.v1", retentionPolicyVersion: "synthetic-retention.v1",
    templateId: SNAP_DRAFT_CONTRACT.id, templateVersion: SNAP_DRAFT_CONTRACT.version, templateSha256: SNAP_DRAFT_CONTRACT.sha256,
    snapshotId: uuid(5), snapshotHash: "b".repeat(64), contentSha256: sha256(bytes), byteLength: bytes.length,
    expiresAt: "2026-11-04T21:00:00.000Z",
  };
}
const sealed = () => sealSnapFinalPacket(bytes, key, binding(), now);

describe("isolated SNAP final-packet cryptography", () => {
  it("roundtrips exact bytes without mutating inputs or returning a key", () => {
    const metadata = binding(), before = structuredClone(metadata), original = Uint8Array.from(bytes), originalKey = Uint8Array.from(key);
    const packet = sealSnapFinalPacket(bytes, key, metadata, now);
    expect(packet.binding).toEqual(metadata); expect(packet.binding).not.toBe(metadata);
    expect(packet.iv).toHaveLength(12); expect(packet.tag).toHaveLength(16); expect(packet.ciphertext).toHaveLength(bytes.length);
    expect(packet.ciphertext).not.toEqual(bytes); expect(Object.keys(packet).sort()).toEqual(["binding", "ciphertext", "iv", "tag"]);
    const packetBefore = JSON.stringify(packet);
    expect(openSnapFinalPacket(packet, key, now)).toEqual(Buffer.from(bytes));
    expect(JSON.stringify(packet)).toBe(packetBefore); expect(metadata).toEqual(before); expect(bytes).toEqual(original); expect(key).toEqual(originalKey);
  });

  it("uses independent native IVs for repeated sealing without generating keys", () => {
    const a = sealed(), b = sealed();
    expect(a.iv).not.toEqual(b.iv); expect(a.ciphertext).not.toEqual(b.ciphertext);
    expect(openSnapFinalPacket(a, key, now)).toEqual(openSnapFinalPacket(b, key, now));
  });

  it("uses the exact SQL-compatible, ordered all-string AAD independent of object insertion order", () => {
    const b = binding();
    const expected = [SNAP_FINAL_PACKET_FORMAT,uuid(1),uuid(2),uuid(3),"2","snap-pa","snap_new","snap_final_application_packet",uuid(4),
      "synthetic-policy.v1","synthetic-retention.v1",SNAP_DRAFT_CONTRACT.id,SNAP_DRAFT_CONTRACT.version,SNAP_DRAFT_CONTRACT.sha256,
      uuid(5),"b".repeat(64),sha256(bytes),String(bytes.length),"2026-11-04T21:00:00.000Z"];
    expect(Buffer.from(snapFinalPacketAad(b)).toString("utf8")).toBe(JSON.stringify(expected));
    expect(expected).toHaveLength(19); expect(expected.every(value => typeof value === "string")).toBe(true);
    expect(snapFinalPacketAad(Object.fromEntries(Object.entries(b).reverse()))).toEqual(snapFinalPacketAad(b));
  });

  it("accepts the maximum PostgreSQL integer request version", () => {
    const b = { ...binding(), requestVersion: 2147483647 }, packet = sealSnapFinalPacket(bytes, key, b, now);
    expect(JSON.parse(Buffer.from(snapFinalPacketAad(b)).toString("utf8"))[4]).toBe("2147483647");
    expect(packet.binding.requestVersion).toBe(2147483647); expect(openSnapFinalPacket(packet, key, now)).toEqual(Buffer.from(bytes));
  });

  it.each(Object.keys(binding()) as (keyof SnapFinalPacketBinding)[])("rejects a changed %s binding", field => {
    const packet = sealed(), changed: Record<string, unknown> = { ...packet.binding };
    changed[field] = field === "requestVersion" ? 3 : field === "byteLength" ? bytes.length + 1 : field === "expiresAt" ? "2026-11-04T21:00:00.001Z"
      : field.endsWith("Id") && !field.startsWith("template") ? uuid(99) : field.endsWith("Hash") || field.endsWith("Sha256") ? "c".repeat(64)
      : field.endsWith("PolicyVersion") || field === "policyVersion" ? "another-synthetic-policy.v1" : "changed";
    expect(() => openSnapFinalPacket({ ...packet, binding: changed }, key, now)).toThrow(SNAP_FINAL_PACKET_ERROR);
  });

  it.each(["iv", "tag", "ciphertext"] as const)("rejects a changed %s without changing the original packet", field => {
    const packet = sealed(), copy = { ...packet, [field]: Uint8Array.from(packet[field]) }, before = JSON.stringify(packet);
    copy[field][0] ^= 1;
    expect(() => openSnapFinalPacket(copy, key, now)).toThrow(SNAP_FINAL_PACKET_ERROR); expect(JSON.stringify(packet)).toBe(before);
  });

  it.each([
    { format: "other" }, { kind: SNAP_FINAL_PACKET_FORMAT }, { packetId: "invalid" }, { ownerId: uuid(2).replace("4000", "A000") },
    { requestVersion: 0 }, { requestVersion: 1.5 }, { requestVersion: "2" }, { requestVersion: 2147483648 },
    { recipient: "other" }, { need: "snap_renewal" }, { purpose: "other" },
    { authorizationId: "invalid" }, { policyVersion: "" }, { policyVersion: "A" }, { policyVersion: "v".repeat(81) },
    { retentionPolicyVersion: "private policy canary" }, { templateId: "another" }, { templateVersion: "another" }, { templateSha256: "c".repeat(64) },
    { snapshotId: "invalid" }, { snapshotHash: "B".repeat(64) }, { contentSha256: "invalid" },
    { byteLength: 0 }, { byteLength: 10 * 1024 * 1024 + 1 }, { byteLength: 1.5 },
    { expiresAt: "2026-11-04T21:00:00Z" }, { expiresAt: "2026-11-04T21:00:00.000+00:00" }, { expiresAt: "2026-02-30T21:00:00.000Z" },
    { expiresAt: "invalid" }, { extra: "PRIVATE_UNKNOWN_FIELD_CANARY" },
  ])("strictly rejects invalid metadata %#", override => {
    const b = { ...binding(), ...override };
    expect(() => sealSnapFinalPacket(bytes, key, b, now)).toThrow(SNAP_FINAL_PACKET_ERROR);
    expect(() => snapFinalPacketAad(b)).toThrow(SNAP_FINAL_PACKET_ERROR);
    expect(() => openSnapFinalPacket({ ...sealed(), binding: b }, key, now)).toThrow(SNAP_FINAL_PACKET_ERROR);
  });

  it.each([0, 1, 31, 33, 64])("rejects a %s-byte key without fallback", length => {
    const invalid = new Uint8Array(length);
    expect(() => sealSnapFinalPacket(bytes, invalid, binding(), now)).toThrow(SNAP_FINAL_PACKET_ERROR);
    expect(() => openSnapFinalPacket(sealed(), invalid, now)).toThrow(SNAP_FINAL_PACKET_ERROR);
  });

  it("rejects a different valid-length key", () => {
    expect(() => openSnapFinalPacket(sealed(), new Uint8Array(32), now)).toThrow(SNAP_FINAL_PACKET_ERROR);
  });

  it.each([null,"PRIVATE_KEY_CANARY",Array.from(key)] as unknown[])("rejects keys outside the supplied byte boundary %#", value => {
    expect(() => sealSnapFinalPacket(bytes, value as Uint8Array, binding(), now)).toThrow(SNAP_FINAL_PACKET_ERROR);
    expect(() => openSnapFinalPacket(sealed(), value as Uint8Array, now)).toThrow(SNAP_FINAL_PACKET_ERROR);
  });

  it.each([new Date("bad"),new Date("2026-11-04T21:00:00.000Z"),new Date("2026-11-04T21:00:00.001Z")])("rejects invalid/expired clocks %s", at => {
    expect(() => sealSnapFinalPacket(bytes, key, binding(), at)).toThrow(SNAP_FINAL_PACKET_ERROR);
    expect(() => openSnapFinalPacket(sealed(), key, at)).toThrow(SNAP_FINAL_PACKET_ERROR);
  });

  it("accepts an exact unexpired millisecond and does not renew expiry", () => {
    const at = new Date("2026-11-04T20:59:59.999Z"), packet = sealSnapFinalPacket(bytes, key, binding(), at);
    expect(openSnapFinalPacket(packet, key, at)).toEqual(Buffer.from(bytes)); expect(packet.binding.expiresAt).toBe(binding().expiresAt);
  });

  it.each([undefined,null,"2026-11-04T20:00:00.000Z"] as unknown[])("requires the caller's explicit Date clock %#", value => {
    expect(() => sealSnapFinalPacket(bytes, key, binding(), value as Date)).toThrow(SNAP_FINAL_PACKET_ERROR);
    expect(() => openSnapFinalPacket(sealed(), key, value as Date)).toThrow(SNAP_FINAL_PACKET_ERROR);
  });

  it.each(["hash", "length", "empty", "oversized", "not_bytes"])("rejects %s source bytes", kind => {
    let value: unknown = bytes, b = binding();
    if (kind === "hash") b = { ...b, contentSha256: "c".repeat(64) };
    if (kind === "length") b = { ...b, byteLength: bytes.length + 1 };
    if (kind === "empty") { value = new Uint8Array(); b = { ...b, byteLength: 0, contentSha256: sha256(value as Uint8Array) }; }
    if (kind === "oversized") { value = new Uint8Array(10 * 1024 * 1024 + 1); b = { ...b, byteLength: (value as Uint8Array).length, contentSha256: sha256(value as Uint8Array) }; }
    if (kind === "not_bytes") value = Array.from(bytes);
    expect(() => sealSnapFinalPacket(value as Uint8Array, key, b, now)).toThrow(SNAP_FINAL_PACKET_ERROR);
  });

  it.each([
    { iv: new Uint8Array(11) }, { iv: new Uint8Array(13) }, { tag: new Uint8Array(15) }, { tag: new Uint8Array(17) },
    { ciphertext: new Uint8Array() }, { ciphertext: new Uint8Array(bytes.length - 1) }, { ciphertext: new Uint8Array(10 * 1024 * 1024 + 1) },
    { ciphertext: "PRIVATE_CIPHERTEXT_CANARY" }, { iv: [] }, { tag: null }, { extra: "PRIVATE_EXTRA_CANARY" },
  ])("rejects malformed or unbounded encrypted packets %#", changed => {
    expect(() => openSnapFinalPacket({ ...sealed(), ...changed }, key, now)).toThrow(SNAP_FINAL_PACKET_ERROR);
  });

  it("checks the complete plaintext hash after authenticated decryption", () => {
    const b = { ...binding(), contentSha256: "c".repeat(64) }, iv = new Uint8Array(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 }); cipher.setAAD(snapFinalPacketAad(b));
    const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
    expect(() => openSnapFinalPacket({ binding: b, iv, tag: cipher.getAuthTag(), ciphertext }, key, now)).toThrow(SNAP_FINAL_PACKET_ERROR);
  });

  it("roundtrips the exact maximum supported size", () => {
    const value = new Uint8Array(10 * 1024 * 1024), b = { ...binding(), byteLength: value.length, contentSha256: sha256(value) };
    expect(Buffer.from(openSnapFinalPacket(sealSnapFinalPacket(value, key, b, now), key, now)).equals(Buffer.from(value))).toBe(true);
  });

  it("returns only a generic error and never logs document, key or metadata canaries", () => {
    const log = vi.spyOn(console, "log"), warn = vi.spyOn(console, "warn"), error = vi.spyOn(console, "error");
    try {
      for (const operation of [
        () => sealSnapFinalPacket(bytes, key, { ...binding(), policyVersion: "PRIVATE_POLICY_CANARY" }, now),
        () => sealSnapFinalPacket(bytes, key, { ...binding(), contentSha256: "c".repeat(64) }, now),
        () => openSnapFinalPacket({ ...sealed(), tag: new Uint8Array(16) }, key, now),
      ]) {
        try { operation(); expect.unreachable(); } catch (caught) {
          expect(caught).toBeInstanceOf(Error); expect((caught as Error).message).toBe(SNAP_FINAL_PACKET_ERROR);
          expect((caught as Error).cause).toBeUndefined(); expect(JSON.stringify(caught)).toBe("{}");
        }
      }
      expect(log).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
    } finally { vi.restoreAllMocks(); }
  });
});
