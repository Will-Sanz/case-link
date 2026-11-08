import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  require: vi.fn(),
  owned: vi.fn(),
  session: vi.fn(),
}));
vi.mock("./auth", () => ({ requireParentSession: mocks.require }));
import {
  applicationBrowser,
  applicationBrowserControl,
} from "./browser-client";
import { COMPASS_FAMILY_SAFETY } from "./browser-policy";
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

it("forwards minimal validated controls after owned authentication and binds interactive image URLs", async () => {
  const frameId = "e1671f04-783d-469e-ad76-a426c2a2d832";
  const input = {
    sessionId: id,
    frameId,
    action: { type: "continue" as const },
  };
  const fetcher = vi.fn().mockResolvedValue(
    Response.json({
      ok: true,
      available: true,
      reason: null,
      session: {
        id,
        programId: "snap-pa",
        status: "needs_parent",
        currentUrl: COMPASS_FAMILY_SAFETY,
        title: "Pennsylvania COMPASS",
        summary: "Website check",
        updatedAt: new Date().toISOString(),
        canControl: true,
        frameUrl: "https://untrusted.test/frame",
        handoff: {
          kind: "continue",
          frameId,
          width: 1100,
          height: 720,
          expiresAt: new Date(Date.now() + 600000).toISOString(),
        },
      },
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  const response = await applicationBrowserControl(id, input);
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(
    `http://127.0.0.1:3330/requests/${id}/control`,
    expect.objectContaining({
      method: "POST",
      redirect: "error",
      cache: "no-store",
      headers: {
        authorization: "Bearer verified-user-token",
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    }),
  );
  expect((await response.json()).session.frameUrl).toBe(
    `/api/parent/requests/${id}/browser/frame?frameId=${frameId}`,
  );
  fetcher.mockResolvedValue(
    new Response("jpeg", { headers: { "content-type": "image/jpeg" } }),
  );
  await applicationBrowser(id, "GET", true, frameId);
  expect(fetcher.mock.calls.at(-1)?.[0]).toBe(
    `http://127.0.0.1:3330/requests/${id}/frame?frameId=${frameId}`,
  );
  fetcher.mockClear();
  mocks.owned.mockResolvedValue({ data: null, error: null });
  await expect(applicationBrowserControl(id, input)).rejects.toThrow(
    "unavailable",
  );
  expect(fetcher).not.toHaveBeenCalled();
});

it("preserves stale, throttled and unavailable command results without acknowledging an action", async () => {
  const input = {
    sessionId: id,
    frameId: id,
    action: { type: "refresh" as const },
  };
  for (const status of [400, 403, 409, 429]) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status })),
    );
    expect((await applicationBrowserControl(id, input)).status).toBe(status);
  }
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
  expect((await applicationBrowserControl(id, input)).status).toBe(503);
});
