import { describe, expect, it } from "vitest";
import { MODELS, modelSupportsReasoningEffort } from "@/lib/ai/models";

describe("AI model defaults", () => {
  it("uses GPT-5.6 Luna for planning and product helpers", () => {
    expect(MODELS).toEqual({
      PLAN_GENERATION: "gpt-5.6-luna",
      CHAT_UI_EDITS: "gpt-5.6-luna",
    });
  });

  it("recognizes GPT-5.6 family reasoning controls", () => {
    expect(modelSupportsReasoningEffort("gpt-5.6-luna")).toBe(true);
    expect(modelSupportsReasoningEffort("gpt-5.6-terra")).toBe(true);
    expect(modelSupportsReasoningEffort("gpt-5.6-sol")).toBe(true);
    expect(modelSupportsReasoningEffort("gpt-4.1-mini")).toBe(false);
  });
});
