import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHostedParentProtectedFrontdoor, createLocalParentProtectedFrontdoor } from "./protected-frontdoor";

const packet = Buffer.from("%PDF-SYNTHETIC-PROTECTED-PACKET-CANARY");
const servers: Server[] = [];
const appCalls: { path: string; body: Buffer; headers: IncomingMessage["headers"] }[] = [];
const protectedCalls: typeof appCalls = [];
let front: string, appOrigin: string, protectedOrigin: string, protectedServer: Server;
let protectedReply: (request: IncomingMessage, response: ServerResponse) => void;

async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing synthetic HTTP listener.");
  return `http://127.0.0.1:${address.port}`;
}
function receiver(calls: typeof appCalls, reply: (request: IncomingMessage, response: ServerResponse) => void) {
  return createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      calls.push({ path: request.url!, body: Buffer.concat(chunks), headers: request.headers });
      reply(request, response);
    } catch { response.destroy(); }
  });
}
beforeEach(async () => {
  appCalls.length = 0; protectedCalls.length = 0;
  appOrigin = await listen(receiver(appCalls, (_request, response) => { response.writeHead(200, { "Cache-Control": "public, max-age=60" }); response.end("ordinary application"); }));
  protectedReply = (_request, response) => {
    response.writeHead(200, { "Content-Type": "application/pdf", "Cache-Control": "public, max-age=9999", "Content-Length": packet.length,
      "Set-Cookie": ["parent-access=synthetic; HttpOnly; SameSite=Lax", "parent-refresh=synthetic; HttpOnly; SameSite=Lax"] });
    response.end(packet);
  };
  protectedServer = receiver(protectedCalls, (request, response) => protectedReply(request, response));
  protectedOrigin = await listen(protectedServer);
  front = await listen(createLocalParentProtectedFrontdoor(appOrigin, protectedOrigin));
});
afterEach(async () => {
  for (const server of servers.splice(0).reverse()) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

function send(path: string, method = "GET", body?: Buffer, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: Buffer; headers: IncomingMessage["headers"] }>((resolve, reject) => {
    const target = new URL(front);
    const request = httpRequest({ hostname: target.hostname, port: target.port, path, method, agent: false,
      headers: { ...(body ? { "Content-Length": String(body.length) } : {}), ...headers } }, response => {
      const chunks: Buffer[] = [];
      response.on("data", chunk => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve({ status: response.statusCode!, body: Buffer.concat(chunks), headers: response.headers }));
      response.on("error", reject);
    });
    request.on("error", reject); request.end(body);
  });
}

describe("credential-free local protected frontdoor (actual HTTP servers; no Auth or provider)", () => {
  it("streams exact protected uploads directly without invoking the ordinary application", async () => {
    const response = await send("/protected/snap/capture?packet=synthetic", "PUT", packet, { Origin: front, "Content-Type": "application/pdf", Cookie: "caselink-parent-auth=synthetic",
      "X-Forwarded-Host": "untrusted.example", Forwarded: "host=untrusted.example" });
    expect(response.status).toBe(200); expect(response.body).toEqual(packet); expect(appCalls).toEqual([]);
    expect(protectedCalls).toHaveLength(1); expect(protectedCalls[0].body).toEqual(packet);
    expect(protectedCalls[0].path).toBe("/protected/snap/capture?packet=synthetic");
    expect(protectedCalls[0].headers.cookie).toBe("caselink-parent-auth=synthetic");
    expect(protectedCalls[0].headers.host).toBe(new URL(front).host);
    expect(protectedCalls[0].headers["x-forwarded-host"]).toBeUndefined(); expect(protectedCalls[0].headers.forwarded).toBeUndefined();
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["referrer-policy"]).toBe("no-referrer"); expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(response.headers["set-cookie"]).toHaveLength(2);
  });
  it("preserves ordinary application routing, bodies and caching", async () => {
    const response = await send("/api/parent/requests", "POST", Buffer.from('{"synthetic":true}'), { Origin: front, Cookie: "parent=synthetic" });
    expect(response.body.toString()).toBe("ordinary application"); expect(response.headers["cache-control"]).toBe("public, max-age=60");
    expect(protectedCalls).toEqual([]); expect(appCalls[0].body.toString()).toBe('{"synthetic":true}');
    expect(appCalls[0].headers.cookie).toBe("parent=synthetic");
  });
  it.each(["/protected", "/protected/other", "/Protected/snap/review", "/%70rotected/snap/review", "/x/../protected/snap/review", "/protected/snap/../other", "/protected/snap/%2e%2e/other", "/protected/snap/%252f", "/protected/snap/%zz", "/protected\\snap/review"])("rejects ambiguous/reserved path %s before either upstream", async path => {
    expect((await send(path)).status).toBe(400); expect(appCalls).toEqual([]); expect(protectedCalls).toEqual([]);
  });
  it.each(["origin", "host"])("rejects a foreign %s before forwarding", async field => {
    const headers: Record<string, string> = field === "origin" ? { Origin: "https://untrusted.example" } : { Origin: front, Host: "untrusted.example" };
    const response = await send("/protected/snap/capture", "PUT", packet, headers);
    expect([400, 403]).toContain(response.status); expect(appCalls).toEqual([]); expect(protectedCalls).toEqual([]);
  });
  it("requires same-origin mutation and bounded declared framing", async () => {
    const cases: Record<string, string>[] = [{}, { Origin: front, "Transfer-Encoding": "chunked" }, { Origin: front, "Content-Length": "10485761" }];
    for (const headers of cases) {
      expect((await send("/protected/snap/capture", "POST", undefined, headers)).status).toBe(400);
    }
    expect((await send("/protected/snap/review", "GET", packet)).status).toBe(400);
    expect((await send("/protected/snap/capture", "PATCH", packet, { Origin: front })).status).toBe(400);
    expect(appCalls).toEqual([]); expect(protectedCalls).toEqual([]);
  });
  it("does not fall back to the application or expose upstream failure text", async () => {
    protectedReply = (_request, response) => { response.writeHead(500); response.end("PRIVATE_UPSTREAM_ERROR_CANARY"); };
    const response = await send("/protected/snap/review");
    expect(response.status).toBe(503); expect(response.body.toString()).not.toContain("PRIVATE_UPSTREAM_ERROR_CANARY"); expect(appCalls).toEqual([]);
  });
  it("does not let a redirect resend a protected upload outside its service", async () => {
    protectedReply = (_request, response) => { response.writeHead(307, { Location: "https://untrusted.example/capture" }); response.end(); };
    const response = await send("/protected/snap/capture", "PUT", packet, { Origin: front });
    expect(response.status).toBe(503); expect(response.headers.location).toBeUndefined(); expect(appCalls).toEqual([]);
  });
  it("fails closed when the protected service is down", async () => {
    protectedServer.closeAllConnections(); await new Promise<void>(resolve => protectedServer.close(() => resolve()));
    expect((await send("/protected/snap/review")).status).toBe(503); expect(appCalls).toEqual([]);
  });
  it("rejects an oversized protected response before emitting its bytes", async () => {
    protectedReply = (_request, response) => { response.writeHead(200, { "Content-Length": "10485761" }); response.end(packet); };
    const response = await send("/protected/snap/review");
    expect(response.status).toBe(503); expect(response.body.includes(packet)).toBe(false); expect(appCalls).toEqual([]);
  });
  it("aborts an oversized chunked response without falling through to the app", async () => {
    protectedReply = (_request, response) => { response.writeHead(200, { "Transfer-Encoding": "chunked" }); response.end(Buffer.alloc(10485761)); };
    await expect(send("/protected/snap/review")).rejects.toThrow(); expect(appCalls).toEqual([]);
  });
  it("closes the protected upstream when its viewer disconnects", async () => {
    let closed!: () => void;
    const closure = new Promise<void>(resolve => { closed = resolve; });
    protectedReply = (_request, response) => { response.once("close", closed); response.writeHead(200); response.write(packet); };
    await new Promise<void>((resolve, reject) => {
      const request = httpRequest(`${front}/protected/snap/review`, { agent: false }, response => {
        response.once("data", () => { response.destroy(); resolve(); }); response.on("error", () => {});
      });
      request.on("error", reject); request.end();
    });
    await closure; expect(appCalls).toEqual([]);
  });
  it.each(["https://127.0.0.1:3319", "http://localhost:3319", "http://127.0.0.1:80", "http://127.0.0.1:3319/", "http://user:password@127.0.0.1:3319", "http://127.0.0.1:3319/protected"])("rejects an unsafe/ambiguous upstream %s", target => {
    expect(() => createLocalParentProtectedFrontdoor("http://127.0.0.1:3201", target)).toThrow();
  });
  it("requires separate upstream processes", () => {
    expect(() => createLocalParentProtectedFrontdoor("http://127.0.0.1:3201", "http://127.0.0.1:3201")).toThrow();
  });
});


