import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureRequest, fixtureMandate } from "@/lib/parent/test-fixtures";
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  control: vi.fn(),
  correct: vi.fn(),
  resolve: vi.fn(),
  fact: vi.fn(),
  mandate: vi.fn(),
  booking: vi.fn(),
}));
vi.mock("@/lib/parent/data", () => ({
  getSupportRequest: mocks.get,
  controlSupportRequest: mocks.control,
  correctSupportRequest: mocks.correct,
  resolveParentAction: mocks.resolve,
}));
vi.mock("@/lib/parent/mutations", () => ({
  answerParentFact: mocks.fact,
  replaceParentMandate: mocks.mandate,
  updateParentBooking: mocks.booking,
}));
import { POST } from "./requests/[id]/route";
const id = fixtureRequest().id,
  context = { params: Promise.resolve({ id }) };
const request = (body: unknown, origin = "https://app.example.test") =>
  new Request(`https://app.example.test/api/parent/requests/${id}`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.example.test");
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(fixtureRequest());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
describe("versioned parent actions", () => {
  it("passes one typed source fact and rejects account secrets or invalid dates before mutation", async () => {
    const body = {
      action: "answer_fact",
      need: "electricity",
      field: "amountDue",
      value: 0,
      version: 2,
    };
    expect((await POST(request(body), context)).status).toBe(200);
    expect(mocks.fact).toHaveBeenCalledWith(id, {
      need: "electricity",
      field: "amountDue",
      value: 0,
      version: 2,
    });
    expect(
      (
        await POST(
          request({ ...body, field: "dueDate", value: "2026-02-30" }),
          context,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          request({ ...body, field: "password", value: "secret" }),
          context,
        )
      ).status,
    ).toBe(400);
    expect(mocks.fact).toHaveBeenCalledTimes(1);
  });
  it("requires exact renewed scope and same-origin access; concurrent corrections stay safe", async () => {
    const body = {
      action: "replace_mandate",
      mandate: fixtureMandate(),
      version: 2,
    };
    expect(
      (await POST(request(body, "https://evil.example.test"), context)).status,
    ).toBe(403);
    expect(mocks.mandate).not.toHaveBeenCalled();
    mocks.mandate.mockRejectedValueOnce(
      new Error("This request changed. Reload it before saving your update."),
    );
    expect((await POST(request(body), context)).status).toBe(409);
    expect(mocks.mandate).toHaveBeenCalledWith(id, body.mandate, 2);
  });
});
