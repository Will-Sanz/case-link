"use client";

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import type { PlanWithSteps, PlanStepRow, PlanStepDetails } from "@/types/family";

const PHASE_LABELS: Record<string, string> = {
  "30": "30-day",
  "60": "60-day",
  "90": "90-day",
};

const ACTION_VERB_RE =
  /\b(call|submit|send|confirm|apply|schedule|register|request|book|gather|arrange|complete|enroll|secure|attend|file|prepare|contact)\b/i;
const ARTIFACT_DOC_RE =
  /\b(photo\s*id|photo\s*i\.?d|proof|lease|rent\s*statement|past-?due|statement|id\b|income\s*loss|layoff)\b/i;
const ARTIFACT_CONTACT_RE =
  /\b(email|phone|landlord\s*(email|phone)|contact\s*info)\b/i;

function isArtifactLikeActionItemTitle(title: string): boolean {
  const t = title.trim();
  if (!t) return false;
  if (ACTION_VERB_RE.test(t)) return false;
  return ARTIFACT_DOC_RE.test(t) || ARTIFACT_CONTACT_RE.test(t);
}

function groupArtifactActionItemsPdf(items: Array<{
  id: string;
  title: string;
  target_date: string | null;
  week_index: number;
  description: string | null;
  sort_order: number;
}>) {
  const groups: Array<{
    parent: (typeof items)[number];
    artifacts: (typeof items)[number][];
  }> = [];
  const orphans: Array<(typeof items)[number]> = [];
  let currentGroupIndex = -1;
  for (const item of items) {
    if (isArtifactLikeActionItemTitle(item.title)) {
      if (currentGroupIndex >= 0) {
        groups[currentGroupIndex]?.artifacts.push(item);
      } else {
        orphans.push(item);
      }
    } else {
      groups.push({ parent: item, artifacts: [] });
      currentGroupIndex = groups.length - 1;
    }
  }
  return { groups, orphans };
}

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: "Helvetica",
  },
  header: {
    marginBottom: 24,
    paddingBottom: 16,
    borderBottomWidth: 2,
    borderBottomColor: "#0d9488",
  },
  title: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#0f172a",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 11,
    color: "#64748b",
  },
  phaseSection: {
    marginBottom: 20,
  },
  phaseHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    paddingVertical: 4,
  },
  phaseBadge: {
    backgroundColor: "#0d9488",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginRight: 8,
  },
  phaseTitle: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#0f172a",
  },
  stepCard: {
    marginBottom: 12,
    padding: 12,
    backgroundColor: "#f8fafc",
    borderRadius: 4,
    borderLeftWidth: 3,
    borderLeftColor: "#0d9488",
  },
  stepTitle: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#0f172a",
    marginBottom: 6,
  },
  stepStatus: {
    fontSize: 8,
    color: "#64748b",
    marginBottom: 6,
    textTransform: "uppercase",
  },
  sectionLabel: {
    fontSize: 8,
    fontWeight: "bold",
    color: "#64748b",
    marginTop: 8,
    marginBottom: 4,
    textTransform: "uppercase",
  },
  bodyText: {
    fontSize: 10,
    color: "#334155",
    lineHeight: 1.5,
    marginBottom: 4,
  },
  listItem: {
    flexDirection: "row",
    marginBottom: 2,
  },
  bullet: {
    width: 12,
    fontSize: 10,
    color: "#0d9488",
  },
  contactLine: {
    fontSize: 9,
    color: "#334155",
    marginBottom: 2,
  },
});

