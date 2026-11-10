"use client";
import { useEffect, useId, useState, type FormEvent } from "react";
import {
  NEED_LABELS,
  OUTCOME_LABELS,
  type SupportRequest,
  type OutcomeState,
  type SupportNeed,
  type NecessaryAction,
} from "@/lib/parent/domain";
import { getProgram } from "@/lib/parent/programs";
import { receiptSchema } from "@/lib/parent/policy";
import { snapProtectedReferenceSchema, snapProtectedOperationSchema, snapProtectedDeliveryAttempt } from "@/lib/parent/snap-protected-operation";
import { parentApi, displayDate, ParentApiError } from "./api";
import { ParentLoading, ServiceError } from "./feedback";
import { SnapReviewPdf } from "./snap-review-pdf";
import styles from "./parent.module.css";
import { usePermissionWindow } from "./use-permission-window";
export type RecordedOperation = {
  id: string;
  request_id?: string;
  program_id: string;
  state: string;
  created_at: string;
  artifact_id?: string | null;
  protected_packet?: unknown;
  form?: { readonly preparation_only: boolean } | null;
  request_version?: number;
  need?: SupportNeed | null;
  action?: string;
  evidence?: Record<string, unknown> | null;
};
export function protectedRecordedSnapPacket(operation: Pick<RecordedOperation, "need" | "program_id" | "action" | "artifact_id" | "protected_packet">) {
  const reference = snapProtectedReferenceSchema.safeParse(operation.protected_packet);
  return operation.need === "snap_new" && operation.program_id === "snap-pa" && operation.action === "submit" && operation.artifact_id === null && reference.success ? reference.data : null;
}
export function currentSnapReview(request: Pick<SupportRequest, "id" | "version">, input: unknown) {
  const review = snapProtectedOperationSchema.safeParse(input);
  return review.success && review.data.requestId === request.id && review.data.requestVersion === request.version ? review.data : null;
}
export function isSnapFinalReviewAction(action: NecessaryAction) {
  return action.need === "snap_new" && action.reason === "submission_review" && action.field === "snap_final_submit";
}
export function currentProtectedSnapAttempt(request: Pick<SupportRequest, "id" | "version" | "intake">, operations: readonly RecordedOperation[]) {
  return request.intake.needs.includes("snap_new") && operations.some(operation => operation.request_id === request.id && operation.request_version === request.version && protectedRecordedSnapPacket(operation)
    && snapProtectedDeliveryAttempt(operation.state));
}
export function recordedReceipt(operation: Pick<RecordedOperation, "state" | "evidence">) {
  const evidence = operation.evidence ?? {};
  const receipt = receiptSchema.safeParse({
    state: operation.state,
    source: evidence.source,
    reference: evidence.reference,
    recordedAt: evidence.recordedAt ?? evidence.observedAt,
    ...(evidence.agencyStatus !== undefined ? { agencyStatus: evidence.agencyStatus } : {}),
  });
  return receipt.success && receipt.data.reference.trim() ? receipt.data : null;
}
export type OperationHistory = {
  data: { operations: RecordedOperation[]; historyLimited: boolean } | null;
  loading: boolean;
  error: Error | null;
  reload: () => void;
};
export function currentSnapDraft(request: SupportRequest, operations: readonly RecordedOperation[]) {
  if (!request.intake.needs.includes("snap_new") || request.status !== "active" || !(Date.parse(request.mandate.expiresAt) > Date.now())) return null;
  const current = operations.filter(operation => operation.artifact_id && operation.need === "snap_new" && operation.program_id === "snap-pa"
    && operation.action === "prepare" && operation.form?.preparation_only === true && operation.state === "prepared"
    && operation.request_id === request.id && operation.request_version === request.version);
  return current.length === 1 ? current[0] : null;
}

