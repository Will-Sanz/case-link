import { describe, expect, it, vi } from "vitest";
import { parseSnapPendingCapture, runSnapCaptureCheck, snapCaptureCheckResultSchema } from "./snap-pending-capture";
import { fixtureNow, fixtureSnapCaptureIntent } from "./test-fixtures";

const intent = fixtureSnapCaptureIntent();
const scope = { requestId: intent.requestId, requestVersion: intent.requestVersion, leaseUntil: new Date(fixtureNow.getTime()+300000).toISOString(), now: fixtureNow };
const pending = () => ({ packetId: intent.packetId, requestId: intent.requestId, requestVersion: intent.requestVersion, state: "pending", reason: null,
  intent, deadline: new Date(fixtureNow.getTime()+120000).toISOString() });
describe("strict exact pending capture metadata", () => {
  it("reuses the durable exact intent and its bounded lease deadline", () => { expect(parseSnapPendingCapture(pending(), scope)).toEqual(pending()); });
  it.each(["requestId", "requestVersion", "packetId", "deadline", "intent_request", "source", "extra"])("rejects changed or unexpected %s", field => {
    const value: Record<string, unknown> = pending();
    if (field === "requestId" || field === "packetId") value[field] = "33333333-3333-4333-8333-333333333333";
    if (field === "requestVersion") value.requestVersion = 2;
    if (field === "deadline") value.deadline = new Date(fixtureNow.getTime()+301000).toISOString();
    if (field === "intent_request") value.intent = { ...intent, requestId: "33333333-3333-4333-8333-333333333333" };
    if (field === "source") value.intent = { ...intent, templateSha256: "e".repeat(64) };
    if (field === "extra") value.privateField = "PRIVATE_SYNTHETIC_CANARY";
    expect(() => parseSnapPendingCapture(value, scope)).toThrow();
  });
  it("does not expose an unavailable file as a checked or decryptable intent", () => {
    expect(parseSnapPendingCapture({ ...pending(), state: "unavailable", reason: "permission_or_file_unavailable", intent: null, deadline: null }, scope).state).toBe("unavailable");
    expect(() => parseSnapPendingCapture({ ...pending(), deadline: fixtureNow.toISOString() }, scope)).toThrow();
  });
  it("accepts only fixed content-free result codes and binds a checked operation", () => {
    const value = { packetId: intent.packetId, requestId: intent.requestId, requestVersion: intent.requestVersion, contentSha256: intent.contentSha256,
      state: "checked", reason: null, operationId: "467931e4-f88c-479b-8dcf-13f8ac397051" };
    expect(snapCaptureCheckResultSchema.safeParse(value).success).toBe(true);
    expect(snapCaptureCheckResultSchema.safeParse({ ...value, operationId: undefined }).success).toBe(false);
    expect(snapCaptureCheckResultSchema.safeParse({ ...value, reason: "PRIVATE_CANARY" }).success).toBe(false);
    expect(snapCaptureCheckResultSchema.safeParse({ ...value, ssn: "PRIVATE_CANARY" }).success).toBe(false);
  });
  it("bounds a private checker that ignores its signal and aborts that attempt", async () => {
    let signal: AbortSignal | undefined;
    const port = { prepareCapture: vi.fn(input => { signal = input.signal; return new Promise(() => {}); }) };
    await expect(runSnapCaptureCheck(port, { jobId: "synthetic-job", leaseToken: "synthetic-lease", requestId: intent.requestId, requestVersion: 1,
      packetId: intent.packetId, intent, deadline: scope.leaseUntil }, 5)).rejects.toThrow("snap_capture_check_unconfirmed");
    expect(signal?.aborted).toBe(true); expect(port.prepareCapture).toHaveBeenCalledOnce();
  });
  it("refuses a bound beyond90 seconds before invoking the private checker", async () => {
    const port = { prepareCapture: vi.fn() };
    await expect(runSnapCaptureCheck(port, { jobId: "synthetic-job", leaseToken: "synthetic-lease", requestId: intent.requestId,
      requestVersion: 1, packetId: intent.packetId, intent, deadline: scope.leaseUntil }, 90001)).rejects.toThrow(); expect(port.prepareCapture).not.toHaveBeenCalled();
  });
});