function StepContent({ step }: { step: PlanStepRow }) {
  const d = step.details as PlanStepDetails | null | undefined;
  const w = step.workflow_data as { outcome_notes?: string; blocker_reason?: string } | null | undefined;
  const helperData = step.ai_helper_data as { action_needed_now?: string } | null | undefined;
  const dueDate = step.due_date
    ? new Date(step.due_date).toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;
  const isCompleted = step.status === "completed";
  const isBlocked = step.status === "blocked";
  const actionNow = d?.action_needed_now ?? helperData?.action_needed_now;

  return (
    <View style={styles.stepCard}>
      <Text style={styles.stepTitle}>{step.title}</Text>

      {step.status ? (
        <Text style={styles.stepStatus}>{step.status.replace("_", " ")}</Text>
      ) : null}

      {d?.priority ? (
        <Text style={[styles.bodyText, { marginBottom: 6 }]}>Priority: {d.priority}</Text>
      ) : null}

      {actionNow ? (
        <>
          <Text style={styles.sectionLabel}>Action needed now</Text>
          <Text style={[styles.bodyText, { fontWeight: "bold", marginBottom: 8 }]}>{actionNow}</Text>
        </>
      ) : null}

      {(d?.stage_goal || d?.why_now) ? (
        <>
          {d?.stage_goal ? (
            <>
              <Text style={styles.sectionLabel}>Stage focus</Text>
              <Text style={styles.bodyText}>{d.stage_goal}</Text>
            </>
          ) : null}
          {d?.why_now ? (
            <>
              <Text style={styles.sectionLabel}>Why now</Text>
              <Text style={styles.bodyText}>{d.why_now}</Text>
            </>
          ) : null}
        </>
      ) : null}

      {d?.rationale ? (
        <>
          <Text style={styles.sectionLabel}>Why this matters</Text>
          <Text style={styles.bodyText}>{d.rationale}</Text>
        </>
      ) : null}

      {d?.detailed_instructions ? (
        <>
          <Text style={styles.sectionLabel}>What to do</Text>
          <Text style={styles.bodyText}>{d.detailed_instructions}</Text>
        </>
      ) : step.description ? (
        <>
          <Text style={styles.sectionLabel}>What to do</Text>
          <Text style={styles.bodyText}>{step.description}</Text>
        </>
      ) : null}

      {d?.contact_script ? (
        <>
          <Text style={styles.sectionLabel}>What to say (outreach script)</Text>
          <Text style={styles.bodyText}>{d.contact_script}</Text>
        </>
      ) : null}

      {d?.checklist && d.checklist.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>Checklist</Text>
          {d.checklist.map((item, i) => (
            <View key={i} style={styles.listItem}>
              <Text style={styles.bullet}>•</Text>
              <Text style={styles.bodyText}>{item}</Text>
            </View>
          ))}
        </>
      ) : null}

      {d?.required_documents && d.required_documents.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>What to prepare</Text>
          <Text style={styles.bodyText}>{d.required_documents.join(", ")}</Text>
        </>
      ) : null}

      {d?.contacts && d.contacts.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>Contacts</Text>
          {d.contacts.map((c, i) => (
            <Text key={i} style={styles.contactLine}>
              {[c.name, c.phone, c.email].filter(Boolean).join(" · ")}
              {c.notes ? ` — ${c.notes}` : ""}
            </Text>
          ))}
        </>
      ) : null}

      {d?.expected_outcome ? (
        <>
          <Text style={styles.sectionLabel}>Success looks like</Text>
          <Text style={styles.bodyText}>{d.expected_outcome}</Text>
        </>
      ) : null}

      {d?.blockers && d.blockers.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>Common blockers</Text>
          {d.blockers.map((b, i) => (
            <View key={i} style={styles.listItem}>
              <Text style={styles.bullet}>•</Text>
              <Text style={styles.bodyText}>{b}</Text>
            </View>
          ))}
        </>
      ) : null}

      {d?.fallback_options && d.fallback_options.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>Fallback options</Text>
          {d.fallback_options.map((f, i) => (
            <View key={i} style={styles.listItem}>
              <Text style={styles.bullet}>•</Text>
              <Text style={styles.bodyText}>{f}</Text>
            </View>
          ))}
        </>
      ) : null}

      {d?.timing_guidance ? (
        <>
          <Text style={styles.sectionLabel}>When</Text>
          <Text style={styles.bodyText}>{d.timing_guidance}</Text>
        </>
      ) : null}

      {step.action_items && step.action_items.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>Weekly action items</Text>
          {(() => {
            const sorted = [...step.action_items!].sort((a, b) => a.sort_order - b.sort_order);
            const { groups, orphans } = groupArtifactActionItemsPdf(
              sorted as Array<{
                id: string;
                title: string;
                target_date: string | null;
                week_index: number;
                description: string | null;
                sort_order: number;
              }>,
            );

            return (
              <>
                {groups.map((g) => (
                  <View key={g.parent.id} style={styles.listItem}>
                    <Text style={styles.bullet}>•</Text>
                    <View>
                      <Text style={styles.bodyText}>
                        Week {g.parent.week_index}: {g.parent.title}
                        {g.parent.target_date
                          ? ` (${new Date(g.parent.target_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })})`
                          : ""}
                      </Text>
                      {g.parent.description ? (
                        <Text
                          style={[
                            styles.bodyText,
                            { marginLeft: 8, color: "#64748b", fontSize: 9 },
                          ]}
                        >
                          {g.parent.description}
                        </Text>
                      ) : null}
                      {g.artifacts.length > 0 ? (
                        <>
                          {g.artifacts.map((a) => (
                            <Text
                              key={a.id}
                              style={[
                                styles.bodyText,
                                { marginLeft: 14, color: "#475569", fontSize: 9 },
                              ]}
                            >
                              • {a.title}
                              {a.target_date
                                ? ` (Due ${new Date(a.target_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })})`
                                : ""}
                            </Text>
                          ))}
                        </>
                      ) : null}
                    </View>
                  </View>
                ))}
                {orphans.length > 0 ? (
                  <>
                    <Text style={[styles.sectionLabel, { marginTop: 8 }]}>Additional items</Text>
                    {orphans.map((a) => (
                      <View key={a.id} style={styles.listItem}>
                        <Text style={styles.bullet}>•</Text>
                        <Text style={styles.bodyText}>{a.title}</Text>
                      </View>
                    ))}
                  </>
                ) : null}
              </>
            );
          })()}
        </>
      ) : null}

      {dueDate ? (
        <Text style={[styles.bodyText, { marginTop: 6, color: "#0d9488", fontWeight: "bold" }]}>
          Follow-up date: {dueDate}
        </Text>
      ) : null}

      {isCompleted && w?.outcome_notes ? (
        <Text style={[styles.bodyText, { marginTop: 6, color: "#047857" }]}>
          Completed: {w.outcome_notes}
        </Text>
      ) : null}

      {isBlocked ? (
        <Text style={[styles.bodyText, { marginTop: 6, color: "#b91c1c", fontStyle: "italic" }]}>
          {w?.blocker_reason ? `Blocked: ${w.blocker_reason}` : "Currently on hold — your case manager will follow up"}
        </Text>
      ) : null}
    </View>
  );
}

