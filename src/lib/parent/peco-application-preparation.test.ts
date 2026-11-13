import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { fixtureMandate } from "./test-fixtures";
import { PECO_ACCOUNT_AUTHORITY_STATEMENT, PECO_APPLICATION_NOTICE_VERSION, PECO_APPLICATION_SOURCE, PECO_SUBJECT_AUTHORITY_STATEMENT, pecoApplicationLeaves, type PecoApplicationFields } from "./peco-application-fields";
import { pecoApplicationSnapshotSchema, type PecoApplicationSnapshot } from "./peco-application-snapshot";
import { PECO_APPLICATION_PREPARATION_ERROR, prepareFictionalPecoApplicationDraft, type FictionalPecoPreparationContext } from "./peco-application-preparation";

const template = readFileSync("tests/fixtures/parent/peco-cap-2026.pdf");
const now = new Date("2026-11-13T20:10:00Z"), earlier = "2026-11-13T20:07:00.000Z", expiry = "2026-11-14T20:00:00.000Z";
const requestId = "11111111-1111-4111-8111-111111111111", snapshotId = "22222222-2222-4222-8222-222222222222";
const actorId = "33333333-3333-4333-8333-333333333333", applicantId = "44444444-4444-4444-8444-444444444444", childId = "55555555-5555-4555-8555-555555555555";
const sourceId = "66666666-6666-4666-8666-666666666666", otherId = "77777777-7777-4777-8777-777777777777";
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function snapshot(details: PecoApplicationFields = { journey: "new_enrollment", currentCapState: "not_enrolled", householdComplete: true, accountNumber: "9000000001",
  applicant: { id: applicantId, firstName: "Fictional", lastName: "Rivera", dateOfBirth: "1988-04-15", income: { state: "sources", sources: [{ id: sourceId, kind: "employment" }] } },
  address: { street: "123 Synthetic Way", city: "Philadelphia", state: "PA", zip: "19104" }, householdMembers: [{ id: childId, firstName: "FictionalChild", lastName: "Rivera", dateOfBirth: "2020-01-01", relationship: "Child" }] }) {
  return pecoApplicationSnapshotSchema.parse({ id: snapshotId, request_id: requestId, revision: 1, base_version: 1, request_version: 2, details,
    provenance: Object.fromEntries(Object.keys(pecoApplicationLeaves(details)).map(path => [path, { source: "parent", confirmedAt: earlier, asOf: "2026-11-13" }])),
    source: structuredClone(PECO_APPLICATION_SOURCE), notice_version: PECO_APPLICATION_NOTICE_VERSION, created_at: "2026-11-13T20:08:00.000Z", idempotency_key: sourceId,
    consent_evidence: { subjectAuthorityDeclared: true, subjectStatement: PECO_SUBJECT_AUTHORITY_STATEMENT, accountAuthorityDeclared: true, accountStatement: PECO_ACCOUNT_AUTHORITY_STATEMENT,
      accountAuthority: "self", actorId, noticeVersion: PECO_APPLICATION_NOTICE_VERSION, declaredAt: "2026-11-13T20:08:00.000Z", revision: 1,
      detailsSha256: hash(JSON.stringify(details)), accountNumberSha256: details.accountNumber ? hash(details.accountNumber) : null,
      subjects: [...(details.applicant ? [`applicant.${details.applicant.id}`] : []), ...(details.householdMembers ?? []).map(person => `householdMembers.${person.id}`)] } });
}
function context(value: PecoApplicationSnapshot): FictionalPecoPreparationContext {
  const binding = { requestId, householdId: "88888888-8888-4888-8888-888888888888", requestVersion: 2, accountRef: snapshotId,
    programId: "peco-cap" as const, need: "electricity" as const, purpose: "income_preparation" as const };
  return { kind: "fictional_offline_rehearsal", expectedSnapshot: { id: value.id, revision: value.revision, sha256: hash(JSON.stringify(value)), binding: { ...binding } }, binding,
    actorId, accountAuthority: "self", accountNumberSha256: value.consent_evidence.accountNumberSha256, requestState: "active",
    mandate: fixtureMandate({ recipientIds: ["peco-cap"], mode: "prepare_only", allowedActions: ["research", "prepare"], allowedData: ["household", "income", "utility"], expiresAt: expiry }),
    mandateRevoked: false, grant: { expiresAt: expiry, revoked: false }, collection: { collectionEnabled: true, noticeVersion: PECO_APPLICATION_NOTICE_VERSION, expiresAt: expiry },
    validUntil: expiry, retentionUntil: expiry };
}
const prepare = (value = snapshot(), scope = context(value), at = now) => prepareFictionalPecoApplicationDraft(template, value, scope, at);
describe("fictional exact private PECO snapshot projection", () => {
  it("prepares an unsigned source-bound draft without claiming proof, certification, submission or sending", async () => {
    const value = snapshot(), scope = context(value), result = await prepare(value, scope);
    expect(result).toMatchObject({ kind: "fictional_unsigned_preparation", formFieldsReady: true, missingFacts: [], serviceBlockers: [],
      incomeProof: "not_assessed", certification: "not_recorded", submissionReady: false, sending: "not_attempted" });
    expect((await PDFDocument.load(result.bytes!)).getPageCount()).toBe(2);
    expect(result.manifest).toMatchObject({ sourceSnapshot: { id: value.id, revision: value.revision, sha256: scope.expectedSnapshot.sha256 },
      subjectIds: [applicantId, childId], binding: scope.binding, confirmedAt: earlier, validUntil: expiry, retentionUntil: expiry,
      artifactSha256: hash(result.bytes!), templateSha256: PECO_APPLICATION_SOURCE.sourceSha256 });
  });
  it("returns known missing facts together, keeps unknown journey and income unanswered, and emits no bytes", async () => {
    const value = snapshot({ applicant: { id: applicantId, dateOfBirth: "1988-04-15", income: { state: "unknown", sources: [] } } });
    const result = await prepare(value);
    expect(result.bytes).toBeNull(); expect(result.manifest).toBeNull(); expect(result.formFieldsReady).toBe(false);
    expect(result.missingFacts).toEqual(expect.arrayContaining([
      { group: "cap_journey", fields: ["journey"] }, { group: "cap_enrollment", fields: ["currentCapState"] },
      { group: "account", fields: ["accountNumber"] }, { group: "household", fields: ["householdComplete"] },
      { group: "applicant", fields: ["applicant.firstName", "applicant.lastName", "applicant.income"] },
      { group: "service_address", fields: ["address.street", "address.city", "address.state", "address.zip"] },
    ]));
    expect(JSON.stringify(result)).not.toContain("No income");
  });
  it.each(["renewal", "already_enrolled"])("does not turn %s into a new CAP application", async route => {
    const details = structuredClone(snapshot().details);
    if (route === "renewal") details.journey = "renewal"; else details.currentCapState = "enrolled";
    const result = await prepare(snapshot(details));
    expect(result.bytes).toBeNull(); expect(result.serviceBlockers).toEqual(["different_cap_journey_required"]);
  });
  it.each<[string, (scope: FictionalPecoPreparationContext) => void]>([
    ["wrong id", (scope: FictionalPecoPreparationContext) => { scope.expectedSnapshot.id = otherId; }],
    ["wrong revision", (scope: FictionalPecoPreparationContext) => { scope.expectedSnapshot.revision++; }],
    ["wrong digest", (scope: FictionalPecoPreparationContext) => { scope.expectedSnapshot.sha256 = "0".repeat(64); }],
    ["wrong request", (scope: FictionalPecoPreparationContext) => { scope.binding.requestId = otherId; }],
    ["wrong household", (scope: FictionalPecoPreparationContext) => { scope.binding.householdId = otherId; }],
    ["wrong request version", (scope: FictionalPecoPreparationContext) => { scope.binding.requestVersion++; }],
    ["wrong account reference", (scope: FictionalPecoPreparationContext) => { scope.binding.accountRef = otherId; }],
    ["wrong actor", (scope: FictionalPecoPreparationContext) => { scope.actorId = otherId; }],
    ["wrong account digest", (scope: FictionalPecoPreparationContext) => { scope.accountNumberSha256 = hash("9000000002"); }],
    ["changed account authority", (scope: FictionalPecoPreparationContext) => { scope.accountAuthority = "authorized_caregiver"; }],
    ["revoked mandate", (scope: FictionalPecoPreparationContext) => { scope.mandateRevoked = true; }],
    ["revoked grant", (scope: FictionalPecoPreparationContext) => { scope.grant.revoked = true; }],
    ["cancelled request", (scope: FictionalPecoPreparationContext) => { scope.requestState = "cancelled"; }],
    ["paused request", (scope: FictionalPecoPreparationContext) => { scope.requestState = "paused"; }],
    ["wrong recipient", (scope: FictionalPecoPreparationContext) => { scope.mandate.recipientIds = ["pgw-crp"]; }],
    ["different purpose", (scope: FictionalPecoPreparationContext) => { scope.mandate.mode = "full"; }],
    ["missing data permission", (scope: FictionalPecoPreparationContext) => { scope.mandate.allowedData = ["household", "utility"]; }],
    ["closed collection", (scope: FictionalPecoPreparationContext) => { scope.collection = { collectionEnabled: false, noticeVersion: null, expiresAt: null }; }],
    ...(["validUntil", "retentionUntil"] as const).map(key => [`expired ${key}`, (scope: FictionalPecoPreparationContext) => { scope[key] = now.toISOString(); }] as [string, (scope: FictionalPecoPreparationContext) => void]),
    ["expired mandate", (scope: FictionalPecoPreparationContext) => { scope.mandate.expiresAt = now.toISOString(); }],
    ["expired grant", (scope: FictionalPecoPreparationContext) => { scope.grant.expiresAt = now.toISOString(); }],
    ["expired collection", (scope: FictionalPecoPreparationContext) => { scope.collection.expiresAt = now.toISOString(); }],
  ])("rejects %s without echoing private answers", async (_name, change) => {
    const value = snapshot(), scope = context(value); change(scope);
    await expect(prepare(value, scope)).rejects.toEqual(new Error(PECO_APPLICATION_PREPARATION_ERROR));
  });
  it.each(["name", "account", "date", "person id", "source id", "source kind", "provenance", "official source"])("rejects changed %s under an earlier trusted reference", async field => {
    const value = snapshot(), scope = context(value);
    if (field === "name") value.details.applicant!.firstName = "Substituted";
    if (field === "account") value.details.accountNumber = "9000000002";
    if (field === "date") value.details.applicant!.dateOfBirth = "1988-04-16";
    if (field === "person id") value.details.applicant!.id = otherId;
    if (field === "source id") value.details.applicant!.income!.sources[0].id = otherId;
    if (field === "source kind") value.details.applicant!.income!.sources[0].kind = "pension";
    if (field === "provenance") Object.values(value.provenance)[0].confirmedAt = "2026-11-13T20:07:01.000Z";
    if (field === "official source") value.source = { ...value.source, sourceSha256: "0".repeat(64) } as typeof value.source;
    await expect(prepare(value, scope)).rejects.toEqual(new Error(PECO_APPLICATION_PREPARATION_ERROR));
  });
  it("accepts a genuinely new trusted correction while preserving IDs and original field dates", async () => {
    const details = structuredClone(snapshot().details); details.applicant!.firstName = "Corrected";
    const value = snapshot(details); value.id = otherId; value.revision = 2; value.consent_evidence.revision = 2;
    const scope = context(value), result = await prepare(value, scope);
    expect(result.formFieldsReady).toBe(true); expect(result.manifest?.sourceSnapshot).toMatchObject({ id: otherId, revision: 2 });
    expect(result.manifest?.subjectIds).toEqual([applicantId, childId]); expect(result.manifest?.confirmedAt).toBe(earlier);
  });
  it("can bind unchanged latest facts to a newer independently trusted request version without a family re-save", async () => {
    const value = snapshot(), scope = context(value); scope.binding.requestVersion = 3; scope.expectedSnapshot.binding.requestVersion = 3;
    const result = await prepare(value, scope);
    expect(result.formFieldsReady).toBe(true); expect(result.manifest?.binding.requestVersion).toBe(3);
    expect(result.manifest?.confirmedAt).toBe(earlier); expect(result.manifest?.sourceSnapshot.revision).toBe(1);
  });
  it("takes the earliest original deadline, never a later generation date", async () => {
    const value = snapshot(), scope = context(value); scope.retentionUntil = "2026-11-13T21:00:00.000Z";
    const result = await prepare(value, scope);
    expect(result.manifest).toMatchObject({ confirmedAt: earlier, validUntil: scope.retentionUntil, retentionUntil: scope.retentionUntil });
    expect((await prepare(value, scope, new Date("2026-11-13T20:20:00Z"))).manifest?.retentionUntil).toBe(scope.retentionUntil);
  });
  it("checks original source bounds and rejects non-fictional execution contexts", async () => {
    const value = snapshot(), scope = context(value);
    await expect(prepare(value, scope, new Date("2026-11-13T20:05:00Z"))).rejects.toEqual(new Error(PECO_APPLICATION_PREPARATION_ERROR));
    await expect(prepare(value, scope, new Date(PECO_APPLICATION_SOURCE.verifiedUntil))).rejects.toEqual(new Error(PECO_APPLICATION_PREPARATION_ERROR));
    await expect(prepareFictionalPecoApplicationDraft(template, value, { ...scope, kind: "owned_live_snapshot" }, now)).rejects.toEqual(new Error(PECO_APPLICATION_PREPARATION_ERROR));
  });
  it("snapshots values, source, context, template and date before asynchronous rendering", async () => {
    const value = snapshot(), scope = context(value), source = Uint8Array.from(template), at = new Date(now);
    const original = await prepare(value, scope), pending = prepareFictionalPecoApplicationDraft(source, value, scope, at);
    value.details.applicant!.firstName = "Mutated"; (value.source as { sourceSha256: string }).sourceSha256 = "0".repeat(64);
    scope.binding.accountRef = otherId; scope.retentionUntil = "2099-01-01T00:00:00Z"; source.fill(0); at.setUTCFullYear(2099);
    const result = await pending;
    expect(result.manifest).toEqual(original.manifest); expect(hash(result.bytes!)).toBe(hash(original.bytes!));
  });
  it("keeps unsupported rendering with CaseLink instead of guessing or treating it as missing family income", async () => {
    const details = structuredClone(snapshot().details); details.applicant!.firstName = "🙂";
    const result = await prepare(snapshot(details));
    expect(result.bytes).toBeNull(); expect(result.missingFacts).toEqual([]); expect(result.serviceBlockers).toEqual(["form_rendering_requires_service_check"]);
  });
});
