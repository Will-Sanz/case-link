import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPgwUtilityPreparationRenderer } from "./pgw-private-preparation";
import { fictionalPgwFields } from "./pgw-application-test-fixtures";
import { PGW_APPLICATION_SOURCE, PGW_APPLICATION_NOTICE_VERSION, PGW_SUBJECT_AUTHORITY_STATEMENT, PGW_ACCOUNT_AUTHORITY_STATEMENT, pgwApplicationLeaves } from "./pgw-application-fields";
import { pgwApplicationSnapshotSchema } from "./pgw-application-snapshot";
import { utilityProtectedBindingSchema, utilityProtectedInputReferenceSchema } from "./utility-protected-input-contract";
import { fixtureMandate } from "./test-fixtures";
import type { UtilityPreparedRenderer } from "./utility-prepared-artifact-client";
import type { withUtilityProtectedInput } from "./utility-protected-client";

const ports = vi.hoisted(() => ({ read: vi.fn<typeof withUtilityProtectedInput>(), proofs: vi.fn() }));
vi.mock("./utility-protected-client", async load => ({ ...await load<typeof import("./utility-protected-client")>(), withUtilityProtectedInput: ports.read }));
vi.mock("./utility-preparation-pdf", () => ({ appendUtilityPreparationProofs: ports.proofs }));
const now = new Date("2026-11-13T22:00:00.000Z"), template = readFileSync("tests/fixtures/parent/pgw-crp-2026-11-13.pdf");
const owner = "44444444-4444-4444-8444-444444444444", household = "55555555-5555-4555-8555-555555555555";
const requestId = "66666666-6666-4666-8666-666666666666", snapshotId = "77777777-7777-4777-8777-777777777777";
const inputId = "88888888-8888-4888-8888-888888888888", authorizationId = "99999999-9999-4999-8999-999999999999";
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function setup() {
  const details = fictionalPgwFields();
  const snapshot = pgwApplicationSnapshotSchema.parse({ id: snapshotId, request_id: requestId, revision: 1, base_version: 1, request_version: 2, details,
    provenance: Object.fromEntries(Object.keys(pgwApplicationLeaves(details)).map(path => [path, { source: "parent", confirmedAt: now.toISOString(), asOf: "2026-11-13" }])),
    source: PGW_APPLICATION_SOURCE, notice_version: PGW_APPLICATION_NOTICE_VERSION, created_at: now.toISOString(), idempotency_key: owner,
    consent_evidence: { subjectAuthorityDeclared: true, subjectStatement: PGW_SUBJECT_AUTHORITY_STATEMENT, accountAuthorityDeclared: true,
      accountStatement: PGW_ACCOUNT_AUTHORITY_STATEMENT, accountAuthority: "self", actorId: owner, noticeVersion: PGW_APPLICATION_NOTICE_VERSION,
      declaredAt: now.toISOString(), revision: 1, detailsSha256: "a".repeat(64), accountNumberSha256: hash(details.accountNumber!),
      subjects: [`customer.${details.customer!.id}`, ...details.householdMembers!.map(person => `householdMembers.${person.id}`)] } });
  const reference = utilityProtectedInputReferenceSchema.parse({ inputId, authorizationId, ownerId: owner, requestId, requestVersion: 2, programId: "pgw-crp", snapshotId, snapshotRevision: 1,
    snapshotHash: snapshot.consent_evidence.detailsSha256, purpose: "required_identifier", targets: [{ subjectId: details.householdMembers![0].id, sourceId: null, field: "pgw_household_identifier" }],
    state: "stored", consentedAt: now.toISOString(), expiresAt: "2026-11-13T22:01:00.000Z", validation: null });
  const input: Parameters<UtilityPreparedRenderer>[0] = { context: { ownerId: owner, householdId: household, accountAuthority: "self", grantExpiresAt: "2026-11-13T22:10:00.000Z",
    requestId, requestVersion: 2, programId: "pgw-crp", need: "gas", snapshot,
    mandate: fixtureMandate({ recipientIds: ["pgw-crp"], allowedActions: ["research", "prepare"], allowedData: ["household", "income", "utility", "documents"], mode: "prepare_only", expiresAt: "2026-11-13T22:10:00.000Z" }),
    sourceExpiresAt: snapshot.source.verifiedUntil, approvalExpiresAt: "2026-11-13T22:10:00.000Z" }, references: [reference],
    options: { connectionString: "fictional-private-test-port", deadline: new Date(now.getTime() + 30000) } };
  const scalar = { purpose: "required_identifier" as const, type: "student_id" as const, value: "FICT-CHILD-01" };
  const raw = { binding: utilityProtectedBindingSchema.parse({ ...Object.fromEntries(Object.entries(reference).filter(([key]) => !["state", "validation"].includes(key))), format: "caselink-utility-protected-input-v1", need: "gas", policyVersion: "test.v1", retentionPolicyVersion: "test.v1",
    mediaType: "application/octet-stream", byteLength: JSON.stringify(scalar).length, contentDigest: "b".repeat(64) }),
    snapshot: structuredClone(snapshot), bytes: new TextEncoder().encode(JSON.stringify(scalar)) };
  return { input, raw, scalar };
}
let test: ReturnType<typeof setup>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); test = setup(); ports.read.mockReset(); ports.proofs.mockReset();
  ports.read.mockImplementation(async (_id, _options, action) => action(test.raw));
  ports.proofs.mockImplementation(async bytes => ({ bytes: Uint8Array.from(bytes), inputs: [], expiresAt: null }));
});
afterEach(() => vi.useRealTimers());
const render = () => createPgwUtilityPreparationRenderer(template)(test.input);
describe("isolated owned PGW form preparation", () => {
  it.each(PGW_APPLICATION_SOURCE.identifierTypes)("inserts the permitted fictional %s scalar through the protected port, preserving unsigned boundaries", async type => {
    const scalar = { purpose: "required_identifier", type, value: "FICT-ID-01", ...(type === "other" ? { otherType: "Fictional program card" } : {}) };
    test.raw.bytes = new TextEncoder().encode(JSON.stringify(scalar));
    const output = await render(); expect(output).not.toBeNull();
    expect((await PDFDocument.load(output!.bytes)).getPageCount()).toBe(type === "other" ? 5 : 4);
    expect(output).toMatchObject({ expiresAt: test.input.references[0].expiresAt, source: { kind: "official_public_form", sha256: PGW_APPLICATION_SOURCE.sourceSha256 },
      inputs: [{ inputId, authorizationId, validationId: null }] });
    expect(ports.read.mock.calls[0][1]).toBe(test.input.options); expect(ports.read.mock.calls[0][3]).toBeUndefined();
    expect(ports.proofs.mock.calls[0][3]).toBe(test.input.options);
    expect(JSON.stringify({ ...output, bytes: undefined })).not.toMatch(/FICT-ID|Fictional program card|student_id/);
  });
  it("waits without producing a packet when any source-required member identifier or ordinary field is missing", async () => {
    test.input.references = []; expect(await render()).toBeNull(); expect(ports.read).not.toHaveBeenCalled();
    test = setup(); delete test.input.context.snapshot.details.phone;
    delete (test.input.context.snapshot as unknown as { provenance: Record<string, unknown> }).provenance.phone;
    expect(await render()).toBeNull(); expect(ports.read).not.toHaveBeenCalled(); expect(ports.proofs).not.toHaveBeenCalled();
  });
  it("allows current routing or pause/resume versions without a repeated declaration of unchanged private facts", async () => {
    test.input.context.requestVersion = 3; test.input.references[0].requestVersion = 3; test.raw.binding.requestVersion = 3;
    expect(await render()).not.toBeNull();
  });
  it("prepares the protected scalar-only case under an existing three-category mandate without adding file permission", async () => {
    test.input.context.mandate.allowedData = ["household", "income", "utility"];
    const output = await render(); expect(output).not.toBeNull();
    expect(output?.inputs).toEqual([{ inputId, authorizationId, validationId: null }]);
    expect(ports.proofs.mock.calls[0][2].every((reference: { purpose: string }) => reference.purpose === "required_identifier")).toBe(true);
  });
  it.each(["owner", "account", "authority", "request", "version", "program", "need", "mandate", "permission", "source", "approval", "grant"])("rejects a mismatched or expired %s context generically", async change => {
    const context = test.input.context;
    if (change === "owner") context.ownerId = household;
    if (change === "account") context.snapshot.details.accountNumber = "DIFFERENT-ACCOUNT";
    if (change === "authority") context.accountAuthority = "authorized_caregiver";
    if (change === "request") context.requestId = household;
    if (change === "version") context.requestVersion = 1;
    if (change === "program") context.programId = "pwd-tap";
    if (change === "need") context.need = "water";
    if (change === "mandate") context.mandate.recipientIds = ["peco-cap"];
    if (change === "permission") context.mandate.allowedData = ["income", "utility"];
    if (change === "source") context.sourceExpiresAt = now.toISOString();
    if (change === "approval") context.approvalExpiresAt = now.toISOString();
    if (change === "grant") context.grantExpiresAt = now.toISOString();
    await expect(render()).rejects.toEqual(new Error("The protected PGW preparation needs a service check."));
    expect(ports.read).not.toHaveBeenCalled();
  });
  it.each(["customer", "source", "expired", "duplicate", "staleSnapshot"])("does not read a %s identifier reference", async change => {
    const reference = test.input.references[0];
    if (change === "customer") reference.targets[0].subjectId = fictionalPgwFields().customer!.id;
    if (change === "source") reference.targets[0].sourceId = owner;
    if (change === "expired") reference.expiresAt = now.toISOString();
    if (change === "duplicate") test.input.references.push(structuredClone(reference));
    if (change === "staleSnapshot") reference.snapshotId = owner;
    await expect(render()).rejects.toThrow("service check"); expect(ports.read).not.toHaveBeenCalled();
  });
  it.each(["account", "person", "actor", "snapshot", "target", "expiry", "purpose", "malformed", "wrongScalar", "unrenderable"])("rejects a substituted protected %s without returning identifier data", async change => {
    if (change === "account") test.raw.snapshot.details.accountNumber = "OTHER-ACCOUNT";
    if (change === "person") test.raw.snapshot.details.householdMembers = [{ ...fictionalPgwFields().householdMembers![0], firstName: "Substituted" }];
    if (change === "actor") test.raw.snapshot.consent_evidence.actorId = household;
    if (change === "snapshot") test.raw.binding.snapshotId = household;
    if (change === "target") test.raw.binding.targets[0].subjectId = owner;
    if (change === "expiry") test.raw.binding.expiresAt = "2026-11-13T22:02:00.000Z";
    if (change === "purpose") test.raw.binding.purpose = "income_proof";
    if (change === "malformed") test.raw.bytes = new TextEncoder().encode("{");
    if (change === "wrongScalar") test.raw.bytes = new TextEncoder().encode(JSON.stringify({ purpose: "account_access", accessCode: "000000000", zip: "19104" }));
    if (change === "unrenderable") test.raw.bytes = new TextEncoder().encode(JSON.stringify({ ...test.scalar, value: "X".repeat(256) }));
    await expect(render()).rejects.toEqual(new Error("The protected PGW preparation needs a service check."));
    expect(ports.proofs).not.toHaveBeenCalled();
  });
  it("copies snapshot/references/template before the first await and preserves the original deadline", async () => {
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    ports.read.mockImplementationOnce(async (_id, _options, action) => { await waiting; return action(test.raw); });
    const source = Uint8Array.from(template), renderer = createPgwUtilityPreparationRenderer(source), pending = renderer(test.input);
    source.fill(0); test.input.context.snapshot.details.accountNumber = "MUTATED"; test.input.references[0].targets[0].subjectId = owner;
    test.input.context.approvalExpiresAt = now.toISOString(); release();
    const output = await pending; expect(output?.expiresAt).toBe("2026-11-13T22:01:00.000Z");
  });
  it("drops a rendered packet if its original identifier permission expires during preparation", async () => {
    let generated: Uint8Array | undefined;
    ports.proofs.mockImplementationOnce(async bytes => {
      generated = Uint8Array.from(bytes); vi.setSystemTime(new Date("2026-11-13T22:01:00.000Z")); return { bytes: generated, inputs: [], expiresAt: null };
    });
    await expect(render()).rejects.toThrow("service check"); expect(generated!.every(value => value === 0)).toBe(true);
  });
});
