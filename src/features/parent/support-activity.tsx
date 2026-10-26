"use client";
import { useState, type FormEvent } from "react";
import {
  NEED_LABELS,
  OUTCOME_LABELS,
  type SupportRequest,
  type OutcomeState,
  type SupportNeed,
} from "@/lib/parent/domain";
import { getProgram } from "@/lib/parent/programs";
import { parentApi, displayDate } from "./api";
import styles from "./parent.module.css";
export type RecordedOperation = {
  id: string;
  program_id: string;
  state: string;
  created_at: string;
  artifact_id?: string | null;
  request_version?: number;
  need?: SupportNeed | null;
  action?: string;
};
export type OperationHistory = {
  data: { operations: RecordedOperation[]; historyLimited: boolean } | null;
  loading: boolean;
  error: Error | null;
  reload: () => void;
};
export function SupportActivity({
  request,
  onChange,
  history,
}: {
  request: SupportRequest;
  onChange: () => void;
  history: OperationHistory;
}) {
  const { data, error, reload } = history;
  const [need, setNeed] = useState(request.intake.needs[0]),
    [outcome, setOutcome] = useState("support_received"),
    [reference, setReference] = useState("");
  const [pending, setPending] = useState(false),
    [message, setMessage] = useState(""),
    [reportError, setReportError] = useState("");
  async function report(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    setReportError("");
    try {
      await parentApi(`/requests/${request.id}/outcome`, {
        method: "POST",
        body: JSON.stringify({ need, outcome, reference }),
      });
      setMessage(
        "Your report is saved as information from you. It does not replace a program’s recorded receipt or decision.",
      );
      setReference("");
      onChange();
    } catch (err) {
      setReportError(
        err instanceof Error
          ? err.message
          : "We couldn’t save your report. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      {!!data?.operations?.length && (
        <section className={styles.surface}>
          <h2>Recorded packets & receipts</h2>
          <p className={styles.hint}>
            Each download keeps the exact information and evidence recorded for
            that attempt.
          </p>
          <ul className={styles.packetList}>
            {data.operations.map((operation) => (
              <li key={operation.id}>
                <strong>
                  {getProgram(operation.program_id)?.name ?? "Named program"}
                </strong>
                <p className={styles.hint}>
                  {OUTCOME_LABELS[operation.state as OutcomeState] ??
                    "Needs verification"}{" "}
                  · {displayDate(operation.created_at)}
                </p>
                <a
                  className={styles.textLink}
                  href={`/api/parent/requests/${request.id}/operations/${operation.id}/export`}
                >
                  Download recorded information
                </a>
                {operation.artifact_id && (
                  <p className={styles.space}>
                    <a
                      className={styles.textLink}
                      href={`/api/parent/requests/${request.id}/forms/${operation.artifact_id}`}
                    >
                      Download this prepared form
                    </a>
                  </p>
                )}
              </li>
            ))}
          </ul>
          {data.historyLimited && (
            <p className={`${styles.hint} ${styles.space}`}>
              Showing the latest 100 recorded operations. Earlier submissions or
              uncertain deliveries may not appear here.{" "}
              <a className={styles.textLink} href="/api/parent/account/export">
                Download your retained information
              </a>{" "}
              to review earlier history before starting another application.
            </p>
          )}
        </section>
      )}
      {error && (
        <div className={styles.notice}>
          <p>Recorded packet history could not be loaded.</p>
          <button className={styles.quiet} onClick={reload}>
            Try packet history again
          </button>
        </div>
      )}
      <details className={styles.disclosure}>
        <summary>Tell us about an outcome</summary>
        <div>
          <p className={styles.hint}>
            Record help you received or a program response. Never include an
            account number, government ID, password or sign-in code.
          </p>
          <form className={`${styles.form} ${styles.space}`} onSubmit={report}>
            <div className={styles.field}>
              <label htmlFor="report-need">Which support?</label>
              <select
                id="report-need"
                className={styles.select}
                value={need}
                onChange={(e) => setNeed(e.target.value as typeof need)}
              >
                {request.intake.needs.map((n) => (
                  <option key={n} value={n}>
                    {NEED_LABELS[n]}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor="report-outcome">What happened?</label>
              <select
                id="report-outcome"
                className={styles.select}
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
              >
                <option value="support_received">I received support</option>
                <option value="assistance_approved">
                  The program told me assistance was approved
                </option>
                <option value="declined">
                  The program declined assistance
                </option>
                <option value="unresolved">I still need help</option>
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor="report-reference">
                What did you receive or hear, and when?
              </label>
              <textarea
                id="report-reference"
                className={styles.input}
                required
                maxLength={500}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </div>
            <button type="submit" className={styles.button} disabled={pending}>
              {pending ? "Saving…" : "Save my report"}
            </button>
            {message && (
              <p role="status" className={styles.success}>
                {message}
              </p>
            )}
            {reportError && (
              <p role="alert" className={styles.error}>
                {reportError}
              </p>
            )}
          </form>
        </div>
      </details>
    </>
  );
}
