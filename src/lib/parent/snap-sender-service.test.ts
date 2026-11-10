import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as packetCrypto from "./snap-final-packet";
import * as pdfInspection from "./snap-final-pdf";
import { SNAP_DRAFT_CONTRACT } from "./snap-draft";
import { createSnapProtectedDelivery, createSnapProtectedSenderHandler } from "./snap-sender-service";
import { snapSenderAttemptSchema, type SnapSenderIntent } from "./snap-sender-contract";
import type { SnapSenderStore, SnapSenderEnvelope } from "./snap-sender-store";
import type { SnapSenderCarrier } from "./snap-sender-carrier";

const now = "2026-11-07T18:20:00.000Z", future = "2026-11-07T18:25:00.000Z";
const id = "11111111-1111-4111-8111-111111111111", packetId = "22222222-2222-4222-8222-222222222222";
const original = readFileSync("data/verified-forms/snap-pa600fs-2019.pdf"), hash = createHash("sha256").update(original).digest("hex");
const key = Buffer.alloc(32, 0xab), controller = () => new AbortController();
const intent = (): SnapSenderIntent => ({ jobId: id, leaseToken: id, operationId: id, requestId: id, requestVersion: 2,
  idempotencyKey: `snap-final:${packetId}`, packetHash: "a".repeat(64), protectedPacket: { packetId, authorizationId: id, snapshotId: id,
    snapshotHash: "b".repeat(64), contentSha256: hash, byteLength: original.length, verificationId: id } });
