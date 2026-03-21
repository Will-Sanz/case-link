import type { ResourceMatchRow } from "@/types/family";
import type { GeneratedStep, PlanPhase } from "./types";

/** Non-dismissed matches only, highest score first (for plan AI + rules). */
export function matchesForPlanContext(
  matches: ResourceMatchRow[],
  max: number,
): ResourceMatchRow[] {
  return matches
    .filter((m) => m.status !== "dismissed" && m.resource)
    .sort((a, b) => {
      const pri = (x: ResourceMatchRow) =>
        x.status === "accepted" ? 0 : x.status === "suggested" ? 1 : 2;
      const p = pri(a) - pri(b);
      if (p !== 0) return p;
      return b.score - a.score;
    })
    .slice(0, max);
}

const MAX_RESOURCE_STEPS = 10;

function phaseForResourceStep(index: number, total: number): PlanPhase {
  if (total <= 1) return "30";
  const t = index / Math.max(total - 1, 1);
  if (t <= 0.38) return "30";
  if (t <= 0.72) return "60";
  return "90";
}

/** Rules fallback: concrete outreach steps tied to directory programs. */
export function generatedStepsFromMatches(
  matches: ResourceMatchRow[],
): GeneratedStep[] {
  const usable = matchesForPlanContext(matches, MAX_RESOURCE_STEPS);
  if (usable.length === 0) return [];

  return usable.map((m, i) => {
    const r = m.resource!;
    const phase = phaseForResourceStep(i, usable.length);
    const contactBits = [
      r.primary_contact_name,
      r.primary_contact_email,
      r.primary_contact_phone,
    ].filter(Boolean);
    const contactLine =
      contactBits.length > 0 ? `Contact: ${contactBits.join(" · ")}` : null;

    const description = [
      r.office_or_department,
      contactLine,
      m.match_reason ? `Why matched: ${m.match_reason}` : null,
      "Begin intake or referral as appropriate; document outcome in case notes.",
    ]
      .filter(Boolean)
      .join("\n");

    return {
      phase,
      title: `Outreach: ${r.program_name}`,
      description,
      sort_order: 0,
    };
  });
}

export function formatMatchesForAiPrompt(
  matches: ResourceMatchRow[],
  max: number,
): string {
  const rows = matchesForPlanContext(matches, max);
  if (rows.length === 0) {
    return "MATCHED_RESOURCES: None yet (matching not run or all suggestions dismissed). Use general Philadelphia-area guidance only where needed; avoid inventing fake organization names.";
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

  return `MATCHED_COMMUNITY_RESOURCES (use these real programs in your steps — primary input):\n\n${blocks.join("\n\n")}`;
}

function normTitle(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Resource-grounded steps first; then rules templates; dedupe by title. */
export function mergeResourceAndRulesSteps(
  resourceSteps: GeneratedStep[],
  rulesSteps: GeneratedStep[],
): GeneratedStep[] {
  const seen = new Set<string>();
  const out: GeneratedStep[] = [];

  function push(step: GeneratedStep) {
    const key = normTitle(step.title);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...step, sort_order: 0 });
  }

  for (const s of resourceSteps) push(s);
  for (const s of rulesSteps) push(s);

  const phaseOrder: Record<PlanPhase, number> = { "30": 0, "60": 1, "90": 2 };
  out.sort((a, b) => {
    const d = phaseOrder[a.phase] - phaseOrder[b.phase];
    if (d !== 0) return d;
    return a.title.localeCompare(b.title);
  });
  out.forEach((s, i) => {
    s.sort_order = i;
  });
  return out;
}
