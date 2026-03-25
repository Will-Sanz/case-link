"use client";

import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { PlanWithSteps, PlanStepRow, PlanStepDetails } from "@/types/family";

// --- Text normalization (client-side PDF only; no PII logging) ---

function cleanText(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

function capitalizeWord(w: string): string {
  if (!w) return w;
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

function formatPriority(p: PlanStepRow["priority"] | null | undefined): string | null {
  if (!p || p === "medium") return null;
  if (p === "urgent") return "Urgent";
  return capitalizeWord(p);
}

function formatTimeline(step: PlanStepRow, d: PlanStepDetails | undefined): string | null {
  const timing = cleanText(d?.timing_guidance);
  if (timing) return timing;
  if (step.due_date) {
    const dt = new Date(step.due_date);
    if (!Number.isNaN(dt.getTime())) {
      return dt.toLocaleDateString(undefined, { dateStyle: "medium" });
    }
  }
  return null;
}

/** Single narrative paragraph: description + non-redundant action / guidance. */
function narrativeParagraph(step: PlanStepRow, d: PlanStepDetails | undefined): string | null {
  const desc = cleanText(step.description);
  const actionNow = cleanText(d?.action_needed_now);
  const fromHelper = cleanText(
    (step.ai_helper_data as { action_needed_now?: string } | null | undefined)?.action_needed_now,
  );
  const detailed = cleanText(d?.detailed_instructions);

  const chunks: string[] = [];
  if (desc) chunks.push(desc);

  const secondary = actionNow || fromHelper;
  if (secondary) {
    const dlow = desc.toLowerCase();
    const sub = secondary.toLowerCase().slice(0, Math.min(48, secondary.length));
    if (!desc || (sub.length > 0 && !dlow.includes(sub))) {
      if (secondary !== desc) chunks.push(secondary);
    }
  }

  if (detailed) {
    const joined = chunks.join(" ").toLowerCase();
    const dsub = detailed.toLowerCase().slice(0, Math.min(56, detailed.length));
    if (dsub.length > 0 && !joined.includes(dsub)) {
      chunks.push(detailed);
    }
  }

  return cleanText(chunks.join(" ")) || null;
}

function keyActionBullets(step: PlanStepRow, d: PlanStepDetails | undefined): string[] {
  const bullets: string[] = [];
  const pushUnique = (line: string) => {
    const t = cleanText(line);
    if (!t) return;
    if (!bullets.some((b) => b.toLowerCase() === t.toLowerCase())) bullets.push(t);
  };

  if (step.action_items?.length) {
    const sorted = [...step.action_items].sort((a, b) =>
      a.sort_order !== b.sort_order ? a.sort_order - b.sort_order : a.week_index - b.week_index,
    );
    for (const ai of sorted) {
      const t = cleanText(ai.title);
      if (!t) continue;
      pushUnique(ai.week_index > 1 ? `Week ${ai.week_index}: ${t}` : t);
    }
  }

  if (d?.checklist?.length) {
    for (const c of d.checklist) {
      pushUnique(c);
    }
  }

  return bullets;
}

function documentBullets(d: PlanStepDetails | undefined): string[] {
  if (!d) return [];
  const out: string[] = [];
  const push = (x: string) => {
    const t = cleanText(x);
    if (!t) return;
    if (!out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  };
  for (const x of d.required_documents ?? []) push(x);
  for (const x of d.materials_needed ?? []) push(x);
  return out;
}

function contactLines(d: PlanStepDetails | undefined): string[] {
  if (!d?.contacts?.length) return [];
  return d.contacts
    .map((c) => {
      const name = cleanText(c.name);
      const email = cleanText(c.email);
      const phone = cleanText(c.phone);
      const parts = [name, email, phone].filter(Boolean);
      return parts.length ? parts.join(" · ") : "";
    })
    .filter(Boolean);
}

const styles = StyleSheet.create({
  page: {
    padding: 48,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#111111",
  },
  docTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 14,
    color: "#000000",
  },
  headerLine: {
    fontSize: 10,
    lineHeight: 1.45,
    marginBottom: 3,
    color: "#333333",
  },
  headerBold: {
    fontWeight: "bold",
    color: "#000000",
  },
  barrierSection: {
    marginTop: 12,
    marginBottom: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#bfbfbf",
  },
  sectionLabel: {
    fontSize: 9,
    fontWeight: "bold",
    marginBottom: 6,
    color: "#000000",
  },
  barrierBulletRow: {
    flexDirection: "row",
    marginBottom: 2,
    paddingLeft: 2,
  },
  barrierBullet: { width: 12, fontSize: 9, color: "#333333" },
  barrierText: { flex: 1, fontSize: 9, lineHeight: 1.4, color: "#333333" },
  phaseHeading: {
    fontSize: 12,
    fontWeight: "bold",
    marginTop: 16,
    marginBottom: 8,
    color: "#000000",
  },
  phaseIntro: {
    fontSize: 10,
    lineHeight: 1.45,
    color: "#444444",
    marginBottom: 10,
  },
  stepBlock: {
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#d9d9d9",
  },
  stepTitle: {
    fontSize: 11,
    fontWeight: "bold",
    marginBottom: 5,
    color: "#000000",
  },
  metaLine: {
    fontSize: 9,
    lineHeight: 1.35,
    marginBottom: 2,
    color: "#333333",
  },
  body: {
    fontSize: 10,
    lineHeight: 1.5,
    color: "#222222",
    marginTop: 4,
    marginBottom: 6,
  },
  fieldLabel: {
    fontSize: 9,
    fontWeight: "bold",
    marginTop: 6,
    marginBottom: 3,
    color: "#000000",
  },
  bulletRow: {
    flexDirection: "row",
    marginBottom: 2,
    paddingLeft: 2,
  },
  bullet: { width: 12, fontSize: 10, color: "#222222" },
  bulletText: { flex: 1, fontSize: 10, lineHeight: 1.45, color: "#222222" },
  statusLine: {
    fontSize: 9,
    marginTop: 6,
    color: "#444444",
  },
});

function PdfStep({ step, index }: { step: PlanStepRow; index: number }) {
  const d = step.details as PlanStepDetails | undefined;
  const pri = formatPriority(step.priority ?? undefined);
  const timeline = formatTimeline(step, d);
  const narrative = narrativeParagraph(step, d);
  const actions = keyActionBullets(step, d);
  const docs = documentBullets(d);
  const contacts = contactLines(d);
  const outcome = cleanText(d?.expected_outcome);
  const w = step.workflow_data;
  const blockedNote =
    step.status === "blocked"
      ? cleanText(w?.blocker_reason) || "On hold pending follow-up."
      : null;
  const completedNote =
    step.status === "completed" ? cleanText(w?.outcome_notes ?? null) : null;

  const title = cleanText(step.title) || "Untitled step";

  return (
    <View style={styles.stepBlock}>
      <Text style={styles.stepTitle}>
        {index}. {title}
      </Text>
      {pri ? (
        <Text style={styles.metaLine}>
          Priority: {pri}
        </Text>
      ) : null}
      {timeline ? (
        <Text style={styles.metaLine}>
          Timeline: {timeline}
        </Text>
      ) : null}
      {narrative ? <Text style={styles.body}>{narrative}</Text> : null}
      {actions.length > 0 ? (
        <>
          <Text style={styles.fieldLabel}>Key actions</Text>
          {actions.map((line, i) => (
            <View key={i} style={styles.bulletRow}>
              <Text style={styles.bullet}>•</Text>
              <Text style={styles.bulletText}>{line}</Text>
            </View>
          ))}
        </>
      ) : null}
      {docs.length > 0 ? (
        <>
          <Text style={styles.fieldLabel}>Required documents</Text>
          {docs.map((line, i) => (
            <View key={i} style={styles.bulletRow}>
              <Text style={styles.bullet}>•</Text>
              <Text style={styles.bulletText}>{line}</Text>
            </View>
          ))}
        </>
      ) : null}
      {contacts.length > 0 ? (
        <>
          <Text style={styles.fieldLabel}>Contact</Text>
          {contacts.map((line, i) => (
            <Text key={i} style={styles.body}>
              {line}
            </Text>
          ))}
        </>
      ) : null}
      {outcome ? (
        <>
          <Text style={styles.fieldLabel}>Expected outcome</Text>
          <Text style={styles.body}>{outcome}</Text>
        </>
      ) : null}
      {blockedNote ? <Text style={styles.statusLine}>Status: {blockedNote}</Text> : null}
      {completedNote ? <Text style={styles.statusLine}>Completion notes: {completedNote}</Text> : null}
    </View>
  );
}

export function PlanPdfDocument({
  plan,
  familyName,
  generatedDate,
  barrierLabels,
}: {
  plan: PlanWithSteps;
  familyName?: string;
  generatedDate: string;
  barrierLabels?: string[];
}) {
  const phases = ["30", "60", "90"] as const;
  const stepsByPhase = {
    "30": plan.steps
      .filter((s) => s.phase === "30")
      .sort((a, b) => a.sort_order - b.sort_order),
    "60": plan.steps
      .filter((s) => s.phase === "60")
      .sort((a, b) => a.sort_order - b.sort_order),
    "90": plan.steps
      .filter((s) => s.phase === "90")
      .sort((a, b) => a.sort_order - b.sort_order),
  };

  const barriers = (barrierLabels ?? []).map(cleanText).filter(Boolean);

  return (
    <Document>
      <Page size="A4" style={styles.page} wrap>
        <Text style={styles.docTitle}>Case Plan</Text>

        {familyName ? (
          <Text style={styles.headerLine}>
            <Text style={styles.headerBold}>Family: </Text>
            {cleanText(familyName)}
          </Text>
        ) : null}
        <Text style={styles.headerLine}>
          <Text style={styles.headerBold}>Date generated: </Text>
          {generatedDate}
        </Text>

        {barriers.length > 0 ? (
          <View style={styles.barrierSection}>
            <Text style={styles.sectionLabel}>Barriers identified</Text>
            {barriers.map((b, i) => (
              <View key={i} style={styles.barrierBulletRow}>
                <Text style={styles.barrierBullet}>•</Text>
                <Text style={styles.barrierText}>{b}</Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={{ height: 8 }} />
        )}

        {phases.flatMap((phase) => {
          const steps = stepsByPhase[phase];
          const intro = cleanText(plan.client_display?.phaseSummaries?.[phase]);
          if (steps.length === 0 && !intro) return [];

          return [
            <View key={phase} minPresenceAhead={72}>
              <Text style={styles.phaseHeading}>{phase}-day period</Text>
              {intro ? <Text style={styles.phaseIntro}>{intro}</Text> : null}
              {steps.map((step, idx) => (
                <PdfStep key={step.id} step={step} index={idx + 1} />
              ))}
            </View>,
          ];
        })}
      </Page>
    </Document>
  );
}
