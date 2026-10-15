import { beforeEach, describe, expect, it, vi } from "vitest";
import { generatedCompactPlanStep, generatedPlanStep, refinedPlanStep } from "../../../tests/fixtures/plan-contract";
import { buildLeanPlanRootJsonSchema, leanPlanResponseSchema, buildLeanPhaseRootJsonSchema, planPhaseResponseSchema, leanActionItemZ, sparseDetailsForPersistence } from "./lean-plan-schema";
import { OPENAI_PLAN_REFINE_STEPS_ROOT_SCHEMA, planRefineLeanResponseSchema } from "./plan-refine-lean";
import { tryGenerateLeanPlanOpenAI, tryGenerateLeanPlanPhaseOpenAI } from "./openai-plan-lean-phase";
import { updatePlanStepActionItemSchema } from "@/lib/validations/plans";
import { createAiResponse } from "@/lib/ai/client";
import type { PlanGenerationSnapshot } from "@/types/family";

vi.mock("@/lib/ai/client", () => ({ createAiResponse: vi.fn() }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({}) }));
const snapshot: PlanGenerationSnapshot = { family_id: "synthetic", captured_at: "2026-10-13T12:00:00Z", revision: "a".repeat(64), brief: "Synthetic context", resources: "None", resource_catalog: [] };

