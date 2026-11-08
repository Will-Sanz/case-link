import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSinchSnapFaxCarrier } from "./snap-sender-carrier";
import { SNAP_SENDER_ERROR, type SnapSenderAttempt } from "./snap-sender-contract";

const now = "2026-11-07T18:20:00.000Z", id = "11111111-1111-4111-8111-111111111111", faxId = "carrier-123";
const bytes = new TextEncoder().encode("%PDF-1.7\nPRIVATE_PDF_CANARY"), digest = createHash("sha256").update(bytes).digest("hex");
const config = { projectId: "live-project", serviceId: "private-service", fromNumber: "+12155550101", accessKey: "test-key", secretKey: "PRIVATE_KEY_CANARY",
  destinations: [{ id: "phila-office", version: "route-v1", number: "+12155550102", verifiedUntil: "2026-11-08T18:20:00.000Z" }] };
const signal = () => new AbortController().signal;
function attempt(dispatched = true): SnapSenderAttempt {
  return { operationId: id, packetId: id, contentSha256: digest, operationRef: "a".repeat(64), attemptedAt: now,
    projectId: config.projectId, serviceId: config.serviceId, from: config.fromNumber, to: config.destinations[0].number,
    dispatchAuthorizedAt: dispatched ? now : null,
    destinationId: "phila-office", destinationVersion: "route-v1", expiresAt: "2026-11-07T18:25:00.000Z", pageCount: 12, providerId: null, providerStatus: "UNKNOWN" };
}
function fax(overrides: Record<string, unknown> = {}) {
  return { id: faxId, projectId: config.projectId, serviceId: config.serviceId, from: config.fromNumber, to: config.destinations[0].number,
    direction: "OUTBOUND", status: "QUEUED", createTime: now, maxRetries: 0,
    labels: { operationRef: "a".repeat(64), sourceSha256: digest, pageCount: "12" }, ...overrides };
}
const completed = () => fax({ status: "COMPLETED", numberOfPages: 12, pagesSentSuccessfully: 12, completedTime: now });
const service = () => ({ id: config.serviceId, projectId: config.projectId, saveOutboundFaxDocuments: false, numberOfRetries: 0, inProgressNotifications: false });
const numbers = () => ({ numbers: [{ phoneNumber: config.fromNumber, projectId: config.projectId, serviceId: config.serviceId }], page: 0, pageSize: 100, totalItems: 1, totalPages: 1 });
const json = (value: unknown) => Response.json(value);
const list = (values: unknown[]) => ({ faxes: values, page: 0, totalPages: values.length ? 1 : 0, pageSize: 100, totalItems: values.length });