function phaseIntro(
  plan: PlanWithSteps,
  phase: "30" | "60" | "90",
): string | null {
  const s = plan.client_display?.phaseSummaries?.[phase]?.trim();
  if (s) return s;
  return null;
}

export function PlanPdfDocument({
  plan,
  familyName,
  documentTitle,
  generatedDate,
}: {
  plan: PlanWithSteps;
  familyName?: string;
  documentTitle?: string;
  generatedDate: string;
}) {
  const stepsByPhase = {
    "30": plan.steps.filter((s) => s.phase === "30"),
    "60": plan.steps.filter((s) => s.phase === "60"),
    "90": plan.steps.filter((s) => s.phase === "90"),
  };

  const mainTitle =
    documentTitle?.trim() ||
    plan.client_display?.title?.trim() ||
    plan.summary?.trim() ||
    "30 / 60 / 90 Day Plan";

  const phases: Array<"30" | "60" | "90"> = ["30", "60", "90"];

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>{mainTitle}</Text>
          {familyName ? (
            <Text style={styles.subtitle}>Case / family: {familyName}</Text>
          ) : null}
          <Text style={styles.subtitle}>Plan version {plan.version}</Text>
          <Text style={styles.subtitle}>Exported {generatedDate}</Text>
        </View>

        {phases.map((phase) => {
          const intro = phaseIntro(plan, phase);
          return (
            <View key={phase} style={styles.phaseSection}>
              <View style={styles.phaseHeader}>
                <View style={styles.phaseBadge}>
                  <Text style={{ color: "white", fontWeight: "bold" }}>{phase}</Text>
                </View>
                <Text style={styles.phaseTitle}>
                  {PHASE_LABELS[phase]} horizon
                </Text>
              </View>
              {intro ? (
                <Text style={[styles.bodyText, { marginBottom: 10, fontStyle: "italic" }]}>
                  {intro}
                </Text>
              ) : null}
              {stepsByPhase[phase].map((step) => (
                <StepContent key={step.id} step={step} />
              ))}
            </View>
          );
        })}
      </Page>
    </Document>
  );
}