function setup() {
  const binding: packetCrypto.SnapFinalPacketBinding = { format: "caselink-snap-final-packet-v1", packetId, ownerId: id, requestId: id, requestVersion: 2,
    recipient: "snap-pa", need: "snap_new", purpose: "snap_final_application_packet", authorizationId: id, policyVersion: "fixture-policy", retentionPolicyVersion: "fixture-retention",
    templateId: SNAP_DRAFT_CONTRACT.id, templateVersion: SNAP_DRAFT_CONTRACT.version, templateSha256: SNAP_DRAFT_CONTRACT.sha256,
    snapshotId: id, snapshotHash: "b".repeat(64), contentSha256: hash, byteLength: original.length, expiresAt: future };
  const sealed = packetCrypto.sealSnapFinalPacket(original, key, binding, new Date(now));
  const envelope: SnapSenderEnvelope = { binding, keyBase64: key.toString("base64"), aad: Buffer.from(packetCrypto.snapFinalPacketAad(binding)).toString("base64"),
    iv: Buffer.from(sealed.iv).toString("base64"), tag: Buffer.from(sealed.tag).toString("base64"), ciphertext: Buffer.from(sealed.ciphertext).toString("base64") };
  const attempt = { operationId: id, packetId, contentSha256: hash, operationRef: createHash("sha256").update(intent().idempotencyKey).digest("hex"),
    attemptedAt: now, dispatchAuthorizedAt: null as string | null, expiresAt: future, projectId: "project", serviceId: "service", from: "+12155550101", to: "+12155550102", destinationId: "office", destinationVersion: "v1",
    pageCount: 12 as const, providerId: null as string | null, providerStatus: "UNKNOWN" as "UNKNOWN" | "QUEUED" | "COMPLETED" | "FAILURE" };
  const order: string[] = [];
  const store = {
    reserve: vi.fn<SnapSenderStore["reserve"]>(async () => { order.push("committed-reservation"); return { state: "dispatch_allowed", attempt: { ...attempt }, envelope }; }),
    resume: vi.fn<SnapSenderStore["resume"]>(async () => {
      if (attempt.dispatchAuthorizedAt !== null) throw new Error("Already authorized");
      order.push("resumed-commit"); return { state: "dispatch_allowed", attempt: { ...attempt }, envelope };
    }),
    recheck: vi.fn<SnapSenderStore["recheck"]>(async () => {
      if (attempt.dispatchAuthorizedAt !== null) throw new Error("Already authorized");
      order.push("recheck"); attempt.dispatchAuthorizedAt = now; return { ...attempt };
    }),
    read: vi.fn<SnapSenderStore["read"]>(async () => { order.push("read-metadata"); return { ...attempt }; }),
    record: vi.fn<SnapSenderStore["record"]>(async (_, providerId, providerStatus) => {
      order.push(`record-${providerStatus}`); Object.assign(attempt, { providerId, providerStatus }); return { ...attempt };
    }),
  };
  let uploaded: Uint8Array | undefined;
  const carrier = {
    checkConfiguration: vi.fn<SnapSenderCarrier["checkConfiguration"]>(async () => { order.push("configuration"); }),
    validateAttempt: vi.fn<SnapSenderCarrier["validateAttempt"]>(input => snapSenderAttemptSchema.parse(input)),
    send: vi.fn<SnapSenderCarrier["send"]>(async (_, bytes, beforeSend, signal) => {
      await beforeSend(); signal.throwIfAborted(); uploaded = Uint8Array.from(bytes); order.push("POST"); return { providerId: "fax-id", providerStatus: "QUEUED" };
    }),
    reconcile: vi.fn<SnapSenderCarrier["reconcile"]>(async () => { order.push("GET"); return { providerId: "fax-id", providerStatus: "COMPLETED", completedAt: now }; }),
  };
  return { binding, envelope, attempt, store, carrier, order, uploaded: () => uploaded, delivery: createSnapProtectedDelivery({ store, carrier }) };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  vi.spyOn(pdfInspection, "inspectSnapFinalPdf").mockImplementation(async () => ({ ok: true, scope: "structure_only", contentSha256: hash, byteLength: original.length,
    source: { templateId: SNAP_DRAFT_CONTRACT.id, templateVersion: SNAP_DRAFT_CONTRACT.version, templateSha256: SNAP_DRAFT_CONTRACT.sha256 },
    pageCount: 12, pageWidth: 612, pageHeight: 792, rotation: 0, userUnit: 1, staticContentChecked: true }));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("isolated exact-PDF SNAP delivery", () => {
  it("attributes a completed controlled transmission to the emulator instead of a real fax", async () => {
    const f = setup();
    Object.assign(f.attempt, { kind: "sinch_emulation", requestId: id, snapshotHash: intent().protectedPacket.snapshotHash, to: "+19898989898",
      destinationId: "sinch-free-emulator", destinationVersion: "controlled-test-v1" });
    const result = await f.delivery.execute(intent(), controller().signal);
    expect(result).toMatchObject({ receipt: { state: "sent", source: "provider_api", reference: "sinch-emulation:fax-id" } });
  });
  it("returns a persisted terminal carrier failure without claiming agency rejection or polling it again", async () => {
    const f = setup();
    f.carrier.reconcile.mockResolvedValue({ providerId: "fax-id", providerStatus: "FAILURE" });
    const failed = { operationId: id, packetId, contentSha256: hash, state: "delivery_unknown", transportStatus: "FAILURE" };
    expect(await f.delivery.execute(intent(), controller().signal)).toEqual(failed);
    expect(f.attempt.providerStatus).toBe("FAILURE");
    expect(await f.delivery.reconcile(intent(), controller().signal)).toEqual(failed);
    expect(f.carrier.reconcile).toHaveBeenCalledOnce(); expect(f.carrier.send).toHaveBeenCalledOnce();
    expect(f.store.resume).not.toHaveBeenCalled();
  });
  it("does not report a terminal carrier failure when its evidence could not be saved", async () => {
    const f = setup(); f.carrier.reconcile.mockResolvedValue({ providerId: "fax-id", providerStatus: "FAILURE" });
    const record = f.store.record.getMockImplementation()!;
    f.store.record.mockImplementation(async (...args) => { if (args[2] === "FAILURE") throw new Error("PRIVATE_STORAGE_ERROR"); return record(...args); });
    expect(await f.delivery.execute(intent(), controller().signal)).toEqual({ operationId: id, packetId, contentSha256: hash, state: "delivery_unknown" });
  });
  it("stops immediately when the carrier POST reports a persisted failure", async () => {
    const f = setup();
    f.carrier.send.mockImplementation(async (_, __, beforeSend) => { await beforeSend(); return { providerId: "fax-id", providerStatus: "FAILURE" }; });
    expect(await f.delivery.execute(intent(), controller().signal)).toMatchObject({ state: "delivery_unknown", transportStatus: "FAILURE" });
    expect(f.carrier.reconcile).not.toHaveBeenCalled(); expect(f.attempt.providerStatus).toBe("FAILURE");
  });
  it("decrypts only a committed exact packet, rechecks before POST, persists ID and GET completion before sent", async () => {
    const f = setup(), opened = vi.spyOn(packetCrypto, "openSnapFinalPacket");
    const result = await f.delivery.execute(intent(), controller().signal);
    expect(result).toMatchObject({ operationId: id, packetId, contentSha256: hash, receipt: { state: "sent", source: "provider_api", reference: "sinch-fax:fax-id", recordedAt: now } });
    expect(f.order).toEqual(["configuration", "committed-reservation", "recheck", "POST", "record-QUEUED", "GET", "record-COMPLETED"]);
    expect(Buffer.from(f.uploaded()!).equals(original)).toBe(true);
    expect((f.carrier.send.mock.calls[0][1]).every(value => value === 0)).toBe(true);
    expect(opened.mock.calls[0][1].every(value => value === 0)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/keyBase64|ciphertext|ownerId|Pennsylvania Application/);
  });
  it("waits for a known reservation commit before decrypting or sending", async () => {
    const f = setup(), open = vi.spyOn(packetCrypto, "openSnapFinalPacket");
    let finish!: () => void;
    f.store.reserve.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ state: "dispatch_allowed", attempt: f.attempt, envelope: f.envelope }); }));
    const pending = f.delivery.execute(intent(), controller().signal);
    await vi.waitFor(() => expect(f.store.reserve).toHaveBeenCalled()); expect(open).not.toHaveBeenCalled(); expect(f.carrier.send).not.toHaveBeenCalled();
    finish(); expect(await pending).toHaveProperty("receipt.state", "sent");
  });
  it("passes the actual isolated PDF structural inspector before a mocked carrier sees public fixture bytes", async () => {
    vi.mocked(pdfInspection.inspectSnapFinalPdf).mockRestore();
    const f = setup();
    expect(await f.delivery.execute(intent(), controller().signal)).toHaveProperty("receipt.state", "sent");
    expect(Buffer.from(f.uploaded()!).equals(original)).toBe(true);
  });
  it("does not dispatch or decrypt after an uncertain reservation commit", async () => {
    const f = setup(), open = vi.spyOn(packetCrypto, "openSnapFinalPacket"); f.store.reserve.mockResolvedValue({ state: "reservation_unknown" });
    expect(await f.delivery.execute(intent(), controller().signal)).toHaveProperty("state", "delivery_unknown");
    expect(open).not.toHaveBeenCalled(); expect(f.carrier.send).not.toHaveBeenCalled(); expect(f.store.read).not.toHaveBeenCalled();
  });
  it("reconciles a replay instead of uploading or asking for personal entries again", async () => {
    const f = setup(); f.attempt.dispatchAuthorizedAt = now; f.store.reserve.mockResolvedValue({ state: "reconcile_only", attempt: f.attempt });
    expect(await f.delivery.execute(intent(), controller().signal)).toHaveProperty("receipt.state", "sent");
    expect(f.carrier.send).not.toHaveBeenCalled(); expect(pdfInspection.inspectSnapFinalPdf).not.toHaveBeenCalled(); expect(f.store.read).toHaveBeenCalledTimes(1);
  });
  it.each(["owner_scope", "version", "snapshot", "content", "aad", "key", "ciphertext", "expired", "structure"])("closes a damaged %s packet without provider upload", async kind => {
    const f = setup();
    if (kind === "owner_scope") f.envelope.binding.requestId = packetId;
    if (kind === "version") f.envelope.binding.requestVersion = 3;
    if (kind === "snapshot") f.envelope.binding.snapshotHash = "c".repeat(64);
    if (kind === "content") f.envelope.binding.contentSha256 = "c".repeat(64);
    if (kind === "aad") f.envelope.aad = Buffer.from("PRIVATE_AAD_CANARY").toString("base64");
    if (kind === "key") f.envelope.keyBase64 = Buffer.alloc(32).toString("base64");
    if (kind === "ciphertext") f.envelope.ciphertext = Buffer.alloc(original.length).toString("base64");
    if (kind === "expired") f.envelope.binding.expiresAt = now;
    if (kind === "structure") vi.mocked(pdfInspection.inspectSnapFinalPdf).mockResolvedValue({ ok: false, reason: "unsupported_content" });
    expect(await f.delivery.execute(intent(), controller().signal)).toHaveProperty("state", "delivery_unknown");
    expect(f.carrier.send).not.toHaveBeenCalled(); expect(f.store.recheck).not.toHaveBeenCalled();
  });
  it("stops cancelled/withdrawn work at the final authority check", async () => {
    const f = setup(); f.store.recheck.mockRejectedValue(new Error("PRIVATE_WITHDRAWAL_CANARY"));
    expect(await f.delivery.execute(intent(), controller().signal)).toHaveProperty("state", "delivery_unknown");
    expect(f.order).not.toContain("POST"); expect(f.carrier.reconcile).not.toHaveBeenCalled();
    expect(f.carrier.send.mock.calls[0][1].every(value => value === 0)).toBe(true);
  });
  it("checks provider privacy configuration before reserving or opening any packet", async () => {
    const f = setup(); f.carrier.checkConfiguration.mockRejectedValue(new Error("PRIVATE_CARRIER_SETTINGS"));
    expect(await f.delivery.execute(intent(), controller().signal)).toHaveProperty("state", "delivery_unknown");
    expect(f.store.reserve).not.toHaveBeenCalled(); expect(f.carrier.send).not.toHaveBeenCalled();
  });
  it("never presents a POST acknowledgement or an unpersisted GET as a receipt", async () => {
    const f = setup(); f.carrier.reconcile.mockResolvedValue({ providerId: "fax-id", providerStatus: "IN_PROGRESS" });
    expect(await f.delivery.execute(intent(), controller().signal)).toHaveProperty("state", "delivery_unknown");
    const other = setup(); other.store.record.mockRejectedValue(new Error("PRIVATE_PERSISTENCE_FAILURE"));
    expect(await other.delivery.execute(intent(), controller().signal)).toHaveProperty("state", "delivery_unknown");
    expect(other.carrier.reconcile).not.toHaveBeenCalled();
  });
  it("recovers a lost POST response with metadata GETs and no second POST", async () => {
    const f = setup(); f.carrier.send.mockImplementationOnce(async (_, __, beforeSend) => { await beforeSend(); f.order.push("POST"); return { providerId: null, providerStatus: "UNKNOWN" }; });
    expect(await f.delivery.execute(intent(), controller().signal)).toHaveProperty("state", "delivery_unknown");
    expect(await createSnapProtectedDelivery({ store: f.store, carrier: f.carrier }).reconcile(intent(), controller().signal)).toHaveProperty("receipt.state", "sent");
    expect(f.carrier.send).toHaveBeenCalledTimes(1); expect(f.store.reserve).toHaveBeenCalledTimes(1); expect(f.store.recheck).toHaveBeenCalledTimes(1);
  });
  it("can reconcile after raw-packet expiry/deletion without decrypting, inspecting or obtaining new signatures", async () => {
    const f = setup(); f.envelope.binding.expiresAt = "2026-11-06T18:20:00.000Z"; f.envelope.ciphertext = "";
    f.attempt.attemptedAt = f.attempt.dispatchAuthorizedAt = "2026-11-06T18:20:00.000Z";
    expect(await f.delivery.reconcile(intent(), controller().signal)).toHaveProperty("receipt.state", "sent");
    expect(f.store.reserve).not.toHaveBeenCalled(); expect(f.store.resume).not.toHaveBeenCalled(); expect(f.store.recheck).not.toHaveBeenCalled(); expect(pdfInspection.inspectSnapFinalPdf).not.toHaveBeenCalled(); expect(f.carrier.send).not.toHaveBeenCalled();
  });
  it("resumes the same current Submit after a lost reservation acknowledgement proved to precede dispatch", async () => {
    const f = setup(), open = vi.spyOn(packetCrypto, "openSnapFinalPacket");
    f.store.reserve.mockResolvedValueOnce({ state: "reservation_unknown" });
    expect(await f.delivery.execute(intent(), controller().signal)).toHaveProperty("state", "delivery_unknown");
    expect(open).not.toHaveBeenCalled();
    const nextLease = { ...intent(), leaseToken: packetId };
    expect(await createSnapProtectedDelivery({ store: f.store, carrier: f.carrier }).reconcile(nextLease, controller().signal)).toHaveProperty("receipt.state", "sent");
    expect(f.store.resume).toHaveBeenCalledExactlyOnceWith(nextLease, expect.any(AbortSignal));
    expect(f.store.reserve).toHaveBeenCalledTimes(1); expect(f.store.recheck).toHaveBeenCalledTimes(1); expect(open).toHaveBeenCalledTimes(1);
    expect(f.order).toEqual(["configuration", "read-metadata", "configuration", "resumed-commit", "recheck", "POST", "record-QUEUED", "GET", "record-COMPLETED"]);
    expect(f.carrier.send.mock.calls[0][0]).toMatchObject({ operationId: id, packetId, dispatchAuthorizedAt: null });
  });
  it("waits for a known resume commit and safely recovers another lost commit acknowledgement", async () => {
    const f = setup(), open = vi.spyOn(packetCrypto, "openSnapFinalPacket");
    f.store.resume.mockResolvedValueOnce({ state: "reservation_unknown" });
    expect(await f.delivery.reconcile(intent(), controller().signal)).toHaveProperty("state", "delivery_unknown");
    expect(open).not.toHaveBeenCalled(); expect(f.carrier.send).not.toHaveBeenCalled();
    expect(await f.delivery.reconcile(intent(), controller().signal)).toHaveProperty("receipt.state", "sent");
    expect(f.store.resume).toHaveBeenCalledTimes(2); expect(f.store.recheck).toHaveBeenCalledTimes(1); expect(f.order.filter(value => value === "POST")).toHaveLength(1);
  });
  it("allows only one POST when resumed callers race for the same atomic dispatch gate", async () => {
    const f = setup();
    let waiting = 0, release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    f.store.resume.mockImplementation(async () => {
      const reserved = { state: "dispatch_allowed" as const, attempt: { ...f.attempt }, envelope: f.envelope };
      if (++waiting === 2) release(); await ready; return reserved;
    });
    const results = await Promise.all([f.delivery.reconcile(intent(), controller().signal), f.delivery.reconcile(intent(), controller().signal)]);
    expect(results.some(value => "receipt" in value && value.receipt.state === "sent")).toBe(true);
    expect(f.order.filter(value => value === "POST")).toHaveLength(1); expect(f.store.reserve).not.toHaveBeenCalled();
    expect(f.attempt.operationRef).toBe(createHash("sha256").update(intent().idempotencyKey).digest("hex"));
  });
  it.each(["revoked", "changed_packet", "changed_route", "expired", "configuration"])("closes %s pre-dispatch recovery without posting", async kind => {
    const f = setup(), open = vi.spyOn(packetCrypto, "openSnapFinalPacket");
    if (kind === "revoked" || kind === "changed_packet") f.store.resume.mockRejectedValue(new Error("PRIVATE_CURRENT_SUBMIT_DENIED"));
    if (kind === "changed_route") f.store.resume.mockResolvedValue({ state: "dispatch_allowed", attempt: { ...f.attempt, destinationVersion: "changed" }, envelope: f.envelope });
    if (kind === "expired") f.attempt.expiresAt = now;
    if (kind === "configuration") f.carrier.checkConfiguration.mockRejectedValue(new Error("PRIVATE_SETTINGS"));
    expect(await f.delivery.reconcile(intent(), controller().signal)).toHaveProperty("state", "delivery_unknown");
    expect(open).not.toHaveBeenCalled(); expect(f.order).not.toContain("POST"); expect(f.store.recheck).not.toHaveBeenCalled();
  });
  it("never resumes or opens a packet after dispatch authorization even without a provider ID", async () => {
    const f = setup(), open = vi.spyOn(packetCrypto, "openSnapFinalPacket"); f.attempt.dispatchAuthorizedAt = now;
    f.carrier.reconcile.mockResolvedValue({ providerId: null, providerStatus: "UNKNOWN" });
    expect(await f.delivery.reconcile(intent(), controller().signal)).toHaveProperty("state", "delivery_unknown");
    expect(f.order).toEqual(["read-metadata", "record-UNKNOWN"]);
    expect(f.carrier.reconcile).toHaveBeenCalledTimes(1); expect(f.store.resume).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled(); expect(f.carrier.send).not.toHaveBeenCalled();
  });
  it("keeps a lost dispatch-gate acknowledgement GET-only instead of authorizing another POST", async () => {
    const f = setup();
    f.store.recheck.mockImplementationOnce(async () => { f.attempt.dispatchAuthorizedAt = now; throw new Error("PRIVATE_LOST_ACK"); });
    expect(await f.delivery.execute(intent(), controller().signal)).toHaveProperty("state", "delivery_unknown");
    expect(f.order).not.toContain("POST");
    f.carrier.reconcile.mockResolvedValue({ providerId: null, providerStatus: "UNKNOWN" });
    expect(await f.delivery.reconcile(intent(), controller().signal)).toHaveProperty("state", "delivery_unknown");
    expect(f.store.resume).not.toHaveBeenCalled(); expect(f.store.recheck).toHaveBeenCalledTimes(1); expect(f.carrier.send).toHaveBeenCalledTimes(1);
    expect(f.order).not.toContain("POST"); expect(f.carrier.reconcile).toHaveBeenCalledTimes(1);
  });
  it("does not query the carrier when current follow-up authority is denied", async () => {
    const f = setup(); f.store.read.mockRejectedValue(new Error("PRIVATE_REVOKED"));
    expect(await f.delivery.reconcile(intent(), controller().signal)).toHaveProperty("state", "delivery_unknown");
    expect(f.carrier.reconcile).not.toHaveBeenCalled(); expect(f.store.record).not.toHaveBeenCalled();
  });
});

