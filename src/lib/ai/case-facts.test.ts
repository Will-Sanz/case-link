import { beforeEach, describe, expect, it, vi } from "vitest";
import { directoryCase, directoryStamp } from "../../../tests/fixtures/directory-case";
import { refinedPlanStep } from "../../../tests/fixtures/plan-contract";
import { buildCaseFacts } from "./case-facts";
import { buildPlanningBrief } from "@/lib/plan-generator/planning-brief";
import { buildAssistantCaseContext } from "@/lib/case-assistant/case-context";
import { previewRefinePlanStepsWithOpenAI } from "@/lib/plan-generator/openai-plan";
import type { DraftStepRefineInput } from "@/lib/plan-generator/plan-refine-lean";
import { createAiResponse } from "./client";

vi.mock("./client", () => ({ createAiResponse: vi.fn() }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({}) }));

const draft: DraftStepRefineInput = { ...refinedPlanStep, updated_at: directoryStamp, status: "pending", details: { owner: "shared", stage_goal: "Keep school travel reliable" },
  action_items: refinedPlanStep.action_items.map(action => ({ ...action, updated_at: directoryStamp, status: "pending", notes: null, outcome: null, follow_up_date: null })),
};

function conflictingHistory() {
  const detail = directoryCase();
  detail.summary = "An earlier preference was a morning phone call.";
  detail.household_notes = "A relative helps with transport twice a week.";
  detail.goals = [{ id: "goal", family_id: detail.id, label: "Keep school travel reliable", preset_key: null, sort_order: 0, created_at: directoryStamp }];
  detail.caseNotes = [{ id: "note", family_id: detail.id, author_id: "author", author: { email: "staff@example.test" }, created_at: directoryStamp, body: "The utility assistance application is awaiting a response; follow up, do not restart." }];
  detail.progressUpdates = [
    { id: "late-recorded", family_id: detail.id, plan_id: null, author_id: "author", author: null, occurred_on: "2026-10-01", created_at: "2026-10-15T12:00:00Z", summary: "The family preferred mornings then.", plan_changes: [] },
    { id: "recent-meeting", family_id: detail.id, plan_id: null, author_id: "author", author: null, occurred_on: "2026-10-14", created_at: "2026-10-14T12:00:00Z", summary: "The family now wants calls after work and wants to review referrals before provider contact.", plan_changes: [] },
  ];
  return detail;
}

describe("shared factual context", () => {
  beforeEach(() => vi.mocked(createAiResponse).mockReset().mockResolvedValue({ ok: true, model: "test", text: JSON.stringify({ steps: [refinedPlanStep] }) }));

  it("carries the same family goals, full preferences and dated observations into generation, chat and refinement", async () => {
    const detail = conflictingHistory();
    const facts = buildCaseFacts(detail);
    expect(facts.recent_meetings[0]).toMatchObject({ occurred_on: "2026-10-14", summary: detail.progressUpdates[1].summary });
    expect(JSON.parse(buildPlanningBrief(detail))).toMatchObject(facts);
    expect(JSON.parse(buildAssistantCaseContext(detail))).toMatchObject(facts);
    expect(await previewRefinePlanStepsWithOpenAI(detail, [draft], "Clarify the next discussion")).toMatchObject({ ok: true });
    const request = vi.mocked(createAiResponse).mock.calls[0][0];
    expect(request.input).toContain(JSON.stringify(facts).slice(0, -1));
    expect(request.input).not.toContain("staff@example.test");
    expect(request.instructions).toContain("Use meeting occurrence dates");
    expect(request.instructions).toContain("not to provider office hours");
    expect(request.instructions).toContain("put that discussion first");
  });

  it("retains restrictions beyond former clipping limits and declares older history separately", () => {
    const detail = conflictingHistory();
    detail.summary = "General context. ".repeat(150) + "Do not leave voicemail.";
    detail.progressUpdates[1].summary = "Discussed travel. ".repeat(60) + "Review with family before provider contact.";
    detail.caseNotes = Array.from({ length: 8 }, (_, i) => ({ ...detail.caseNotes[0], id: `note-${i}`, created_at: `2026-10-${10 + i}T12:00:00Z` }));
    const context = JSON.parse(buildAssistantCaseContext(detail));
    expect(context.summary).toBe(detail.summary);
    expect(context.recent_meetings[0].summary).toBe(detail.progressUpdates[1].summary);
    expect(context.history_limits).toMatchObject({ older_notes_omitted: 3, complete_history: false });
  });

  it("does not call refinement with an oversized family context", async () => {
    const detail = conflictingHistory();
    detail.summary = "x".repeat(80_000) + "Do not contact the provider.";
    expect(await previewRefinePlanStepsWithOpenAI(detail, [draft], "Clarify")).toMatchObject({ ok: false, reason: expect.stringContaining("no instructions were discarded") });
    expect(createAiResponse).not.toHaveBeenCalled();
  });
});
