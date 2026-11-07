import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import source from "../../../data/verified-forms/snap-pa600fs-2019.json";
import { fixtureMandate, fixtureSnapSnapshot } from "./test-fixtures";
import { snapApplicationSnapshotSchema } from "./snap-application-snapshot";
import { MAX_SNAP_PACKET_BYTES } from "./snap-packet-contract";
import { loadSnapSigningCopyFile, SNAP_SIGNING_COPY_FILE_ERROR, type SnapSigningCopyFileInput } from "./snap-signing-copy-file";

// Synthetic bytes exercise descriptor/stream verification, not PDF structural or signature validation.
const paper = new TextEncoder().encode("%PDF-1.7 SYNTHETIC_UNSIGNED_PREPARATION"), sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const now = new Date("2026-11-05T22:00:00.000Z"), savedAt = new Date("2026-11-05T21:59:00.000Z"), fetcher = vi.fn();
const saved = (at: Date) => snapApplicationSnapshotSchema.parse(structuredClone(fixtureSnapSnapshot(at)));
function input(): SnapSigningCopyFileInput {
  const snapshot = saved(savedAt);
  return { requestId: snapshot.request_id, requestVersion: snapshot.request_version, status: "active", snapshot,
    mandate: fixtureMandate({ recipientIds: ["snap-pa"], expiresAt: new Date(now.getTime() + 60_000).toISOString() }),
    context: { requestVersion: snapshot.request_version, snapshotId: snapshot.id, snapshotHash: "a".repeat(64), source: { ...snapshot.source },
      applyingSubjectIds: snapshot.details.household!.filter(person => person.requestingSnap).map(person => person.id) } };
}
function headers(extra: Record<string, string> = {}) {
  return { "Content-Type": "application/pdf", "Content-Length": String(paper.length), "X-CaseLink-SNAP-Unsigned-Byte-Length": String(paper.length), "X-CaseLink-SNAP-Prepared-At": savedAt.toISOString(),
    "X-CaseLink-SNAP-Unsigned-SHA256": sha(paper), ...extra };
}
const response = (bytes = Uint8Array.from(paper), extra: Record<string, string> = {}) => new Response(bytes, { headers: headers(extra) });
const load = (value: unknown = input(), signal = new AbortController().signal) => loadSnapSigningCopyFile(value, signal);
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); vi.clearAllMocks(); vi.stubGlobal("fetch", fetcher); fetcher.mockImplementation(async () => response()); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("current unsigned signing-copy browser descriptor", () => {
  it("returns exact caller-owned bytes and the existing completion worker context without granting capture or submission", async () => {
    const value = input(), before = structuredClone(value), result = await load(value);
    expect(result.bytes).toEqual(paper);
    expect(result.trusted).toEqual({ requestId: value.requestId, context: value.context, snapshot: value.snapshot,
      preparedAt: savedAt.toISOString(), unsignedContentSha256: sha(paper) });
    expect(Object.keys(result).sort()).toEqual(["bytes", "trusted"]);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(`/api/parent/requests/${value.requestId}/snap-signing-copy?expectedVersion=${value.requestVersion}&snapshotId=${value.snapshot.id}`,
      expect.objectContaining({ credentials: "same-origin", mode: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
        headers: { Accept: "application/pdf" }, signal: expect.any(AbortSignal) }));
    result.bytes.fill(0); expect(paper.some(byte => byte !== 0)).toBe(true); expect(value).toEqual(before);
  });
  it("verifies the decoded bytes when Next omits transport Content-Length", async () => {
    const reply = response(); reply.headers.delete("Content-Length"); fetcher.mockResolvedValue(reply);
    const result = await load(); expect(result.bytes).toEqual(paper); result.bytes.fill(0);
  });
  it("does not use compressed transport framing as the decoded PDF length", async () => {
    fetcher.mockResolvedValue(response(undefined, { "Content-Encoding": "gzip", "Content-Length": "12" }));
    const result = await load(); expect(result.bytes).toEqual(paper); result.bytes.fill(0);
  });
  it("requires the application byte count even when transport framing is present", async () => {
    const reply = response(); reply.headers.delete("X-CaseLink-SNAP-Unsigned-Byte-Length"); fetcher.mockResolvedValue(reply);
    await expect(load()).rejects.toThrow(SNAP_SIGNING_COPY_FILE_ERROR);
  });
  it("copies all input scope and facts before the first await", async () => {
    const value = input(), expected = structuredClone(value);
    let resolve!: (response: Response) => void; fetcher.mockReturnValue(new Promise<Response>(done => { resolve = done; }));
    const pending = load(value);
    value.context.snapshotHash = "f".repeat(64); value.context.source.templateId = "changed" as typeof value.context.source.templateId;
    value.snapshot.details.screening!.lowCashAndIncome = !value.snapshot.details.screening!.lowCashAndIncome;
    Reflect.set(value.snapshot.source, "templateSha256", "f".repeat(64)); value.mandate.expiresAt = now.toISOString();
    resolve(response()); const result = await pending;
    expect(result.trusted.context).toEqual(expected.context); expect(result.trusted.snapshot).toEqual(expected.snapshot);
  });
  it("accepts a DB-endorsed older snapshot and preparation-only mandate without renewing either", async () => {
    const value = input(); value.requestVersion++; value.context.requestVersion++;
    value.mandate.mode = "prepare_only"; value.mandate.allowedActions = ["research", "prepare"];
    const result = await load(value);
    expect(result.trusted.context.requestVersion).toBe(value.requestVersion);
    expect(result.trusted.snapshot.request_version).toBe(value.requestVersion - 1); expect(result.trusted.preparedAt).toBe(savedAt.toISOString());
  });
  it("normalizes saved offset/microsecond timestamps and uppercase UUIDs, independent of source key order", async () => {
    const value = input(); value.snapshot.created_at = "2026-11-05T16:59:00.123456-05:00";
    value.requestId = value.requestId.toUpperCase(); value.snapshot.request_id = value.snapshot.request_id.toUpperCase(); value.snapshot.id = value.snapshot.id.toUpperCase();
    const person = value.snapshot.details.household![0], id = "abcdefab-abcd-4abc-8abc-abcdefabcdef";
    value.snapshot.details.household![0] = { ...person, id: id.toUpperCase() };
    for (const key of Object.keys(value.snapshot.provenance)) if (key.includes(person.id)) {
      value.snapshot.provenance[key.replace(person.id, id.toUpperCase())] = value.snapshot.provenance[key]; delete value.snapshot.provenance[key];
    }
    value.context.applyingSubjectIds = [id];
    value.snapshot.source = Object.fromEntries(Object.entries(value.snapshot.source).reverse()) as typeof value.snapshot.source;
    fetcher.mockResolvedValue(response(undefined, { "X-CaseLink-SNAP-Prepared-At": "2026-11-05T21:59:00.123Z" }));
    const result = await load(value);
    expect(result.trusted.preparedAt).toBe("2026-11-05T21:59:00.123Z"); expect(result.trusted.requestId).toBe(value.requestId.toLowerCase());
  });

  const invalidInput: [string, (value: SnapSigningCopyFileInput) => void][] = [
    ["malformed request", value => { value.requestId = "PRIVATE-CANARY"; }],
    ["wrong request", value => { value.requestId = value.snapshot.id; }],
    ["paused request", value => { Reflect.set(value, "status", "paused"); }],
    ["closed request", value => { Reflect.set(value, "status", "closed"); }],
    ["cancelled request", value => { Reflect.set(value, "status", "cancelled"); }],
    ["changed version", value => { value.requestVersion++; }],
    ["future snapshot version", value => { value.snapshot.request_version++; }],
    ["wrong snapshot", value => { value.context.snapshotId = value.requestId; }],
    ["missing source", value => { Reflect.deleteProperty(value.context.source, "templateId"); }],
    ["wrong source", value => { Reflect.set(value.snapshot.source, "templateSha256", "f".repeat(64)); }],
    ["wrong applicant", value => { value.context.applyingSubjectIds = [value.snapshot.id]; }],
    ["extra applicant", value => { value.context.applyingSubjectIds.push(value.snapshot.id); }],
    ["missing recipient", value => { value.mandate.recipientIds = ["philly-food"]; }],
    ["missing prepare", value => { value.mandate.allowedActions = ["research"]; }],
    ["missing household permission", value => { value.mandate.allowedData = ["income"]; }],
    ["missing income permission", value => { value.mandate.allowedData = ["household"]; }],
    ["expired mandate", value => { value.mandate.expiresAt = now.toISOString(); }],
    ["unaccepted mandate", value => { Reflect.set(value.mandate, "accepted", false); }],
    ["future preparation", value => { value.snapshot.created_at = new Date(now.getTime() + 1).toISOString(); }],
    ["missing provenance", value => { value.snapshot.provenance = {}; }],
    ["incomplete answers", value => { delete value.snapshot.details.address; for (const key of Object.keys(value.snapshot.provenance)) if (key.startsWith("address.")) delete value.snapshot.provenance[key]; }],
    ["unknown input", value => { Reflect.set(value, "captureAuthorized", true); }],
  ];
  it.each(invalidInput)("rejects %s before any fetch", async (_label, mutate) => {
    const value = input(); mutate(value); await expect(load(value)).rejects.toThrow(SNAP_SIGNING_COPY_FILE_ERROR); expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not use immutable preparation time to revive stale answers", async () => {
    const value = input();
    for (const evidence of Object.values(value.snapshot.provenance)) { evidence.confirmedAt = "2026-09-20T21:00:00Z"; evidence.asOf = "2026-09-20"; }
    await expect(load(value)).rejects.toThrow(SNAP_SIGNING_COPY_FILE_ERROR); expect(fetcher).not.toHaveBeenCalled();
  });
  it("refuses the pinned source at its review expiry even with fresh facts and a later mandate", async () => {
    vi.setSystemTime(new Date(source.verifiedUntil));
    const value = input(); value.snapshot = saved(new Date()); value.context.snapshotId = value.snapshot.id;
    value.mandate.expiresAt = "2027-01-01T00:00:00Z";
    await expect(load(value)).rejects.toThrow(SNAP_SIGNING_COPY_FILE_ERROR); expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong media", { "Content-Type": "text/html" }], ["missing size", { "X-CaseLink-SNAP-Unsigned-Byte-Length": "" }],
    ["zero size", { "X-CaseLink-SNAP-Unsigned-Byte-Length": "0" }], ["noncanonical size", { "X-CaseLink-SNAP-Unsigned-Byte-Length": "01" }],
    ["oversize", { "X-CaseLink-SNAP-Unsigned-Byte-Length": String(MAX_SNAP_PACKET_BYTES + 1) }],
    ["missing digest", { "X-CaseLink-SNAP-Unsigned-SHA256": "" }], ["malformed digest", { "X-CaseLink-SNAP-Unsigned-SHA256": "PRIVATE-CANARY" }],
    ["uppercase digest", { "X-CaseLink-SNAP-Unsigned-SHA256": sha(paper).toUpperCase() }], ["different digest", { "X-CaseLink-SNAP-Unsigned-SHA256": "f".repeat(64) }],
    ["missing preparation time", { "X-CaseLink-SNAP-Prepared-At": "" }], ["different preparation time", { "X-CaseLink-SNAP-Prepared-At": now.toISOString() }],
    ["noncanonical preparation time", { "X-CaseLink-SNAP-Prepared-At": "2026-11-05T16:59:00-05:00" }],
  ] as [string, Record<string, string>][])("rejects %s response metadata", async (_label, extra) => {
    fetcher.mockResolvedValue(response(undefined, extra)); await expect(load()).rejects.toThrow(SNAP_SIGNING_COPY_FILE_ERROR);
  });
  it.each([201, 202, 204, 206, 301, 401, 403, 409, 500])("rejects HTTP %i without exporting any body/error", async status => {
    fetcher.mockResolvedValue(new Response(status === 204 ? null : "PRIVATE-CANARY", { status, headers: headers() }));
    await expect(load()).rejects.toThrow(SNAP_SIGNING_COPY_FILE_ERROR);
  });
  it("rejects a redirected response or missing stream", async () => {
    const redirected = response(); Object.defineProperty(redirected, "redirected", { value: true }); fetcher.mockResolvedValue(redirected);
    await expect(load()).rejects.toThrow(SNAP_SIGNING_COPY_FILE_ERROR);
    fetcher.mockResolvedValue(new Response(null, { headers: headers() })); await expect(load()).rejects.toThrow(SNAP_SIGNING_COPY_FILE_ERROR);
  });
  it.each(["short", "long", "changed"])("rejects %s bytes and clears every delivered chunk", async kind => {
    const chunk = kind === "short" ? paper.slice(0, -1) : kind === "long" ? new Uint8Array(paper.length + 1).fill(1) : Uint8Array.from(paper);
    if (kind === "changed") chunk[8] ^= 1;
    const descriptor = new Headers(headers()); descriptor.delete("Content-Length");
    fetcher.mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(chunk); controller.close(); } }), { headers: descriptor }));
    await expect(load()).rejects.toThrow(SNAP_SIGNING_COPY_FILE_ERROR); expect([...chunk]).toEqual(Array(chunk.length).fill(0));
  });
  it("clears stream chunks after success while returning a separate owned copy", async () => {
    const chunks = [paper.slice(0, 5), paper.slice(5)];
    fetcher.mockResolvedValue(new Response(new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } }), { headers: headers() }));
    const result = await load(); expect(result.bytes).toEqual(paper);
    for (const chunk of chunks) expect([...chunk]).toEqual(Array(chunk.length).fill(0));
  });
  it("contains network/stream/digest failures without logging diagnostics", async () => {
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {}), errors = vi.spyOn(console, "error").mockImplementation(() => {});
    fetcher.mockRejectedValueOnce(new Error("PRIVATE-CANARY")); await expect(load()).rejects.toThrow(SNAP_SIGNING_COPY_FILE_ERROR);
    fetcher.mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { controller.error(new Error("PRIVATE-CANARY")); } }), { headers: headers() }));
    await expect(load()).rejects.toThrow(SNAP_SIGNING_COPY_FILE_ERROR);
    vi.spyOn(crypto.subtle, "digest").mockRejectedValueOnce(new Error("PRIVATE-CANARY")); await expect(load()).rejects.toThrow(SNAP_SIGNING_COPY_FILE_ERROR);
    expect(warnings).not.toHaveBeenCalled(); expect(errors).not.toHaveBeenCalled();
  });
});

