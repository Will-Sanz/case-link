import { describe, it, expect } from "vitest";
import { readBoundedBody, readParentJson, requireSameOrigin } from "./http";
describe("parent HTTP trust boundary", () => {
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
});
