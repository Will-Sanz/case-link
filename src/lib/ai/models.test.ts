import { beforeEach, describe, expect, it, vi } from "vitest";
import { getModelForTask, getReasoningEffortForTask, getDefaultMaxTokensForTask, modelSupportsReasoningEffort } from "@/lib/ai/models";

const state = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("@/lib/env", () => ({ getEnv: () => state.env }));
beforeEach(() => { state.env = {}; });

describe("AI model defaults", () => {
  it.each([
    ["plan_generation", "gpt-6.1-sol", "medium", 16384],
    ["plan_phase_generation", "gpt-6.1-sol", "medium", 16384],
    ["plan_refinement", "gpt-6.1-sol", "medium", 8192],
    ["case_assistant", "gpt-6.1-sol", "medium", 8192],
    ["step_refinement", "gpt-6-luna", "low", 4096],
  ] as const)("routes %s independently of the legacy client mode", (task, model, effort, cap) => {
    expect(getModelForTask(task, "fast")).toBe(model);
    expect(getReasoningEffortForTask(task)).toBe(effort);
    expect(getDefaultMaxTokensForTask(task)).toBe(cap);
  });

  it("preserves global/legacy model overrides and prefers explicit task configuration", () => {
    state.env = { OPENAI_UI_MODEL: "gpt-4o", OPENAI_PLAN_PHASE_MODEL: "gpt-5.6-luna" };
    expect(getModelForTask("plan_generation", "fast")).toBe("gpt-5.6-luna");
    expect(getModelForTask("case_assistant", "fast")).toBe("gpt-4o");
    Object.assign(state.env, { OPENAI_CASE_ASSISTANT_MODEL: "gpt-6-astra", OPENAI_CASE_ASSISTANT_REASONING_EFFORT: "high", OPENAI_CASE_ASSISTANT_MAX_OUTPUT_TOKENS: 12000 });
    expect(getModelForTask("case_assistant", "fast")).toBe("gpt-6-astra");
    expect(getReasoningEffortForTask("case_assistant")).toBe("high");
    expect(getDefaultMaxTokensForTask("case_assistant")).toBe(12000);
    state.env.OPENAI_MODEL_OVERRIDE = "gpt-5.6-luna";
    expect(getModelForTask("case_assistant", "fast")).toBe("gpt-5.6-luna");
  });

  it("preserves collisions between legacy planning overrides until a new task override is set", () => {
    state.env = { OPENAI_PLAN_MODEL: "gpt-4o", OPENAI_PLAN_PHASE_MODEL: "gpt-5.6-luna", OPENAI_PLAN_PHASE_THINKING_MODEL: "gpt-6.1-sol" };
    expect(getModelForTask("plan_generation", "fast")).toBe("gpt-5.6-luna");
    expect(getModelForTask("plan_phase_generation", "thinking")).toBe("gpt-6.1-sol");
    expect(getModelForTask("case_assistant", "thinking")).toBe("gpt-4o");
    state.env.OPENAI_PLAN_GENERATION_MODEL = "gpt-6-astra";
    expect(getModelForTask("plan_generation", "fast")).toBe("gpt-6-astra");
  });

  it("recognizes reasoning controls only for supported model contracts", () => {
    expect(modelSupportsReasoningEffort("gpt-5.6-luna")).toBe(true);
    expect(modelSupportsReasoningEffort("gpt-6-astra")).toBe(true);
    expect(modelSupportsReasoningEffort("gpt-5.6-terra")).toBe(false);
    expect(modelSupportsReasoningEffort("gpt-5.6-sol")).toBe(false);
    expect(modelSupportsReasoningEffort("gpt-4.1-mini")).toBe(false);
  });
});
