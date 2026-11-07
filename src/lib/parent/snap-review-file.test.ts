import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureProtectedSnapOperation, fixtureSnapCaptureIntent } from "./test-fixtures";
import { loadSnapReviewFile, loadSnapPacketReviewFile, SNAP_REVIEW_FILE_ERROR } from "./snap-review-file";
const source = new TextEncoder().encode("%PDF- SYNTHETIC_PRIVATE_BROWSER_CANARY"), digest = createHash("sha256").update(source).digest("hex");
const operation = fixtureProtectedSnapOperation();
operation.packet.protectedSnapPacket.contentSha256 = digest; operation.packet.protectedSnapPacket.byteLength = source.byteLength;
const fetcher = vi.fn();
const invalidHeaders: Record<string, string>[] = [{ "Content-Type": "text/html" }, { "Content-Length": "0" }, { "Content-Length": String(source.length + 1) }];
function response(bytes = Uint8Array.from(source), headers: Record<string, string> = {}) {
  return new Response(bytes, { headers: { "Content-Type": "application/pdf", "Content-Length": String(source.length), ...headers } });
}
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", fetcher); fetcher.mockImplementation(() => Promise.resolve(response())); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function authorization() {
  return { intent: { ...fixtureSnapCaptureIntent(), contentSha256: digest, byteLength: source.length },
    authorizationExpiresAt: new Date(Date.now() + 60000).toISOString(), consentedAt: new Date(Date.now() - 1000).toISOString(),
    subjectIds: ["11111111-1111-4111-8111-111111111111"], authorityDeclaration: "parent_declared_household_data_authority", state: "stored" };
}
describe.each(["operation", "stored candidate"])("exact protected browser PDF loading from %s", kind => {
  const load = kind === "operation" ? loadSnapReviewFile : loadSnapPacketReviewFile;
  const input = () => kind === "operation" ? operation : authorization();
  it("reads only the isolated route, checks exact length/hash, and returns caller-owned bytes", async () => {
    const bytes = await load(input(), new AbortController().signal); expect(bytes).toEqual(source);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe(`/protected/snap/requests/${operation.requestId}/packets/${operation.packet.protectedSnapPacket.packetId}?expectedVersion=${operation.requestVersion}`);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: "same-origin", cache: "no-store", redirect: "error", headers: { Accept: "application/pdf" } });
    bytes.fill(0); expect(source.some(value => value !== 0)).toBe(true);
  });
  it.each(invalidHeaders)("rejects another response type or declared file size: %j", async headers => {
    fetcher.mockResolvedValue(response(undefined, headers)); await expect(load(input(), new AbortController().signal)).rejects.toThrow(SNAP_REVIEW_FILE_ERROR);
  });
  it.each(["short", "long", "changed", "denied", "rejected"])("never opens a different or failed file: %s", async kind => {
    const bytes = kind === "short" ? source.slice(0, -1) : kind === "long" ? new Uint8Array(source.length + 1) : Uint8Array.from(source);
    if (kind === "changed") bytes[10] ^= 1;
    if (kind === "rejected") fetcher.mockRejectedValue(new Error("PRIVATE-CANARY"));
    else fetcher.mockResolvedValue(kind === "denied" ? new Response("PRIVATE-CANARY", { status: 403 }) : response(bytes));
    await expect(load(input(), new AbortController().signal)).rejects.toThrow(SNAP_REVIEW_FILE_ERROR);
  });
  it("rejects malformed metadata before making a request", async () => {
    await expect(load({ ...input(), packet: {} }, new AbortController().signal)).rejects.toThrow(SNAP_REVIEW_FILE_ERROR); expect(fetcher).not.toHaveBeenCalled();
  });
  it("stops an uncooperative response stream on cancellation and clears chunks already read", async () => {
    const controller = new AbortController(), chunk = Uint8Array.from(source.slice(0, 5)); let reads = 0, cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ pull(c) { if (!reads++) c.enqueue(chunk); }, cancel() { cancelled = true; } });
    fetcher.mockResolvedValue(new Response(stream, { headers: { "Content-Type": "application/pdf", "Content-Length": String(source.length) } }));
    const loaded = load(input(), controller.signal); await vi.waitFor(() => expect(reads).toBeGreaterThan(1)); controller.abort();
    await expect(loaded).rejects.toThrow(SNAP_REVIEW_FILE_ERROR); expect(cancelled).toBe(true); expect([...chunk]).toEqual(Array(5).fill(0));
  });
  it("bounds a fetch that ignores cancellation without waiting indefinitely", async () => {
    vi.useFakeTimers(); fetcher.mockReturnValue(new Promise(() => {}));
    const controller = new AbortController(), loaded = load(input(), controller.signal);
    const rejected = expect(loaded).rejects.toThrow(SNAP_REVIEW_FILE_ERROR); controller.abort(); await rejected;
  });
  it("cancels a late fetch body after the caller already stopped waiting", async () => {
    let resolve!: (response: Response) => void, cancelled = false;
    fetcher.mockReturnValue(new Promise<Response>(done => { resolve = done; }));
    const controller = new AbortController(), loaded = load(input(), controller.signal);
    const rejected = expect(loaded).rejects.toThrow(SNAP_REVIEW_FILE_ERROR); controller.abort(); await rejected;
    resolve(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
    await vi.waitFor(() => expect(cancelled).toBe(true));
  });
});

describe("stored candidate review permission metadata", () => {
  it.each(["authorized", "expired", "future", "unknown"])("rejects %s metadata before fetching private bytes", async kind => {
    const value = authorization();
    if (kind === "authorized") value.state = "authorized";
    if (kind === "expired") { value.consentedAt = new Date(Date.now() - 2000).toISOString(); value.authorizationExpiresAt = new Date(Date.now() - 1000).toISOString(); }
    if (kind === "future") value.consentedAt = new Date(Date.now() + 1000).toISOString();
    if (kind === "unknown") Reflect.set(value, "submissionReady", true);
    await expect(loadSnapPacketReviewFile(value, new AbortController().signal)).rejects.toThrow(SNAP_REVIEW_FILE_ERROR);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("loads genuine stored metadata without manufacturing a Submit operation", async () => {
    const value = authorization();
    expect(value).not.toHaveProperty("operationId"); expect(value).not.toHaveProperty("protectedParentSubmitReady");
    expect(await loadSnapPacketReviewFile(value, new AbortController().signal)).toEqual(source);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^\/protected\/snap\//), expect.objectContaining({ credentials: "same-origin", cache: "no-store" }));
  });
  it("rejects permission expiring during the download", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const value = authorization();
    fetcher.mockImplementation(async () => { vi.setSystemTime(new Date(value.authorizationExpiresAt)); return response(); });
    await expect(loadSnapPacketReviewFile(value, new AbortController().signal)).rejects.toThrow(SNAP_REVIEW_FILE_ERROR);
  });
});
