import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import { NEED_LABELS, OUTCOME_LABELS, type SupportRequest } from "./domain";
import type { ParentLocale } from "./locale";
import { parentExportText } from "./export-copy";
import { supportRouteLabel } from "./application-readiness";
import { getProgram } from "./programs";
import { finalizePlanPdf } from "../domain/plan/finalize-plan-pdf";
import { foodAccessPlanSchema, foodAccessReportSchema, SHARE_FOOD_ACCESS_SITE, SHARE_FOOD_ACCESS_SOURCE, type FoodAccessReport } from "./food-access";
const foodReportLabels: Record<FoodAccessReport["result"], string> = {
  received_enough_food: "Collected enough food for this immediate need",
  some_food_still_needed: "Collected some food and still needs help",
  no_food: "No food was available",
  could_not_access: "Could not access this location",
  need_another_way: "Needs another way to get food",
};
const originalLanguageNotice = "Program names, family-entered text and other recorded wording without a reviewed translation remain in their original language. This CaseLink helper is not an official form or official translation.";
const requestStates = { active: "Active", paused: "Paused", cancelled: "Cancelled", closed: "Closed" };
const stoppedRequestMessages = { paused: "You paused this request. Resume when you are ready.", cancelled: "You cancelled this request. Future work is stopped.", closed: "This request is closed. Check the recorded outcomes below." };
const actorLabels: Record<string, string> = { parent: "Parent", caselink: "CaseLink", provider: "Program", operator: "Operator" };
const actionLabels: Record<string, string> = { research: "Research", prepare: "Prepare", share: "Share", submit: "Submit", schedule: "Schedule", follow_up: "Follow up" };
const evidenceLabels: Record<string, string> = { source: "Source", state: "State", reference: "Reference", recordedAt: "Recorded at", observedAt: "Observed at", reason: "Reason", attribution: "Attribution" };
const styles = StyleSheet.create({
  page: {
    padding: 42,
    fontFamily: "Helvetica",
    fontSize: 10,
    lineHeight: 1.5,
    color: "#111111",
  },
  title: { fontSize: 23, marginBottom: 8 },
  subtitle: { fontSize: 11, marginBottom: 24 },
  section: { marginTop: 18, marginBottom: 8, fontSize: 14 },
  route: { marginBottom: 14 },
  label: { fontFamily: "Helvetica-Bold" },
  small: { fontSize: 8, color: "#444444" },
});
export function ParentSummaryDocument({
  request, locale = "en",
}: {
  request: SupportRequest; locale?: ParentLocale;
}) {
  const t = (english: string) => parentExportText(locale, english);
  return (
    <Document title={t("Your CaseLink support summary")} author="CaseLink" language={locale}>
      <Page size="A4" style={styles.page} wrap>
        <Text style={styles.title}>{t("Your support, in one place.")}</Text>
        <Text style={styles.subtitle}>
          {t("CaseLink food and utility support")} · {request.created_at.slice(0, 10)}
        </Text>
        <Text>
          {t("Request")} {request.id} · {t(requestStates[request.status])}
        </Text>
        <Text>
          {request.intake.needs.map((n) => t(NEED_LABELS[n])).join(" / ")}
        </Text>
        <Text style={styles.small}>{t(originalLanguageNotice)}</Text>
        <Text style={styles.section}>{t("What is happening")}</Text>
        {request.plan?.routes.map((route) => {
          const parsed = foodAccessPlanSchema.safeParse(route.foodAccess);
          const food = parsed.success && parsed.data.requestId === request.id ? parsed.data : null;
          const parsedReport = foodAccessReportSchema.safeParse(route.foodAccessReport);
          const foodReport = parsedReport.success && parsedReport.data.requestId === request.id ? parsedReport.data : null;
          return <View key={route.need} style={styles.route}>
            <Text style={styles.label} minPresenceAhead={28}>
              {t(NEED_LABELS[route.need])} · {t(supportRouteLabel(route))}
            </Text>
            <Text>{route.title}</Text>
            <Text>{t(route.summary)}</Text>
            {food && <>
              <Text>{food.site.name} · {food.site.address}</Text>
              {food.state === "prepared" && !foodReport && <Text>{t(food.site.location)} {t(food.site.publishedHours)} {t(food.site.paperwork)}</Text>}
              <Text>{t("Stock unknown. Nothing is reserved. Delivery, language service and physical-access arrangements are not verified.")}</Text>
              <Text>{t("Share guidance reviewed")} {food.source.reviewedOn}.{food.cityObservation ? ` ${t("City directory checked")} ${food.cityObservation.checkedAt}; ${t("this is not confirmation from the location.")}` : ""}</Text>
              <Text style={styles.small}>{t("Share access instructions")}: {food.source.operatorUrl}</Text>
              {foodReport && <>
                <Text>{t("Parent reported:")} {t(foodReportLabels[foodReport.result])}.</Text>
                <Text>{t(foodReport.outcome === "unresolved" ? "Your food need remains open. Check current City listings for other unconfirmed options." : "This food outcome is attributed to your report. Other requested needs keep their own progress.")}</Text>
              </>}
            </>}
            {route.limitation && <Text>{t(route.limitation)}</Text>}
            {route.steps.map((step, i) => (
              <Text key={i}>• {t(step)}</Text>
            ))}
            <Text style={styles.small}>
              {t("Official information")}: {route.sourceUrl}
            </Text>
          </View>;
        })}
        {!request.plan && (
          <Text>
            {t("Your saved request is waiting for preparation. No application or referral is implied.")}
          </Text>
        )}
        <Text style={styles.section}>{t("Your permission")}</Text>
        <Text>
          {t(request.mandate.mode === "prepare_only" ? "Preparation only" : "Bounded service authorization")}.
          {" "}{t(request.status === "active" ? "Valid through" : "Recorded expiry")} {request.mandate.expiresAt.slice(0, 10)}. {t("You can pause or cancel future work in CaseLink.")}
        </Text>
        {request.status !== "active" && <Text>{t(stoppedRequestMessages[request.status])}</Text>}
        <Text style={styles.section}>{t("Activity and evidence")}</Text>
        {(request.events ?? []).map((event) => {
          const parsed = foodAccessReportSchema.safeParse(event.evidence?.foodAccessReport);
          const foodReport = event.actor === "parent" && event.kind === "parent.outcome_reported" && parsed.success && parsed.data.requestId === request.id ? parsed.data : null;
          return <View key={event.id} style={{ marginBottom: 7 }} wrap={false} minPresenceAhead={36}>
            <Text>
              {event.created_at.slice(0, 10)} · {Object.hasOwn(actorLabels, event.actor) ? t(actorLabels[event.actor]) : event.actor}
            </Text>
            <Text>{t(event.summary)}</Text>
            {event.kind === "parent.outcome_reported" &&
              event.actor === "parent" && (
                <>
                  {typeof event.evidence?.outcome === "string" &&
                    Object.hasOwn(OUTCOME_LABELS, event.evidence.outcome) && (
                      <Text>
                        {t("Parent reported outcome:")}{" "}
                        {t(OUTCOME_LABELS[event.evidence.outcome as keyof typeof OUTCOME_LABELS])}
                      </Text>
                    )}
                  {typeof event.evidence?.reference === "string" && (
                    <Text>{event.evidence.reference}</Text>
                  )}
                  {foodReport && <>
                    <Text>{t("Food access report:")} {t(foodReportLabels[foodReport.result])}</Text>
                    <Text>{SHARE_FOOD_ACCESS_SITE.name} · {SHARE_FOOD_ACCESS_SITE.address}</Text>
                    <Text>{t("Parent reported at")} {foodReport.reportedAt}. {t("Share guidance reviewed")} {SHARE_FOOD_ACCESS_SOURCE.reviewedOn}. {t("Share has not confirmed this report.")}</Text>
                  </>}
                </>
              )}
          </View>;
        })}
        {request.events_truncated && (
          <Text style={styles.small}>
            {t("Showing the latest 200 updates. Download your information from your CaseLink account for retained earlier history.")}
          </Text>
        )}
        <Text style={styles.small}>
          {t("This is a current support summary, not an agency application, signature, approval or proof of benefits. Submitted packets and provider receipts are identified separately when available.")}
        </Text>
      </Page>
    </Document>
  );
}
export async function renderParentSummary(
  request: SupportRequest, locale: ParentLocale = "en",
): Promise<Buffer> {
  return Buffer.from(
    await finalizePlanPdf(
      await renderToBuffer(<ParentSummaryDocument request={request} locale={locale} />),
      parentExportText(locale, "CaseLink - Private support summary"), locale,
    ),
  );
}

