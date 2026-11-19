"use client";
import { useParentLocale } from "./parent-locale";
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
  const { t, locale } = useParentLocale();
  if (receipt.state !== "agency_submitted") return null;
  const status = outcome ? undefined : receipt.agencyStatus;
  const interviewChannel = status?.interview?.channel && {
    phone: "by phone", in_person: "in person", video: "by video",
  }[status.interview.channel];
  return (
    <section lang={locale} className={styles.space} aria-label={t("Your SNAP submission record")}>
      <h3>{t("Your submission record") }</h3>
      <p><strong>{t("Recorded reference:") }</strong> {receipt.reference}</p>
      <p className={styles.hint}>
        {t(attribution[receipt.source])} · {" "}
        <time dateTime={receipt.recordedAt}>{displayDate(receipt.recordedAt, true, locale)}</time> {t("(Eastern time)") }{" "}</p>
      <a className={styles.textLink}
        href={`/api/parent/requests/${requestId}/operations/${encodeURIComponent(operationId)}/export`}>
        {t("Download this exact submission record") }{" "}</a>
      <h3 className={styles.space}>{t("What to do next") }</h3>
      {status && <p className={styles.hint}>
        {t(attribution[receipt.source])} {t("· Status reference:") }{" "}{status.reference} · {" "}
        <time dateTime={status.observedAt}>{displayDate(status.observedAt, true, locale)}</time> {t("(Eastern time). Follow the official notice for complete instructions.") }{" "}</p>}
      <ul className={`${styles.list} ${styles.space}`}>
        {status?.documents?.map((document, index) => <li key={index}>
          {t("DHS requested this document:") }{" "}<strong>{document.name}</strong>.
          {document.dueDate && <> {t("Due") }{" "}<time dateTime={document.dueDate}>{displayDate(document.dueDate, false, locale)}</time>.</>}
          {" "}{t("Use the delivery instructions in your DHS notice.") }{" "}</li>)}
        {status?.interview && <li>
          {t("Complete the required SNAP interview") }{interviewChannel ? ` ${t(interviewChannel)}` : ""}.
          {status.interview.scheduledAt
            ? <> {t("Recorded appointment:") }{" "}<time dateTime={status.interview.scheduledAt}>{displayDate(status.interview.scheduledAt, true, locale)}</time> {t("(Eastern time).") }</>
            : t(" Follow your DHS notice to arrange or complete it; no appointment time is recorded here.")}
          {status.interview.dueDate && <> {t("Complete by") }{" "}<time dateTime={status.interview.dueDate}>{displayDate(status.interview.dueDate, false, locale)}</time>.</>}
        </li>}
        {status?.waitingForDecision && <li>{t("DHS’s recorded status is awaiting a decision. Watch for its next notice; this status does not approve benefits.") }</li>}
        <li>{t(outcome
          ? "Use the recorded decision or support outcome and any official notice for your next step."
          : "Watch for the official DHS notice. Submission is separate from an eligibility decision.")}</li>
        {!outcome && !status && <li>{t("Follow the interview instructions and any document deadlines in your DHS notice.") }</li>}
        <li><a className={styles.textLink} href="https://www.pa.gov/services/dhs/track-your-liheap-medicaid-snap-and-tanf-applications">
          {t("Check your application with the official Pennsylvania tracker") }{" "}</a>{t(". Enter any required identifying information directly on the official site.") }</li>
        <li>{t("Keep your submission record and any notices you receive.") }</li>
      </ul>
    </section>
  );
}