describe("plan output contracts", () => {
  beforeEach(() => vi.mocked(createAiResponse).mockReset());

  it("generates one complete goal/date plan with no phase or week obligations", async () => {
    const step = { ...generatedCompactPlanStep, action_items: [
      { ...generatedCompactPlanStep.action_items[0], target_date: "2026-10-13" },
      { ...generatedCompactPlanStep.action_items[0], title: "Review the agreed outcome", target_date: "2027-01-11" },
    ] };
    vi.mocked(createAiResponse).mockResolvedValue({ ok: true, model: "test", text: JSON.stringify({ steps: [step] }) });
    const result = await tryGenerateLeanPlanOpenAI(snapshot, { retries: 1 });
    expect(result).toMatchObject({ ok: true, steps: [{ phase: "30", action_items: [
      { target_date: "2026-10-13", week_index: 1 }, { target_date: "2027-01-11", week_index: 13 },
    ] }] });
    expect(createAiResponse).toHaveBeenCalledTimes(1);
    const request = vi.mocked(createAiResponse).mock.calls[0][0];
    expect(request.taskType).toBe("plan_generation");
    expect(request.structuredJsonSchema).toEqual({ name: "lean_intervention_plan", schema: buildLeanPlanRootJsonSchema(), strict: true });
    expect(request.instructions).toContain("exactly one step with at most two actions");
    expect(request.input).not.toContain("Use week_index");
    expect(leanPlanResponseSchema.safeParse({ steps: [generatedPlanStep] }).success).toBe(false);
    expect(leanPlanResponseSchema.safeParse({ steps: [{ ...step, action_items: Array(4).fill(step.action_items[0]) }] }).success).toBe(false);
  });

  it.each(["2026-10-12", "2027-01-12", "2026-02-30", null])("rejects an invalid compact-plan date %s without saving a weaker contract", async target_date => {
    vi.mocked(createAiResponse).mockResolvedValue({ ok: true, model: "test", text: JSON.stringify({ steps: [{ ...generatedCompactPlanStep,
      action_items: [{ ...generatedCompactPlanStep.action_items[0], target_date }],
    }] }) });
    expect(await tryGenerateLeanPlanOpenAI(snapshot, { retries: 1 })).toMatchObject({ ok: false });
  });

  it("preserves similar goal wording when the concrete actions are different", async () => {
    const distinctStep = { ...generatedCompactPlanStep, action_items: [{ ...generatedCompactPlanStep.action_items[0], title: "Follow up after the family discussion" }] };
    vi.mocked(createAiResponse).mockResolvedValue({ ok: true, model: "test", text: JSON.stringify({ steps: [generatedCompactPlanStep, distinctStep] }) });
    const result = await tryGenerateLeanPlanOpenAI(snapshot, { retries: 1 });
    expect(result).toMatchObject({ ok: true, steps: [{ action_items: [{ title: "Review the checklist" }] }, { action_items: [{ title: "Follow up after the family discussion" }] }] });
    expect(createAiResponse).toHaveBeenCalledTimes(1);
  });

  it("requests correction for identical whole steps instead of silently dropping them", async () => {
    vi.mocked(createAiResponse).mockResolvedValueOnce({ ok: true, model: "test", text: JSON.stringify({ steps: [generatedCompactPlanStep,
      { ...generatedCompactPlanStep, title: `  ${generatedCompactPlanStep.title.toUpperCase()}  ` },
    ] }) }).mockResolvedValueOnce({ ok: true, model: "test", text: JSON.stringify({ steps: [generatedCompactPlanStep] }) });
    expect(await tryGenerateLeanPlanOpenAI(snapshot, { retries: 2 })).toMatchObject({ ok: true });
    expect(createAiResponse).toHaveBeenCalledTimes(2);
    expect(vi.mocked(createAiResponse).mock.calls[1][0].input).toContain("without losing constraints or distinct tasks");
  });

  it("fails a legacy phase containing only work already covered instead of reinserting duplicates", async () => {
    vi.mocked(createAiResponse).mockResolvedValue({ ok: true, model: "test", text: JSON.stringify({ steps: [{ ...generatedPlanStep, phase: "60" }] }) });
    expect(await tryGenerateLeanPlanPhaseOpenAI(snapshot, "60", {
      retries: 1, priorPhasesSummary: `${generatedPlanStep.title} ${generatedPlanStep.summary}`,
    })).toMatchObject({ ok: false });
  });

  it.each(["30", "60", "90"] as const)("enforces the same complete phase %s contract in the provider and parser", async phase => {
    const step = { ...generatedPlanStep, phase };
    vi.mocked(createAiResponse).mockResolvedValue({ ok: true, model: "test", text: JSON.stringify({ steps: [step] }) });
    expect(await tryGenerateLeanPlanPhaseOpenAI(snapshot, phase, { retries: 1 })).toMatchObject({ ok: true, steps: [step] });
    expect(vi.mocked(createAiResponse).mock.calls[0][0].structuredJsonSchema).toEqual({ name: `lean_plan_phase_${phase}`, schema: buildLeanPhaseRootJsonSchema(phase), strict: true });
    expect(sparseDetailsForPersistence(step)).toMatchObject({ owner: "case_manager", stage_goal: step.goal, required_documents: [], contacts: [] });
  });

  it("keeps exact generated action dates without adding a default timing window", async () => {
    const step = { ...generatedPlanStep, phase: "60" as const, action_items: [{ ...generatedPlanStep.action_items[0], week_index: 5, target_date: "2026-12-03" }] };
    vi.mocked(createAiResponse).mockResolvedValue({ ok: true, model: "test", text: JSON.stringify({ steps: [step] }) });
    const result = await tryGenerateLeanPlanPhaseOpenAI(snapshot, "60", { retries: 1, planStartDate: "2026-10-15" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.steps[0].action_items[0].target_date).toBe("2026-12-03");
    expect(sparseDetailsForPersistence(result.steps[0])).not.toHaveProperty("timing_guidance");
  });

  it.each(["Weeks 5–6", "Calls only after school"])("rejects non-null generated timing (%s), accepting constraints in the action description", async timing => {
    const corrected = { ...generatedPlanStep, action_items: [{ ...generatedPlanStep.action_items[0], description: "Call only after school, as requested by the family." }] };
    vi.mocked(createAiResponse).mockResolvedValueOnce({ ok: true, model: "test", text: JSON.stringify({ steps: [{ ...generatedPlanStep, timing }] }) })
      .mockResolvedValueOnce({ ok: true, model: "test", text: JSON.stringify({ steps: [corrected] }) });
    expect(await tryGenerateLeanPlanPhaseOpenAI(snapshot, "30", { retries: 2 })).toMatchObject({ ok: true, steps: [corrected] });
    expect(createAiResponse).toHaveBeenCalledTimes(2);
    expect(sparseDetailsForPersistence(corrected)).not.toHaveProperty("timing_guidance");
    expect(buildLeanPhaseRootJsonSchema("30")).toMatchObject({ properties: { steps: { items: { properties: { timing: { type: "null" } } } } } });
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

  it.each(["model_unavailable", "safety_review"] as const)("does not automatically retry a complete plan after %s", async code => {
    vi.mocked(createAiResponse).mockResolvedValue({ ok: false, code, error: "The request needs attention." });
    expect(await tryGenerateLeanPlanOpenAI(snapshot, { retries: 2 })).toMatchObject({ ok: false, reason: "The request needs attention." });
    expect(createAiResponse).toHaveBeenCalledTimes(1);
  });
});
