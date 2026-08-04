"use client";

import { Fragment } from "react";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { actionUiStatus } from "@/lib/domain/plan/action-state";
import { groupPlanStepsByGoal } from "@/lib/domain/plan/group-plan-steps";
import type { PlanStepDetails, PlanStepRow, PlanWithSteps } from "@/types/family";

export const PLAN_PDF_TITLE = "Family Support Intervention Plan";
export const PLAN_PDF_PALETTE = { ink: "#000000", paper: "#FFFFFF" } as const;

function cleanText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

function formatOwner(owner: PlanStepDetails["owner"]): string {
  if (owner === "family") return "Family";
  if (owner === "shared") return "Shared";
  if (owner === "school_program") return "School / program";
  return "Case manager";
}

function formatPriority(priority: PlanStepRow["priority"]): string {
  if (priority === "urgent") return "Urgent";
  if (priority === "high") return "High";
  if (priority === "low") return "Low";
  return "Standard";
}

function formatDateOnly(value: string | null): string {
  if (!value) return "Not set";
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function narrative(step: PlanStepRow): string | null {
  const details = step.details ?? {};
  const values = [
    cleanText(step.description),
    cleanText(details.action_needed_now),
    cleanText(details.detailed_instructions),
  ].filter(Boolean);
  const unique = values.filter(
    (value, index) =>
      values.findIndex((candidate) => candidate.toLowerCase() === value.toLowerCase()) === index,
  );
  return unique.join(" ") || null;
}

function uniqueLines(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  return values.flatMap((raw) => {
    const value = cleanText(raw);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return [];
    seen.add(key);
    return [value];
  });
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 42,
    paddingRight: 42,
    paddingBottom: 52,
    paddingLeft: 42,
    backgroundColor: PLAN_PDF_PALETTE.paper,
    color: PLAN_PDF_PALETTE.ink,
    fontFamily: "Helvetica",
    fontSize: 9.5,
    lineHeight: 1.4,
  },
  title: {
    fontSize: 18,
    fontWeight: "bold",
    lineHeight: 1.15,
  },
  titleRule: {
    marginTop: 11,
    borderBottomWidth: 1.5,
    borderBottomColor: PLAN_PDF_PALETTE.ink,
  },
  metadata: {
    marginTop: 11,
    flexDirection: "row",
    flexWrap: "wrap",
  },
  metadataItem: {
    width: "50%",
    paddingRight: 12,
    marginBottom: 5,
  },
  label: {
    fontWeight: "bold",
  },
  section: {
    marginTop: 18,
  },
  sectionHeading: {
    fontWeight: "bold",
    fontSize: 11,
    marginBottom: 7,
  },
  barrierList: {
    borderTopWidth: 0.75,
    borderTopColor: PLAN_PDF_PALETTE.ink,
  },
  barrierRow: {
    flexDirection: "row",
    paddingTop: 4,
    paddingBottom: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: PLAN_PDF_PALETTE.ink,
  },
  bullet: {
    width: 14,
  },
  grow: {
    flexGrow: 1,
    flexShrink: 1,
  },
  goal: {
    marginTop: 20,
  },
  goalHeader: {
    paddingTop: 7,
    paddingRight: 8,
    paddingBottom: 7,
    paddingLeft: 8,
    borderTopWidth: 1.25,
    borderBottomWidth: 0.75,
    borderTopColor: PLAN_PDF_PALETTE.ink,
    borderBottomColor: PLAN_PDF_PALETTE.ink,
  },
  goalTitle: {
    fontWeight: "bold",
    fontSize: 12,
  },
  goalProgress: {
    marginTop: 3,
    fontSize: 8.5,
  },
  step: {
    paddingTop: 11,
    paddingRight: 8,
    paddingBottom: 11,
    paddingLeft: 8,
    borderBottomWidth: 0.75,
    borderBottomColor: PLAN_PDF_PALETTE.ink,
  },
  stepTitle: {
    fontWeight: "bold",
    fontSize: 10.5,
  },
  meta: {
    marginTop: 3,
    fontSize: 8.5,
  },
  narrative: {
    marginTop: 7,
  },
  fieldHeading: {
    marginTop: 8,
    marginBottom: 3,
    fontWeight: "bold",
    fontSize: 8.5,
  },
  actionTable: {
    marginTop: 8,
    borderTopWidth: 0.75,
    borderLeftWidth: 0.75,
    borderRightWidth: 0.75,
    borderColor: PLAN_PDF_PALETTE.ink,
  },
  actionHeader: {
    flexDirection: "row",
    borderBottomWidth: 0.75,
    borderBottomColor: PLAN_PDF_PALETTE.ink,
    fontWeight: "bold",
    fontSize: 8,
  },
  actionRow: {
    flexDirection: "row",
    borderBottomWidth: 0.75,
    borderBottomColor: PLAN_PDF_PALETTE.ink,
  },
  actionCell: {
    width: "58%",
    paddingTop: 5,
    paddingRight: 6,
    paddingBottom: 5,
    paddingLeft: 6,
  },
  dateCell: {
    width: "22%",
    paddingTop: 5,
    paddingRight: 5,
    paddingBottom: 5,
    paddingLeft: 5,
    borderLeftWidth: 0.5,
    borderLeftColor: PLAN_PDF_PALETTE.ink,
  },
  statusCell: {
    width: "20%",
    paddingTop: 5,
    paddingRight: 5,
    paddingBottom: 5,
    paddingLeft: 5,
    borderLeftWidth: 0.5,
    borderLeftColor: PLAN_PDF_PALETTE.ink,
  },
  actionDetail: {
    marginTop: 2,
    fontSize: 8,
  },
  listRow: {
    flexDirection: "row",
    marginTop: 2,
  },
});

