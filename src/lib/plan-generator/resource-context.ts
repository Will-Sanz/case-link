import type { ResourceMatchRow } from "@/types/family";
import type { GeneratedStep, GeneratedStepDetails, PlanPhase } from "./types";

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

    const contacts: GeneratedStepDetails["contacts"] = [];
    if (r.primary_contact_name || r.primary_contact_email || r.primary_contact_phone) {
      contacts.push({
        name: r.primary_contact_name ?? undefined,
        email: r.primary_contact_email ?? undefined,
        phone: r.primary_contact_phone ?? undefined,
        notes: r.primary_contact_title ?? undefined,
      });
    }
    if (
      r.secondary_contact_name ||
      r.secondary_contact_email ||
      r.secondary_contact_phone
    ) {
      contacts.push({
        name: r.secondary_contact_name ?? undefined,
        email: r.secondary_contact_email ?? undefined,
        phone: r.secondary_contact_phone ?? undefined,
      });
    }

    const phaseGuidance =
      phase === "30"
        ? {
            stage_goal: "Initial outreach and intake setup",
            why_now: "First 30 days focus on making contact and starting intake; delays here push back the whole timeline.",
            detailed_instructions: `Call or email ${r.program_name} (${r.office_or_department}) to begin intake or referral. ${contactLine ? `Use: ${contactLine}` : ""} Before reaching out, gather any required documents (ID, proof of address, income verification). After contact, document the representative's name, date, and next steps. Follow up in 3–5 business days if you don't hear back.`,
          }
        : phase === "60"
          ? {
              stage_goal: "Follow-through and application completion",
              why_now: "By day 60, initial outreach should be done; this phase focuses on completing applications and troubleshooting.",
              detailed_instructions: `Follow up on prior contact with ${r.program_name}. Submit any missing documents they requested. Attend scheduled appointments. If you haven't connected yet, try again and document the attempt. Record outcome in case notes.`,
            }
          : {
              stage_goal: "Ongoing support and renewal",
              why_now: "By day 90, focus shifts to sustaining gains, renewing assistance if needed, and contingency planning.",
              detailed_instructions: `Check status with ${r.program_name}. If assistance was granted, note renewal dates. If still pending, escalate or explore fallbacks. Document current status and next steps for ongoing support.`,
            };

    const details: GeneratedStepDetails = {
      ...phaseGuidance,
      rationale: m.match_reason
        ? `This program matches the family's needs: ${m.match_reason}`
        : undefined,
      checklist:
        phase === "30"
          ? [
              "Gather ID, proof of address, and income documents",
              `Contact ${r.program_name} by phone or email`,
              "Document representative name, date, and outcome",
              "Set follow-up reminder for 3–5 business days",
            ]
          : phase === "60"
            ? [
                "Submit any requested documents",
                "Attend scheduled appointments",
                "Document outcome and next steps",
                "Record result in case notes",
              ]
            : [
                "Verify current status",
                "Note renewal or expiration dates",
                "Update case notes with ongoing plan",
              ],
      required_documents:
        phase === "30"
          ? ["ID", "Proof of address", "Income verification"]
          : undefined,
      contacts: contacts.length > 0 ? contacts : undefined,
      expected_outcome:
        phase === "30"
          ? "Intake started; next steps documented"
          : phase === "60"
            ? "Application completed or outcome documented"
            : "Status confirmed; renewal or contingency plan in place",
      milestone_type:
        phase === "30" ? "outreach" : phase === "60" ? "follow_up" : "review",
    };

    return {
      phase,
      title: `Outreach: ${r.program_name}`,
      description,
      sort_order: 0,
      details,
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
