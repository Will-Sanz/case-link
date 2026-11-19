import { z } from "zod";
import { findLikelyIdentifiers } from "@/lib/privacy/no-pii";
import { updatePlanStepSchema, updatePlanStepActionItemSchema } from "@/lib/validations/plans";
import type { PlanStepRow } from "@/types/family";

export const DRAFT_PREFIX = "caselink:local-action-draft:";
export const DRAFT_LOGOUT_KEY = "caselink:drafts-cleared-at";
export const DRAFT_TTL_MS = 30 * 60 * 1000;
const MAX_DRAFT_LENGTH = 100_000;
const rowFields = {
  id: z.string().uuid(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
  sort_order: z.number().int().nonnegative(),
};
const actionSchema = updatePlanStepActionItemSchema.omit({ familyId: true, actionItemId: true, expectedUpdatedAt: true }).required().extend({
  ...rowFields, plan_step_id: z.string().uuid(), title: z.string().max(500),
});
const stepSchema = updatePlanStepSchema.omit({ familyId: true, stepId: true, expectedUpdatedAt: true }).extend({
  ...rowFields,
  plan_id: z.string().uuid(),
  title: z.string().max(500),
  description: z.string().max(4000),
  status: updatePlanStepSchema.shape.status.unwrap(),
  phase: updatePlanStepSchema.shape.phase.unwrap(),
  priority: updatePlanStepSchema.shape.priority.nullable(),
  details: updatePlanStepSchema.shape.details.nullable(),
  workflow_data: updatePlanStepSchema.shape.workflow_data.nullable(),
  due_date: z.string().nullable(),
  assigned_to_id: z.string().uuid().nullable(),
  action_items: z.array(actionSchema).max(50).default([]),
});
const draftSchema = z.object({
  v: z.literal(2), userId: z.string().uuid(), planId: z.string().uuid(),
  savedAt: z.string().datetime(), step: stepSchema,
});
export type LocalActionDraft = z.infer<typeof draftSchema>;

export function localActionDraftKey(userId: string, planId: string): string {
  return `${DRAFT_PREFIX}${userId}:${planId}`;
}

function hasIdentifiers(value: unknown): boolean {
  if (typeof value === "string") return findLikelyIdentifiers(value).length > 0;
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some(hasIdentifiers);
}

export function serializeLocalActionDraft(userId: string, planId: string, step: PlanStepRow, now = Date.now()): string | null {
  // Store editable content only; provider helper output is not needed for recovery.
  const parsed = draftSchema.safeParse({ v: 2, userId, planId, savedAt: new Date(now).toISOString(), step });
  if (!parsed.success) return null;
  if (parsed.data.step.details?.contacts) {
    parsed.data.step.details.contacts = parsed.data.step.details.contacts.map(contact =>
      contact.source_resource_id && contact.source_updated_at
        ? { source_resource_id: contact.source_resource_id, source_updated_at: contact.source_updated_at }
        : contact);
  }
  const { title, description, details, workflow_data, action_items } = parsed.data.step;
  if (hasIdentifiers([title, description, details, workflow_data, action_items.map(a => [a.title, a.description, a.notes, a.outcome])])) return null;
  const value = JSON.stringify(parsed.data);
  return value.length <= MAX_DRAFT_LENGTH ? value : null;
}

export function parseLocalActionDraft(value: string | null, userId: string, planId: string, now = Date.now(), clearedAt = 0): LocalActionDraft | null {
  if (!value || value.length > MAX_DRAFT_LENGTH) return null;
  try {
    const parsed = draftSchema.safeParse(JSON.parse(value));
    if (!parsed.success) return null;
    const d = parsed.data;
    const time = Date.parse(d.savedAt);
    if (d.userId !== userId || d.planId !== planId || d.step.plan_id !== planId ||
        d.step.action_items.some(a => a.plan_step_id !== d.step.id) ||
        time > now || now - time >= DRAFT_TTL_MS || time <= clearedAt) return null;
    const safeValue = serializeLocalActionDraft(userId, planId, d.step, time);
    return safeValue ? draftSchema.parse(JSON.parse(safeValue)) : null;
  } catch {
    return null;
  }
}

/** Throws when storage is blocked so the editor can tell the user recovery is unavailable. */
export function pruneLocalActionDrafts(userId?: string): void {
  const clearedAt = Number(window.localStorage.getItem(DRAFT_LOGOUT_KEY)) || 0;
  for (const key of Object.keys(window.localStorage)) {
    if (key.startsWith(DRAFT_PREFIX)) window.localStorage.removeItem(key);
  }
  for (const key of Object.keys(window.sessionStorage)) {
    if (!key.startsWith(DRAFT_PREFIX)) continue;
    const [owner, planId] = key.slice(DRAFT_PREFIX.length).split(":");
    if ((userId && owner !== userId) || !parseLocalActionDraft(window.sessionStorage.getItem(key), owner, planId, Date.now(), clearedAt)) {
      window.sessionStorage.removeItem(key);
    }
  }
}

export function clearLocalActionDrafts(): void {
  // This content-free marker also invalidates copies in suspended or duplicated tabs.
  try { window.localStorage.setItem(DRAFT_LOGOUT_KEY, String(Date.now())); } catch { /* Storage may be disabled. */ }
  for (const kind of ["sessionStorage", "localStorage"] as const) {
    try {
      const storage = window[kind];
      for (const key of Object.keys(storage)) if (key.startsWith(DRAFT_PREFIX)) storage.removeItem(key);
    } catch { /* No persistent draft is available when storage is disabled. */ }
  }
}