function PdfActionTable({ step }: { step: PlanStepRow }) {
  const actions = [...(step.action_items ?? [])].sort((a, b) => {
    const aDate = a.status === "blocked" ? a.follow_up_date ?? a.target_date : a.target_date;
    const bDate = b.status === "blocked" ? b.follow_up_date ?? b.target_date : b.target_date;
    if (aDate && bDate && aDate !== bDate) return aDate.localeCompare(bDate);
    if (aDate && !bDate) return -1;
    if (!aDate && bDate) return 1;
    return a.sort_order - b.sort_order;
  });
  if (actions.length === 0) return null;

  return (
    <View style={styles.actionTable}>
      <View style={styles.actionHeader}>
        <Text style={styles.actionCell}>Action</Text>
        <Text style={styles.dateCell}>Target / follow-up</Text>
        <Text style={styles.statusCell}>Status</Text>
      </View>
      {actions.map((action) => {
        const displayDate =
          action.status === "blocked"
            ? action.follow_up_date ?? action.target_date
            : action.target_date;
        return (
          <View key={action.id} style={styles.actionRow}>
            <View style={styles.actionCell}>
              <Text style={styles.label}>{cleanText(action.title) || "Untitled action"}</Text>
              {cleanText(action.description) ? <Text style={styles.actionDetail}>{cleanText(action.description)}</Text> : null}
              {cleanText(action.notes) ? <Text style={styles.actionDetail}>Progress: {cleanText(action.notes)}</Text> : null}
              {cleanText(action.outcome) ? <Text style={styles.actionDetail}>Outcome: {cleanText(action.outcome)}</Text> : null}
            </View>
            <Text style={styles.dateCell}>{formatDateOnly(displayDate)}</Text>
            <Text style={styles.statusCell}>{actionUiStatus(action).replaceAll("_", " ")}</Text>
          </View>
        );
      })}
    </View>
  );
}

