import type { PlanStepDetails, PlanStepRow } from "@/types/family";

/** Merge document lists for a single editable block (materials_needed is an alias in schema). */
export function documentsToEditable(d: PlanStepDetails | null | undefined): string {
  const req = d?.required_documents ?? [];
  const mat = d?.materials_needed ?? [];
  const merged = [...req, ...mat.map((x) => x.trim())].filter(Boolean);
  return [...new Set(merged.map((x) => x.trim()).filter(Boolean))].join("\n");
}

export function documentsFromEditable(text: string): { required_documents: string[]; materials_needed?: undefined } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return { required_documents: lines, materials_needed: undefined };
}

/** One line per contact: "Name · phone · email · notes" (optional parts). */
export function contactsToEditable(contacts: PlanStepDetails["contacts"] | undefined): string {
  if (!contacts?.length) return "";
  return contacts
    .map((c) => [c.name, c.phone, c.email, c.notes].map((x) => x?.trim()).filter(Boolean).join(" · "))
    .join("\n");
}

const PART_SEP = /\s*·\s*/;

export function contactsFromEditable(text: string): PlanStepDetails["contacts"] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  return lines.map((line) => {
    const parts = line.split(PART_SEP).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return { name: line };
    if (parts.length === 1) return { name: parts[0] };
    if (parts.length === 2) return { name: parts[0], phone: parts[1] };
    if (parts.length === 3) return { name: parts[0], phone: parts[1], email: parts[2] };
    return {
      name: parts[0],
      phone: parts[1],
      email: parts[2],
      notes: parts.slice(3).join(" · "),
    };
  });
}

/**
 * Narrative body: summary + action items (prose) + timing.
 * Persisted primarily in `description`; timing line may be extracted on save.
 */
export function buildMainParagraph(step: PlanStepRow): string {
  const d = (step.details ?? {}) as PlanStepDetails;
  const desc = step.description?.trim();
  const fallback =
    d.action_needed_now?.trim() || step.ai_helper_data?.action_needed_now?.trim() || "";
  const parts: string[] = [];
  if (desc) parts.push(desc);
  else if (fallback) parts.push(fallback);

  const actions = [...(step.action_items ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const titles = actions.map((a) => a.title.trim()).filter(Boolean);
  if (titles.length === 1) {
    parts.push(`Next step: ${titles[0]}`);
  } else if (titles.length > 1) {
    const last = titles[titles.length - 1];
    const rest = titles.slice(0, -1);
    parts.push(`Planned tasks include ${rest.join("; ")}; and ${last}.`);
  }

  const timing = d.timing_guidance?.trim();
  if (timing) parts.push(`Timing: ${timing}`);

  return parts.join("\n\n");
}

/** Split trailing `Timing: …` into timing_guidance; remainder → description. */
export function parseMainParagraphOnSave(text: string): { description: string; timing_guidance?: string } {
  const trimmed = text.trim();
  const re = /\nTiming:\s*([^\n]+)\s*$/;
  const m = trimmed.match(re);
  if (m && m.index != null) {
    const body = trimmed.slice(0, m.index).trim();
    return {
      description: body,
      timing_guidance: m[1]?.trim() || undefined,
    };
  }
  return { description: trimmed };
}

export function formatDocumentsDisplay(d: PlanStepDetails | null | undefined): string | null {
  const raw = documentsToEditable(d);
  if (!raw) return null;
  const items = raw.split(/\r?\n/).filter((l) => l.trim());
  if (items.length === 0) return null;
  if (items.length === 1) return `The client will need ${items[0]}.`;
  return `The client will need the following: ${items.join("; ")}.`;
}

export function formatContactDisplay(d: PlanStepDetails | null | undefined): string | null {
  const line = contactsToEditable(d?.contacts);
  if (!line.trim()) return null;
  return `Primary contact: ${line.replace(/\n/g, " · ")}`;
}

export function formatOutcomeDisplay(d: PlanStepDetails | null | undefined): string | null {
  const o = d?.expected_outcome?.trim();
  if (!o) return null;
  return `Expected outcome: ${o}`;
}

/** Optional case record lines (workflow), narrative, no section headers in UI. */
export function formatRecordNotes(wf: PlanStepRow["workflow_data"]): string | null {
  const parts: string[] = [];
  const on = wf?.outcome_notes?.trim();
  const br = wf?.blocker_reason?.trim();
  if (on) parts.push(on);
  if (br) parts.push(`Currently blocked: ${br}`);
  if (parts.length === 0) return null;
  return parts.join("\n\n");
}

export type CaseNoteDraftSlice = {
  title: string;
  mainParagraph: string;
  documentsEditable: string;
  contactEditable: string;
  outcome: string;
};

export function stepToCaseNoteDraft(step: PlanStepRow): CaseNoteDraftSlice {
  const d = (step.details ?? {}) as PlanStepDetails;
  return {
    title: step.title,
    mainParagraph: buildMainParagraph(step),
    documentsEditable: documentsToEditable(d),
    contactEditable: contactsToEditable(d.contacts),
    outcome: d.expected_outcome?.trim() ?? "",
  };
}
