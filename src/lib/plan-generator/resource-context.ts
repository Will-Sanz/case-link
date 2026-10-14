import { isResourceAvailable } from "@/lib/matching/resource-availability";
import { GEO_CONTEXT_FOR_CASE_MANAGER_PROMPTS } from "@/lib/ai/prompt-geo";
import type { ResourceMatchRow } from "@/types/family";

/** Non-dismissed matches only, highest score first (for AI planning and case assistance). */
export function matchesForPlanContext(
  matches: ResourceMatchRow[],
  max: number,
): ResourceMatchRow[] {
  return matches
    .filter((m) => m.status !== "dismissed" && isResourceAvailable(m.resource))
    .sort((a, b) => {
      const pri = (x: ResourceMatchRow) =>
        x.status === "accepted" ? 0 : x.status === "suggested" ? 1 : 2;
      const p = pri(a) - pri(b);
      if (p !== 0) return p;
      return b.score - a.score;
    })
    .slice(0, max);
}

/** Compact resource lines for lean / staged plan generation (smaller prompt). */
export function formatMatchesForPlannerPrompt(
  matches: ResourceMatchRow[],
  max = 6,
): string {
  const rows = matchesForPlanContext(matches, max);
  if (rows.length === 0) {
    return "RESOURCES: None matched. Use general Philadelphia guidance only; do not invent programs.";
  }
  const lines = rows.map((m, i) => {
    const r = m.resource!;
    const reason = m.match_reason.trim();
    const why = reason.length > 140 ? `${reason.slice(0, 140)}… [shortened]` : reason;
    return `${i + 1}. ${r.program_name} (${r.office_or_department || r.category || "service"}), ${why}`;
  });
  const omitted = matchesForPlanContext(matches, matches.length).length - rows.length;
  return `MATCHED_RESOURCES (reference, generic steps are OK; ${omitted} additional matches omitted; contact details are not included):\n${lines.join("\n")}`;
}

export function formatMatchesForAiPrompt(
  matches: ResourceMatchRow[],
  max: number,
): string {
  const rows = matchesForPlanContext(matches, max);
  if (rows.length === 0) {
    return `MATCHED_RESOURCES: None yet (matching not run or all suggestions dismissed). ${GEO_CONTEXT_FOR_CASE_MANAGER_PROMPTS} Use general guidance only where needed; avoid inventing fake organization names.`;
  }

  const blocks = rows.map((m, idx) => {
    const r = m.resource!;
    const lines = [
      `### Resource ${idx + 1} (score ${Math.round(m.score)}, status: ${m.status})`,
      `- Program: ${r.program_name}`,
      `- Office/department: ${r.office_or_department}`,
      r.category ? `- Category: ${r.category}` : null,
      r.primary_contact_name ? `- Contact name: ${r.primary_contact_name}` : null,
      r.primary_contact_email ? `- Email: ${r.primary_contact_email}` : null,
      r.primary_contact_phone ? `- Phone: ${r.primary_contact_phone}` : null,
      `- Why it matches: ${m.match_reason}`,
    ];
    return lines.filter(Boolean).join("\n");
  });

  return `MATCHED_COMMUNITY_RESOURCES (directory records only; verify current contacts, eligibility, and availability before use):\n\n${blocks.join("\n\n")}`;
}