function PdfStep({ step }: { step: PlanStepRow }) {
  const details = step.details ?? {};
  const documents = uniqueLines([
    ...(details.required_documents ?? []),
    ...(details.materials_needed ?? []),
  ]);
  const contacts = uniqueLines(
    (details.contacts ?? []).map((contact) =>
      [contact.name, contact.phone, contact.email, contact.notes]
        .map(cleanText)
        .filter(Boolean)
        .join(" · "),
    ),
  );
  const body = narrative(step);

  return (
    <View style={styles.step} minPresenceAhead={80}>
      <Text style={styles.stepTitle}>{cleanText(step.title) || "Plan action"}</Text>
      <Text style={styles.meta}>Owner: {formatOwner(details.owner)} · Priority: {formatPriority(step.priority)}</Text>
      {body ? <Text style={styles.narrative}>{body}</Text> : null}
      <PdfActionTable step={step} />
      {documents.length > 0 ? (
        <View>
          <Text style={styles.fieldHeading}>Documents or materials</Text>
          {documents.map((line) => <View key={line} style={styles.listRow}><Text style={styles.bullet}>•</Text><Text style={styles.grow}>{line}</Text></View>)}
        </View>
      ) : null}
      {contacts.length > 0 ? (
        <View>
          <Text style={styles.fieldHeading}>Contacts</Text>
          {contacts.map((line) => <Text key={line}>{line}</Text>)}
        </View>
      ) : null}
      {cleanText(details.expected_outcome) ? (
        <View>
          <Text style={styles.fieldHeading}>Expected outcome</Text>
          <Text>{cleanText(details.expected_outcome)}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function PlanPdfDocument({
  plan,
  familyName,
  generatedDate,
  barrierLabels = [],
}: {
  plan: PlanWithSteps;
  familyName?: string;
  generatedDate: string;
  barrierLabels?: string[];
}) {
  const goals = groupPlanStepsByGoal(plan.steps);
  const barriers = uniqueLines(barrierLabels);

  return (
    <Document title={PLAN_PDF_TITLE} subject="Reviewed family-support intervention plan">
      <Page size="A4" style={styles.page} wrap>
        <Text style={styles.title}>{PLAN_PDF_TITLE}</Text>
        <View style={styles.titleRule} />
        <View style={styles.metadata}>
          <Text style={styles.metadataItem}><Text style={styles.label}>Family label: </Text>{cleanText(familyName) || "Not provided"}</Text>
          <Text style={styles.metadataItem}><Text style={styles.label}>Prepared: </Text>{generatedDate}</Text>
          <Text style={styles.metadataItem}><Text style={styles.label}>Plan version: </Text>{plan.version}</Text>
          <Text style={styles.metadataItem}><Text style={styles.label}>Plan status: </Text>{plan.client_display?.reviewedAt ? "Reviewed" : "Draft"}</Text>
        </View>

        {cleanText(plan.summary) ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Plan summary</Text>
            <Text>{cleanText(plan.summary)}</Text>
          </View>
        ) : null}

        {barriers.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Current barriers</Text>
            <View style={styles.barrierList}>
              {barriers.map((barrier) => <View key={barrier} style={styles.barrierRow}><Text style={styles.bullet}>•</Text><Text style={styles.grow}>{barrier}</Text></View>)}
            </View>
          </View>
        ) : null}

        {goals.map((goal, goalIndex) => (
          <Fragment key={goal.key}>
            <View style={[styles.goal, styles.goalHeader]} minPresenceAhead={160}>
              <Text style={styles.goalTitle}>Goal {goalIndex + 1}: {goal.title}</Text>
              <Text style={styles.goalProgress}>
                {goal.completedActionCount} of {goal.actionCount} dated actions complete
                {goal.earliestOpenTargetDate ? ` · Next target ${formatDateOnly(goal.earliestOpenTargetDate)}` : ""}
              </Text>
            </View>
            {goal.steps.map((step) => <PdfStep key={step.id} step={step} />)}
          </Fragment>
        ))}

      </Page>
    </Document>
  );
}
