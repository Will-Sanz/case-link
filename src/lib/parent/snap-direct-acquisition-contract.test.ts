import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import source from "../../../data/verified-forms/snap-pa600fs-2019.json";
import { SNAP_APPLICATION_SOURCE } from "./snap-application-fields";
vi.mock("node:crypto", () => { throw new Error("Private cryptography cannot enter this contract."); });
vi.mock("pg", () => { throw new Error("Database runtime cannot enter this contract."); });
vi.mock("pdf-lib", () => { throw new Error("PDF processing cannot enter this contract."); });
vi.mock("./snap-direct-completion-core", () => { throw new Error("The renderer cannot enter this contract."); });
import {
  SNAP_DIRECT_ACQUISITION_FIELDS, SNAP_DIRECT_ACQUISITION_METHOD, snapDirectAcquisitionInputSchema,
  snapDirectAcquisitionResultSchema, snapDirectAcquisitionRevokeSchema, snapDirectAcquisitionScopeSchema,
  snapDirectPacketInputSchema, snapDirectPacketReadScopeSchema, snapDirectPacketScopeSchema,
} from "./snap-direct-acquisition-contract";

const id = "abcdefab-cdef-4abc-8def-abcdefabcdef", other = "bbcdefab-cdef-4abc-8def-abcdefabcdef";
const scope = { expectedVersion: 2, snapshotId: id, snapshotHash: "a".repeat(64) };
const input = () => ({ ...scope, acquisitionId: id, policyVersion: "synthetic-policy", retentionPolicyVersion: "synthetic-retention", subjectIds: [id], acceptedExpiresAt: "2026-11-05T20:05:00.000Z", authorityDeclared: true });
const permission = () => ({
  state: "permission_needed", acquisitionId: null, ownerId: id, requestId: other, requestVersion: 2,
  snapshotId: id, snapshotHash: scope.snapshotHash, recipient: "snap-pa", need: "snap_new", purpose: "snap_final_application_packet",
  method: SNAP_DIRECT_ACQUISITION_METHOD, fieldScope: [...SNAP_DIRECT_ACQUISITION_FIELDS], source: { ...SNAP_APPLICATION_SOURCE }, subjectIds: [id],
  policyVersion: "synthetic-policy", retentionPolicyVersion: "synthetic-retention", authorityDeclaration: null,
  consentedAt: null, expiresAt: "2026-11-05T20:05:00.000Z",
});
const authorized = () => ({ ...permission(), state: "authorized", acquisitionId: id,
  authorityDeclaration: "parent_declared_household_data_authority", consentedAt: "2026-11-05T20:00:00.000Z" });