describe("private metadata-only sender handler", () => {
  const origin = "http://127.0.0.1:3340", secret = "sender-fixture-secret-".repeat(3);
  function request(path = "/snap/execute", overrides: Record<string, string> = {}, value: unknown = intent()) {
    const body = JSON.stringify(value);
    return new Request(origin + path, { method: "POST", headers: { Host: "127.0.0.1:3340", Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)), ...overrides }, body });
  }
  it("returns only the bound safe result and routes reconciliation separately", async () => {
    const f = setup(), handler = createSnapProtectedSenderHandler({ origin, secret, delivery: f.delivery });
    expect((await handler(request())).status).toBe(200);
    const response = await handler(request("/snap/reconcile")), text = await response.text();
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(text).not.toMatch(/keyBase64|ciphertext|PRIVATE|authorizationId|leaseToken/);
    expect(f.carrier.send).toHaveBeenCalledTimes(1);
  });
  it.each(["secret", "origin", "cookie", "host", "encoding", "size", "extra_private", "query", "path"])("closes unsafe %s without touching the store or carrier", async kind => {
    const f = setup(), handler = createSnapProtectedSenderHandler({ origin, secret, delivery: f.delivery });
    const headers: Record<string, string> = {};
    if (kind === "secret") headers.Authorization = "Bearer PRIVATE_CANARY";
    if (kind === "origin") headers.Origin = origin;
    if (kind === "cookie") headers.Cookie = "PRIVATE_SESSION_CANARY";
    if (kind === "host") headers.Host = "outside.invalid";
    if (kind === "encoding") headers["Content-Encoding"] = "gzip";
    if (kind === "size") headers["Content-Length"] = "9999";
    const value = kind === "extra_private" ? { ...intent(), rawSsn: "PRIVATE_IDENTIFIER_CANARY" } : intent();
    const response = await handler(request(kind === "query" ? "/snap/execute?other=1" : kind === "path" ? "/other" : "/snap/execute", headers, value));
    expect([400, 401]).toContain(response.status); expect(await response.text()).not.toContain("PRIVATE");
    expect(f.store.reserve).not.toHaveBeenCalled(); expect(f.carrier.checkConfiguration).not.toHaveBeenCalled();
  });
  it("refuses a forged agency confirmation or private result body", async () => {
    const delivery = { execute: vi.fn(), reconcile: vi.fn() };
    delivery.execute.mockResolvedValue({ operationId: id, packetId, contentSha256: hash, receipt: { state: "agency_submitted", source: "agency_receipt", reference: "NOT_PROVEN", recordedAt: now } });
    const handler = createSnapProtectedSenderHandler({ origin, secret, delivery });
    expect((await handler(request())).status).toBe(503);
    delivery.execute.mockResolvedValue({ operationId: id, packetId, contentSha256: hash, state: "delivery_unknown", keyBase64: "PRIVATE_KEY_CANARY" });
    expect(await (await handler(request())).text()).not.toContain("PRIVATE");
  });
});
