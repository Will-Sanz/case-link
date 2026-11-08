import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/rate-limit/ai-rate-limit", () => ({ consumeOpenAiRateSlot: async () => ({ allowed: true, retryAfter: 0 }) }));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); });
function environment() {
  vi.stubEnv("VERCEL_ENV", "development"); vi.stubEnv("CASELINK_ENVIRONMENT", "test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "synthetic-public");
  for (const name of ["OPENAI_MODEL_OVERRIDE", "OPENAI_PLAN_MODEL", "OPENAI_PLAN_PHASE_MODEL", "OPENAI_PLAN_PHASE_THINKING_MODEL", "OPENAI_THINKING_UI_MODEL", "OPENAI_UI_MODEL"]) vi.stubEnv(name, "");
}
it("requires a restarted application to adopt a rotated key and safely rejects the revoked key", async () => {
  environment(); vi.resetModules();
  const oldKey = "synthetic-old-credential", newKey = "synthetic-new-credential";
  vi.stubEnv("OPENAI_API_KEY", oldKey);
  let acceptedKey = oldKey;
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => init.headers.Authorization === `Bearer ${acceptedKey}`
    ? Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "Draft a next step for review." }] }] })
    : new Response("Rejected credential details must not be returned", { status: 401 })));
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const options = { taskType: "case_assistant" as const, input: "Review a synthetic plan", instructions: "Prepare a draft", requestMeta: { route: "syntheticRotation" } };
  const original = await import("@/lib/ai/client");
  expect(await original.createAiResponse(options)).toMatchObject({ ok: true });
  acceptedKey = newKey; vi.stubEnv("OPENAI_API_KEY", newKey);
  const revoked = await original.createAiResponse(options);
  expect(revoked).toMatchObject({ ok: false, code: "provider_error" });
  expect(JSON.stringify(revoked)).not.toMatch(/synthetic-old-credential|synthetic-new-credential|Rejected credential/);
  vi.resetModules();
  expect(await (await import("@/lib/ai/client")).createAiResponse(options)).toMatchObject({ ok: true });
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/synthetic-old-credential|synthetic-new-credential/);
});
it("does not echo a misplaced credential in model configuration errors", async () => {
  environment(); vi.resetModules(); vi.stubEnv("OPENAI_MODEL_OVERRIDE", "synthetic-secret-misplaced-in-model");
  const { getEnv } = await import("@/lib/env");
  expect(getEnv).toThrow(/Invalid OPENAI_MODEL_OVERRIDE/);
  try { getEnv(); } catch (error) { expect(String(error)).not.toContain("synthetic-secret-misplaced-in-model"); }
});
