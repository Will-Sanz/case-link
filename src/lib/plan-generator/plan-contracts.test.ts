import { beforeEach, describe, expect, it, vi } from "vitest";
import { generatedPlanStep, refinedPlanStep } from "../../../tests/fixtures/plan-contract";
import { buildLeanPhaseRootJsonSchema, planPhaseResponseSchema, leanActionItemZ, sparseDetailsForPersistence } from "./lean-plan-schema";
import { OPENAI_PLAN_REFINE_STEPS_ROOT_SCHEMA, planRefineLeanResponseSchema } from "./plan-refine-lean";
import { tryGenerateLeanPlanPhaseOpenAI } from "./openai-plan-lean-phase";
import { updatePlanStepActionItemSchema } from "@/lib/validations/plans";
import { createAiResponse } from "@/lib/ai/client";
import type { PlanGenerationSnapshot } from "@/types/family";

vi.mock("@/lib/ai/client", () => ({ createAiResponse: vi.fn() }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({}) }));
const snapshot: PlanGenerationSnapshot = { family_id: "synthetic", captured_at: "2026-10-13T12:00:00Z", revision: "a".repeat(64), brief: "Synthetic context", resources: "None", resource_catalog: [] };

describe("plan output contracts", () => {
  beforeEach(() => vi.mocked(createAiResponse).mockReset());

  it.each(["30", "60", "90"] as const)("enforces the same complete phase %s contract in the provider and parser", async phase => {
    const step = { ...generatedPlanStep, phase };
    vi.mocked(createAiResponse).mockResolvedValue({ ok: true, model: "test", text: JSON.stringify({ steps: [step] }) });
    expect(await tryGenerateLeanPlanPhaseOpenAI(snapshot, phase, { retries: 1 })).toMatchObject({ ok: true, steps: [step] });
    expect(vi.mocked(createAiResponse).mock.calls[0][0].structuredJsonSchema).toEqual({ name: `lean_plan_phase_${phase}`, schema: buildLeanPhaseRootJsonSchema(phase), strict: true });
    expect(sparseDetailsForPersistence(step)).toMatchObject({ owner: "case_manager", stage_goal: step.goal, required_documents: [], contacts: [] });
  });

  it.each(["missing", "extra", "impossible date", "null date", "wrong phase", "empty title", "unknown contact field"])("rejects %s before generation can be persisted", async kind => {
    const step: Record<string, unknown> = structuredClone(generatedPlanStep);
    if (kind === "missing") delete step.timing;
    if (kind === "extra") step.automatic_submission = true;
    if (kind === "wrong phase") step.phase = "60";
    if (kind === "empty title") step.title = "   ";
    if (kind === "impossible date" || kind === "null date") step.action_items = [{ ...generatedPlanStep.action_items[0], target_date: kind === "null date" ? null : "2026-02-30" }];
    if (kind === "unknown contact field") step.contacts = [{ name: "Intake desk", phone: null, email: null, notes: null, trusted: true }];
    vi.mocked(createAiResponse).mockResolvedValue({ ok: true, model: "test", text: JSON.stringify({ steps: [step] }) });
    expect(await tryGenerateLeanPlanPhaseOpenAI(snapshot, "30", { retries: 1 })).toMatchObject({ ok: false });
  });

  it("rejects out-of-window dates and only accepts a corrected provider response", async () => {
    const invalid = { ...generatedPlanStep, action_items: [{ ...generatedPlanStep.action_items[0], target_date: "2027-01-15" }] };
    vi.mocked(createAiResponse).mockResolvedValueOnce({ ok: true, model: "test", text: JSON.stringify({ steps: [invalid] }) })
      .mockResolvedValueOnce({ ok: true, model: "test", text: JSON.stringify({ steps: [generatedPlanStep] }) });
    expect(await tryGenerateLeanPlanPhaseOpenAI(snapshot, "30", { retries: 2 })).toMatchObject({ ok: true });
    expect(vi.mocked(createAiResponse).mock.calls[1][0].input).toContain("between 2026-10-13 and 2027-01-11");
    vi.mocked(createAiResponse).mockResolvedValue({ ok: true, model: "test", text: JSON.stringify({ steps: [{ ...invalid, action_items: [{ ...invalid.action_items[0], target_date: "2026-10-12" }] }] }) });
    expect(await tryGenerateLeanPlanPhaseOpenAI(snapshot, "30", { retries: 1 })).toMatchObject({ ok: false });
  });

  it("requires all refinement fields, rejects progress fields, and preserves explicit null lists", () => {
    expect(planRefineLeanResponseSchema.parse({ steps: [refinedPlanStep] }).steps[0].resource_ids).toBeNull();
    const missing = { ...refinedPlanStep } as Record<string, unknown>;
    delete missing.priority;
    for (const step of [missing, { ...refinedPlanStep, owner: "family" }, { ...refinedPlanStep, action_items: [{ ...refinedPlanStep.action_items[0], status: "completed" }] }]) {
      expect(planRefineLeanResponseSchema.safeParse({ steps: [step] }).success).toBe(false);
    }
    expect(OPENAI_PLAN_REFINE_STEPS_ROOT_SCHEMA).toMatchObject({ additionalProperties: false, required: ["steps"] });
  });

  it("keeps task text, week, count, and calendar boundaries aligned with manual editing", () => {
    const action = { ...generatedPlanStep.action_items[0], title: "x".repeat(500), description: "x".repeat(4000), week_index: 52, target_date: "2028-02-29" };
    const manual = (value: unknown) => updatePlanStepActionItemSchema.safeParse({ ...(value as object), familyId: "20000000-0000-4000-8000-000000000002", actionItemId: refinedPlanStep.action_items[0].id });
    expect(leanActionItemZ.safeParse(action).success).toBe(true);
    expect(manual(action).success).toBe(true);
    for (const patch of [{ title: "x".repeat(501) }, { title: " " }, { description: "x".repeat(4001) }, { week_index: 53 }, { target_date: "2027-02-29" }]) {
      expect(leanActionItemZ.safeParse({ ...action, ...patch }).success).toBe(false);
      expect(manual({ ...action, ...patch }).success).toBe(false);
    }
    expect(planPhaseResponseSchema("30").safeParse({ steps: [{ ...generatedPlanStep, action_items: Array(20).fill(action) }] }).success).toBe(true);
    expect(planPhaseResponseSchema("30").safeParse({ steps: [{ ...generatedPlanStep, action_items: Array(21).fill(action) }] }).success).toBe(false);
    expect(planPhaseResponseSchema("30").safeParse({ steps: [] }).success).toBe(false);
    expect(planPhaseResponseSchema("30").safeParse({ steps: Array(6).fill(generatedPlanStep) }).success).toBe(false);
  });

  it("does not retry provider schema rejection as a weaker contract", async () => {
    vi.mocked(createAiResponse).mockResolvedValue({ ok: false, code: "provider_error", error: "Schema unsupported" });
    expect(await tryGenerateLeanPlanPhaseOpenAI(snapshot, "30")).toMatchObject({ ok: false });
    expect(createAiResponse).toHaveBeenCalledTimes(1);
  });
});
