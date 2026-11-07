import type { recordedReceipt } from "./support-activity";
import { displayDate } from "./api";
import styles from "./parent.module.css";

const attribution = {
  agency_receipt: "Agency receipt",
  provider_api: "Program system record",
  authenticated_partner: "Partner confirmed",
  operator_confirmed: "Operator confirmed",
};

export function SnapSubmissionConfirmation({ requestId, operationId, receipt, outcome }: {
  requestId: string;
  operationId: string;
  receipt: NonNullable<ReturnType<typeof recordedReceipt>>;
  outcome?: "assistance_approved" | "support_received" | "declined";
}) {
  if (receipt.state !== "agency_submitted") return null;
  const status = outcome ? undefined : receipt.agencyStatus;
  const interviewChannel = status?.interview?.channel && {
    phone: "by phone", in_person: "in person", video: "by video",
  }[status.interview.channel];
  return (
    <section className={styles.space} aria-label="Your SNAP submission record">
      <h3>Your submission record</h3>
      <p><strong>Recorded reference:</strong> {receipt.reference}</p>
      <p className={styles.hint}>
        {attribution[receipt.source]} · {" "}
        <time dateTime={receipt.recordedAt}>{displayDate(receipt.recordedAt, true)}</time> (Eastern time)
      </p>
      <a className={styles.textLink}
        href={`/api/parent/requests/${requestId}/operations/${encodeURIComponent(operationId)}/export`}>
        Download this exact submission record
      </a>
      <h3 className={styles.space}>What to do next</h3>
      {status && <p className={styles.hint}>
        {attribution[receipt.source]} · Status reference: {status.reference} · {" "}
        <time dateTime={status.observedAt}>{displayDate(status.observedAt, true)}</time> (Eastern time).
        Follow the official notice for complete instructions.
      </p>}
      <ul className={`${styles.list} ${styles.space}`}>
        {status?.documents?.map((document, index) => <li key={index}>
          DHS requested this document: <strong>{document.name}</strong>.
          {document.dueDate && <> Due <time dateTime={document.dueDate}>{displayDate(document.dueDate)}</time>.</>}
          {" "}Use the delivery instructions in your DHS notice.
        </li>)}
        {status?.interview && <li>
          Complete the required SNAP interview{interviewChannel ? ` ${interviewChannel}` : ""}.
          {status.interview.scheduledAt
            ? <> Recorded appointment: <time dateTime={status.interview.scheduledAt}>{displayDate(status.interview.scheduledAt, true)}</time> (Eastern time).</>
            : " Follow your DHS notice to arrange or complete it; no appointment time is recorded here."}
          {status.interview.dueDate && <> Complete by <time dateTime={status.interview.dueDate}>{displayDate(status.interview.dueDate)}</time>.</>}
        </li>}
        {status?.waitingForDecision && <li>DHS’s recorded status is awaiting a decision. Watch for its next notice; this status does not approve benefits.</li>}
        <li>{outcome
          ? "Use the recorded decision or support outcome and any official notice for your next step."
          : "Watch for the official DHS notice. Submission is separate from an eligibility decision."}</li>
        {!outcome && !status && <li>Follow the interview instructions and any document deadlines in your DHS notice.</li>}
        <li><a className={styles.textLink} href="https://www.pa.gov/services/dhs/track-your-liheap-medicaid-snap-and-tanf-applications">
          Check your application with the official Pennsylvania tracker
        </a>. Enter any required identifying information directly on the official site.</li>
        <li>Keep your submission record and any notices you receive.</li>
      </ul>
    </section>
  );
}
