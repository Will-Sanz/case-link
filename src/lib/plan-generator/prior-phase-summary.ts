import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

const MAX_SUMMARY_CHARS = 1900;

type StepRow = {
  id: string;
  phase: string;
  title: string;
  description: string | null;
};

/**
 * Loads existing plan steps for the given phases and formats a compact block for the planner prompt.
 * Keeps total size bounded for latency and token use.
 */
export async function fetchPriorPhasesSummaryForPlanner(
  supabase: SupabaseClient,
  planId: string,
  phases: Array<"30" | "60">,
): Promise<string> {
  if (phases.length === 0) return "";

  const { data: steps, error: stepsErr } = await supabase
    .from("plan_steps")
    .select("id, phase, title, description")
    .eq("plan_id", planId)
    .in("phase", phases)
    .order("sort_order", { ascending: true });

  if (stepsErr || !steps?.length) return "";

  const stepRows = steps as StepRow[];
  const ids = stepRows.map((s) => s.id);

  const { data: items } = await supabase
    .from("plan_step_action_items")
    .select("plan_step_id, title, sort_order")
    .in("plan_step_id", ids)
    .order("sort_order", { ascending: true });

  const titlesByStep = new Map<string, string[]>();
  for (const row of items ?? []) {
    const sid = row.plan_step_id as string;
    const t = (row.title as string)?.trim();
    if (!t) continue;
    const arr = titlesByStep.get(sid) ?? [];
    if (arr.length < 3) arr.push(t);
    titlesByStep.set(sid, arr);
  }

  const lines: string[] = [];
  for (const s of stepRows) {
    const phase = s.phase === "30" || s.phase === "60" ? s.phase : "?";
    const desc = (s.description ?? "").replace(/\s+/g, " ").trim();
    const shortDesc = desc.length > 100 ? `${desc.slice(0, 97)}…` : desc;
    const ai = titlesByStep.get(s.id)?.join("; ") ?? "";
    const aiPart = ai ? ` | Actions: ${ai.length > 80 ? `${ai.slice(0, 77)}…` : ai}` : "";
    lines.push(`- [${phase}-day] ${s.title.trim()}${shortDesc ? `, ${shortDesc}` : ""}${aiPart}`);
  }

  let text = lines.join("\n");
  if (text.length > MAX_SUMMARY_CHARS) {
    text = `${text.slice(0, MAX_SUMMARY_CHARS)}\n… (truncated)`;
  }
  return text.trim();
}