describe("live protected Sinch carrier", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  it("checks private service settings and rejects content forwarding/storage before dispatch", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(service())).mockResolvedValueOnce(json({ emails: [], totalItems: 0, totalPages: 0 })).mockResolvedValueOnce(json(numbers()));
    await createSinchSnapFaxCarrier({ ...config, fetcher }).checkConfiguration(signal());
    expect(fetcher.mock.calls.map(call => call[1]?.method)).toEqual(["GET", "GET", "GET"]);
    expect(fetcher.mock.calls.every(call => !(call[1]?.body))).toBe(true);
  });
  it.each(["storage", "missing_storage", "retry", "callback", "cover", "notifications", "emails"])("fails closed for unsafe %s settings", async kind => {
    const settings: Record<string, unknown> = service();
    if (kind === "storage") settings.saveOutboundFaxDocuments = true;
    if (kind === "missing_storage") delete settings.saveOutboundFaxDocuments;
    if (kind === "retry") settings.numberOfRetries = 3;
    if (kind === "callback") settings.callbackUrl = "https://outside.invalid/PRIVATE_CANARY";
    if (kind === "cover") settings.coverPageId = "unexpected";
    if (kind === "notifications") settings.inProgressNotifications = true;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(settings)).mockResolvedValueOnce(json({ emails: kind === "emails" ? ["PRIVATE_CANARY"] : [], totalItems: kind === "emails" ? 1 : 0, totalPages: 1 })).mockResolvedValueOnce(json(numbers()));
    await expect(createSinchSnapFaxCarrier({ ...config, fetcher }).checkConfiguration(signal())).rejects.toThrow(SNAP_SENDER_ERROR);
    expect(fetcher.mock.calls.every(call => call[1]?.method === "GET")).toBe(true);
  });
  it.each(["absent", "different_service", "different_project", "duplicate", "paginated", "incomplete"])("closes an unproved %s sender-number association before upload", async kind => {
    const assignment = numbers();
    if (kind === "absent") assignment.numbers[0].phoneNumber = "+12155550104";
    if (kind === "different_service") assignment.numbers[0].serviceId = "other-service";
    if (kind === "different_project") assignment.numbers[0].projectId = "other-project";
    if (kind === "duplicate") { assignment.numbers.push({ ...assignment.numbers[0] }); assignment.totalItems = 2; }
    if (kind === "paginated") assignment.totalPages = 2;
    if (kind === "incomplete") assignment.totalItems = 2;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(service())).mockResolvedValueOnce(json({ emails: [], totalItems: 0, totalPages: 0 })).mockResolvedValueOnce(json(assignment));
    await expect(createSinchSnapFaxCarrier({ ...config, fetcher }).checkConfiguration(signal())).rejects.toThrow(SNAP_SENDER_ERROR);
    expect(fetcher.mock.calls.every(call => call[1]?.method === "GET")).toBe(true);
  });
  it("uploads exact bytes with an explicit live target after durable dispatch authorization", async () => {
    const beforeSend = vi.fn(async () => attempt()), fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      expect(beforeSend).toHaveBeenCalledTimes(1); return json(fax());
    });
    const carrier = createSinchSnapFaxCarrier({ ...config, fetcher });
    expect(await carrier.send(attempt(false), bytes, beforeSend, signal())).toEqual({ providerId: faxId, providerStatus: "QUEUED" });
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe("https://fax.api.sinch.com/v3/projects/live-project/faxes"); expect(options?.method).toBe("POST");
    const form = options!.body as FormData;
    expect(form.get("to")).toBe(config.destinations[0].number); expect(form.get("maxRetries")).toBe("0");
    expect(form.has("callbackUrl")).toBe(false); expect(form.has("contentUrl")).toBe(false);
    expect(form.has("serviceId")).toBe(false);
    expect(new Uint8Array(await (form.get("file") as File).arrayBuffer())).toEqual(bytes);
    expect(form.get("labels[operationRef]")).toBe(attempt().operationRef);
  });
  it("does not send after cancellation or denied final recheck", async () => {
    const fetcher = vi.fn<typeof fetch>(), carrier = createSinchSnapFaxCarrier({ ...config, fetcher });
    const stop = new AbortController(); stop.abort();
    expect((await carrier.send(attempt(false), bytes, vi.fn(), stop.signal)).providerStatus).toBe("UNKNOWN");
    expect((await carrier.send(attempt(false), bytes, async () => { throw new Error("PRIVATE_REVOKED"); }, signal())).providerStatus).toBe("UNKNOWN");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["emulator", "destination", "version", "expired", "project"])("rejects mismatched %s authority before provider access", async kind => {
    const input = attempt(false);
    if (kind === "emulator") input.to = "+19898989898";
    if (kind === "destination") input.to = "+12155550103";
    if (kind === "version") input.destinationVersion = "old";
    if (kind === "expired") input.expiresAt = now;
    if (kind === "project") input.projectId = "wrong";
    const fetcher = vi.fn<typeof fetch>();
    await expect(createSinchSnapFaxCarrier({ ...config, fetcher }).send(input, bytes, vi.fn(), signal())).rejects.toThrow(SNAP_SENDER_ERROR);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not post altered bytes or leak a failed response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("PRIVATE_KEY_CANARY")), carrier = createSinchSnapFaxCarrier({ ...config, fetcher });
    expect(await carrier.send(attempt(false), new Uint8Array([1]), vi.fn(), signal())).toEqual({ providerId: null, providerStatus: "UNKNOWN" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await carrier.send(attempt(false), bytes, async () => attempt(), signal())).toEqual({ providerId: null, providerStatus: "UNKNOWN" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("reconciles a known ID with GET and exact completed-page evidence", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(completed()));
    const result = await createSinchSnapFaxCarrier({ ...config, fetcher }).reconcile({ ...attempt(), providerId: faxId }, signal());
    expect(result).toEqual({ providerId: faxId, providerStatus: "COMPLETED", completedAt: now });
    expect(fetcher.mock.calls[0][1]?.method).toBe("GET"); expect(result).not.toHaveProperty("receipt");
  });
  it.each(["wrong_target", "wrong_label", "partial", "callback", "wrong_id", "retry", "contradictory_error"])("keeps %s carrier evidence unknown", async kind => {
    const value = completed();
    if (kind === "wrong_target") value.to = "+12155550103";
    if (kind === "wrong_label") value.labels.sourceSha256 = "d".repeat(64);
    if (kind === "partial") Object.assign(value, { pagesSentSuccessfully: 11 });
    if (kind === "callback") Object.assign(value, { callbackUrl: "PRIVATE_CANARY" });
    if (kind === "wrong_id") value.id = "other";
    if (kind === "retry") value.maxRetries = 1;
    if (kind === "contradictory_error") Object.assign(value, { errorType: "FAX_ERROR", errorCode: 123, errorMessage: "PRIVATE_CANARY" });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(value));
    expect((await createSinchSnapFaxCarrier({ ...config, fetcher }).reconcile({ ...attempt(), providerId: faxId }, signal())).providerStatus).toBe("UNKNOWN");
    expect(fetcher.mock.calls[0][1]?.method).toBe("GET");
  });
  it.each(["none", "ambiguous", "unique"])("recovers a lost POST acknowledgement only through a %s bounded GET match", async kind => {
    const values = kind === "none" ? [] : kind === "ambiguous" ? [completed(), completed()] : [completed()];
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(list(values)));
    const result = await createSinchSnapFaxCarrier({ ...config, fetcher }).reconcile(attempt(), signal());
    expect(result.providerStatus).toBe(kind === "unique" ? "COMPLETED" : "UNKNOWN");
    expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][1]?.method).toBe("GET");
    expect(String(fetcher.mock.calls[0][0])).not.toContain("PRIVATE_PDF_CANARY");
  });
  it("retains carrier recovery after raw-file retention, using current follow-up authority metadata", async () => {
    const past = "2026-11-06T18:20:00.000Z", input = { ...attempt(), attemptedAt: past, dispatchAuthorizedAt: past };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ ...completed(), createTime: past, completedTime: past }));
    expect((await createSinchSnapFaxCarrier({ ...config, fetcher }).reconcile({ ...input, providerId: faxId }, signal())).providerStatus).toBe("COMPLETED");
    expect(fetcher.mock.calls.every(call => call[1]?.method === "GET")).toBe(true);
  });
  it("does not require renewing an old submission destination for authorized status recovery", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(completed()));
    const carrier = createSinchSnapFaxCarrier({ ...config, destinations: [{ ...config.destinations[0], verifiedUntil: "2026-11-06T18:20:00.000Z" }], fetcher });
    expect((await carrier.reconcile({ ...attempt(), providerId: faxId }, signal())).providerStatus).toBe("COMPLETED");
    await expect(carrier.send(attempt(false), bytes, vi.fn(), signal())).rejects.toThrow(SNAP_SENDER_ERROR);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][1]?.method).toBe("GET");
  });
  it("uses dispatch authorization time for delayed resume and never reads/sends before that authorization", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(list([completed()]))), carrier = createSinchSnapFaxCarrier({ ...config, fetcher });
    const delayed = { ...attempt(), attemptedAt: "2026-11-06T18:20:00.000Z" };
    expect((await carrier.reconcile(delayed, signal())).providerStatus).toBe("COMPLETED");
    const query = new URL(String(fetcher.mock.calls[0][0])).searchParams;
    expect(query.get("createTime>")).toBe("2026-11-07T18:19:00.000Z");
    fetcher.mockClear();
    expect((await carrier.reconcile(attempt(false), signal())).providerStatus).toBe("UNKNOWN");
    expect((await carrier.send(attempt(), bytes, vi.fn(), signal())).providerStatus).toBe("UNKNOWN");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
