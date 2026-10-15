import { createHash } from "node:crypto";
import { z } from "zod";
import { actionUiStatus, actionUserNotes } from "@/lib/domain/plan/action-state";
import { formatResourceCatalog, planResourceCatalog, resourceCatalogEntrySchema, matchesForPlanContext } from "@/lib/matching/plan-resources";
import type { FamilyDetail, PlanGenerationSnapshot } from "@/types/family";

const snapshotSchema = z.object({
  family_id: z.string().uuid(),
  captured_at: z.iso.datetime(),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  brief: z.string().min(1).max(80_000),
  resources: z.string().max(15_000),
  resource_catalog: z.array(resourceCatalogEntrySchema).max(12),
}).strict();

/** Preserve instructions in full; recent history is bounded and explicitly identified. */
export function buildPlanningBrief(detail: FamilyDetail, extraFeedback?: string): string {
  const meetings = [...detail.progressUpdates].sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at));
  const notes = [...detail.caseNotes].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const brief = JSON.stringify({
    instructions: extraFeedback?.trim() || null,
    barriers: detail.barriers.map(b => b.label.trim()),
    stated_goals: detail.goals.map(g => g.label.trim()),
    summary: detail.summary,
    household_context: detail.household_notes,
    previous_plan: detail.plan ? {
      id: detail.plan.id, version: detail.plan.version,
      goals: detail.plan.steps.map(step => ({
        title: step.title, summary: step.description, status: step.status,
        actions: (step.action_items ?? []).map(action => ({
          title: action.title, description: action.description, status: actionUiStatus(action),
          target_date: action.target_date, follow_up_date: action.follow_up_date,
          notes: actionUserNotes(action.notes), outcome: action.outcome,
        })),
      })),
    } : null,
    recent_meetings: meetings.slice(0, 5).map(m => ({ date: m.occurred_on, recorded_at: m.created_at, summary: m.summary })),
    recent_notes: notes.slice(0, 5).map(n => ({ recorded_at: n.created_at, text: n.body })),
    history_limits: { older_meetings_omitted: Math.max(0, meetings.length - 5), older_notes_omitted: Math.max(0, notes.length - 5) },
  });
  if (brief.length > 80_000) throw new Error("This case has too much planning context for one draft. Shorten the saved notes or use the plan editor; no instructions were discarded.");
  return brief;
}

function snapshotRevision(snapshot: Omit<PlanGenerationSnapshot, "revision">): string {
  return createHash("sha256").update(JSON.stringify([snapshot.family_id, snapshot.captured_at, snapshot.brief, snapshot.resources, snapshot.resource_catalog])).digest("hex");
}

export function buildPlanningSnapshot(detail: FamilyDetail, feedback?: string, now = new Date()): PlanGenerationSnapshot {
  // The database resolves verified contact facts when saving a step; job state must contain no identifiers.
  const catalog = planResourceCatalog(detail.resourceMatches, 6).map(entry => ({ ...entry, phone: null, email: null }));
  const content = {
    family_id: detail.id, captured_at: now.toISOString(), brief: buildPlanningBrief(detail, feedback),
    resources: formatResourceCatalog(catalog, matchesForPlanContext(detail.resourceMatches, detail.resourceMatches.length).length - catalog.length), resource_catalog: catalog,
  };
  const snapshot = { ...content, revision: snapshotRevision(content) };
  if (!parsePlanningSnapshot(snapshot, detail.id)) throw new Error("The planning context is too large. Review the saved context before generating a new draft.");
  return snapshot;
}

/** Old or damaged jobs must restart; never silently rebuild a different case snapshot. */
export function parsePlanningSnapshot(value: unknown, familyId: string): PlanGenerationSnapshot | null {
  const parsed = snapshotSchema.safeParse(value);
  if (!parsed.success || parsed.data.family_id !== familyId || Buffer.byteLength(JSON.stringify(parsed.data)) > 200_000) return null;
  const { revision, ...content } = parsed.data;
  return snapshotRevision(content) === revision ? parsed.data : null;
}