describe("hosted origin through same-host ingress (loopback transport fixture, no TLS/Auth/provider)", () => {
  const publicOrigin = "https://pilot.example.test";
  it("keeps protected bytes out of Next and strips client forwarding overrides", async () => {
    front = await listen(createHostedParentProtectedFrontdoor(publicOrigin, appOrigin, protectedOrigin));
    const response = await send("/protected/snap/capture", "POST", packet, {
      Host: "pilot.example.test", Origin: publicOrigin, "Content-Type": "application/pdf",
      Forwarded: "host=attacker.example;proto=http", "X-Forwarded-Proto": "http", "X-Forwarded-Host": "attacker.example",
    });
    expect(response.status).toBe(200); expect(response.body).toEqual(packet); expect(appCalls).toEqual([]);
    expect(protectedCalls[0].headers.host).toBe("pilot.example.test");
    expect(protectedCalls[0].headers.origin).toBe(publicOrigin);
    expect(protectedCalls[0].headers.forwarded).toBeUndefined();
    expect(protectedCalls[0].headers["x-forwarded-proto"]).toBeUndefined();
    expect(protectedCalls[0].headers["x-forwarded-host"]).toBeUndefined();
    expect(response.headers["cache-control"]).toBe("private, no-store");
  });
  it.each([
    { Host: "pilot.example.test", Origin: "http://pilot.example.test" },
    { Host: "attacker.example", Origin: publicOrigin },
    { Host: "pilot.example.test", Origin: "https://other.example.test" },
  ])("rejects a wrong public host or mutation origin before either upstream: %j", async headers => {
    front = await listen(createHostedParentProtectedFrontdoor(publicOrigin, appOrigin, protectedOrigin));
    expect([400, 403]).toContain((await send("/protected/snap/capture", "POST", packet, headers)).status);
    expect(appCalls).toEqual([]); expect(protectedCalls).toEqual([]);
  });
  it("preserves ordinary app routing without forwarding protected bytes", async () => {
    front = await listen(createHostedParentProtectedFrontdoor(publicOrigin, appOrigin, protectedOrigin));
    expect((await send("/support", "GET", undefined, { Host: "pilot.example.test", "X-Forwarded-Proto": "http", "X-Forwarded-Host": "attacker.example" })).status).toBe(200);
    expect(appCalls).toHaveLength(1); expect(protectedCalls).toEqual([]);
    expect(appCalls[0].headers["x-forwarded-proto"]).toBe("https");
    expect(appCalls[0].headers["x-forwarded-host"]).toBe("pilot.example.test");
  });
  it.each(["http://pilot.example.test", "https://127.0.0.1", "https://[::1]", "https://localhost", "https://app.localhost",
    "https://pilot.example.test/", "https://pilot.example.test/path", "https://user:secret@pilot.example.test", "https://pilot.example.test?secret=value"])("rejects unsafe public origin %s", value => {
    expect(() => createHostedParentProtectedFrontdoor(value, appOrigin, protectedOrigin)).toThrow();
  });
});
