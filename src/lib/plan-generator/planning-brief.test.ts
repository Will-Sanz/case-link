import { beforeEach, describe, expect, it, vi } from "vitest";
import { directoryCase, directoryId, directoryStamp } from "../../../tests/fixtures/directory-case";
import { buildPlanningBrief, buildPlanningSnapshot, parsePlanningSnapshot } from "./planning-brief";
import { startStagedLeanPlanGeneration, advanceStagedLeanPlanGeneration, continuePlanManually } from "@/app/actions/plans";
import { tryGenerateLeanPlanOpenAI } from "./openai-plan-lean-phase";
import { createAiResponse } from "@/lib/ai/client";
import { generatedCompactPlanStep, generatedPlanStep } from "../../../tests/fixtures/plan-contract";
import type { FamilyDetail, PlanGenerationState, PlanStepRow } from "@/types/family";

const mocks = vi.hoisted(() => ({ session: vi.fn(), detail: vi.fn(), prior: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireAppUserWithClient: mocks.session }));
vi.mock("@/lib/services/families", () => ({ getFamilyDetail: mocks.detail }));
vi.mock("@/lib/plan-generator/prior-phase-summary", () => ({ fetchPriorPhasesSummaryForPlanner: mocks.prior }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ OPENAI_API_KEY: "synthetic" }) }));
vi.mock("@/lib/ai/client", () => ({ createAiResponse: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const familyId = "20000000-0000-4000-8000-000000000002";
const planId = "30000000-0000-4000-8000-000000000003";
const stamp = "2026-10-13T12:00:00Z";
function fixture(): FamilyDetail {
  return { id: familyId, name: "Family 014", summary: "Housing support", household_notes: null, urgency: "high", status: "active", created_by_id: "owner", created_at: stamp,
    updated_at: stamp, creator: null, members: [], goals: [], barriers: [], resourceMatches: [], plan: null, caseNotes: [], progressUpdates: [] };
}

function stagedDatabase(initial?: PlanGenerationState, initialCounts: Record<string, number> = {}) {
  let state = initial;
  let directoryChanged = false;
  const counts: Record<string, number> = { "30": 0, "60": 0, "90": 0, ...initialCounts };
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "start_staged_plan_generation") {
      state = structuredClone(args.p_generation_state as PlanGenerationState);
      return { data: { planId, version: 1 }, error: null };
    }
    if (name === "append_staged_plan_phase" || name === "update_staged_plan_state") {
      state = structuredClone(args.p_generation_state as PlanGenerationState);
      if (name === "append_staged_plan_phase") counts[args.p_phase as string] = 1;
    }
    return { data: true, error: null };
  });
  const from = vi.fn((table: string) => {
    let phase = "30";
    const query = {
      select: () => query, order: () => query, limit: () => query,
      in: async () => ({data:[{resource_id:directoryId,status:"accepted",resource:{active:true,is_demo:false,updated_at:directoryChanged ? "2026-10-14T00:00:00Z" : directoryStamp}}],error:null}),
      eq: (key: string, value: string) => { if (key === "phase") phase = value; return query; },
      maybeSingle: async () => ({ data: table === "plans" ? { id: planId, version: 1, created_at: stamp, generation_state: structuredClone(state), ai_model: null } : { sort_order: 0 }, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ count: counts[phase], error: null }).then(resolve),
    };
    return query;
  });
  return { client: { rpc, from }, read: () => state, changeDirectory: () => { directoryChanged = true; } };
}

