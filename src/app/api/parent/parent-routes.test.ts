import { beforeEach, describe, it, expect, vi } from "vitest";
import {
  fixtureIntake,
  fixtureMandate,
  fixtureRequest,
} from "@/lib/parent/test-fixtures";
const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
}));
vi.mock("@/lib/parent/data", () => ({
  startSupportRequest: mocks.start,
  getSupportRequest: mocks.get,
  listSupportRequests: mocks.list,
}));
import { GET, POST } from "./requests/route";
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-25T16:00:00Z"));
  mocks.start.mockResolvedValue(fixtureRequest().id);
  mocks.get.mockResolvedValue(fixtureRequest());
});
function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://app.example/api/parent/requests", {
    method: "POST",
    headers: {
      origin: "https://app.example",
      "Content-Type": "application/json",
      "Idempotency-Key": "5a8192ad-cd83-4f49-a8ee-e3b83874e111",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
describe("parent request route", () => {
  it("requires exact intake, named scope, origin and stable idempotency", async () => {
    const intake = fixtureIntake(),
      mandate = fixtureMandate();
    expect((await POST(post({ intake, mandate }))).status).toBe(201);
    expect(mocks.start).toHaveBeenCalledWith(
      intake,
      mandate,
      "5a8192ad-cd83-4f49-a8ee-e3b83874e111",
    );
    expect(
      (
        await POST(
          post({ intake, mandate }, { origin: "https://evil.example" }),
        )
      ).status,
    ).toBe(403);
    expect(
      (await POST(post({ intake, mandate }, { "Idempotency-Key": "" }))).status,
    ).toBe(400);
    expect(
      (
        await POST(
          post({
            intake,
            mandate: { ...mandate, recipientIds: ["unexpected"] },
          }),
        )
      ).status,
    ).toBe(400);
  });
  it("keeps account failures private and never caches household responses", async () => {
    mocks.list.mockRejectedValue(new Error("Authentication required"));
    const denied = await GET();
    expect(denied.status).toBe(401);
    expect(denied.headers.get("Cache-Control")).toContain("no-store");
  });
});
