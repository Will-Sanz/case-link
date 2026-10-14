import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAiResponse } from "./client";
import { isAllowedOpenAiModelId } from "./model-allowlist";

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

describe("model request contracts", () => {
  it.each(["OPENAI_MODEL_OVERRIDE", "OPENAI_UI_MODEL", "OPENAI_PLAN_PHASE_MODEL"])("keeps Responses routing with %s", async (key) => {
    mocks.env[key] = "gpt-4o";
    await createAiResponse({ ...options, taskType: "plan_phase_generation", maxTokens: 30000 });
    expect(mocks.fetch.mock.calls[0][0]).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({ model: "gpt-4o", store: false, temperature: 0.4 });
    expect(body).not.toHaveProperty("reasoning");
    expect(body.max_output_tokens).toBeLessThanOrEqual(16384);
  });

  it.each(["fast", "thinking"] as const)("preserves the fast-only product policy for incoming %s mode", async (aiMode) => {
    await createAiResponse({ ...options, aiMode });
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toMatchObject({ model: "gpt-5.6-luna", reasoning: { effort: "low" } });
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).not.toHaveProperty("temperature");
  });

  it.each(["plan_phase_generation", "plan_refinement", "step_refinement", "case_assistant"] as const)("uses Responses for the active %s task", async (taskType) => {
    expect(await createAiResponse({ ...options, taskType })).toMatchObject({ ok: true });
    expect(mocks.fetch.mock.calls[0][0]).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(body).toHaveProperty("max_output_tokens");
    expect(body).toMatchObject({ store: false });
  });

  it.each(["gpt-5-fake", "gpt-4-turbo", "gpt-3.5-turbo", "o9-test", "gpt-4o-2024-05-13"])("rejects untested or incompatible model %s", async (model) => {
    expect(isAllowedOpenAiModelId(model)).toBe(false);
    mocks.env.OPENAI_MODEL_OVERRIDE = model;
    expect(await createAiResponse(options)).toMatchObject({ ok: false });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

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

  it("rejects obsolete chat-completion-shaped output", async () => {
    mocks.fetch.mockResolvedValue(Response.json({ choices: [{ finish_reason: "stop", message: { content: "Hello." } }] }));
    expect(await createAiResponse(options)).toMatchObject({ ok: false, code: "invalid_response" });
  });
});

describe("budget preflight and recovery messages", () => {
  it.each(["plan_phase_generation", "plan_refinement", "step_refinement", "case_assistant"] as const)("blocks private input for %s before billing or network access", async taskType => {
    const log = vi.spyOn(console,"info").mockImplementation(()=>{});
    mocks.env.OPENAI_DEBUG = "1"; mocks.env.OPENAI_PAYLOAD_DEBUG = "1";
    const result = await createAiResponse({...options,taskType,input:"Call private-person@example.test"});
    expect(result).toMatchObject({ok:false,code:"privacy_blocked"});
    expect(JSON.stringify(result)).not.toContain("private-person@example.test");
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-person@example.test");
    expect(mocks.budget).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled();
    log.mockRestore();
  });
  it.each(["instructions","system history","user history","assistant history","schema","encoded plan"])("checks the actual %s without a trust exemption", async location => {
    const request = {...options, input:options.input as string | import("./client").ChatMessage[]};
    if (location === "instructions") request.instructions = "Student ID: AB1234";
    else if (location.endsWith("history")) request.input = [{role:location.split(" ")[0] as "system" | "user" | "assistant",content:"Call 215-555-0199"}];
    else if (location === "encoded plan") request.input = JSON.stringify({steps:[{workflow_data:{outreach_result:"Email family@example.test"}}]});
    const result = await createAiResponse({...request,...(location === "schema" ? {structuredJsonSchema:{name:"example",strict:true as const,schema:{type:"object",description:"Contact family@example.test"}}} : {})});
    expect(result).toMatchObject({ok:false,code:"privacy_blocked"});
    expect(mocks.budget).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("sends the inspected immutable payload even if a caller changes its objects while waiting for budget", async () => {
    const request = {...options,input:[{role:"user" as const,content:"Discuss intake options."}]};
    mocks.budget.mockImplementation(async()=>{request.input[0].content="Email private-person@example.test";return {allowed:true};});
    expect(await createAiResponse(request)).toMatchObject({ok:true});
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).input).toEqual([{role:"user",content:"Discuss intake options."}]);
  });
  it.each(["oversized", "invalid model", "invalid output size"])("rejects %s without spending a request allowance", async kind => {
    const input = { ...options };
    if (kind === "oversized") input.input = "x".repeat(120_001);
    if (kind === "invalid model") mocks.env.OPENAI_MODEL_OVERRIDE = "unsupported-model";
    expect(await createAiResponse({ ...input, ...(kind === "invalid output size" ? { maxTokens: -1 } : {}) })).toMatchObject({ ok: false });
    expect(mocks.budget).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it.each([
    ["operation", 480, "8 minutes"], ["user_hour", 3300, "55 minutes"], ["deployment_day", 7200, "2 hours"], ["disabled", 3600, "turned off"], ["control_unavailable", 60, "could not be checked"],
  ] as const)("preserves %s recovery without making a provider request", async (reason, retryAfter, message) => {
    mocks.budget.mockResolvedValue({ allowed: false, reason, retryAfter });
    expect(await createAiResponse(options)).toMatchObject({ ok: false, code: "rate_limited", retryAfter, error: expect.stringContaining(message) });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
