import { describe, expect, it, vi } from "vitest";
import { fixtureUtilityProtectedOperation } from "./utility-preparation-test-fixtures";
import { createUtilityProtectedPreparationClient } from "./utility-preparation-worker-client";
import { UTILITY_PREPARATION_SERVICE_ERROR } from "./utility-preparation-port";
const operation = () => fixtureUtilityProtectedOperation();
const job = () => { const value = operation().packet.protectedUtilityPacket; return { jobId: "77777777-7777-4777-8777-777777777777", leaseToken: "88888888-8888-4888-8888-888888888888",
  scope: { requestId: value.requestId, expectedVersion: value.requestVersion, programId: value.programId, snapshotId: value.snapshotId, snapshotRevision: value.snapshotRevision, snapshotHash: value.snapshotHash }, inputSetHash: "e".repeat(64), signal: new AbortController().signal }; };
const secret = "synthetic-utility-metadata-token-".repeat(2), origin = "http://127.0.0.1:3341";
describe("metadata-only utility worker HTTP port", () => {
  it("sends only a bounded exact job and checks the returned prepared reference", async () => {
    const fetcher = vi.fn(async () => Response.json({ state: "prepared", operation: operation() }));
    expect(await createUtilityProtectedPreparationClient({ origin, secret, fetcher }).prepare(job())).toMatchObject({ state: "prepared" });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]; expect(url).toBe(`${origin}/utility/prepare`);
    const { signal: _, ...metadata } = job(); void _; expect(JSON.parse(String(init.body))).toEqual(metadata);
    expect(init).toMatchObject({ method: "POST", redirect: "error", cache: "no-store" }); expect(JSON.stringify(init.body)).not.toMatch(/bytes|documents|identifier|password|actorId|consentAccepted/);
  });
  it.each(["changed-request", "old-version", "stale", "raw-result", "wrong-http-status", "redirect", "outside-response", "invalid-json"])("denies %s without echoing private error content", async problem => {
    const value = operation(); if (problem === "changed-request") { value.requestId = "99999999-9999-4999-8999-999999999999"; value.packet.protectedUtilityPacket.requestId = value.requestId; }
    if (problem === "old-version") { value.requestVersion = 1; value.packet.protectedUtilityPacket.requestVersion = 1; }
    if (problem === "stale") value.protectedPacketCurrent = false;
    const fetcher = vi.fn(async () => {
      if (problem === "invalid-json") return new Response("PRIVATE-CANARY", { headers: { "Content-Type": "application/json" } });
      const response = Response.json({ state: "prepared", operation: value, ...(problem === "raw-result" ? { privateValue: "PRIVATE-CANARY" } : {}) }, { status: problem === "wrong-http-status" ? 202 : 200 });
      if (problem === "redirect") Object.defineProperty(response, "redirected", { value: true });
      if (problem === "outside-response") Object.defineProperty(response, "url", { value: "https://outside.invalid/PRIVATE-CANARY" }); return response;
    });
    await expect(createUtilityProtectedPreparationClient({ origin, secret, fetcher }).prepare(job())).rejects.toThrow(UTILITY_PREPARATION_SERVICE_ERROR);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("keeps an unknown commit unknown and makes no automatic duplicate preparation request", async () => {
    const result = { state: "commit_unknown", packetId: operation().packet.protectedUtilityPacket.packetId, operationId: operation().operationId };
    const fetcher = vi.fn(async () => Response.json(result, { status: 202 }));
    expect(await createUtilityProtectedPreparationClient({ origin, secret, fetcher }).prepare(job())).toEqual(result); expect(fetcher).toHaveBeenCalledOnce();
  });
  it("accepts only fixed service blockers and stops before network use after cancellation or raw input injection", async () => {
    const fetcher = vi.fn(async () => Response.json({ state: "service_blocked", reason: "source_unavailable" })); const client = createUtilityProtectedPreparationClient({ origin, secret, fetcher });
    expect(await client.prepare(job())).toEqual({ state: "service_blocked", reason: "source_unavailable" }); fetcher.mockClear();
    await expect(client.prepare({ ...job(), signal: AbortSignal.abort() })).rejects.toThrow(UTILITY_PREPARATION_SERVICE_ERROR);
    await expect(client.prepare({ ...job(), raw: "PRIVATE-CANARY" } as ReturnType<typeof job>)).rejects.toThrow(UTILITY_PREPARATION_SERVICE_ERROR); expect(fetcher).not.toHaveBeenCalled();
  });
});
