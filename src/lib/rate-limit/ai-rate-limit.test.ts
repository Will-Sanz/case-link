import { beforeEach, expect, it, vi } from "vitest";
import { consumeOpenAiRateSlot } from "./ai-rate-limit";
import { aiBudgetMessage } from "./ai-budget-message";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/logger/server-error", () => ({ logServerError: vi.fn() }));
beforeEach(() => { mocks.rpc.mockReset().mockResolvedValue({ data: { allowed: true, retryAfter: 0 } }); });
it.each([
  ["plan_generation", "plan_phase", 2], ["plan_phase_generation", "plan_phase", 2], ["plan_refinement", "plan", 2], ["step_refinement", "plan", 2], ["case_assistant", "chat", 1],
] as const)("meters the active %s task using the shared counter", async (task, operation, weight) => {
  expect(await consumeOpenAiRateSlot(task)).toEqual({ allowed: true, retryAfter: 0 });
  expect(mocks.rpc).toHaveBeenCalledWith("consume_ai_budget", { p_operation: operation, p_weight: weight });
});
it.each([null, {}, { allowed: false }, { allowed: false, retryAfter: -1, reason: "operation" }, { allowed: false, retryAfter: 60, reason: "private debug" }, { allowed: true, retryAfter: 5 }])("fails closed for malformed budget controls %#", async data => {
  mocks.rpc.mockResolvedValue({ data });
  expect(await consumeOpenAiRateSlot("case_assistant")).toEqual({ allowed: false, retryAfter: 60, reason: "control_unavailable" });
});
it("fails closed on an unavailable database, including local development", async () => {
  mocks.rpc.mockRejectedValue(new Error("offline"));
  expect(await consumeOpenAiRateSlot("case_assistant")).toMatchObject({ allowed: false, reason: "control_unavailable" });
});
it.each([
  ["operation", 420, "7 minutes"], ["user_hour", 2400, "40 minutes"], ["deployment_day", 7200, "2 hours"], ["operation", 30, "30 seconds"], ["user_hour", 3601, "1 hour 1 minute"], ["control_unavailable", 60, "could not be checked"],
] as const)("explains the %s limit with its actual retry period", async (reason, retryAfter, message) => {
  mocks.rpc.mockResolvedValue({ data: { allowed: false, reason, retryAfter } });
  const result = await consumeOpenAiRateSlot("case_assistant");
  expect(result).toEqual({ allowed: false, reason, retryAfter });
  expect(aiBudgetMessage(result)).toContain(message);
});
it("explains disabled AI without promising a scheduled recovery", () => {
  const message = aiBudgetMessage({ reason: "disabled", retryAfter: 3600 });
  expect(message).toContain("temporarily turned off");
  expect(message).not.toContain("Try again in");
});
