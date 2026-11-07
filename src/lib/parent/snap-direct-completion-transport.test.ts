import { buildSync } from "esbuild";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureSnapSnapshot } from "./test-fixtures";
import { SNAP_PARENT_CERTIFICATION_ACTS } from "./snap-protected-operation";
import { SNAP_DIRECT_COMPLETION_TRANSPORT_ERROR, recoverSnapDirectCompletion, sendSnapDirectCompletion } from "./snap-direct-completion-transport";

const now = new Date("2026-11-05T20:00:00.000Z"), preparedAt = new Date("2026-11-05T19:59:00.000Z");
const ownerId = "99999999-9999-4999-8999-999999999999", packetId = "abcdefab-cdef-4abc-8def-abcdefabcdef";
function inputs() {
  const snapshot = structuredClone(fixtureSnapSnapshot(preparedAt));
  const context = { requestVersion: snapshot.request_version, snapshotId: snapshot.id, snapshotHash: "a".repeat(64), source: snapshot.source,
    applyingSubjectIds: snapshot.details.household!.filter(person => person.requestingSnap).map(person => person.id) };
  const trusted = { requestId: snapshot.request_id, context, snapshot, preparedAt: preparedAt.toISOString(), unsignedContentSha256: "b".repeat(64) };
  const completion = { requestId: trusted.requestId, requestVersion: context.requestVersion, snapshotId: context.snapshotId, snapshotHash: context.snapshotHash,
    source: context.source, unsignedContentSha256: trusted.unsignedContentSha256, signingRoute: "applicant_name_handwriting",
    identifiers: context.applyingSubjectIds.map(personId => ({ personId, kind: "ssn", value: "900000001" })),
    certifications: SNAP_PARENT_CERTIFICATION_ACTS.map((actId, i) => ({ actId, provenance: "caller_reported_fresh_parent_drawing",
      startedAt: `2026-11-05T19:59:${i ? "30" : "10"}.000Z`, completedAt: `2026-11-05T19:59:${i ? "40" : "20"}.000Z`, date: "2026-11-05",
      strokes: [[{ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.9 }]],
    })) };
  const scope = { ownerId, requestId: trusted.requestId, expectedVersion: context.requestVersion, packetId, snapshotId: context.snapshotId, snapshotHash: context.snapshotHash };
  const authorization = { intent: { format: "caselink-snap-final-packet-v1", packetId, ownerId, requestId: trusted.requestId, requestVersion: context.requestVersion,
    recipient: "snap-pa", need: "snap_new", purpose: "snap_final_application_packet", authorizationId: "44444444-4444-4444-8444-444444444444",
    policyVersion: "synthetic-policy", retentionPolicyVersion: "synthetic-retention", templateId: context.source.templateId, templateVersion: context.source.templateVersion,
    templateSha256: context.source.templateSha256, snapshotId: context.snapshotId, snapshotHash: context.snapshotHash, contentSha256: "c".repeat(64), byteLength: 437000 },
    consentedAt: "2026-11-05T19:58:00.000Z", authorizationExpiresAt: "2026-11-05T20:05:00.000Z", subjectIds: context.applyingSubjectIds,
    authorityDeclaration: "parent_declared_household_data_authority", state: "authorized" };
  return { scope, authorization, trusted, completion };
}
const unconfirmed = { state: "storage_unconfirmed", packetId };
const url = () => `/protected/snap/requests/${inputs().scope.requestId}/packets/${packetId}/direct-completion?expectedVersion=2`;
const response = (value: unknown = { state: "stored", packetId }, status = 201, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", ...headers } });
const send = (value = inputs(), signal?: AbortSignal) => sendSnapDirectCompletion(value.scope, value.authorization, value.trusted, value.completion, { signal });
const recover = (value = inputs(), signal?: AbortSignal) => recoverSnapDirectCompletion(value.scope, value.authorization, { signal });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); fetchMock = vi.fn().mockResolvedValue(response()); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("private direct SNAP completion transport", () => {
  it("posts only parsed completion to the isolated path, then wipes its owned UTF-8 body", async () => {
    let encoded: Uint8Array | undefined, sent = "";
    fetchMock.mockImplementation(async (_url, options) => { encoded = options.body; sent = new TextDecoder().decode(encoded); return response(); });
    const value = inputs(), before = structuredClone(value);
    expect(await send(value)).toEqual({ state: "stored", packetId }); expect(value).toEqual(before);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(url(), expect.objectContaining({ method: "POST", credentials: "same-origin", mode: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
      headers: { Accept: "application/json", "Content-Type": "application/json" }, signal: expect.any(AbortSignal) }));
    expect(JSON.parse(sent)).toEqual(value.completion); expect(Object.keys(JSON.parse(sent))).toEqual(Object.keys(value.completion));
    for (const privateOrOrdinary of ["Private Canary", "1 Synthetic Street", "1990-01-01", ownerId, "synthetic-policy", "subjectIds", "authorizationId", '"snapshot":', '"trusted":']) expect(sent).not.toContain(privateOrOrdinary);
    expect(sent).toContain("900000001"); expect(sent).toContain("strokes"); expect(encoded?.every(byte => byte === 0)).toBe(true);
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty("Content-Length");
  });
  it("keeps an explicit stored POST on the regeneration path instead of acknowledging an older candidate via GET", async () => {
    const value = inputs(); value.authorization.state = "stored";
    expect(await send(value)).toEqual({ state: "stored", packetId }); expect(fetchMock.mock.calls[0][1].method).toBe("POST"); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("sends an explicit per-applicant deferral without inventing or including an identifier value", async () => {
    const value = inputs(), identifiers = [{ personId: value.trusted.context.applyingSubjectIds[0], kind: "provide_to_agency_later" }];
    let sent = ""; fetchMock.mockImplementation(async (_url, options) => { sent = new TextDecoder().decode(options.body); return response(); });
    expect(await sendSnapDirectCompletion(value.scope, value.authorization, value.trusted, { ...value.completion, identifiers })).toEqual({ state: "stored", packetId });
    expect(JSON.parse(sent).identifiers).toEqual(identifiers); expect(sent).not.toContain("900000001"); expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("copies input scope/private drawings before its first await", async () => {
    let encoded: Uint8Array | undefined, sent = "";
    fetchMock.mockImplementation(async (_url, options) => { encoded = options.body; sent = new TextDecoder().decode(encoded); await Promise.resolve(); return response(); });
    const value = inputs(), pending = send(value); value.scope.packetId = value.scope.requestId; value.authorization.intent.byteLength++;
    value.completion.identifiers[0].value = "900000009"; value.completion.certifications[0].strokes[0][0].x = 0.99; value.trusted.snapshot.details.phone = "215-555-0109";
    expect(await pending).toEqual({ state: "stored", packetId }); expect(JSON.parse(sent)).toEqual(inputs().completion); expect(encoded?.every(byte => byte === 0)).toBe(true);
  });
  it.each(["ownerId", "requestId", "expectedVersion", "packetId", "snapshotId", "snapshotHash"] as const)("rejects mismatched local %s before network access", async key => {
    const value = inputs(); Reflect.set(value.scope, key, key === "expectedVersion" ? 3 : key === "snapshotHash" ? "d".repeat(64) : "55555555-5555-4555-8555-555555555555");
    await expect(send(value)).rejects.toThrow(SNAP_DIRECT_COMPLETION_TRANSPORT_ERROR); await expect(recover(value)).rejects.toThrow(SNAP_DIRECT_COMPLETION_TRANSPORT_ERROR); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["scope_extra", "authorization_extra", "expired", "future_consent", "wrong_template", "bad_state"])("rejects suspicious %s metadata before network access", async kind => {
    const value = inputs();
    if (kind === "scope_extra") Reflect.set(value.scope, "ssn", "PRIVATE-CANARY");
    if (kind === "authorization_extra") Reflect.set(value.authorization, "rawFile", "PRIVATE-CANARY");
    if (kind === "expired") value.authorization.authorizationExpiresAt = now.toISOString();
    if (kind === "future_consent") value.authorization.consentedAt = "2026-11-05T20:01:00.000Z";
    if (kind === "wrong_template") value.authorization.intent.templateSha256 = "d".repeat(64);
    if (kind === "bad_state") value.authorization.state = "complete";
    const error = await send(value).catch(error => error as Error); expect((error as Error).message).toBe(SNAP_DIRECT_COMPLETION_TRANSPORT_ERROR); expect((error as Error).message).not.toContain("PRIVATE-"); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["request", "version", "snapshot", "hash", "source", "subjects", "identifier", "stroke", "future_act", "unknown"])("uses the existing full parser to reject changed %s without uploading", async kind => {
    const value = inputs();
    if (kind === "request") value.completion.requestId = packetId;
    if (kind === "version") value.completion.requestVersion++;
    if (kind === "snapshot") value.completion.snapshotId = packetId;
    if (kind === "hash") value.completion.snapshotHash = "d".repeat(64);
    if (kind === "source") Reflect.set(value.completion.source, "templateSha256", "d".repeat(64));
    if (kind === "subjects") value.authorization.subjectIds = [ownerId];
    if (kind === "identifier") value.completion.identifiers[0].value = "PRIVATE-CANARY";
    if (kind === "stroke") value.completion.certifications[0].strokes = [];
    if (kind === "future_act") value.completion.certifications[0].completedAt = "2026-11-05T20:01:00.000Z";
    if (kind === "unknown") Reflect.set(value.completion, "debug", "PRIVATE-CANARY");
    await expect(send(value)).rejects.toThrow(SNAP_DIRECT_COMPLETION_TRANSPORT_ERROR); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("enforces the encoded UTF-8 request bound before fetch (synthetic encoder-size seam)", async () => {
    const oversized = new Uint8Array(256 * 1024 + 1); oversized.fill(1); vi.spyOn(TextEncoder.prototype, "encode").mockReturnValueOnce(oversized);
    await expect(send()).rejects.toThrow(SNAP_DIRECT_COMPLETION_TRANSPORT_ERROR); expect(fetchMock).not.toHaveBeenCalled(); expect(oversized.every(byte => byte === 0)).toBe(true);
  });
  it.each([200, 201])("accepts only a storage acknowledgement on POST status %i", async status => {
    fetchMock.mockResolvedValue(response({ state: "stored", packetId }, status)); expect(await send()).toEqual({ state: "stored", packetId });
  });
  it.each([202, 400, 401, 403, 409, 500, 503])("keeps status %i unconfirmed without a retry or response-error echo", async status => {
    fetchMock.mockResolvedValue(response(status === 202 ? unconfirmed : { error: "PRIVATE-PROVIDER-CANARY" }, status)); expect(await send()).toEqual(unconfirmed); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([{ state: "stored", packetId: ownerId }, { state: "stored", packetId, debug: "PRIVATE-CANARY" }, { state: "complete", packetId }, null,
    { state: "storage_unconfirmed", packetId }])("rejects wrong/extra/nonmatching successful replies %#", async body => {
    fetchMock.mockResolvedValue(response(body)); expect(await send()).toEqual(unconfirmed); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("does not accept stored under an unconfirmed response status or unconfirmed under 200", async () => {
    fetchMock.mockResolvedValue(response({ state: "stored", packetId }, 202)); expect(await send()).toEqual(unconfirmed);
    fetchMock.mockResolvedValue(response(unconfirmed, 200)); expect(await send()).toEqual(unconfirmed); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each(["oversized", "bad_json", "utf8", "declared_large", "declared_wrong", "redirect", "wrong_media"])("bounds and discards %s responses without returning raw data", async kind => {
    const raw = kind === "utf8" ? Uint8Array.of(255) : new TextEncoder().encode(kind === "bad_json" ? "{PRIVATE-CANARY" : kind === "oversized" ? "x".repeat(1025) : JSON.stringify({ state: "stored", packetId }));
    const headers: Record<string, string> = { "Content-Type": kind === "wrong_media" ? "text/plain" : "application/json", ...(kind === "declared_large" ? { "Content-Length": "1025" } : kind === "declared_wrong" ? { "Content-Length": "1" } : {}) };
    const value = new Response(new ReadableStream({ start(stream) { stream.enqueue(raw); stream.close(); } }), { status: 201, headers });
    if (kind === "redirect") Object.defineProperty(value, "redirected", { value: true });
    fetchMock.mockResolvedValue(value); expect(await send()).toEqual(unconfirmed); expect(fetchMock).toHaveBeenCalledTimes(1);
    if (["oversized", "bad_json", "utf8", "declared_wrong"].includes(kind)) expect(raw.every(byte => byte === 0)).toBe(true);
  });
  it("uses the mandatory 30-second bound even if fetch ignores its abort signal", async () => {
    let encoded: Uint8Array | undefined, active: AbortSignal | undefined;
    fetchMock.mockImplementation((_url, options) => { encoded = options.body; active = options.signal; return new Promise(() => {}); });
    const pending = send(); await vi.advanceTimersByTimeAsync(30000); expect(await pending).toEqual(unconfirmed); expect(active?.aborted).toBe(true); expect(encoded?.every(byte => byte === 0)).toBe(true); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("keeps an already aborted valid known attempt unconfirmed without fetch", async () => {
    expect(await send(inputs(), AbortSignal.abort())).toEqual(unconfirmed); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("contains a simultaneous abort and synchronous fetch failure without an unhandled rejection", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(() => { controller.abort(); throw new Error("PRIVATE-FETCH-CANARY"); });
    expect(await send(inputs(), controller.signal)).toEqual(unconfirmed); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("wipes an aborted request and cancels a late fetch response without acknowledging storage", async () => {
    const aborted = new AbortController(); let encoded: Uint8Array | undefined, finish!: (value: Response) => void, cancelled = false;
    fetchMock.mockImplementation((_url, options) => { encoded = options.body; return new Promise(resolve => { finish = resolve; }); });
    const pending = send(inputs(), aborted.signal); aborted.abort("PRIVATE-ABORT-CANARY"); expect(await pending).toEqual(unconfirmed); expect(encoded?.every(byte => byte === 0)).toBe(true);
    finish(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 201, headers: { "Content-Type": "application/json" } }));
    await Promise.resolve(); await Promise.resolve(); expect(cancelled).toBe(true); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("bounds a stalled response body and wipes chunks arriving after abort", async () => {
    let finish!: (value: ReadableStreamReadResult<Uint8Array>) => void, cancelled = 0;
    const body = { getReader: () => ({ read: () => new Promise(resolve => { finish = resolve; }), cancel: async () => { cancelled++; } }), cancel: async () => { cancelled++; } };
    fetchMock.mockResolvedValue({ status: 201, redirected: false, headers: new Headers({ "Content-Type": "application/json" }), body });
    const pending = send(); await vi.advanceTimersByTimeAsync(0); await vi.advanceTimersByTimeAsync(30000); expect(await pending).toEqual(unconfirmed);
    const raw = new TextEncoder().encode("PRIVATE-LATE-REPLY-CANARY"); finish({ done: false, value: raw }); await Promise.resolve(); await Promise.resolve();
    expect(raw.every(byte => byte === 0)).toBe(true); expect(cancelled).toBeGreaterThan(0);
  });
  it("discards an acknowledgement if authorization expires while awaiting the response", async () => {
    fetchMock.mockImplementation(async () => { vi.setSystemTime(new Date("2026-11-05T20:06:00.000Z")); return response(); }); expect(await send()).toEqual(unconfirmed);
  });
  it("uses an explicit readonly GET after an unknown POST, without any automatic recovery or resubmission", async () => {
    fetchMock.mockRejectedValueOnce(new Error("PRIVATE-TRANSPORT-CANARY")); expect(await send()).toEqual(unconfirmed); expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(response({ state: "stored", packetId }, 200)); expect(await recover()).toEqual({ state: "stored", packetId }); expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([, options]) => options.method)).toEqual(["POST", "GET"]); expect(fetchMock.mock.calls[1][1].body).toBeUndefined(); expect(fetchMock.mock.calls[1][1].headers).toEqual({ Accept: "application/json" });
  });
  it("never accepts a GET-created acknowledgement or creates a new intent after missing recovery", async () => {
    fetchMock.mockResolvedValue(response({ state: "stored", packetId }, 201)); expect(await recover()).toEqual(unconfirmed);
    fetchMock.mockResolvedValue(response({ error: "PRIVATE-NOT-FOUND" }, 404)); expect(await recover()).toEqual(unconfirmed); expect(fetchMock.mock.calls.every(([, options]) => options.method === "GET")).toBe(true);
  });
  it("bundles for browsers without Node, server Auth, parentApi, ordinary storage or logging", () => {
    const bundled = buildSync({ entryPoints: ["src/lib/parent/snap-direct-completion-transport.ts"], bundle: true, platform: "browser", format: "esm", write: false, metafile: true });
    expect(bundled.outputFiles[0].text).not.toMatch(/node:crypto|node:fs|node:child_process/);
    const imports = Object.keys(bundled.metafile!.inputs);
    for (const path of ["src/features/parent/api.ts", "src/lib/parent/auth.ts", "src/lib/parent/snap-finalizer-client.ts", "src/lib/parent/snap-draft.ts"]) expect(imports).not.toContain(path);
    expect(bundled.outputFiles[0].text).not.toMatch(/console\.(log|warn|error)|localStorage|sessionStorage/);
  });
});
