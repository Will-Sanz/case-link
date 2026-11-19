"use client";
import { useParentLocale } from "./parent-locale";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { snapApplicationSnapshotSchema } from "@/lib/parent/snap-application-snapshot";
import { snapFormSource } from "@/lib/parent/snap-form-source";
import type { ParentLocale } from "@/lib/parent/locale";
import type { SupportRequest } from "@/lib/parent/domain";
import { SNAP_PARENT_CERTIFICATION_ACTS, snapProtectedDeliveryAttempt, snapProtectedOperationSchema, type SnapProtectedOperation } from "@/lib/parent/snap-protected-operation";
import { loadSnapReviewFile } from "@/lib/parent/snap-review-file";
import { boundedParentApi, ParentApiError } from "./api";
import { ParentLoading, ServiceError } from "./feedback";
import { useParentResource } from "./use-parent-resource";
import { SnapReviewPdf } from "./snap-review-pdf";
import styles from "./parent.module.css";
import { usePermissionWindow } from "./use-permission-window";

const submitReply = z.object({ ok: z.literal(true), operationId: z.uuid(), state: z.literal("authorization_recorded") }).strict();
const replacementReply = z.object({ ok: z.literal(true), requestVersion: z.number().int().positive().max(2147483647) }).strict();

export function SnapFinalReview({ request, onChange, onReviewChange }: { request: SupportRequest; onChange?: () => void; onReviewChange?: (review: SnapProtectedOperation | null) => void }) {
  const { t, locale } = useParentLocale();
  const saved = useParentResource<{ review: unknown }>(`/requests/${request.id}/snap-submission?expectedVersion=${request.version}`);
  const review = useMemo(() => {
    const parsed = snapProtectedOperationSchema.safeParse(saved.data?.review);
    return parsed.success && parsed.data.requestId === request.id && parsed.data.requestVersion === request.version ? parsed.data : null;
  }, [saved.data, request.id, request.version]);
  const binding = review ? JSON.stringify({ operationId: review.operationId, packetHash: review.packetHash, packet: review.packet, permissionVersion: review.permissionVersion }) : "";
  const [fileRevision, setFileRevision] = useState(0);
  const mandateDeadline = Date.parse(request.mandate.expiresAt);
  const mandateCurrent = usePermissionWindow(mandateDeadline);
  const requestScope = JSON.stringify({ id: request.id, version: request.version, status: request.status, needs: request.intake.needs, mandate: request.mandate });
  const actionScope = JSON.stringify([requestScope, binding]);
  const work = useRef<AbortController | null>(null);
  const versionKey = `${request.id}:${request.version}`, attempted = useRef<string | null>(null);
  const [attempt, setAttempt] = useState<{ key: string; scope: string; work: AbortController; kind: "submit" | "replace"; state: "pending" | "unknown" | "recorded" } | null>(null);
  const writeAttempted = attempt?.key === versionKey;
  const pending = writeAttempted && attempt.scope === actionScope && attempt.state === "pending" && !attempt.work.signal.aborted;
  const replaced = writeAttempted && attempt.kind === "replace" && attempt.state === "recorded";
  const current = request.status === "active" && mandateCurrent && !replaced && !saved.loading && !saved.error && !!review;
  // A metadata/access refresh revokes the old URL; it cannot count as the new load's usable viewer.
  const loadScope = useMemo(() => ({ review, fileRevision, current }), [review, fileRevision, current]);
  const [documentLanguage, setDocumentLanguage] = useState<{ scope: typeof loadScope; language: ParentLocale } | null>(null);
  const [file, setFile] = useState<{ scope: typeof loadScope; url: string; blob: Blob } | null>(null);
  const [displayed, setDisplayed] = useState<typeof loadScope | null>(null);
  const onDisplayReady = useCallback((ready: boolean) => setDisplayed(ready ? loadScope : null), [loadScope]);
  const [fileError, setFileError] = useState<{ scope: typeof loadScope; error: Error } | null>(null);
  const [decision, setDecision] = useState("");
  const reviewRequested = request.required_actions.some(action => !action.resolved && action.need === "snap_new" && action.reason === "submission_review"
    && action.field === "snap_final_submit" && (!action.resolver || action.resolver === "parent"));
  const exactFile = current && !!binding && file?.scope === loadScope;
  const authorized = !!binding && (decision === binding || review?.snapSubmissionAuthorized === true);
  const unconfirmed = writeAttempted && !pending && attempt.state !== "recorded" && !authorized && !snapProtectedDeliveryAttempt(review?.state ?? "");
  const reconcile = unconfirmed && attempt.scope === actionScope && request.status === "active" && mandateCurrent && !!review
    && (!saved.error || saved.error instanceof ParentApiError && [0, 500, 502, 504].includes(saved.error.status));
  const reloadIfIdle = saved.reloadIfIdle;
  useEffect(() => {
    if (!reconcile) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible" && Date.now() < mandateDeadline) reloadIfIdle(); }, 5000);
    return () => clearInterval(timer);
  }, [reconcile, reloadIfIdle, mandateDeadline, actionScope]);
  const maySubmit = reviewRequested && current && exactFile && displayed === loadScope && review?.state === "prepared" && review.protectedPacketCurrent && review.protectedParentSubmitReady && !authorized && (!writeAttempted || pending && attempt.kind === "submit");
  // Close old writes before callbacks can run for a newly committed request or exact packet.
  useLayoutEffect(() => {
    const controller = new AbortController(); work.current = controller;
    return () => { controller.abort(); if (work.current === controller) work.current = null; };
  }, [actionScope, mandateCurrent]);
  useEffect(() => { onReviewChange?.(current ? review : null); }, [current, review, onReviewChange]);
  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(() => { if (Date.now() >= mandateDeadline) work.current?.abort(); setFileRevision(value => value + 1); }, Math.max(0, Math.min(2147483647, mandateDeadline - Date.now())));
    return () => clearTimeout(timer);
  }, [current, mandateDeadline, fileRevision]);
  if (file && file.scope !== loadScope) setFile(null);
  if (displayed && displayed !== loadScope) setDisplayed(null);
  useLayoutEffect(() => {
    if (!binding || !current || !review) return;
    const controller = new AbortController(); let url: string | undefined;
    // Source labels follow the packet's own immutable revision; this read grants no Submit authority.
    void boundedParentApi(`/requests/${review.requestId}/snap-application?revision=${review.packet.protectedSnapPacket.snapshotId}`, {}, controller.signal, request.mandate.expiresAt)
      .then(value => {
        const parsed = z.object({ snapshot: snapApplicationSnapshotSchema }).safeParse(value);
        const saved = parsed.success ? parsed.data.snapshot : null;
        if (!controller.signal.aborted && saved && saved.id === review.packet.protectedSnapPacket.snapshotId
          && saved.request_id === review.requestId && saved.request_version <= review.requestVersion)
          setDocumentLanguage({ scope: loadScope, language: snapFormSource(saved.source.templateId).language });
      }).catch(() => { /* Exact bytes remain reviewable; unavailable source metadata never implies English. */ });
    loadSnapReviewFile(review, controller.signal).then(bytes => {
      try {
        if (controller.signal.aborted) return;
        const blob = new Blob([bytes], { type: "application/pdf" }); url = URL.createObjectURL(blob);
        setFile({ scope: loadScope, url, blob }); setFileError(null);
      } finally { bytes.fill(0); }
    }).catch(() => { if (!controller.signal.aborted) setFileError({ scope: loadScope, error: new Error("The exact application could not be opened. Check access and try again before choosing Submit.") }); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [review, binding, current, loadScope, request.mandate.expiresAt]);
  async function submit() {
    const controller = work.current;
    if (!maySubmit || pending || !review || Date.now() >= mandateDeadline || !controller || controller.signal.aborted || attempted.current === versionKey) return;
    attempted.current = versionKey; setAttempt({ key: versionKey, scope: actionScope, work: controller, kind: "submit", state: "pending" });
    try {
      const ref = review.packet.protectedSnapPacket;
      const result = submitReply.parse(await boundedParentApi(`/requests/${request.id}/snap-submission`, { method: "POST", body: JSON.stringify({
        operationId: review.operationId, expectedVersion: request.version, packetHash: review.packetHash, packetId: ref.packetId,
        contentSha256: ref.contentSha256, completedActs: [...SNAP_PARENT_CERTIFICATION_ACTS],
      }) }, controller.signal, request.mandate.expiresAt));
      if (controller.signal.aborted || work.current !== controller) return;
      if (result.operationId !== review.operationId) throw new Error();
      setAttempt({ key: versionKey, scope: actionScope, work: controller, kind: "submit", state: "recorded" }); setDecision(binding); saved.reload(); onChange?.();
    } catch {
      if (controller.signal.aborted || work.current !== controller) return;
      setAttempt({ key: versionKey, scope: actionScope, work: controller, kind: "submit", state: "unknown" }); saved.reload(); onChange?.();
    }
  }
  async function replacePages() {
    const controller = work.current;
    if (!current || !review || authorized || pending || Date.now() >= mandateDeadline || !controller || controller.signal.aborted || attempted.current === versionKey) return;
    attempted.current = versionKey; setAttempt({ key: versionKey, scope: actionScope, work: controller, kind: "replace", state: "pending" });
    try {
      const result = replacementReply.parse(await boundedParentApi(`/requests/${request.id}/snap-application/capture`, { method: "POST", body: JSON.stringify({ expectedVersion: request.version, previousPacketId: review.packet.protectedSnapPacket.packetId }) }, controller.signal, request.mandate.expiresAt));
      if (controller.signal.aborted || work.current !== controller) return;
      if (result.requestVersion !== request.version + 1) throw new Error("The page replacement needs checking. Refresh your request before choosing another file.");
      setAttempt({ key: versionKey, scope: actionScope, work: controller, kind: "replace", state: "recorded" }); onChange?.();
    } catch {
      if (controller.signal.aborted || work.current !== controller) return;
      setAttempt({ key: versionKey, scope: actionScope, work: controller, kind: "replace", state: "unknown" }); saved.reload(); onChange?.();
    }
  }
  if (request.status !== "active") return <section lang={locale} className={`${styles.section} ${styles.snapApplication}`} id="snap-final-review" aria-labelledby="snap-final-review-title" tabIndex={-1}>
    <h2 id="snap-final-review-title">{t(request.status === "paused" ? "SNAP work is paused" : request.status === "cancelled" ? "SNAP work is cancelled" : "SNAP work is closed")}</h2>
    <p>{t("Future application work is stopped. Check") }{" "}<a className={styles.textLink} href="#application-receipts">{t("Activity & receipts") }</a> {t("for anything already sent or confirmed.") }</p>
  </section>;
  return <section lang={locale} className={`${styles.section} ${styles.snapApplication}`} id="snap-final-review" aria-labelledby="snap-final-review-title" tabIndex={-1}>
    <h2 id="snap-final-review-title">{t("Review your SNAP application") }</h2>
    <p>{t("Check this complete application before choosing Submit. Correct any saved answer or personal page that needs changing.") }</p>
    {!mandateCurrent && <p className={styles.notice} role="status">{t("Your application permission has expired or could not be checked. Check your request’s permission before continuing. Your saved answers and receipts are kept.") }</p>}
    {saved.loading ? <ParentLoading label="Loading your exact application"/> : saved.error ? <ServiceError error={saved.error} retry={saved.reload}/> : !review ?
      <p className={styles.notice}>{t("The exact application is not available for review yet. Your saved answers are kept. Check Activity & receipts for recorded delivery status.") }</p> : <>
      {exactFile && file ? <>
        <SnapReviewPdf documentLanguage={documentLanguage?.scope === loadScope ? documentLanguage.language : undefined} source={file.blob} onReady={onDisplayReady}/>
        <a className={styles.textLink} href={file.url} target="_blank" rel="noopener noreferrer">{t("Open this exact application PDF full size") }</a>
        <button type="button" className={styles.quiet} onClick={() => setFileRevision(value => value + 1)}>{t("Reload application pages") }</button>
      </> : fileError?.scope === loadScope ? <ServiceError error={fileError.error} retry={() => { setFileError(null); setFileRevision(value => value + 1); }}/> : current ? <ParentLoading label="Checking and opening the exact PDF"/> : null}
      {authorized ? <p className={styles.success} role="status">{t("Your Submit decision is recorded. CaseLink will check the delivery result. An agency confirmation is a separate record and will appear when verified.") }</p> : snapProtectedDeliveryAttempt(review.state) ?
        <p className={styles.notice} role="status"><span>{t("See") }{" "}<a className={styles.textLink} href="#application-receipts">{t("Activity & receipts") }</a> {t("for the latest delivery record and any verified agency confirmation. You do not need to Submit this application again.") }</span></p> : <>
        <div className={`${styles.inline} ${styles.space}`}>
          <a className={styles.textLink} href="#application-answers">{t("Correct saved answers") }</a>
          <button type="button" className={styles.quiet} disabled={!current || writeAttempted || review.state !== "prepared"} onClick={replacePages}>{t("Replace personal pages") }</button>
        </div>
        {maySubmit ? <>
          <p id="snap-final-submit-report" className={`${styles.hint} ${styles.space}`}>{t("By choosing Submit, I confirm that my required handwritten signatures and dates are complete on form pages 1 and 5 of this exact application, and ask CaseLink to send it to Pennsylvania SNAP.") }</p>
          <button type="button" className={`${styles.button} ${styles.space}`} aria-describedby="snap-final-submit-report" disabled={pending} onClick={submit}>{t(pending ? "Recording Submit…" : "Submit")}</button>
        </> : current && exactFile && !writeAttempted && <p className={styles.notice}>{t("CaseLink must resolve the application’s remaining submission requirements. You do not need to repeat your saved answers.") }</p>}
      </>}
    </>}
    {pending && attempt.kind === "replace" && <p role="status">{t("Recording page replacement…") }</p>}
    {replaced && <p className={styles.notice} role="status">{t("Page replacement is recorded. Waiting for the current application revision. Your earlier pages are no longer shown.") }</p>}
    {unconfirmed && <div className={styles.notice} role="status"><p>{t(attempt.kind === "submit" ? "Submit result is not confirmed." : "Page replacement result is not confirmed.")} {t("CaseLink must check the current application before another attempt. This does not establish whether anything reached the agency.") }</p><button type="button" className={styles.quiet} onClick={() => { saved.reload(); onChange?.(); }}>{t("Check current application status") }</button></div>}
  </section>;
}
