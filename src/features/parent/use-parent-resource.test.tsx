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
