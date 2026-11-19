"use client";

import { Fragment } from "react";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatDateOnly } from "@/lib/dates";
import { cleanPdfText, formatPlanOwner } from "@/features/families/plan-pdf-document";
import type { FamilyTakeawayData } from "@/features/families/family-takeaway-data";

export const FAMILY_TAKEAWAY_TITLE = "Your next steps";

const styles = StyleSheet.create({
  page: { padding: 42, paddingBottom: 52, backgroundColor: "#FFFFFF", color: "#000000", fontFamily: "Helvetica", fontSize: 11, lineHeight: 1.45 },
  title: { fontSize: 23, fontWeight: "bold", lineHeight: 1.2 },
  metadata: { fontSize: 9, marginTop: 8 },
  intro: { marginTop: 14 },
  goal: { marginTop: 22, paddingTop: 9, borderTopWidth: 1, borderTopColor: "#000000", fontSize: 13, fontWeight: "bold" },
  action: { marginTop: 12, paddingBottom: 10, borderBottomWidth: 0.5, borderBottomColor: "#000000" },
  actionTitle: { fontWeight: "bold" },
  detail: { marginTop: 4 },
  contact: { marginTop: 10 },
  label: { fontWeight: "bold" },
  checkIn: { marginTop: 22, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#000000" },
});

export function FamilyTakeawayDocument({ data, familyName, generatedDate }: {
  data: FamilyTakeawayData;
  familyName?: string;
  generatedDate: string;
}) {
  return (
    <Document title={FAMILY_TAKEAWAY_TITLE} subject="Selected next steps discussed with the family">
      <Page size="A4" style={styles.page} wrap>
        <Text style={styles.title}>{FAMILY_TAKEAWAY_TITLE}</Text>
        <Text style={styles.metadata}>{cleanPdfText(familyName) || "Family support"} · Prepared {cleanPdfText(generatedDate)}</Text>
        <Text style={styles.intro}>These are the steps discussed with you. If something changes or a step is difficult, let your case manager know so you can review it together.</Text>
        {data.goals.map((goal, index) => (
          <Fragment key={index}>
            <Text style={styles.goal} minPresenceAhead={90}>{cleanPdfText(goal.title)}</Text>
            {goal.actions.map(action => (
              <View key={action.id} style={styles.action} wrap={false}>
                <Text style={styles.actionTitle}>{cleanPdfText(action.title)}</Text>
                <Text style={styles.detail}>Who: {formatPlanOwner(action.owner)}</Text>
                {action.date ? <Text style={styles.detail}>{action.dateLabel === "Follow-up" ? "Waiting - " : ""}{action.dateLabel}: {formatDateOnly(action.date)}</Text> : null}
              </View>
            ))}
            {goal.contacts.map((contact, contactIndex) => (
              <View key={contactIndex} style={styles.contact} wrap={false}>
                <Text style={styles.label}>Contact: {cleanPdfText(contact.name) || "Support contact"}</Text>
                {contact.phone ? <Text>{cleanPdfText(contact.phone)}</Text> : null}
                {contact.email ? <Text>{cleanPdfText(contact.email)}</Text> : null}
              </View>
            ))}
          </Fragment>
        ))}
        {data.nextCheckIn ? <Text style={styles.checkIn}><Text style={styles.label}>Next check-in: </Text>{formatDateOnly(data.nextCheckIn)}</Text> : null}
      </Page>
    </Document>
  );
}
