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

  return (
    <View style={styles.stepCard}>
      <Text style={styles.stepStatus}>{step.status.replace("_", " ")}</Text>
      <Text style={styles.stepTitle}>{step.title}</Text>

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
        <Text style={styles.bodyText}>{step.description}</Text>
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
          <Text style={styles.bodyText}>
            {d.required_documents.join(", ")}
          </Text>
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

      {d?.expected_outcome ? (
        <>
          <Text style={styles.sectionLabel}>Success looks like</Text>
          <Text style={styles.bodyText}>{d.expected_outcome}</Text>
        </>
      ) : null}

      {d?.timing_guidance ? (
        <>
          <Text style={styles.sectionLabel}>Timing</Text>
          <Text style={styles.bodyText}>{d.timing_guidance}</Text>
        </>
      ) : null}
    </View>
  );
}

export function PlanPdfDocument({
  plan,
  familyName,
  generatedDate,
}: {
  plan: PlanWithSteps;
  familyName?: string;
  generatedDate: string;
}) {
  const stepsByPhase = {
    "30": plan.steps.filter((s) => s.phase === "30"),
    "60": plan.steps.filter((s) => s.phase === "60"),
    "90": plan.steps.filter((s) => s.phase === "90"),
  };

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>30 / 60 / 90 Day Action Plan</Text>
          {familyName ? (
            <Text style={styles.subtitle}>Family: {familyName}</Text>
          ) : null}
          <Text style={styles.subtitle}>
            Generated {generatedDate} · Plan v{plan.version}
          </Text>
        </View>

        {(["30", "60", "90"] as const).map((phase) => (
          <View key={phase} style={styles.phaseSection}>
            <View style={styles.phaseHeader}>
              <View style={styles.phaseBadge}>
                <Text style={{ color: "white", fontWeight: "bold" }}>{phase}</Text>
              </View>
              <Text style={styles.phaseTitle}>
                {PHASE_LABELS[phase]} focus
              </Text>
            </View>
            {stepsByPhase[phase].map((step) => (
              <StepContent key={step.id} step={step} />
            ))}
          </View>
        ))}
      </Page>
    </Document>
  );
}