describe("one durable planning snapshot", () => {
  beforeEach(() => {
    mocks.session.mockReset(); mocks.detail.mockReset().mockResolvedValue(fixture()); mocks.prior.mockReset().mockResolvedValue("");
    vi.mocked(createAiResponse).mockReset().mockImplementation(async request => {
      const phase = request.structuredJsonSchema!.name.slice(-2) as "30" | "60" | "90";
      const step = request.taskType === "plan_generation" ? generatedCompactPlanStep : { ...generatedPlanStep, phase };
      return { ok: true, model: "test", text: JSON.stringify({ steps: [step] }) };
    });
  });

  it.each(["before","during"])("refuses contacts changed %s the provider call without persisting a phase", async when => {
    const db = stagedDatabase(); mocks.session.mockResolvedValue({supabase:db.client});
    mocks.detail.mockResolvedValue(directoryCase());
    expect(await startStagedLeanPlanGeneration({familyId})).toMatchObject({ok:true});
    if (when === "before") db.changeDirectory();
    else vi.mocked(createAiResponse).mockImplementationOnce(async () => {
      db.changeDirectory();
      return {ok:true,model:"test",text:JSON.stringify({steps:[{...generatedCompactPlanStep,resource_ids:[directoryId]}]})};
    });
    expect(await advanceStagedLeanPlanGeneration({familyId,planId})).toMatchObject({ok:false});
    expect(db.read()!.status).toBe("failed");
    expect(createAiResponse).toHaveBeenCalledTimes(when === "before" ? 0 : 1);
    expect(db.client.rpc.mock.calls.filter(call=>call[0] === "append_staged_plan_phase")).toHaveLength(0);
  });

  it("anchors the prompt to the saved school date instead of the UTC date or the later resume day", async () => {
    const snapshot = buildPlanningSnapshot(fixture(), undefined, new Date("2026-10-14T02:00:00Z"));
    await tryGenerateLeanPlanOpenAI(snapshot);
    expect(vi.mocked(createAiResponse).mock.calls[0][0].input).toContain("plan starts on 2026-10-13 in America/New_York");
    expect(vi.mocked(createAiResponse).mock.calls[0][0].input).toContain("All dates are proposed until the case manager confirms");
  });

  it("retains all instructions, long notes, and many barriers/goals without slicing the last constraint", () => {
    const detail = fixture();
    detail.summary = "Existing context. ".repeat(200);
    detail.goals = Array.from({ length: 60 }, (_, i) => ({ id: `goal-${i}`, family_id: familyId, preset_key: null, label: `Goal ${i}`, sort_order: i, created_at: stamp }));
    detail.barriers = detail.goals.map(g => ({ ...g, label: g.label.replace("Goal", "Barrier") }));
    const instructions = `${"Use agreed priorities. ".repeat(100)}Do not contact the landlord.`;
    const brief = JSON.parse(buildPlanningBrief(detail, instructions));
    expect(brief.instructions).toBe(instructions);
    expect(brief.summary).toBe(detail.summary);
    expect(brief.barriers).toHaveLength(60); expect(brief.stated_goals).toHaveLength(60);
  });

  it("carries the family's saved priorities, strengths and practical limits into the AI request", async () => {
    const detail = fixture();
    detail.summary = "The family wants to keep the school routine steady. A relative helps with transport. Calls after work; an earlier application is waiting.";
    const snapshot = buildPlanningSnapshot(detail, undefined, new Date(stamp));
    expect(JSON.parse(snapshot.brief).summary).toBe(detail.summary);
    await tryGenerateLeanPlanOpenAI(snapshot);
    expect(vi.mocked(createAiResponse).mock.calls[0][0].input).toContain(detail.summary);
  });

  it("includes completed outcomes on regeneration and identifies older history omitted from context", () => {
    const detail = fixture();
    detail.plan = { id: "old-plan", version: 2, steps: [{ title: "Housing", description: "Intake", status: "completed", details: { stage_goal: "Housing stability", owner: "shared", expected_outcome: "Agree the next support" }, action_items: [{ title: "Finish intake", status: "completed", notes: "Reviewed", outcome: "Intake accepted", target_date: "2026-10-12" }] } as PlanStepRow] } as FamilyDetail["plan"];
    detail.caseNotes = Array.from({ length: 8 }, (_, i) => ({ id: `note-${i}`, family_id: familyId, author_id: "owner", body: `Note ${i}`, created_at: `2026-10-${10 + i}T12:00:00Z`, author: null }));
    const brief = JSON.parse(buildPlanningBrief(detail));
    expect(brief.previous_plan.goals[0].actions[0]).toMatchObject({ status: "completed", outcome: "Intake accepted" });
    expect(brief.previous_plan).toMatchObject({ review: "needs_review", goals: [{ goal: "Housing stability", owner: "shared", expected_result: "Agree the next support" }] });
    expect(brief.recent_notes[0].text).toBe("Note 7");
    expect(brief.history_limits.older_notes_omitted).toBe(3);
  });

  it("rejects oversized context instead of silently discarding it", () => {
    const detail = fixture(); detail.household_notes = "x".repeat(80_000);
    expect(() => buildPlanningBrief(detail, "Do not contact the landlord.")).toThrow("no instructions were discarded");
  });

  it("freezes resource recommendations and declares omitted matches without copying contact identifiers", () => {
    const detail = fixture();
    detail.resourceMatches = Array.from({ length: 8 }, (_, i) => ({ status: "suggested", score: 8 - i, match_reason: "Reason ".repeat(30), resource: { id: `10000000-0000-4000-8000-00000000000${i}`, office_or_department: "Community office", active: true, is_demo: false, updated_at: stamp, program_name: `Program ${i}`, category: "Housing", primary_contact_phone: "215-555-0100", primary_contact_email: "staff@example.test" } })) as FamilyDetail["resourceMatches"];
    const snapshot = buildPlanningSnapshot(detail);
    detail.resourceMatches[0].resource!.program_name = "Changed resource";
    expect(snapshot.resources).toContain("Program 0");
    expect(snapshot.resources).toContain("2 additional matches omitted");
    expect(snapshot.resources).toContain("Reason ".repeat(30));
    expect(snapshot.resources).not.toContain("215-555");
    expect(snapshot.resources).not.toContain("staff@example.test");
    expect(snapshot.resources).not.toContain("Changed resource");
    expect(JSON.stringify(snapshot)).not.toMatch(/215-555|staff@example\.test/);
    expect(snapshot.resource_catalog[0]).toMatchObject({ id: detail.resourceMatches[0].resource!.id, updated_at: stamp, phone: null, email: null });
  });

  it("rejects missing, edited, or cross-family snapshots", () => {
    const snapshot = buildPlanningSnapshot(fixture(), "Use agreed priorities", new Date(stamp));
    expect(parsePlanningSnapshot(JSON.parse(JSON.stringify(snapshot)), familyId)).toEqual(snapshot);
    for (const value of [null, {}, { ...snapshot, brief: "Changed" }, { ...snapshot, resources: "Changed" }, { ...snapshot, captured_at: "yesterday" }]) expect(parsePlanningSnapshot(value, familyId)).toBeNull();
    expect(parsePlanningSnapshot(snapshot, "another-family")).toBeNull();
  });

  it("saves one complete plan from the saved context after refresh and a concurrent family edit", async () => {
    const db = stagedDatabase(); mocks.session.mockResolvedValue({ supabase: db.client });
    expect(await startStagedLeanPlanGeneration({ familyId, regenerationFeedback: "Do not contact the landlord." })).toMatchObject({ ok: true });
    const snapshot = structuredClone(db.read()!.input_snapshot!);
    const changed = fixture(); changed.summary = "New instructions saved after generation began";
    mocks.detail.mockResolvedValue(changed);
    expect(db.read()!.generation_strategy).toBe("single");
    expect(await advanceStagedLeanPlanGeneration({ familyId, planId })).toMatchObject({ ok: true, done: true });
    expect(db.read()).toMatchObject({ status: "complete", pending_phase: null, input_snapshot: snapshot, phases_complete: { "30": true, "60": false, "90": false } });
    // A lost successful response or another refresh must not issue another paid request.
    expect(await advanceStagedLeanPlanGeneration({ familyId, planId })).toMatchObject({ ok: true, done: true });
    expect(mocks.detail).toHaveBeenCalledTimes(1);
    expect(createAiResponse).toHaveBeenCalledTimes(1);
    expect(db.client.rpc.mock.calls.filter(call => call[0] === "append_staged_plan_phase")).toHaveLength(1);
    for (const [request] of vi.mocked(createAiResponse).mock.calls) {
      expect(request.input).toContain(snapshot.brief);
      expect(request.input).toContain(snapshot.revision);
      expect(String(request.input).match(/Do not contact the landlord/g)).toHaveLength(1);
      expect(request.input).not.toContain(changed.summary!);
    }
  });

  it("repairs a malformed complete plan by resuming the same version and snapshot without duplicate tasks", async () => {
    const db = stagedDatabase(); mocks.session.mockResolvedValue({ supabase: db.client });
    await startStagedLeanPlanGeneration({ familyId });
    const snapshot = structuredClone(db.read()!.input_snapshot);
    vi.mocked(createAiResponse).mockResolvedValueOnce({ ok: true, model: "test", text: "not valid JSON" });
    expect(await advanceStagedLeanPlanGeneration({ familyId, planId })).toMatchObject({ ok: false, status: "failed" });
    expect(db.read()!.status).toBe("failed");
    expect(await advanceStagedLeanPlanGeneration({ familyId, planId })).toMatchObject({ ok: true, done: true });
    expect(db.read()!.input_snapshot).toEqual(snapshot);
    expect(createAiResponse).toHaveBeenCalledTimes(2);
    expect(db.client.rpc.mock.calls.filter(call => call[0] === "start_staged_plan_generation")).toHaveLength(1);
    expect(db.client.rpc.mock.calls.filter(call => call[0] === "append_staged_plan_phase")).toHaveLength(1);
  });

  it("resumes an existing legacy job through its remaining phases without replacing saved work", async () => {
    const snapshot = buildPlanningSnapshot(fixture(), undefined, new Date(stamp));
    const db = stagedDatabase({ v: 1, status: "failed", pending_phase: "30", input_snapshot: snapshot,
      phases_complete: { "30": false, "60": false, "90": false }, models_used: ["previous"], stage_timings_ms: {} }, { "30": 1 });
    mocks.session.mockResolvedValue({ supabase: db.client });
    expect(await advanceStagedLeanPlanGeneration({ familyId, planId })).toMatchObject({ ok: true, phaseCompleted: "60", done: false });
    expect(await advanceStagedLeanPlanGeneration({ familyId, planId })).toMatchObject({ ok: true, phaseCompleted: "90", done: true });
    expect(db.read()!.input_snapshot).toEqual(snapshot);
    expect(vi.mocked(createAiResponse).mock.calls.map(([request]) => request.structuredJsonSchema!.name)).toEqual(["lean_plan_phase_60", "lean_plan_phase_90"]);
    expect(db.client.rpc.mock.calls.filter(call => call[0] === "append_staged_plan_phase").map(call => call[1].p_phase)).toEqual(["60", "90"]);
  });

  it("recovers a saved compact batch without adding follow-up phases", async () => {
    const db = stagedDatabase({ v: 1, generation_strategy: "single", status: "failed", pending_phase: "30",
      input_snapshot: buildPlanningSnapshot(fixture(), undefined, new Date(stamp)),
      phases_complete: { "30": false, "60": false, "90": false }, models_used: ["previous"], stage_timings_ms: {} }, { "30": 1 });
    mocks.session.mockResolvedValue({ supabase: db.client });
    expect(await advanceStagedLeanPlanGeneration({ familyId, planId })).toMatchObject({ ok: true, done: true });
    expect(db.read()).toMatchObject({ status: "complete", phases_complete: { "30": true, "60": false, "90": false } });
    expect(createAiResponse).not.toHaveBeenCalled();
    expect(db.client.rpc.mock.calls.filter(call => call[0] === "append_staged_plan_phase")).toHaveLength(0);
  });

  it("returns busy without a provider request or releasing another request's lease", async () => {
    const db = stagedDatabase(); db.client.rpc.mockResolvedValueOnce({ data: false, error: null });
    mocks.session.mockResolvedValue({ supabase: db.client });
    expect(await advanceStagedLeanPlanGeneration({ familyId, planId })).toMatchObject({ ok: true, status: "busy", retryAfter: 5 });
    expect(db.client.from).not.toHaveBeenCalled(); expect(createAiResponse).not.toHaveBeenCalled();
    expect(db.client.rpc).toHaveBeenCalledTimes(1);
  });

  it("delegates manual handoff to the authenticated revision-checked transaction without using AI", async () => {
    const db = stagedDatabase(); mocks.session.mockResolvedValue({ supabase: db.client });
    expect(await continuePlanManually({ familyId, planId, expectedRevision: "a".repeat(64) })).toEqual({ ok: true });
    expect(db.client.rpc).toHaveBeenCalledExactlyOnceWith("continue_plan_manually", {
      p_family_id: familyId, p_plan_id: planId, p_expected_revision: "a".repeat(64),
    });
    expect(createAiResponse).not.toHaveBeenCalled();
    expect(mocks.detail).not.toHaveBeenCalled();
  });

  it("refuses manual handoff without a current revision, authorized session or successful transaction", async () => {
    const db = stagedDatabase(); mocks.session.mockResolvedValue({ supabase: db.client });
    expect(await continuePlanManually({ familyId, planId })).toMatchObject({ ok: false });
    expect(db.client.rpc).not.toHaveBeenCalled();
    mocks.session.mockRejectedValueOnce(new Error("signed out"));
    expect(await continuePlanManually({ familyId, planId, expectedRevision: "a".repeat(64) })).toMatchObject({ ok: false });
    expect(db.client.rpc).not.toHaveBeenCalled();
    db.client.rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await continuePlanManually({ familyId, planId, expectedRevision: "a".repeat(64) })).toMatchObject({ ok: false });
    expect(createAiResponse).not.toHaveBeenCalled();
  });

  it("requires the requested plan identity and releases only its own claim when superseded", async () => {
    const db = stagedDatabase(); mocks.session.mockResolvedValue({ supabase: db.client });
    const result = await advanceStagedLeanPlanGeneration({ familyId, planId: "40000000-0000-4000-8000-000000000004" });
    expect(result).toMatchObject({ ok: true, status: "superseded", done: true });
    expect(createAiResponse).not.toHaveBeenCalled();
    const claimed = db.client.rpc.mock.calls.find(call => call[0] === "claim_ai_job")![1];
    expect(claimed.p_lease_id).toMatch(/^[a-f0-9-]{36}$/);
    expect(db.client.rpc).toHaveBeenCalledWith("release_ai_job", expect.objectContaining({ p_lease_id: claimed.p_lease_id }));
  });

  it("fails old partial jobs before any provider call instead of replacing their context", async () => {
    const db = stagedDatabase({ v: 1, status: "running", pending_phase: "60", planning_brief: "old", phases_complete: { "30": true, "60": false, "90": false }, models_used: [], stage_timings_ms: {} });
    mocks.session.mockResolvedValue({ supabase: db.client });
    expect(await advanceStagedLeanPlanGeneration({ familyId, planId })).toMatchObject({ ok: false, error: expect.stringContaining("Generate a new draft") });
    expect(db.read()!.status).toBe("failed"); expect(createAiResponse).not.toHaveBeenCalled();
  });

  it("blocks identifying current action outcomes before storing or sending a snapshot", async () => {
    const detail = fixture();
    detail.plan = { id: "old", version: 1, steps: [{ title: "Housing", action_items: [{ title: "Finish intake", status: "completed", outcome: "Email private-person@example.test" }] } as PlanStepRow] } as FamilyDetail["plan"];
    mocks.detail.mockResolvedValue(detail);
    const db = stagedDatabase(); mocks.session.mockResolvedValue({ supabase: db.client });
    expect(await startStagedLeanPlanGeneration({ familyId })).toMatchObject({ ok: false });
    expect(db.client.rpc).not.toHaveBeenCalled(); expect(createAiResponse).not.toHaveBeenCalled();
  });

  it("tells the model to respect completed outcomes and the snapshot's history limits", async () => {
    await tryGenerateLeanPlanOpenAI(buildPlanningSnapshot(fixture()));
    const request = vi.mocked(createAiResponse).mock.calls[0][0];
    expect(request.instructions).toContain("Do not restart them");
    expect(request.instructions).toContain("history_limits");
  });
});
