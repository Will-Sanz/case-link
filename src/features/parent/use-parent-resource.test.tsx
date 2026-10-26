// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useParentResource } from "./use-parent-resource";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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
