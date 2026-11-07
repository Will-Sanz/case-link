import { afterEach, describe, expect, it, vi } from "vitest";
import { createSnapProtectedSubmissionClient } from "./snap-sender-worker-client";
import { SNAP_SENDER_ERROR } from "./snap-sender-contract";

const id = "11111111-1111-4111-8111-111111111111", packet = "22222222-2222-4222-8222-222222222222";
const origin = "http://127.0.0.1:3340", secret = "sender-test-secret-".repeat(3);
const intent = () => ({ jobId: id, leaseToken: id, operationId: id, requestId: id, requestVersion: 2,
  idempotencyKey: `snap-final:${packet}`, packetHash: "a".repeat(64), protectedPacket: { packetId: packet, authorizationId: id,
    snapshotId: id, snapshotHash: "b".repeat(64), contentSha256: "c".repeat(64), byteLength: 1000, verificationId: id }, signal: new AbortController().signal });
const result = () => ({ operationId: id, packetId: packet, contentSha256: "c".repeat(64), receipt: {
  state: "sent", source: "provider_api", reference: "sinch-fax:test-carrier", recordedAt: "2026-11-07T17:00:00.000Z" } });
const reply = (value: unknown, status = 200) => Response.json({ result: value }, { status });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("metadata-only protected SNAP sender client", () => {
  it("preserves terminal transport failure with exact binding while keeping agency delivery unknown", async () => {
    const failed = { operationId: id, packetId: packet, contentSha256: "c".repeat(64), state: "delivery_unknown", transportStatus: "FAILURE" };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(failed, 202));
    const port = createSnapProtectedSubmissionClient({ origin, secret, fetcher });
    expect(await port.execute(intent())).toEqual(failed);
    fetcher.mockResolvedValue(reply({ ...failed, packetId: id }, 202));
    expect(await port.reconcile(intent())).toBeNull();
  });
  it("sends only the exact eight-field intent and verifies the bound result", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(result()));
    const port = createSnapProtectedSubmissionClient({ origin, secret, fetcher });
    expect(await port.execute(intent())).toEqual(result());
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe(`${origin}/snap/execute`);
    expect(options).toMatchObject({ method: "POST", redirect: "error", cache: "no-store", headers: { Authorization: `Bearer ${secret}` } });
    const { signal: _, ...expected } = intent(); void _;
    expect(JSON.parse(options!.body as string)).toEqual(expected);
    expect(Object.keys(JSON.parse(options!.body as string))).toHaveLength(8);
  });
  it("preserves an unknown send and performs one separate reconciliation request", async () => {
    const unknown = { operationId: id, packetId: packet, contentSha256: "c".repeat(64), state: "delivery_unknown" };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply(unknown, 202)).mockResolvedValueOnce(reply(result()));
    const port = createSnapProtectedSubmissionClient({ origin, secret, fetcher });
    expect(await port.execute(intent())).toEqual(unknown);
    expect(await port.reconcile(intent())).toEqual(result());
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([`${origin}/snap/execute`, `${origin}/snap/reconcile`]);
  });
  it.each(["pdf", "identity", "bad_key", "bad_scope"])("rejects %s before a network request", async kind => {
    const input = intent();
    if (kind === "pdf") Object.assign(input, { bytes: new Uint8Array([1, 2]) });
    if (kind === "identity") Object.assign(input, { ssn: "PRIVATE_CANARY" });
    if (kind === "bad_key") input.idempotencyKey = "other";
    if (kind === "bad_scope") input.protectedPacket.packetId = id;
    const fetcher = vi.fn<typeof fetch>();
    await expect(createSnapProtectedSubmissionClient({ origin, secret, fetcher }).execute(input)).rejects.toThrow(SNAP_SENDER_ERROR);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["operation", "packet", "hash", "private", "status", "redirect", "oversized"])("never accepts a malformed %s reply or leaks its details", async kind => {
    const value = result();
    if (kind === "operation") value.operationId = packet;
    if (kind === "packet") value.packetId = id;
    if (kind === "hash") value.contentSha256 = "d".repeat(64);
    if (kind === "private") Object.assign(value, { plaintext: "PRIVATE_RESPONSE_CANARY" });
    let response = reply(value, kind === "status" ? 202 : 200);
    if (kind === "redirect") Object.defineProperty(response, "redirected", { value: true });
    if (kind === "oversized") response = new Response("PRIVATE_CANARY".repeat(500), { headers: { "Content-Type": "application/json" } });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
    const port = createSnapProtectedSubmissionClient({ origin, secret, fetcher });
    await expect(port.execute(intent())).rejects.toThrow(SNAP_SENDER_ERROR);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not retry a lost acknowledgement and leaves reconciliation unresolved", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("PRIVATE_PROVIDER_RESPONSE"));
    const port = createSnapProtectedSubmissionClient({ origin, secret, fetcher });
    await expect(port.execute(intent())).rejects.toThrow(SNAP_SENDER_ERROR);
    expect(await port.reconcile(intent())).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("stops a cancelled request before dispatch", async () => {
    const input = intent(), stop = new AbortController(); stop.abort(); input.signal = stop.signal;
    const fetcher = vi.fn<typeof fetch>();
    await expect(createSnapProtectedSubmissionClient({ origin, secret, fetcher }).execute(input)).rejects.toThrow(SNAP_SENDER_ERROR);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("bounds a stalled response body and cancels its reader", async () => {
    const deadline = new AbortController(), timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    const cancelled = vi.fn();
    const response = new Response(new ReadableStream({ pull() { return new Promise(() => {}); }, cancel: cancelled }), { headers: { "Content-Type": "application/json" } });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
    const pending = createSnapProtectedSubmissionClient({ origin, secret, fetcher }).execute(intent());
    const checked = expect(pending).rejects.toThrow(SNAP_SENDER_ERROR);
    await new Promise(resolve => setTimeout(resolve, 0)); deadline.abort(); await checked;
    expect(timeout).toHaveBeenCalledWith(55_000);
    expect(cancelled).toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["https://private.example/path", "http://private.example", "https://user:secret@private.example", "https://private.example/"])("rejects unsafe origin %s", value => {
    expect(() => createSnapProtectedSubmissionClient({ origin: value, secret })).toThrow(SNAP_SENDER_ERROR);
  });
});
