import { afterEach, expect, it, vi } from "vitest";
import { fetchWithTimeout } from "./fetch-with-timeout";
afterEach(() => vi.unstubAllGlobals());
it.each(["caller", "deadline"])("ends a stalled request when its %s cancels", async (source) => {
  const caller = new AbortController();
  const deadline = new AbortController();
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  vi.stubGlobal("fetch", vi.fn((_input, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
  })));
  const request = fetchWithTimeout("https://synthetic.example/auth/v1/token", { signal: caller.signal });
  (source === "caller" ? caller : deadline).abort();
  await expect(request).rejects.toMatchObject({ name: "AbortError" });
  expect(AbortSignal.timeout).toHaveBeenCalledWith(15000);
});