describe("signing-copy cancellation and authority deadlines", () => {
  it("stops before fetch if already aborted", async () => {
    const controller = new AbortController(); controller.abort(new Error("PRIVATE-CANARY"));
    await expect(load(input(), controller.signal)).rejects.toThrow(SNAP_SIGNING_COPY_FILE_ERROR); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["caller", "30-second deadline", "mandate deadline"])("bounds a fetch ignoring %s cancellation", async kind => {
    vi.useFakeTimers(); vi.setSystemTime(now); fetcher.mockReturnValue(new Promise(() => {}));
    const value = input(), controller = new AbortController();
    if (kind === "mandate deadline") value.mandate.expiresAt = new Date(now.getTime() + 1000).toISOString();
    const pending = load(value, controller.signal), rejected = expect(pending).rejects.toThrow(SNAP_SIGNING_COPY_FILE_ERROR);
    if (kind === "caller") controller.abort(); else await vi.advanceTimersByTimeAsync(kind === "mandate deadline" ? 1000 : 30_000);
    await rejected; expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it("bounds the source deadline independently of later mandate expiry", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(Date.parse(source.verifiedUntil) - 1000));
    const value = input(); value.snapshot = saved(new Date()); value.mandate.expiresAt = "2027-01-01T00:00:00Z";
    fetcher.mockReturnValue(new Promise(() => {})); const pending = load(value), rejected = expect(pending).rejects.toThrow(SNAP_SIGNING_COPY_FILE_ERROR);
    await vi.advanceTimersByTimeAsync(1000); await rejected;
  });
  it("cancels a late fetch response after the caller has stopped waiting", async () => {
    let resolve!: (response: Response) => void, cancelled = false;
    fetcher.mockReturnValue(new Promise<Response>(done => { resolve = done; }));
    const controller = new AbortController(), pending = load(input(), controller.signal), rejected = expect(pending).rejects.toThrow(SNAP_SIGNING_COPY_FILE_ERROR);
    controller.abort(); await rejected;
    resolve(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: headers() }));
    await vi.waitFor(() => expect(cancelled).toBe(true));
  });
  it("cancels a stalled body and clears chunks already read", async () => {
    const controller = new AbortController(), chunk = paper.slice(0, 5); let reads = 0, cancelled = false;
    fetcher.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({ pull(stream) { if (!reads++) stream.enqueue(chunk); }, cancel() { cancelled = true; } }), { headers: headers() }));
    const pending = load(input(), controller.signal), rejected = expect(pending).rejects.toThrow(SNAP_SIGNING_COPY_FILE_ERROR);
    await vi.waitFor(() => expect(reads).toBeGreaterThan(1)); controller.abort(); await rejected;
    expect(cancelled).toBe(true); expect([...chunk]).toEqual(Array(5).fill(0));
  });
  it("clears late stream chunks even when the reader ignores cancellation", async () => {
    let resolve!: (value: ReadableStreamReadResult<Uint8Array>) => void;
    const chunk = Uint8Array.from(paper), reader = { read: vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>(done => { resolve = done; })), cancel: vi.fn(async () => {}) };
    fetcher.mockResolvedValue({ status: 200, redirected: false, headers: new Headers(headers()), body: { getReader: () => reader } });
    const controller = new AbortController(), pending = load(input(), controller.signal), rejected = expect(pending).rejects.toThrow(SNAP_SIGNING_COPY_FILE_ERROR);
    await vi.waitFor(() => expect(reader.read).toHaveBeenCalled()); controller.abort(); await rejected;
    resolve({ done: false, value: chunk }); await vi.waitFor(() => expect([...chunk]).toEqual(Array(paper.length).fill(0)));
  });
  it("rejects authority expiring while the response arrives, without reading it", async () => {
    const value = input(); fetcher.mockImplementation(async () => { vi.setSystemTime(new Date(value.mandate.expiresAt)); return response(); });
    await expect(load(value)).rejects.toThrow(SNAP_SIGNING_COPY_FILE_ERROR);
  });
  it("bounds a digest ignoring abort and clears its owned input before rejecting", async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    let owned: Uint8Array | undefined;
    vi.spyOn(crypto.subtle, "digest").mockImplementation((_algorithm, bytes) => { owned = bytes as Uint8Array; return new Promise(() => {}); });
    const controller = new AbortController(), pending = load(input(), controller.signal), rejected = expect(pending).rejects.toThrow(SNAP_SIGNING_COPY_FILE_ERROR);
    await vi.advanceTimersByTimeAsync(0); expect(owned?.length).toBe(paper.length);
    controller.abort(); await rejected; expect([...(owned ?? [])]).toEqual(Array(paper.length).fill(0));
  });
  it("rechecks expiry after digest completion", async () => {
    const value = input(), original = crypto.subtle.digest.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "digest").mockImplementation(async (algorithm, bytes) => {
      const digest = await original(algorithm, bytes); vi.setSystemTime(new Date(value.mandate.expiresAt)); return digest;
    });
    await expect(load(value)).rejects.toThrow(SNAP_SIGNING_COPY_FILE_ERROR);
  });
  it("rechecks fact freshness at the current clock after digest completion", async () => {
    vi.setSystemTime(new Date("2026-11-05T23:59:59.000Z"));
    const value = input(); value.mandate.expiresAt = "2026-11-10T00:00:00Z";
    for (const evidence of Object.values(value.snapshot.provenance)) evidence.asOf = "2026-09-22";
    const original = crypto.subtle.digest.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "digest").mockImplementation(async (algorithm, bytes) => {
      const digest = await original(algorithm, bytes); vi.setSystemTime(new Date("2026-11-06T00:00:00.001Z")); return digest;
    });
    await expect(load(value)).rejects.toThrow(SNAP_SIGNING_COPY_FILE_ERROR); expect(fetcher).toHaveBeenCalledOnce();
  });
});
