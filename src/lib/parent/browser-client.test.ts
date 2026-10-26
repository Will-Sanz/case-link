import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  require: vi.fn(),
  owned: vi.fn(),
  session: vi.fn(),
}));
vi.mock("./auth", () => ({ requireParentSession: mocks.require }));
import { applicationBrowser } from "./browser-client";
const id = "d430cc02-d8d4-46cc-9900-5b397758fb16";
beforeEach(() => {
  mocks.owned.mockResolvedValue({ data: { id }, error: null });
  mocks.session.mockResolvedValue({
    data: { session: { access_token: "verified-user-token" } },
    error: null,
  });
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: mocks.owned,
  };
  mocks.require.mockResolvedValue({
    supabase: { from: () => query, auth: { getSession: mocks.session } },
  });
});
afterEach(() => vi.unstubAllGlobals());
it("checks owned request before forwarding a token, and never sends a family packet", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      Response.json({ ok: true, available: true, reason: null, session: null }),
    );
  vi.stubGlobal("fetch", fetcher);
  await applicationBrowser(id, "POST");
  expect(fetcher).toHaveBeenCalledWith(
    `http://127.0.0.1:3330/requests/${id}`,
    expect.objectContaining({
      method: "POST",
      headers: { authorization: "Bearer verified-user-token" },
      redirect: "error",
    }),
  );
  expect(fetcher.mock.calls[0][1].body).toBeUndefined();
  fetcher.mockClear();
  mocks.owned.mockResolvedValue({ data: null, error: null });
  await expect(applicationBrowser(id, "GET")).rejects.toThrow("unavailable");
  expect(fetcher).not.toHaveBeenCalled();
});
it("returns truthful unavailability when the private service is absent", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("refused")));
  const response = await applicationBrowser(id, "GET");
  expect((await response.json()).available).toBe(false);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect((await applicationBrowser(id, "GET", true)).status).toBe(503);
});
it("does not acknowledge a start or stop when the private service times out", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
  for (const method of ["POST", "DELETE"] as const) {
    const response = await applicationBrowser(id, method);
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
  }
});
it("reissues only bounded real JPEG frames with private cache controls", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response("actual-frame", {
        headers: { "Content-Type": "image/jpeg" },
      }),
    ),
  );
  const frame = await applicationBrowser(id, "GET", true);
  expect(await frame.text()).toBe("actual-frame");
  expect(frame.headers.get("cache-control")).toContain("no-store");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response("<script>untrusted</script>", {
        headers: { "Content-Type": "text/html" },
      }),
    ),
  );
  expect((await applicationBrowser(id, "GET", true)).status).toBe(503);
});
