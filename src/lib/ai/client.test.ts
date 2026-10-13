import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAiResponse } from "./client";

const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown>, budget: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/env", () => ({ getEnv: () => mocks.env }));
vi.mock("@/lib/rate-limit/ai-rate-limit", () => ({ consumeOpenAiRateSlot: mocks.budget }));

const options = { taskType: "case_assistant" as const, instructions: "Use supplied facts.", input: "Suggest an intake step." };
function completed(text = "Arrange an intake.") {
  return { status: "completed", output: [{ type: "message", status: "completed", content: [{ type: "output_text", text }] }] };
}

beforeEach(() => {
  mocks.env = { OPENAI_API_KEY: "synthetic-test-key" };
  mocks.budget.mockResolvedValue({ allowed: true });
  mocks.fetch.mockResolvedValue(Response.json(completed()));
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe("AI terminal results", () => {
  it("accepts completed text and disables provider response storage", async () => {
    expect(await createAiResponse(options)).toMatchObject({ ok: true, text: "Arrange an intake." });
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toMatchObject({ store: false });
  });

  it.each(["incomplete", "failed", "cancelled", "queued", "in_progress"])("rejects %s even when partial prose exists", async (status) => {
    mocks.fetch.mockResolvedValue(Response.json({ ...completed("Partial answer"), status, incomplete_details: { reason: "max_output_tokens" } }));
    const result = await createAiResponse(options);
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("text");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects refusals even when another part contains usable-looking text", async () => {
    const body = completed();
    body.output[0].content.push({ type: "refusal", text: "Sensitive provider explanation" });
    mocks.fetch.mockResolvedValue(Response.json(body));
    expect(await createAiResponse(options)).toMatchObject({ ok: false, code: "refused" });
  });

  it.each([null, {}, { output: [] }, { status: "completed", output: null }, completed(" "), { ...completed(), error: { message: "private content" } }])("rejects empty, malformed, and contradictory results", async (body) => {
    mocks.fetch.mockResolvedValue(Response.json(body));
    expect(await createAiResponse(options)).toMatchObject({ ok: false });
  });

  it("rejects a partially emitted message even under a completed response", async () => {
    const body = completed();
    body.output[0].status = "incomplete";
    mocks.fetch.mockResolvedValue(Response.json(body));
    expect(await createAiResponse(options)).toMatchObject({ ok: false, code: "incomplete" });
  });

  it("preserves a safe rate-limit reason and Retry-After without exposing the response body", async () => {
    mocks.fetch.mockResolvedValue(new Response("private provider content", { status: 429, headers: { "Retry-After": "120" } }));
    expect(await createAiResponse(options)).toMatchObject({ ok: false, code: "rate_limited", retryAfter: 120 });
    expect(JSON.stringify(await createAiResponse(options))).not.toContain("private provider content");
  });

  it.each([400, 401, 500, 503])("handles HTTP %s without an automatic retry", async (status) => {
    mocks.fetch.mockResolvedValue(new Response("private provider content", { status }));
    expect(await createAiResponse(options)).toMatchObject({ ok: false, code: "provider_error" });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([new DOMException("abort", "AbortError"), new DOMException("timeout", "TimeoutError")])("handles request cancellation and timeouts", async (error) => {
    mocks.fetch.mockRejectedValue(error);
    expect(await createAiResponse(options)).toMatchObject({ ok: false, code: "timeout" });
  });

  it("handles network failures and malformed JSON", async () => {
    mocks.fetch.mockRejectedValueOnce(new TypeError("network failed"));
    expect(await createAiResponse(options)).toMatchObject({ ok: false, code: "network_error" });
    mocks.fetch.mockResolvedValueOnce(new Response("invalid json"));
    expect(await createAiResponse(options)).toMatchObject({ ok: false, code: "invalid_response" });
  });

  it.each(["length", "content_filter", "tool_calls", null])("rejects unfinished legacy helper output: %s", async (finish_reason) => {
    mocks.fetch.mockResolvedValue(Response.json({ choices: [{ finish_reason, message: { content: "Partial text" } }] }));
    expect(await createAiResponse({ ...options, taskType: "call_script" })).toMatchObject({ ok: false });
  });

  it("accepts only a finished, non-refused helper response", async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ choices: [{ finish_reason: "stop", message: { content: "Hello." } }] }));
    expect(await createAiResponse({ ...options, taskType: "call_script" })).toMatchObject({ ok: true, text: "Hello." });
    mocks.fetch.mockResolvedValueOnce(Response.json({ choices: [{ finish_reason: "stop", message: { content: "Hello.", refusal: "Refused" } }] }));
    expect(await createAiResponse({ ...options, taskType: "call_script" })).toMatchObject({ ok: false, code: "refused" });
  });
});
