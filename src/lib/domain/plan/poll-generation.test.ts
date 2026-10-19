import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollPlanGeneration } from "./poll-generation";
import type { StagedPlanAdvanceResult } from "@/app/actions/plans";

const complete: StagedPlanAdvanceResult = { ok: true, done: true, status: "complete" };
const busy: StagedPlanAdvanceResult = { ok: true, done: false, status: "busy", retryAfter: 5 };
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe("bounded generation recovery", () => {
  it("waits through another tab's claim until all persisted stages complete", async () => {
    const advance = vi.fn<() => Promise<StagedPlanAdvanceResult>>().mockResolvedValueOnce(busy).mockResolvedValueOnce(busy)
      .mockResolvedValueOnce({ ok: true, status: "advanced", done: false, phaseCompleted: "60" }).mockResolvedValue(complete);
    const refresh = vi.fn().mockResolvedValue(undefined);
    const work = pollPlanGeneration(advance, refresh, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(10_250);
    expect(await work).toBe("complete"); expect(advance).toHaveBeenCalledTimes(4); expect(refresh).toHaveBeenCalledTimes(4);
  });
  it("can recover when the server saved a stage but the browser missed its response", async () => {
    const advance = vi.fn<() => Promise<StagedPlanAdvanceResult>>().mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValue(complete);
    const work = pollPlanGeneration(advance, vi.fn(async () => {}), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(5000); expect(await work).toBe("complete"); expect(advance).toHaveBeenCalledTimes(2);
  });
  it("stops on provider/quota failure without charging automatic retries", async () => {
    const advance = vi.fn<() => Promise<StagedPlanAdvanceResult>>().mockResolvedValue({ ok: false, status: "failed", error: "Daily AI limit reached" });
    expect(await pollPlanGeneration(advance, vi.fn(async () => {}), new AbortController().signal)).toEqual({ error: "Daily AI limit reached" });
    expect(advance).toHaveBeenCalledTimes(1);
  });
  it("bounds repeated connection failures and leaves an explicit resume path", async () => {
    const advance = vi.fn().mockRejectedValue(new Error("offline"));
    const work = pollPlanGeneration(advance, vi.fn(async () => {}), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(10_000); expect(await work).toMatchObject({ error: expect.stringContaining("continue") }); expect(advance).toHaveBeenCalledTimes(3);
  });
  it("bounds busy polling even if a claim remains unavailable", async () => {
    const advance = vi.fn().mockResolvedValue(busy);
    const work = pollPlanGeneration(advance, vi.fn(async () => {}), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(12 * 60_000); expect(await work).toMatchObject({ error: expect.stringContaining("Continue the draft") });
    expect(advance).toHaveBeenCalledTimes(144);
  });
  it("cancels waiting and ignores late requests after navigation without starting another stage", async () => {
    const controller = new AbortController(); const advance = vi.fn().mockResolvedValue(busy);
    const work = pollPlanGeneration(advance, vi.fn(async () => {}), controller.signal);
    await vi.advanceTimersByTimeAsync(0); controller.abort();
    expect(await work).toBe("cancelled"); await vi.advanceTimersByTimeAsync(60_000); expect(advance).toHaveBeenCalledTimes(1);
    let finish!: (v: StagedPlanAdvanceResult) => void;
    const next = new AbortController(); const refresh = vi.fn(async () => {});
    const late = pollPlanGeneration(() => new Promise(resolve => { finish = resolve; }), refresh, next.signal);
    next.abort(); finish(complete); expect(await late).toBe("cancelled"); expect(refresh).not.toHaveBeenCalled();
  });
  it("bounds a request that never returns and cancels it immediately on navigation", async () => {
    const advance = vi.fn(() => new Promise<StagedPlanAdvanceResult>(() => {}));
    const work = pollPlanGeneration(advance, vi.fn(async () => {}), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(12 * 60_000);
    expect(await work).toMatchObject({ error: expect.any(String) });
    expect(advance).toHaveBeenCalledTimes(3);
    const controller = new AbortController();
    const cancelled = pollPlanGeneration(advance, vi.fn(async () => {}), controller.signal);
    controller.abort(); expect(await cancelled).toBe("cancelled");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops superseded drafts instead of advancing a newer plan", async () => {
    const advance = vi.fn().mockResolvedValue({ ok: true, done: true, status: "superseded" });
    expect(await pollPlanGeneration(advance, vi.fn(async () => {}), new AbortController().signal)).toBe("superseded"); expect(advance).toHaveBeenCalledTimes(1);
  });
});
