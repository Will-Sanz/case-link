import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ browser: vi.fn(), control: vi.fn() }));
vi.mock("@/lib/parent/browser-client", () => ({
  applicationBrowser: mocks.browser,
  applicationBrowserControl: mocks.control,
}));
import { GET, POST, DELETE } from "./requests/[id]/browser/route";
import { GET as FRAME } from "./requests/[id]/browser/frame/route";
import { POST as CONTROL } from "./requests/[id]/browser/control/route";
const id = "d430cc02-d8d4-46cc-9900-5b397758fb16";
const context = { params: Promise.resolve({ id }) };
const url = `https://app.example.test/api/parent/requests/${id}/browser`;
const request = (
  method: string,
  body?: unknown,
  origin = "https://app.example.test",
) =>
  new Request(url, {
    method,
    headers: { origin, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.example.test");
  mocks.browser.mockResolvedValue(Response.json({ ok: true }));
  mocks.control.mockResolvedValue(Response.json({ ok: true }));
});
afterEach(() => vi.unstubAllEnvs());
it("validates the program, forbids arbitrary URLs/fields and requires same-origin mutations", async () => {
  expect(
    (await POST(request("POST", { programId: "snap-pa" }), context)).status,
  ).toBe(200);
  expect(mocks.browser).toHaveBeenCalledWith(id, "POST");
  mocks.browser.mockClear();
  for (const body of [
    { programId: "peco-cap" },
    { programId: "snap-pa", url: "http://169.254.169.254/" },
    { programId: "snap-pa", ssn: "123-45-6789" },
  ])
    expect((await POST(request("POST", body), context)).status).toBe(400);
  expect(
    (
      await POST(
        request("POST", { programId: "snap-pa" }, "https://evil.test"),
        context,
      )
    ).status,
  ).toBe(403);
  expect(
    (await DELETE(request("DELETE", undefined, "https://evil.test"), context))
      .status,
  ).toBe(403);
  expect(mocks.browser).not.toHaveBeenCalled();
});
it("routes read, stop and image access through the same owned authorization boundary", async () => {
  await GET(request("GET"), context);
  await DELETE(request("DELETE"), context);
  await FRAME(request("GET"), context);
  expect(mocks.browser).toHaveBeenCalledWith(id, "GET");
  expect(mocks.browser).toHaveBeenCalledWith(id, "DELETE");
  expect(mocks.browser).toHaveBeenCalledWith(id, "GET", true, undefined);
});

it("requires exact control shape and same origin before forwarding any parent action", async () => {
  const input = { sessionId: id, frameId: id, action: { type: "continue" } };
  expect((await CONTROL(request("POST", input), context)).status).toBe(200);
  expect(mocks.control).toHaveBeenCalledExactlyOnceWith(id, input);
  mocks.control.mockClear();
  for (const body of [
    { ...input, ssn: "synthetic-private-value" },
    { ...input, action: { type: "navigate", url: "https://untrusted.test" } },
    { ...input, action: { type: "key", key: "Control+V" } },
    { ...input, action: { type: "click", x: -1, y: 0.5 } },
    { ...input, frameId: "stale" },
  ])
    expect((await CONTROL(request("POST", body), context)).status).toBe(400);
  expect(
    (await CONTROL(request("POST", input, "https://untrusted.test"), context))
      .status,
  ).toBe(403);
  expect(
    (
      await CONTROL(
        new Request(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        }),
        context,
      )
    ).status,
  ).toBe(403);
  expect(mocks.control).not.toHaveBeenCalled();
});

it("accepts only an exact image nonce and existing bounded cache-busting query", async () => {
  await FRAME(new Request(`${url}/frame?frameId=${id}&view=2`), context);
  expect(mocks.browser).toHaveBeenCalledWith(id, "GET", true, id);
  mocks.browser.mockClear();
  for (const query of [
    `frameId=${id}&frameId=${id}`,
    "frameId=not-a-uuid",
    "view=not-a-number",
    "url=https://untrusted.test",
    "view=1&view=2",
  ])
    expect(
      (await FRAME(new Request(`${url}/frame?${query}`), context)).status,
    ).toBe(400);
  expect(mocks.browser).not.toHaveBeenCalled();
});
