import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import { NEED_LABELS, OUTCOME_LABELS, type SupportRequest } from "./domain";
import { getProgram } from "./programs";
import { finalizePlanPdf } from "../domain/plan/finalize-plan-pdf";
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
  request,
}: {
  request: SupportRequest;
}) {
  return (
    <Document title="Your CaseLink support summary" author="CaseLink">
      <Page size="A4" style={styles.page} wrap>
        <Text style={styles.title}>Your support, in one place.</Text>
        <Text style={styles.subtitle}>
          CaseLink food and utility support · {request.created_at.slice(0, 10)}
        </Text>
        <Text>
          Request {request.id} · {request.status}
        </Text>
        <Text>
          {request.intake.needs.map((n) => NEED_LABELS[n]).join(" / ")}
        </Text>
        <Text style={styles.section}>What is happening</Text>
        {request.plan?.routes.map((route) => (
          <View key={route.need} style={styles.route} wrap={false}>
            <Text style={styles.label}>
              {NEED_LABELS[route.need]} · {OUTCOME_LABELS[route.state]}
            </Text>
            <Text>{route.title}</Text>
            <Text>{route.summary}</Text>
            {route.limitation && <Text>{route.limitation}</Text>}
            {route.steps.map((step, i) => (
              <Text key={i}>• {step}</Text>
            ))}
            <Text style={styles.small}>
              Official information: {route.sourceUrl}
            </Text>
          </View>
        ))}
        {!request.plan && (
          <Text>
            Your saved request is waiting for preparation. No application or
            referral is implied.
          </Text>
        )}
        <Text style={styles.section}>Your permission</Text>
        <Text>
          {request.mandate.mode === "prepare_only"
            ? "Preparation only"
            : "Bounded service authorization"}
          . Valid through {request.mandate.expiresAt.slice(0, 10)}. You can
          pause or cancel future work in CaseLink.
        </Text>
        <Text style={styles.section}>Activity and evidence</Text>
        {(request.events ?? []).map((event) => (
          <View key={event.id} style={{ marginBottom: 7 }} wrap={false}>
            <Text>
              {event.created_at.slice(0, 10)} · {event.actor}
            </Text>
            <Text>{event.summary}</Text>
            {event.kind === "parent.outcome_reported" &&
              event.actor === "parent" && (
                <>
                  {typeof event.evidence?.outcome === "string" &&
                    Object.hasOwn(OUTCOME_LABELS, event.evidence.outcome) && (
                      <Text>
                        Parent reported outcome:{" "}
                        {
                          OUTCOME_LABELS[
                            event.evidence
                              .outcome as keyof typeof OUTCOME_LABELS
                          ]
                        }
                      </Text>
                    )}
                  {typeof event.evidence?.reference === "string" && (
                    <Text>{event.evidence.reference}</Text>
                  )}
                </>
              )}
          </View>
        ))}
        {request.events_truncated && (
          <Text style={styles.small}>
            Showing the latest 200 updates. Download your information from your
            CaseLink account for retained earlier history.
          </Text>
        )}
        <Text style={styles.small}>
          This is a current support summary, not an agency application,
          signature, approval or proof of benefits. Submitted packets and
          provider receipts are identified separately when available.
        </Text>
      </Page>
    </Document>
  );
}
export async function renderParentSummary(
  request: SupportRequest,
): Promise<Buffer> {
  return Buffer.from(
    await finalizePlanPdf(
      await renderToBuffer(<ParentSummaryDocument request={request} />),
      "CaseLink - Private support summary",
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
  operation,
}: {
  operation: RecordedPacket;
}) {
  return (
    <Document title="CaseLink recorded packet and receipt" author="CaseLink">
      <Page size="A4" style={styles.page} wrap>
        <Text style={styles.title}>Your recorded support packet</Text>
        <Text style={styles.subtitle}>
          {getProgram(operation.program_id)?.name ?? operation.program_id}
        </Text>
        <Text>
          Recorded state:{" "}
          {OUTCOME_LABELS[operation.state as keyof typeof OUTCOME_LABELS] ??
            operation.state.replaceAll("_", " ")}
        </Text>
        <Text>
          Action: {operation.action.replaceAll("_", " ")} · Household
          information version: {operation.request_version}
        </Text>
        <Text>
          Prepared: {operation.created_at}
          {operation.executed_at
            ? ` · Attempted: ${operation.executed_at}`
            : " · No delivery attempt recorded"}
        </Text>
        <Text style={styles.section}>Exact information for this attempt</Text>
        {Object.entries(operation.packet).map(([field, value]) => (
          <View key={field} style={styles.route} wrap={false}>
            <Text style={styles.label}>{packetLabels[field] ?? field}</Text>
            <Text>
              {Array.isArray(value)
                ? value.map(String).join(", ")
                : typeof value === "object"
                  ? JSON.stringify(value)
                  : String(value)}
            </Text>
          </View>
        ))}
        <Text style={styles.section}>Attributed evidence</Text>
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
                {key.replaceAll("_", " ")}: {String(value)}
              </Text>
            ))
        ) : (
          <Text>No program receipt is recorded for this packet.</Text>
        )}
        <Text style={styles.section}>Record identity</Text>
        <Text style={styles.small}>
          Request: {operation.request_id}
          {"\n"}Operation: {operation.id}
          {"\n"}Packet SHA-256: {operation.packet_hash}
        </Text>
        <Text style={[styles.small, { marginTop: 14 }]}>
          This preserves the exact recorded packet. Preparation, delivery,
          program receipt, agency submission, approval and support received are
          different states. This document does not add an agency signature,
          certify a personal declaration or prove an outcome beyond the
          attributed evidence above.
        </Text>
      </Page>
    </Document>
  );
}
export async function renderParentPacket(
  operation: RecordedPacket,
): Promise<Buffer> {
  return Buffer.from(
    await finalizePlanPdf(
      await renderToBuffer(<ParentPacketDocument operation={operation} />),
      "CaseLink - Private packet and evidence",
    ),
  );
}
