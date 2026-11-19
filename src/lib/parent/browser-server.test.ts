import { request as httpRequest } from "node:http";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApplicationBrowserServer } from "./browser-server";

const id = "d430cc02-d8d4-46cc-9900-5b397758fb16";
const frameId = "e1671f04-783d-469e-ad76-a426c2a2d832";
const input = { sessionId: id, frameId, action: { type: "refresh" } };
const runner = {
  read: vi.fn(),
  control: vi.fn(),
};
let server: ReturnType<typeof createApplicationBrowserServer>;
let port: number;

beforeEach(async () => {
  runner.read.mockResolvedValue(Response.json({ ok: true }));
  runner.control.mockResolvedValue(Response.json({ ok: true }));
  server = createApplicationBrowserServer(
    runner as unknown as Parameters<typeof createApplicationBrowserServer>[0],
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test listener");
  port = address.port;
});
afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

function send(
  path: string,
  method = "GET",
  body?: string,
  headers: Record<string, string> = {},
) {
  return new Promise<{
    status: number;
    body: string;
    cache: string | undefined;
  }>((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        agent: false,
        headers: {
          authorization: "Bearer short-lived-token",
          ...(body === undefined
            ? {}
            : {
                "content-type": "application/json",
                "content-length": String(Buffer.byteLength(body)),
              }),
          ...headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () =>
          resolve({
            status: response.statusCode!,
            body: Buffer.concat(chunks).toString(),
            cache: response.headers["cache-control"],
          }),
        );
        response.on("error", reject);
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

it("forwards only validated controls and exact frame nonces through the real HTTP handler", async () => {
  expect(
    (await send(`/requests/${id}/control`, "POST", JSON.stringify(input)))
      .status,
  ).toBe(200);
  expect(runner.control).toHaveBeenCalledExactlyOnceWith(
    "short-lived-token",
    id,
    input,
  );
  expect((await send(`/requests/${id}/frame?frameId=${frameId}`)).status).toBe(
    200,
  );
  expect(runner.read).toHaveBeenCalledExactlyOnceWith(
    "short-lived-token",
    id,
    "GET",
    true,
    frameId,
  );
  expect(runner.read).not.toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    expect.anything(),
    false,
    frameId,
  );
});

it("rejects malformed, oversized, chunked and unsupported controls before the runner", async () => {
  for (const [body, headers] of [
    ["{", {}],
    [JSON.stringify({ ...input, ssn: "synthetic-forbidden-value" }), {}],
    [
      JSON.stringify({ ...input, action: { type: "type", text: "private" } }),
      {},
    ],
    [JSON.stringify(input), { "content-type": "text/plain" }],
    ["x".repeat(2049), {}],
    [
      JSON.stringify(input),
      { "transfer-encoding": "chunked", "content-length": "" },
    ],
  ] as [string, Record<string, string>][]) {
    expect(
      (await send(`/requests/${id}/control`, "POST", body, headers)).status,
    ).toBe(400);
  }
  expect(runner.control).not.toHaveBeenCalled();
});

it("keeps the private origin, path, verb and body boundaries closed", async () => {
  const body = JSON.stringify(input);
  for (const headers of [
    { origin: "http://127.0.0.1:3200" },
    { host: `localhost:${port}` },
  ] as Record<string, string>[])
    expect(
      (await send(`/requests/${id}/control`, "POST", body, headers)).status,
    ).toBe(403);
  for (const path of [
    `/requests/${id}?frameId=${frameId}`,
    `/requests/${id}/control?frameId=${frameId}`,
    `/requests/${id}/frame?frameId=${frameId}&extra=1`,
    `/requests/${id}/frame?frameId=not-a-nonce`,
  ])
    expect((await send(path)).status).toBe(404);
  expect((await send(`/requests/${id}/control`)).status).toBe(404);
  expect((await send(`/requests/${id}/frame`, "POST")).status).toBe(404);
  expect((await send(`/requests/${id}`, "POST", body)).status).toBe(400);
  expect(runner.read).not.toHaveBeenCalled();
  expect(runner.control).not.toHaveBeenCalled();
});

it("returns private recoverable statuses without exposing error text or identifiers", async () => {
  for (const [message, status] of [
    ["browser_stale_frame", 409],
    ["browser_control_busy", 429],
    ["browser_control_rate", 429],
    ["browser_not_owned", 403],
    ["browser_control_target", 400],
    ["private-provider-error-with-sensitive-detail", 403],
  ] as const) {
    runner.control.mockRejectedValueOnce(new Error(message));
    const response = await send(
      `/requests/${id}/control`,
      "POST",
      JSON.stringify(input),
    );
    expect(response.status).toBe(status);
    expect(response.body).toBe("");
    expect(response.cache).toBe("private, no-store");
  }
});
