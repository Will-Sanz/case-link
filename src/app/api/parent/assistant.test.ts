import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}));
vi.mock("@/lib/parent/auth", () => ({ requireParentSession: mocks.session }));
import { GET, POST, DELETE } from "./requests/[id]/assistant/route";
const id = randomUUID(),
  messageId = randomUUID(),
  context = { params: Promise.resolve({ id }) };
const request = (
  body: unknown,
  method = "POST",
  origin = "https://app.example.test",
) =>
  new Request(`https://app.example.test/api/parent/requests/${id}/assistant`, {
    method,
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.example.test");
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({
    supabase: { rpc: mocks.rpc, from: mocks.from },
    user: { id: randomUUID() },
  });
  mocks.from.mockImplementation((table: string) => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({ data: { id }, error: null })),
      limit: vi.fn(async () => ({
        data:
          table === "parent_assistant_messages"
            ? [
                {
                  id: messageId,
                  question: "Latest question",
                  status: "answered",
                  answer: null,
                  error: null,
                  created_at: "2026-10-26T14:00:00Z",
                  updated_at: "2026-10-26T14:00:00Z",
                },
                {
                  id: randomUUID(),
                  question: "Earlier question",
                  status: "answered",
                  answer: null,
                  error: null,
                  created_at: "2026-10-26T13:00:00Z",
                  updated_at: "2026-10-26T13:00:00Z",
                },
              ]
            : [],
        error: null,
      })),
    };
    return query;
  });
  mocks.rpc.mockImplementation(async (name: string) => ({
    data:
      name === "parent_assistant_available"
        ? true
        : name === "parent_ask_assistant"
          ? messageId
          : null,
    error: null,
  }));
});
afterEach(() => vi.unstubAllEnvs());
describe("parent assistant HTTP flow", () => {
  it("returns private, chronological history and actual runtime availability", async () => {
    const response = await GET(
        new Request("https://app.example.test"),
        context,
      ),
      body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.available).toBe(true);
    expect(body.messages.map((m: { question: string }) => m.question)).toEqual([
      "Earlier question",
      "Latest question",
    ]);
    expect(mocks.rpc).toHaveBeenCalledWith("parent_assistant_available", {
      p_request_id: id,
    });
  });
  it("requires explicit consent and blocks identifiers before the database enqueue", async () => {
    for (const body of [
      { question: "What now?", idempotencyKey: randomUUID(), consented: false },
      {
        question: "SSN: 123456789",
        idempotencyKey: randomUUID(),
        consented: true,
      },
    ]) {
      const response = await POST(request(body), context);
      expect(response.status).toBe(400);
      expect(JSON.stringify(await response.json())).not.toContain("123456789");
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("queues one real worker turn and never calls a model from the web route", async () => {
    const body = {
      question: "What happens next?",
      idempotencyKey: randomUUID(),
      consented: true,
    };
    const response = await POST(request(body), context);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true, id: messageId });
    expect(mocks.rpc).toHaveBeenCalledWith("parent_ask_assistant", {
      p_request_id: id,
      p_question: body.question,
      p_idempotency_key: body.idempotencyKey,
      p_consented: true,
    });
  });
  it("reports offline and budget states without a fabricated answer", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "assistant_unavailable" },
    });
    const response = await POST(
      request({
        question: "What now?",
        idempotencyKey: randomUUID(),
        consented: true,
      }),
      context,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: expect.stringContaining("not currently connected"),
    });
  });
  it("requires same-origin request access for sending or withdrawing consent", async () => {
    expect(
      (await POST(request({}, "POST", "https://attacker.invalid"), context))
        .status,
    ).toBe(403);
    expect(
      (
        await DELETE(
          request({ messageId }, "DELETE", "https://attacker.invalid"),
          context,
        )
      ).status,
    ).toBe(403);
    expect(mocks.session).not.toHaveBeenCalled();
    expect(
      (await DELETE(request({ messageId }, "DELETE"), context)).status,
    ).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("parent_cancel_assistant", {
      p_request_id: id,
      p_message_id: messageId,
    });
  });
});
