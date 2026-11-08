import { describe, expect, it, vi } from "vitest";
vi.mock("node:crypto",()=>{throw new Error("Private cryptography cannot enter the metadata contract.");});
vi.mock("pg",()=>{throw new Error("Private database runtime cannot enter the metadata contract.");});
vi.mock("pdf-lib",()=>{throw new Error("PDF processing cannot enter the metadata contract.");});
vi.mock("./snap-draft",()=>{throw new Error("The draft renderer cannot enter the metadata contract.");});
import { MAX_SNAP_PACKET_BYTES, snapFinalPacketBindingSchema, snapFinalizerIntentSchema, snapPacketAuthorizationInputSchema } from "./snap-packet-contract";

describe("browser-safe SNAP packet metadata contract",()=>{
 it("loads only pure schemas and pinned public metadata, preserving binding/intent exports",()=>{
  expect(MAX_SNAP_PACKET_BYTES).toBe(10485760);expect(snapFinalPacketBindingSchema.shape.expiresAt).toBeTruthy();expect("expiresAt" in snapFinalizerIntentSchema.shape).toBe(false);
 });
 it("rejects a duplicate subject after canonicalizing UUID case",()=>{
  const packetId="abcdefab-cdef-4abc-8def-abcdefabcdef",value={packetId,expectedVersion:1,snapshotId:packetId,snapshotHash:"a".repeat(64),contentSha256:"b".repeat(64),byteLength:1,
   policyVersion:"synthetic",retentionPolicyVersion:"synthetic",subjectIds:[packetId,packetId.toUpperCase()],authorityDeclared:true};
  expect(snapPacketAuthorizationInputSchema.safeParse(value).success).toBe(false);
 });
});
