import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  parentError,
  readBoundedBody,
  readParentJson,
  requireSameOrigin,
} from "./http";
beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SITE_URL", undefined));
afterEach(() => vi.unstubAllEnvs());
describe("parent HTTP trust boundary", () => {
  it("records unexpected failures without private error details, even in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = parentError(new Error("private-family-bill-canary"));
    expect(response.status).toBe(500);
    const payload = JSON.parse(logger.mock.calls[0][0]);
    expect(payload).toMatchObject({
      event: "server.error",
      scope: "parentApi",
    });
    expect(payload.fingerprint).toMatch(/^[a-f0-9]{16}$/);
    expect(payload).not.toHaveProperty("message");
    expect(payload).not.toHaveProperty("stack");
    expect(JSON.stringify(logger.mock.calls)).not.toContain(
      "private-family-bill-canary",
    );
    expect(await response.text()).not.toContain("private-family-bill-canary");
    parentError(new Error("parent_invalid_input"));
    expect(logger).toHaveBeenCalledTimes(1);
  });
  it("uses the configured public origin when Next routes use an internal origin", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://127.0.0.1:3200");
    expect(() =>
      requireSameOrigin(
        new Request("http://localhost:3200/api/parent/auth", {
          headers: { origin: "http://127.0.0.1:3200" },
        }),
      ),
    ).not.toThrow();
    for (const origin of [
      "http://localhost:3200",
      "http://127.0.0.1:3201",
      "null",
      "https://attacker.test",
    ]) {
      expect(() =>
        requireSameOrigin(
          new Request("http://localhost:3200/api/parent/auth", {
            headers: {
              origin,
              host: "attacker.test",
              "x-forwarded-host": "attacker.test",
            },
          }),
        ),
      ).toThrow("parent_origin_denied");
    }
  });
  it("fails closed on malformed configured origins rather than trusting request hosts", () => {
    for (const site of [
      "",
      "https://user:password@parents.example",
      "https://parents.example/path",
    ]) {
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", site);
      expect(() =>
        requireSameOrigin(
          new Request("https://parents.example/api/parent/auth", {
            headers: { origin: "https://parents.example" },
          }),
        ),
      ).toThrow("parent_origin_denied");
    }
  });
  it("rejects cross-origin and missing-origin cookie mutations", () => {
    expect(() =>
      requireSameOrigin(
        new Request("https://app.example/api/parent/requests", {
          headers: { origin: "https://evil.example" },
        }),
      ),
    ).toThrow();
    expect(() =>
      requireSameOrigin(new Request("https://app.example/api/parent/requests")),
    ).toThrow();
    expect(() =>
      requireSameOrigin(
        new Request("https://app.example/api/parent/requests", {
          headers: { origin: "https://app.example" },
        }),
      ),
    ).not.toThrow();
  });
  it("bounds streamed bytes even with no length header", async () => {
    const body = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(5));
        c.enqueue(new Uint8Array(8));
        c.close();
      },
    });
    const request = new Request("https://app.example", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit);
    await expect(readBoundedBody(request, 10)).rejects.toThrow(
      "parent_invalid_input",
    );
    expect(
      await readParentJson(
        new Request("https://app.example", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: '{"ok":true}',
        }),
      ),
    ).toEqual({ ok: true });
  });
  it("keeps the ordinary JSON bound while allowing the bounded SNAP envelope", async () => {
    const input = { value: "a".repeat(41000) };
    const request = () => new Request("https://app.example", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    await expect(readParentJson(request())).rejects.toThrow("parent_invalid_input");
    expect(await readParentJson(request(), 65536)).toEqual(input);
    const oversized = new Request("https://app.example", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: "a".repeat(65536) }) });
    await expect(readParentJson(oversized, 65536)).rejects.toThrow("parent_invalid_input");
  });
});
