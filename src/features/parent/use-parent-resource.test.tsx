// @vitest-environment jsdom
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useParentResource } from "./use-parent-resource";
import { ParentApiError } from "./api";
import { ApplicationBrowser } from "./application-browser";
import { fixtureRequest } from "@/lib/parent/test-fixtures";
import { COMPASS_FAMILY_SAFETY } from "@/lib/parent/browser-policy";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("never exposes the previous request while loading a new request path", async () => {
  let finishSecond: ((value: unknown) => void) | undefined;
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ request: { id: "first" } }),
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishSecond = resolve;
          }),
      ),
  );
  const { result, rerender } = renderHook(
    ({ path }) => useParentResource<{ request: { id: string } }>(path),
    { initialProps: { path: "/requests/first" } },
  );
  await waitFor(() => expect(result.current.data?.request.id).toBe("first"));
  rerender({ path: "/requests/second" });
  expect(result.current.data).toBeNull();
  expect(result.current.loading).toBe(true);
  await act(async () => {
    finishSecond?.({
      ok: true,
      status: 200,
      json: async () => ({ request: { id: "second" } }),
    });
  });
  await waitFor(() => expect(result.current.data?.request.id).toBe("second"));
});
it.each([0, 500, 502, 504])(
  "keeps same-request data after a temporary refresh failure (%s)",
  async (status) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ request: { id: "first" } }),
      });
    if (status === 0) fetch.mockRejectedValueOnce(new Error("Disconnected"));
    else
      fetch.mockResolvedValueOnce({
        ok: false,
        status,
        json: async () => ({ error: "Try again." }),
      });
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() =>
      useParentResource<{ request: { id: string } }>("/requests/first"),
    );
    await waitFor(() => expect(result.current.data?.request.id).toBe("first"));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.data?.request.id).toBe("first");
  },
);

const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
function stalledRead(phase: "fetch" | "body") {
  let finish!: (value: unknown) => void, signal: AbortSignal | undefined;
  const pending = new Promise(resolve => { finish = resolve; });
  return {
    read: (_url: unknown, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return phase === "fetch" ? pending : Promise.resolve({ ok: true, status: 200, json: () => pending });
    },
    finish: (value: unknown) => finish(phase === "fetch" ? reply(value) : value),
    signal: () => signal,
  };
}

describe("bounded parent resource reads", () => {
  it.each([200, 403])("does not turn a malformed HTTP %s body into a transient permission result", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply({ id: "private" })).mockResolvedValueOnce({ ok: status < 400, status, json: async () => null }));
    const { result } = renderHook(() => useParentResource<{ id: string }>("/requests/first"));
    await waitFor(() => expect(result.current.data?.id).toBe("private"));
    await act(async () => result.current.reload());
    expect(result.current.error).not.toBeNull(); expect(result.current.data).toBeNull();
  });

  it.each(["fetch", "body"] as const)("ends an initial stalled %s, releases retry and ignores its late result", async phase => {
    vi.useFakeTimers(); const stalled = stalledRead(phase);
    vi.stubGlobal("fetch", vi.fn().mockImplementationOnce(stalled.read).mockResolvedValue(reply({ id: "retry" })));
    const { result } = renderHook(() => useParentResource<{ id: string }>("/requests/first"));
    await act(async () => { await vi.advanceTimersByTimeAsync(29_999); });
    expect(result.current.loading).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(result.current.loading).toBe(false); expect(result.current.data).toBeNull();
    expect(result.current.error).toBeInstanceOf(ParentApiError); expect((result.current.error as ParentApiError).status).toBe(0);
    expect(stalled.signal()?.aborted).toBe(true);
    await act(async () => result.current.reloadIfIdle());
    expect(result.current.data?.id).toBe("retry"); expect(result.current.error).toBeNull();
    await act(async () => stalled.finish({ id: "late" })); expect(result.current.data?.id).toBe("retry");
  });

  it.each(["fetch", "body"] as const)("keeps the same saved object through a stalled refresh %s and reports a recoverable error", async phase => {
    vi.useFakeTimers(); const stalled = stalledRead(phase), original = { id: "first" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply(original)).mockImplementationOnce(stalled.read).mockResolvedValue(reply({ id: "fresh" })));
    const { result } = renderHook(() => useParentResource<{ id: string }>("/requests/first"));
    await act(async () => {}); const saved = result.current.data;
    expect(saved).toBe(original);
    await act(async () => result.current.reload());
    expect(result.current.data).toBe(saved); expect(result.current.loading).toBe(false); expect(result.current.error).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(result.current.data).toBe(saved); expect(result.current.loading).toBe(false);
    expect((result.current.error as ParentApiError).status).toBe(0);
    await act(async () => stalled.finish({ id: "superseded" })); expect(result.current.data).toBe(saved);
    await act(async () => result.current.reloadIfIdle()); expect(result.current.data?.id).toBe("fresh");
  });

  it("cancels the old path and unmounted read without retaining deadline timers or accepting late bodies", async () => {
    vi.useFakeTimers(); const first = stalledRead("body"), second = stalledRead("fetch");
    vi.stubGlobal("fetch", vi.fn().mockImplementationOnce(first.read).mockImplementationOnce(second.read));
    const { result, rerender, unmount } = renderHook(({ path }) => useParentResource<{ id: string }>(path), { initialProps: { path: "/requests/first" } });
    await act(async () => {}); rerender({ path: "/requests/second" }); await act(async () => {});
    expect(first.signal()?.aborted).toBe(true); expect(result.current.data).toBeNull(); expect(result.current.loading).toBe(true);
    await act(async () => first.finish({ id: "first" })); expect(result.current.data).toBeNull();
    unmount(); await act(async () => {}); expect(second.signal()?.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
    await act(async () => second.finish({ id: "second" })); expect(vi.getTimerCount()).toBe(0);
  });

  it("lets an active application's pending read reach its deadline across five-second background ticks", async () => {
    vi.useFakeTimers(); const stalled = stalledRead("body"), session = { id: "e1671f04-783d-469e-ad76-a426c2a2d832", programId: "snap-pa", status: "running",
      currentUrl: COMPASS_FAMILY_SAFETY, title: "Pennsylvania COMPASS", summary: "Recorded website activity", updatedAt: new Date().toISOString(), canControl: false, frameUrl: null, handoff: null };
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ ok: true, available: true, reason: null, session })).mockImplementationOnce(stalled.read)
      .mockResolvedValue(reply({ ok: true, available: true, reason: null, session: null }));
    vi.stubGlobal("fetch", fetcher);
    render(<ApplicationBrowser request={fixtureRequest()} canStart={false} hasAttempt={false}/>); await act(async () => {});
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); }); expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(25_000); });
    expect(fetcher).toHaveBeenCalledTimes(2); expect(stalled.signal()?.aborted).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); }); expect(stalled.signal()?.aborted).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); }); expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
it.each([401, 403, 404, 503])(
  "discards prior data when access or processing is unavailable (%s)",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ request: { id: "first" } }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status,
          json: async () => ({ error: "Unavailable." }),
        }),
    );
    const { result } = renderHook(() =>
      useParentResource<{ request: { id: string } }>("/requests/first"),
    );
    await waitFor(() => expect(result.current.data?.request.id).toBe("first"));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.data).toBeNull();
  },
);