describe("pure SNAP direct acquisition metadata contract", () => {
  it("accepts exactly the SQL's 19 metadata fields and both honest permission states", () => {
    expect(Object.keys(permission())).toHaveLength(19);
    expect(snapDirectAcquisitionResultSchema.parse(permission())).toEqual(permission());
    expect(snapDirectAcquisitionResultSchema.parse(authorized())).toEqual(authorized());
    const renderer = readFileSync(new URL("./snap-direct-completion-core.ts", import.meta.url), "utf8");
    expect(renderer).toContain(`export const SNAP_DIRECT_COMPLETION_VERSION = "${SNAP_DIRECT_ACQUISITION_METHOD}";`);
  });
  it("normalizes only input UUIDs and catches duplicates after normalization", () => {
    const value = input(); value.snapshotId = value.acquisitionId = id.toUpperCase(); value.subjectIds = [other.toUpperCase()];
    expect(snapDirectAcquisitionInputSchema.parse(value)).toMatchObject({ snapshotId: id, acquisitionId: id, subjectIds: [other] });
    expect(snapDirectAcquisitionRevokeSchema.parse({ acquisitionId: id.toUpperCase() })).toEqual({ acquisitionId: id });
    expect(snapDirectAcquisitionInputSchema.safeParse({ ...input(), subjectIds: [id, id.toUpperCase()] }).success).toBe(false);
    expect(snapDirectAcquisitionResultSchema.safeParse({ ...authorized(), ownerId: id.toUpperCase() }).success).toBe(false);
  });
  it.each(["ssn", "identifiers", "strokes", "details", "packetId", "unknown"])("rejects extra sensitive or out-of-scope key %s", key => {
    for (const [schema, value] of [[snapDirectAcquisitionScopeSchema, scope], [snapDirectAcquisitionInputSchema, input()],
      [snapDirectAcquisitionRevokeSchema, { acquisitionId: id }], [snapDirectAcquisitionResultSchema, authorized()]] as const) {
      expect(schema.safeParse({ ...value, [key]: "PRIVATE-CANARY" }).success).toBe(false);
    }
    expect(snapDirectAcquisitionResultSchema.safeParse({ ...permission(), source: { ...SNAP_APPLICATION_SOURCE, [key]: "PRIVATE-CANARY" } }).success).toBe(false);
  });
  it.each([
    { state: "stored" }, { acquisitionId: null }, { authorityDeclaration: null }, { consentedAt: null },
    { authorityDeclaration: "verified_identity" }, { expiresAt: "2026-11-05T20:00:00.000Z" },
    { expiresAt: "2026-11-05T19:59:59.999Z" },
  ])("rejects inconsistent authorized state %j", change => {
    expect(snapDirectAcquisitionResultSchema.safeParse({ ...authorized(), ...change }).success).toBe(false);
  });
  it.each([{ acquisitionId: id }, { authorityDeclaration: "parent_declared_household_data_authority" }, { consentedAt: "2026-11-05T20:00:00.000Z" }])("rejects invented permission-needed consent %j", change => {
    expect(snapDirectAcquisitionResultSchema.safeParse({ ...permission(), ...change }).success).toBe(false);
  });
  it.each(["2026-11-05T20:05:00Z", "2026-11-05T20:05:00.000+00:00", "2026-02-30T20:05:00.000Z", "bad", "2026-12-03T05:00:00.001Z"])("requires a canonical, bounded expiry %s", expiresAt => {
    expect(snapDirectAcquisitionResultSchema.safeParse({ ...permission(), expiresAt }).success).toBe(false);
  });
  it("accepts the exact reviewed expiry boundary and requires canonical consent", () => {
    expect(snapDirectAcquisitionResultSchema.safeParse({ ...authorized(), expiresAt: source.verifiedUntil }).success).toBe(true);
    expect(snapDirectAcquisitionResultSchema.safeParse({ ...authorized(), consentedAt: "2026-11-05T20:00:00Z" }).success).toBe(false);
  });
  it.each([
    { expectedVersion: 0 }, { expectedVersion: 1.5 }, { expectedVersion: "2" }, { expectedVersion: 2147483648 },
    { snapshotId: "invalid" }, { snapshotHash: "A".repeat(64) }, { snapshotHash: "a".repeat(63) },
    { acquisitionId: null }, { policyVersion: "PRIVATE-CANARY" }, { policyVersion: "a".repeat(81) },
    { retentionPolicyVersion: "" }, { authorityDeclared: false }, { authorityDeclared: "true" },
    { acceptedExpiresAt: undefined }, { acceptedExpiresAt: null }, { acceptedExpiresAt: "2026-11-05T20:05:00Z" }, { acceptedExpiresAt: "2026-12-03T05:00:00.001Z" },
    { subjectIds: [] }, { subjectIds: [id, id] }, { subjectIds: [null] },
  ])("rejects invalid scoped input %j", change => {
    expect(snapDirectAcquisitionInputSchema.safeParse({ ...input(), ...change }).success).toBe(false);
  });
  it("limits unique subjects to the method's eight-person capacity in input and reply", () => {
    const subjects = Array.from({ length: 9 }, (_, index) => `${index.toString(16).padStart(8, "0")}-cdef-4abc-8def-abcdefabcdef`);
    for (const count of [8, 9]) {
      expect(snapDirectAcquisitionInputSchema.safeParse({ ...input(), subjectIds: subjects.slice(0, count) }).success).toBe(count === 8);
      expect(snapDirectAcquisitionResultSchema.safeParse({ ...authorized(), subjectIds: subjects.slice(0, count) }).success).toBe(count === 8);
    }
    expect(snapDirectAcquisitionResultSchema.safeParse({ ...authorized(), subjectIds: [id, id] }).success).toBe(false);
  });
  it.each(["recipient", "need", "purpose", "method"])("rejects other %s scope", key => {
    expect(snapDirectAcquisitionResultSchema.safeParse({ ...authorized(), [key]: "unverified" }).success).toBe(false);
  });
  it("requires the exact printed field tuple and complete pinned source", () => {
    for (const fieldScope of [[...SNAP_DIRECT_ACQUISITION_FIELDS].reverse(), SNAP_DIRECT_ACQUISITION_FIELDS.slice(1), [...SNAP_DIRECT_ACQUISITION_FIELDS, "extra"]]) {
      expect(snapDirectAcquisitionResultSchema.safeParse({ ...authorized(), fieldScope }).success).toBe(false);
    }
    for (const key of Object.keys(SNAP_APPLICATION_SOURCE)) {
      expect(snapDirectAcquisitionResultSchema.safeParse({ ...authorized(), source: { ...SNAP_APPLICATION_SOURCE, [key]: "changed" } }).success).toBe(false);
    }
  });
  it("binds only exact packet metadata to earlier permission, without another declaration", () => {
    const value = { ...scope, packetId: other.toUpperCase(), acquisitionId: id.toUpperCase(), contentSha256: "b".repeat(64), byteLength: 10485760 };
    expect(snapDirectPacketInputSchema.parse(value)).toEqual({ ...value, packetId: other, acquisitionId: id });
    expect(snapDirectPacketScopeSchema.parse({ ...scope, packetId: other })).toEqual({ ...scope, packetId: other });
    for (const change of [{ acquisitionId: null }, { packetId: "bad" }, { contentSha256: "B".repeat(64) }, { byteLength: 0 }, { byteLength: 10485761 },
      { authorityDeclared: true }, { policyVersion: "synthetic" }, { subjectIds: [id] }, { ssn: "PRIVATE-CANARY" }, { strokes: [] }]) {
      expect(snapDirectPacketInputSchema.safeParse({ ...value, ...change }).success).toBe(false);
    }
  });
  it("permits only packetId to be omitted for current intent discovery", () => {
    expect(snapDirectPacketReadScopeSchema.parse(scope)).toEqual(scope);
    expect(snapDirectPacketReadScopeSchema.parse({ ...scope, packetId: other.toUpperCase() })).toEqual({ ...scope, packetId: other });
    for (const key of Object.keys(scope)) {
      const missing: Record<string, unknown> = { ...scope }; delete missing[key];
      expect(snapDirectPacketReadScopeSchema.safeParse(missing).success).toBe(false);
    }
    for (const change of [{ packetId: null }, { packetId: "" }, { acquisitionId: id }, { ownerId: id }, { ssn: "PRIVATE-CANARY" }]) {
      expect(snapDirectPacketReadScopeSchema.safeParse({ ...scope, ...change }).success).toBe(false);
    }
  });
});