export type RecordedPacket = {
  id: string;
  request_id: string;
  request_version: number;
  program_id: string;
  action: string;
  packet: Record<string, unknown>;
  packet_hash: string;
  state: string;
  evidence: Record<string, unknown>;
  created_at: string;
  executed_at: string | null;
};
const packetLabels: Record<string, string> = {
  zip: "Household ZIP",
  householdSize: "Household size",
  incomeAmount: "Income before taxes ($)",
  incomeFrequency: "Income frequency",
  utilityProvider: "Utility provider",
  accountAuthority: "Account authority",
  amountDue: "Current amount due ($)",
  totalBalance: "Total account balance ($)",
  dueDate: "Payment due date",
  shutoffDate: "Shutoff date",
  documentIds: "Attached document references",
  statusReference: "Existing program reference",
};
export function ParentPacketDocument({
  operation, locale = "en",
}: {
  operation: RecordedPacket; locale?: ParentLocale;
}) {
  const t = (english: string) => parentExportText(locale, english);
  return (
    <Document title={t("CaseLink recorded packet and receipt")} author="CaseLink" language={locale}>
      <Page size="A4" style={styles.page} wrap>
        <Text style={styles.title}>{t("Your recorded support packet")}</Text>
        <Text style={styles.subtitle}>
          {getProgram(operation.program_id)?.name ?? operation.program_id}
        </Text>
        <Text>
          {t("Recorded state")}: {Object.hasOwn(OUTCOME_LABELS, operation.state) ? t(OUTCOME_LABELS[operation.state as keyof typeof OUTCOME_LABELS]) : operation.state}
        </Text>
        <Text>
          {t("Action")}: {Object.hasOwn(actionLabels, operation.action) ? `${t(actionLabels[operation.action])} (${operation.action})` : operation.action} · {t("Household information version")}: {operation.request_version}
        </Text>
        <Text>
          {t("Prepared at")}: {operation.created_at}
          {operation.executed_at ? ` · ${t("Attempted at")}: ${operation.executed_at}` : ` · ${t("No delivery attempt recorded")}`}
        </Text>
        <Text style={styles.small}>{t(originalLanguageNotice)}</Text>
        <Text style={styles.section}>{t("Exact information for this attempt")}</Text>
        {Object.entries(operation.packet).map(([field, value]) => (
          <View key={field} style={styles.route} wrap={false}>
            <Text style={styles.label}>{Object.hasOwn(packetLabels, field) ? t(packetLabels[field]) : field}</Text>
            <Text>
              {typeof value === "object" ? JSON.stringify(value) : String(value)}
            </Text>
          </View>
        ))}
        <Text style={styles.section}>{t("Attributed evidence")}</Text>
        {Object.keys(operation.evidence ?? {}).length ? (
          Object.entries(operation.evidence)
            .filter(([key]) =>
              [
                "source",
                "state",
                "reference",
                "recordedAt",
                "observedAt",
                "reason",
                "attribution",
              ].includes(key),
            )
            .map(([key, value]) => (
              <Text key={key}>
                {t(evidenceLabels[key] ?? key)}: {typeof value === "object" ? JSON.stringify(value) : String(value)}
              </Text>
            ))
        ) : (
          <Text>{t("No program receipt is recorded for this packet.")}</Text>
        )}
        <Text style={styles.section}>{t("Record identity")}</Text>
        <Text style={styles.small}>
          {t("Request")}: {operation.request_id}
          {"\n"}{t("Operation")}: {operation.id}
          {"\n"}{t("Packet SHA-256")}: {operation.packet_hash}
        </Text>
        <Text style={[styles.small, { marginTop: 14 }]}>
          {t("This preserves the exact recorded packet. Preparation, delivery, program receipt, agency submission, approval and support received are different states. This document does not add an agency signature, certify a personal declaration or prove an outcome beyond the attributed evidence above.")}
        </Text>
      </Page>
    </Document>
  );
}
export async function renderParentPacket(
  operation: RecordedPacket, locale: ParentLocale = "en",
): Promise<Buffer> {
  return Buffer.from(
    await finalizePlanPdf(
      await renderToBuffer(<ParentPacketDocument operation={operation} locale={locale} />),
      parentExportText(locale, "CaseLink - Private packet and evidence"), locale,
    ),
  );
}
