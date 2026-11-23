"use client";
import { useParentLocale } from "./parent-locale";
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
import { utilityPreparedReferenceSchema } from "@/lib/parent/utility-protected-operation";
import { parentApi, displayDate, ParentApiError } from "./api";
import { ParentLoading, ServiceError } from "./feedback";
import { SnapReviewPdf } from "./snap-review-pdf";
import styles from "./parent.module.css";
import wicStyles from "./wic.module.css";
import { usePermissionWindow } from "./use-permission-window";
import { hasTypedFoodAccessPath } from "@/lib/parent/food-access";
import { currentIntakeFields } from "@/lib/parent/current-intake-fields";
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
export function protectedRecordedUtilityPacket(operation: Pick<RecordedOperation, "need" | "program_id" | "action" | "artifact_id" | "protected_packet" | "request_id" | "request_version">) {
  const reference = utilityPreparedReferenceSchema.safeParse(operation.protected_packet);
  return reference.success && operation.action === "prepare" && operation.artifact_id === null && reference.data.programId === operation.program_id && reference.data.requestId === operation.request_id
    && reference.data.requestVersion === operation.request_version && { "peco-cap": "electricity", "pgw-crp": "gas", "pwd-tap": "water" }[reference.data.programId] === operation.need ? reference.data : null;
}
function UtilityDraftDownload({ request, operation }: { request: SupportRequest; operation: RecordedOperation }) {
  const reference = protectedRecordedUtilityPacket(operation);
  const current = usePermissionWindow(Math.min(Date.parse(reference?.expiresAt ?? ""), Date.parse(request.mandate.expiresAt)));
  const inspectable = operation.state === "prepared" || operation.state === "invalidated" && request.status === "paused" && operation.request_version === request.version - 1;
  if (!reference || !current || !inspectable || operation.request_id !== request.id || !["active", "paused"].includes(request.status)) return null;
  return <p className={styles.space}><a className={styles.textLink}
    href={`/protected/utilities/requests/${request.id}/prepared/${reference.packetId}?expectedVersion=${request.version}`}>
    {reference.sourceKind === "local_test_issued_form" ? "Download LOCAL TEST water draft" : "Download unsigned utility draft"}
  </a></p>;
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
export const RECORDED_RECEIPT_SOURCES = {
  agency_receipt: "Agency receipt",
  provider_api: "Program system record",
  authenticated_partner: "Partner confirmed",
  operator_confirmed: "Operator confirmed",
} as const;

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
  const { t, locale } = useParentLocale();
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
  return <section lang={locale} className={styles.section} aria-label={t("Your prepared SNAP draft")}>
    <h2>{t("Your prepared draft")}</h2>
    <p className={styles.hint}>{t("Check the exact application here. You can correct your saved answers below.")}</p>
    <button type="button" className={open ? styles.quiet : styles.button} aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
      {t(open ? "Hide prepared draft" : "View prepared draft")}
    </button>
    {open && <div id={id} className={styles.space}>
      <p className={styles.hint}>{t("This is the exact incomplete, unsigned draft recorded for this attempt. Viewing it does not submit an application.")}</p>
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
  const { t: parentText, locale } = useParentLocale();
  const wicOnly = request.intake.needs.length > 0 && request.intake.needs.every(need => need.startsWith("wic_"));
  const foodOnly = request.intake.needs.length > 0 && request.intake.needs.every(need => need === "food_now" || need.startsWith("snap_") || need.startsWith("wic_"));
  const localized = wicOnly || foodOnly;
  const t = (text: string) => localized ? parentText(text) : text;
  const { data, error, reload } = history;
  const typedFood = hasTypedFoodAccessPath(request,currentIntakeFields(request,new Date(),"food_now").zip);
  const reportableNeeds = request.intake.needs.filter(need => need !== "food_now" || !typedFood);
  const [need, setNeed] = useState(reportableNeeds[0] ?? request.intake.needs[0]),
    [outcome, setOutcome] = useState("support_received"),
    [reference, setReference] = useState("");
  const [pending, setPending] = useState(false),
    [message, setMessage] = useState(""),
    [reportError, setReportError] = useState("");
  const reportNeed = reportableNeeds.includes(need) ? need : undefined;
  const outcomes = [
    ["support_received", "I received support"],
    ["assistance_approved", "The program told me assistance was approved"],
    ["declined", "The program declined assistance"],
    ["unresolved", "I still need help"],
  ];
  const outcomeLabel = outcomes.find(([value]) => value === outcome)?.[1];
  async function report(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reportNeed) return;
    setPending(true);
    setMessage("");
    setReportError("");
    try {
      await parentApi(`/requests/${request.id}/outcome`, {
        method: "POST",
        body: JSON.stringify({ need: reportNeed, outcome, reference }),
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
      {!error && !!data?.operations?.length && (
        <section lang={localized ? locale : "en"} className={`${styles.surface} ${wicOnly ? wicStyles.activity : ""}`}>
          <h2>{t("Recorded packets & receipts")}</h2>
          <p className={styles.hint}>{t("Each download keeps the exact information and evidence recorded for that attempt.")}</p>
          <ul className={styles.packetList}>
            {data.operations.map((operation) => {
              const receipt = recordedReceipt(operation);
              return <li key={operation.id}>
                <strong lang="en">
                  {getProgram(operation.program_id)?.name ?? "Named program"}
                </strong>
                <p className={styles.hint}>
                  {t(operation.state === "prepared" && protectedRecordedSnapPacket(operation)
                    ? "SNAP application prepared · not submitted"
                    : operation.state === "prepared" && protectedRecordedUtilityPacket(operation)
                    ? protectedRecordedUtilityPacket(operation)!.sourceKind === "local_test_issued_form" ? "LOCAL TEST water draft · not submitted" : "Unsigned utility draft · not submitted"
                    : operation.state === "prepared" && operation.form?.preparation_only
                    ? "Incomplete unsigned draft · not submitted"
                    : OUTCOME_LABELS[operation.state as OutcomeState] ??
                      "Needs verification")}{" "}{t("·")}{" "}{displayDate(operation.created_at, false, localized ? locale : "en")}
                </p>
                {receipt && <div className={styles.receiptDetails}>
                  <p><strong>{t("Recorded reference:")}</strong>{" "}<bdi>{receipt.reference}</bdi></p>
                  <p className={styles.hint}>
                    {t(RECORDED_RECEIPT_SOURCES[receipt.source])} ·{" "}
                    <time dateTime={receipt.recordedAt}>{displayDate(receipt.recordedAt, true, localized ? locale : "en")}</time>{" "}{t("(Eastern time)")}
                  </p>
                </div>}
                <a
                  className={styles.textLink}
                  lang={operation.need?.startsWith("wic_") || operation.need?.startsWith("snap_") || operation.need === "food_now" ? locale : "en"}
                  href={`/api/parent/requests/${request.id}/operations/${operation.id}/export`}
                >
                  {operation.need?.startsWith("wic_") || operation.need?.startsWith("snap_") || operation.need === "food_now" ? parentText("Download recorded information") : "Download recorded information"}
                </a>
                <UtilityDraftDownload request={request} operation={operation}/>
                {operation.artifact_id && (
                  <p className={styles.space}>
                    <a
                      className={styles.textLink}
                      lang={operation.need?.startsWith("wic_") || operation.need?.startsWith("snap_") || operation.need === "food_now" ? locale : "en"}
                      href={`/api/parent/requests/${request.id}/forms/${operation.artifact_id}`}
                    >
                      {operation.need?.startsWith("wic_") || operation.need?.startsWith("snap_") || operation.need === "food_now" ? parentText(operation.form?.preparation_only ? "Download incomplete unsigned draft" : "Download this prepared form") : operation.form?.preparation_only ? "Download incomplete unsigned draft" : "Download this prepared form"}
                    </a>
                  </p>
                )}
              </li>;
            })}
          </ul>
          {data.historyLimited && (
            <p className={`${styles.hint} ${styles.space}`}>{t("Showing the latest 100 recorded operations. Earlier submissions or uncertain deliveries may not appear here.")}{" "}
              <a className={styles.textLink} href="/api/parent/account/export">{t("Download your retained information")}</a>{" "}{t("to review earlier history before starting another application.")}</p>
          )}
        </section>
      )}
      {error && (
        <div className={styles.notice}>
          <p>{t("Recorded packet history could not be loaded.")}</p>
          <button className={styles.quiet} onClick={reload}>{t("Try packet history again")}</button>
        </div>
      )}
      {reportableNeeds.length > 0 && <details lang={localized ? locale : "en"} className={`${styles.disclosure} ${wicOnly ? wicStyles.activity : ""}`}>
        <summary>{t("Tell us about an outcome")}</summary>
        <div>
          <p className={styles.hint}>{t("Record help you received or a program response. Never include an account number, government ID, password or sign-in code.")}</p>
          <form className={`${styles.form} ${styles.space}`} onSubmit={report}>
            <div className={styles.field}>
              <label htmlFor="report-need">{t("Which support?")}</label>
              <select
                id="report-need"
                aria-describedby={localized && reportNeed ? "report-need-choice" : undefined}
                className={styles.select}
                value={reportNeed ?? ""}
                onChange={(e) => setNeed(e.target.value as typeof need)}
              >
                {!reportNeed && <option value="">{t("Choose support")}</option>}
                {reportableNeeds.map((n) => (
                  <option key={n} value={n}>
                    {t(NEED_LABELS[n])}
                  </option>
                ))}
              </select>
              {localized && reportNeed && <p className={styles.hint} id="report-need-choice">{t(NEED_LABELS[reportNeed])}</p>}
            </div>
            <div className={styles.field}>
              <label htmlFor="report-outcome">{t("What happened?")}</label>
              <select
                id="report-outcome"
                aria-describedby={localized && outcomeLabel ? "report-outcome-choice" : undefined}
                className={styles.select}
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
              >
                {outcomes.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
              </select>
              {localized && outcomeLabel && <p className={styles.hint} id="report-outcome-choice">{t(outcomeLabel)}</p>}
            </div>
            <div className={styles.field}>
              <label htmlFor="report-reference">{t("What did you receive or hear, and when?")}</label>
              <textarea
                id="report-reference"
                lang=""
                className={styles.input}
                required
                maxLength={500}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </div>
            <button type="submit" className={styles.button} disabled={pending || !reportNeed}>
              {t(pending ? "Saving…" : "Save my report")}
            </button>
            {message && (
              <p role="status" className={styles.success}>
                {t(message)}
              </p>
            )}
            {reportError && (
              <p role="alert" lang={t(reportError) === reportError ? "en" : locale} className={styles.error}>
                {t(reportError)}
              </p>
            )}
          </form>
        </div>
      </details>}
    </>
  );
}