const draftDisplayReady = () => undefined; // Inspecting an unsigned draft never authorizes submission.
export function SnapDraftReview({ request, operation }: { request: SupportRequest; operation: RecordedOperation }) {
  const id = useId(), [open, setOpen] = useState(false), [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ scope: string; file?: Blob; error?: Error } | null>(null);
  const expiresAt = Date.parse(request.mandate.expiresAt);
  const timeCurrent = usePermissionWindow(expiresAt);
  const permitted = timeCurrent && !!currentSnapDraft(request, [operation]), artifactId = operation.artifact_id ?? "";
  const scope = JSON.stringify([request.id, request.version, artifactId, expiresAt, permitted, open, revision]);
  if (result && result.scope !== scope) setResult(null);
  useEffect(() => {
    if (!open || !permitted || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return;
    const controller = new AbortController();
    const fail = () => { controller.abort(); setResult({ scope, error: new Error("The draft could not be opened. Check your access and try again, or use the download link.") }); };
    const timer = setTimeout(fail, Math.max(0, Math.min(30_000, expiresAt - Date.now())));
    void (async () => {
      let bytes: Uint8Array<ArrayBuffer> | undefined;
      try {
        // This existing authenticated route verifies the stored artifact's exact SHA-256 before returning bytes.
        const response = await fetch(`/api/parent/requests/${encodeURIComponent(request.id)}/forms/${encodeURIComponent(artifactId)}`, {
          credentials: "same-origin", cache: "no-store", redirect: "error", headers: { Accept: "application/pdf" }, signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.status === 401) throw new ParentApiError("Sign in to view this private draft.", 401);
        if (!response.ok || response.redirected || response.headers.get("content-type") !== "application/pdf"
          || response.headers.get("cache-control") !== "private, no-store") throw new Error();
        bytes = new Uint8Array(await response.arrayBuffer());
        if (controller.signal.aborted) return;
        if (!bytes.length || bytes.length > 10_485_760 || new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-" || Date.now() >= expiresAt) throw new Error();
        setResult({ scope, file: new Blob([bytes], { type: "application/pdf" }) });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ scope, error: error instanceof ParentApiError ? error : new Error("The draft could not be opened. Try again, or use its download link.") });
      } finally { clearTimeout(timer); bytes?.fill(0); }
    })();
    const expiry = setTimeout(fail, Math.max(0, Math.min(2_147_483_647, expiresAt - Date.now())));
    return () => { clearTimeout(timer); clearTimeout(expiry); controller.abort(); };
  }, [open, revision, request.id, artifactId, expiresAt, permitted, scope]);
  if (!permitted) return null;
  const view = result?.scope === scope ? result : null;
  return <section className={styles.section} aria-label="Your prepared SNAP draft">
    <h2>Your prepared draft</h2>
    <p className={styles.hint}>Check the exact application here. You can correct your saved answers below.</p>
    <button type="button" className={open ? styles.quiet : styles.button} aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
      {open ? "Hide prepared draft" : "View prepared draft"}
    </button>
    {open && <div id={id} className={styles.space}>
      <p className={styles.hint}>This is the exact incomplete, unsigned draft recorded for this attempt. Viewing it does not submit an application.</p>
      {!view ? <ParentLoading label="Opening your prepared draft"/> : view.file ? <SnapReviewPdf source={view.file} onReady={draftDisplayReady}/>
        : view.error && <ServiceError error={view.error} retry={() => setRevision(value => value + 1)} returnTo={`/support/${request.id}`}/>}
    </div>}
  </section>;
}
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
                  {request.controlled_test ? recordedReceipt(operation)?.reference.startsWith("sinch-emulation:") ? "Free emulator test completed · no agency filing" : "Fictional test record · no agency filing" : operation.state === "prepared" && protectedRecordedSnapPacket(operation)
                    ? "SNAP application prepared · not submitted"
                    : operation.state === "prepared" && operation.form?.preparation_only
                    ? "Incomplete unsigned draft · not submitted"
                    : OUTCOME_LABELS[operation.state as OutcomeState] ??
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
                      {operation.form?.preparation_only
                        ? "Download incomplete unsigned draft"
                        : "Download this prepared form"}
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
      {!request.controlled_test && <details className={styles.disclosure}>
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
      </details>}
    </>
  );
}
