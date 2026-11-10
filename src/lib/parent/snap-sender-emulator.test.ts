import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSinchSnapFaxEmulatorCarrier } from "./snap-sender-emulator";
import { createSinchSnapFaxCarrier } from "./snap-sender-carrier";
import type { SnapSenderAttempt } from "./snap-sender-contract";

const now = "2026-11-10T14:00:00.000Z", id = "11111111-1111-4111-8111-111111111111";
const bytes = new Uint8Array(readFileSync("data/verified-forms/snap-pa600fs-2019.pdf"));
const hash = createHash("sha256").update(bytes).digest("hex");
const operationRef = createHash("sha256").update(`snap-final:${id}`).digest("hex");
const config = { requestId: id, snapshotHash: "a".repeat(64), projectId: "test-project", serviceId: "test-service",
  fromNumber: "+12155550101", accessKey: "test-key", secretKey: "TEST_KEY_CANARY" };
const signal = () => new AbortController().signal;
function attempt(dispatched = false): SnapSenderAttempt {
  return { kind: "sinch_emulation", requestId: id, snapshotHash: config.snapshotHash, operationId: id, packetId: id,
    contentSha256: hash, operationRef, attemptedAt: now, dispatchAuthorizedAt: dispatched ? now : null,
    projectId: config.projectId, serviceId: config.serviceId, from: config.fromNumber, to: "+19898989898",
    destinationId: "sinch-free-emulator", destinationVersion: "controlled-test-v1", expiresAt: "2026-11-10T14:05:00.000Z",
    pageCount: 12, providerId: null, providerStatus: "UNKNOWN" };
}
const fax = (completed = false) => ({ id: "test-fax", projectId: config.projectId, serviceId: config.serviceId,
  from: config.fromNumber, to: "+19898989898", direction: "OUTBOUND", status: completed ? "COMPLETED" : "QUEUED", createTime: now,
  maxRetries: 0, labels: { operationRef, sourceSha256: hash, pageCount: "12" },
  ...(completed ? { completedTime: now, numberOfPages: 12, pagesSentSuccessfully: 12 } : {}) });

describe("explicit free fax emulator for one approved fictional snapshot", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  it("sends the checked PDF only to the free emulator after the durable dispatch gate", async () => {
    const gate = vi.fn(async () => attempt(true));
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, input) => {
      expect(gate).toHaveBeenCalledTimes(1); expect(input?.method).toBe("POST");
      const form = input?.body as FormData;
      expect(form.get("to")).toBe("+19898989898"); expect(form.get("maxRetries")).toBe("0");
      expect(form.has("contentUrl")).toBe(false); expect(form.has("callbackUrl")).toBe(false);
      expect(new Uint8Array(await (form.get("file") as Blob).arrayBuffer())).toEqual(bytes);
      return Response.json(fax());
    });
    const carrier = createSinchSnapFaxEmulatorCarrier({ ...config, fetcher });
    expect(await carrier.send(attempt(), bytes, gate, signal())).toEqual({ providerId: "test-fax", providerStatus: "QUEUED" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["recipient", "request", "snapshot", "live", "expiry"])("rejects a changed %s before any provider action", async kind => {
    const value = { ...attempt() } as Record<string, unknown>;
    if (kind === "recipient") value.to = "+12155550102";
    if (kind === "request") value.requestId = "22222222-2222-4222-8222-222222222222";
    if (kind === "snapshot") value.snapshotHash = "b".repeat(64);
    if (kind === "live") { delete value.kind; delete value.requestId; delete value.snapshotHash; value.to = "+12155550102"; }
    if (kind === "expiry") value.expiresAt = "2026-11-10T13:59:00.000Z";
    const fetcher = vi.fn<typeof fetch>(), carrier = createSinchSnapFaxEmulatorCarrier({ ...config, fetcher });
    expect(() => carrier.validateAttempt(value)).toThrow(); expect(fetcher).not.toHaveBeenCalled();
  });
  it("keeps emulated attempts out of the live carrier", () => {
    const carrier = createSinchSnapFaxCarrier({ projectId: config.projectId, serviceId: config.serviceId, fromNumber: config.fromNumber,
      accessKey: config.accessKey, secretKey: config.secretKey,
      destinations: [{ id: "real", version: "v1", number: "+12155550102", verifiedUntil: "2026-11-11T00:00:00Z" }] });
    expect(() => carrier.validateAttempt(attempt())).toThrow();
  });
  it("rejects changed bytes without opening the dispatch gate", async () => {
    const fetcher = vi.fn<typeof fetch>(), gate = vi.fn(async () => attempt(true));
    const carrier = createSinchSnapFaxEmulatorCarrier({ ...config, fetcher });
    expect((await carrier.send(attempt(), bytes.subarray(0, 100), gate, signal())).providerStatus).toBe("UNKNOWN");
    expect(gate).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it("reconciles a dispatched attempt by GET and reports emulation only", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fax(true)));
    const carrier = createSinchSnapFaxEmulatorCarrier({ ...config, fetcher });
    expect(await carrier.reconcile({ ...attempt(true), providerId: "test-fax" }, signal()))
      .toEqual({ providerId: "test-fax", providerStatus: "COMPLETED", completedAt: now });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][1]?.method).toBe("GET");
  });
});
