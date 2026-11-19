"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Camera, Lock, Page, Trash, Upload } from "iconoir-react";
import type { ParentDocument } from "@/lib/parent/domain";
import { documentUploadReceiptSchema, pendingDocumentUpload, type DocumentUploadReceipt } from "@/lib/parent/document-upload";
import { boundedParentApi, ParentApiError, displayDate } from "./api";
import { useParentLocale } from "./parent-locale";
import styles from "./parent.module.css";

export function SupportDocuments(props: { requestId: string; documents: ParentDocument[]; inactive: boolean; onChange: () => void }) {
  return <Documents key={props.requestId} {...props} />;
}

function Documents({
  requestId,
  documents,
  inactive,
  onChange,
}: {
  requestId: string;
  documents: ParentDocument[];
  inactive: boolean;
  onChange: () => void;
}) {
  const { locale, t } = useParentLocale();
  const [consent, setConsent] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const uploadId = useId();
  const [attempt, setAttempt] = useState<{ key: string; file: File; readOnlyRecovery?: boolean } | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [retryReady, setRetryReady] = useState(false);
  const [resume, setResume] = useState<ParentDocument | null>(null);
  const owner = useRef<AbortController | null>(null);
  const checking = useRef<AbortController | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const controller = new AbortController(); owner.current = controller;
    return () => { controller.abort(); owner.current = null; };
  }, []);
  function saved(readOnlyRecovery = false) {
    setAttempt(null); setUncertain(false); setRetryReady(false); setResume(null);
    setFile(null); setConsent(false); formRef.current?.reset(); setError("");
    setMessage(readOnlyRecovery ? "The original upload was already saved. No new file was added." : "Document saved privately. Its processing status will appear here."); onChange();
  }
  function applyReceipt(receipt: DocumentUploadReceipt, readOnlyRecovery = false) {
    if (receipt.state === "confirmed") { saved(readOnlyRecovery); return; }
    if (receipt.state === "pending") {
      setRetryReady(true);
      setMessage("This transfer is unfinished. Retry the same file; its original consent and expiry stay unchanged."); onChange();
    } else {
      setAttempt(null); setUncertain(false); setRetryReady(false); setResume(null); setFile(null); setConsent(false); formRef.current?.reset();
      setError("This upload expired or was removed. Choose the file again only if it is still needed."); onChange();
    }
  }
  async function readAttempt(key: string, readOnlyRecovery = false) {
    const controller = owner.current;
    if (!controller || controller.signal.aborted || checking.current) return;
    const read = new AbortController(); checking.current = read;
    const signal = AbortSignal.any([controller.signal, read.signal]);
    try {
      const value = await boundedParentApi(`/requests/${requestId}/documents?uploadKey=${key}`, {}, signal, new Date(Date.now() + 30_000).toISOString());
      const receipt = documentUploadReceiptSchema.parse((value as {receipt?: unknown} | null)?.receipt);
      if (!signal.aborted && receipt.document.request_id === requestId && receipt.document.upload_key === key) applyReceipt(receipt, readOnlyRecovery);
    } catch (err) {
      if (!signal.aborted && err instanceof ParentApiError && err.status === 404) setRetryReady(true);
    } finally { if (checking.current === read) checking.current = null; }
  }
  useEffect(() => {
    if (!uncertain || !attempt || pending) return;
    let ticks = 0;
    const refresh = () => { if (document.visibilityState === "visible") void readAttempt(attempt.key, attempt.readOnlyRecovery); };
    const timer = setInterval(() => { refresh(); if (++ticks === 6) clearInterval(timer); }, 5000);
    window.addEventListener("online", refresh); window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); window.removeEventListener("online", refresh); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  // Reads reconcile this immutable attempt; changing display callbacks never starts another write.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uncertain, attempt, pending]);
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inactive || pending || (uncertain && !retryReady)) return;
    setError(""); setMessage("");
    if (!consent || !file) { setError("Choose a document and agree to its processing first."); return; }
    if (!["image/jpeg", "image/png", "application/pdf"].includes(file.type) || file.size > 10 * 1024 * 1024 || file.size === 0) {
      setError("Choose a JPEG, PNG or readable PDF up to 10 MB. PDFs can have up to five pages."); return;
    }
    const current = attempt ? { ...attempt, readOnlyRecovery: false } : { key: resume?.upload_key ?? resume?.id ?? crypto.randomUUID(), file };
    const controller = owner.current;
    if (!controller) return;
    checking.current?.abort(); checking.current = null;
    setAttempt(current); setRetryReady(false); setPending(true);
    const body = new FormData(); body.set("file", current.file); body.set("consent", "1");
    try {
      const value = await boundedParentApi(`/requests/${requestId}/documents`, { method: "POST", headers: { "Idempotency-Key": current.key }, body }, controller.signal, new Date(Date.now() + 120_000).toISOString(), 120_000);
      const parsed = documentUploadReceiptSchema.safeParse((value as {receipt?: unknown} | null)?.receipt);
      if (!parsed.success) throw new Error("The upload result is not confirmed. Check its status before sending another copy.");
      const receipt = parsed.data;
      if (receipt.document.request_id !== requestId || receipt.document.upload_key !== current.key) throw new Error("The upload result is not confirmed. Check its status before sending another copy.");
      if (!controller.signal.aborted) { if (receipt.state !== "confirmed") setUncertain(true); applyReceipt(receipt); }
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "We couldn’t upload your document. Keep the original and try again.");
      if (err instanceof ParentApiError && [400, 409, 413].includes(err.status)) { setAttempt(null); setUncertain(false); setRetryReady(false); }
      else {
        const readOnlyRecovery = err instanceof ParentApiError && err.status === 403;
        setAttempt({ ...current, readOnlyRecovery }); setUncertain(true);
        await readAttempt(current.key, readOnlyRecovery);
      }
    } finally { if (!controller.signal.aborted) setPending(false); }
  }
  async function handleCheckUpload(document: ParentDocument, startedAt: number) {
    const controller = owner.current;
    if (inactive || pending || !controller) return;
    setPending(true); setError(""); setMessage("");
    try {
      const value = await boundedParentApi(`/requests/${requestId}/documents/${document.id}`, {
        method: "POST", body: JSON.stringify({uploadKey: document.upload_key ?? document.id}),
      }, controller.signal, new Date(startedAt + 30_000).toISOString());
      const parsed = documentUploadReceiptSchema.safeParse((value as {receipt?: unknown} | null)?.receipt);
      if (!parsed.success) throw new Error("The upload result is not confirmed. Check its status before sending another copy.");
      const receipt = parsed.data;
      if (controller.signal.aborted || receipt.document.id !== document.id || receipt.document.upload_key !== (document.upload_key ?? document.id)) return;
      if (receipt.state === "pending") {
        setResume(document); setConsent(true); setFile(null); setAttempt(null); setUncertain(false);
        setMessage("This transfer is unfinished. Choose the original file to resume it. Its original consent and expiry stay unchanged.");
        if (detailsRef.current) detailsRef.current.open = true;
        requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>('input[type="file"]')?.focus());
      } else applyReceipt(receipt);
    } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "We couldn’t check this upload. Please try again."); }
    finally { if (!controller.signal.aborted) setPending(false); }
  }
  async function remove(document: ParentDocument) {
    const controller = owner.current;
    if (!controller || pending) return;
    setPending(true);
    setError("");
    setMessage("");
    try {
      await boundedParentApi(`/requests/${requestId}/documents/${document.id}`, { method: "DELETE" }, controller.signal, new Date(Date.now() + 30_000).toISOString());
      if (controller.signal.aborted) return;
      if (attempt?.key === document.upload_key || resume?.id === document.id) {
        setAttempt(null); setUncertain(false); setRetryReady(false); setResume(null); setFile(null); setConsent(false); formRef.current?.reset();
      }
      setMessage(
        "Document deletion recorded. Information already delivered to a program may not be recallable.",
      );
      onChange();
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(
        err instanceof Error
          ? err.message
          : "We couldn’t remove that document. Please try again.",
      );
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  }
  return (
    <section lang={locale} className={`${styles.surface} ${styles.documents}`} aria-labelledby={`${uploadId}-title`}>
      <h2 id={`${uploadId}-title`}>{t("Bills & documents")}</h2>
      <p className={`${styles.subtle} ${styles.small}`}>
        {t("Optional unless a selected program needs one. You can enter information yourself instead.")}
      </p>
      {documents.length > 0 ? (
        <ul className={styles.documentList}>
          {documents.map((document) => {
            const status = pendingDocumentUpload(document) ? "Upload not confirmed" : document.status.replaceAll("_", " ");
            return (
            <li className={styles.document} key={document.id}>
              <div className={styles.inline}>
                <Page width={22} height={22} aria-hidden="true" />
                <div>
                  <strong>{document.filename}</strong>
                  <span>
                    {document.status === "raw_deleted"
                      ? t("Original file removed; validated facts remain")
                      : <><span lang={t(status) === status ? "en" : locale}>{t(status)}</span>{" · "}{t("Raw file expires")}{" "}{displayDate(document.expires_at, false, locale)}</>}
                  </span>
                </div>
              </div>
              {!inactive && pendingDocumentUpload(document) && <button className={styles.quiet} disabled={pending}
                onClick={() => handleCheckUpload(document, Date.now())} aria-label={`${t("Check upload")} ${document.filename}`}>{t("Check upload")}</button>}
              <button
                className={styles.quiet}
                disabled={pending}
                onClick={() => remove(document)}
                aria-label={`${t("Delete")} ${document.filename}`}
              >
                <Trash width={18} height={18} aria-hidden="true" />
                {t("Delete")}
              </button>
            </li>
            );
          })}
        </ul>
      ) : (
        <p className={`${styles.hint} ${styles.space}`}>
          {t("No documents added. Optional uploads do not hold up your request.")}
        </p>
      )}
      {!inactive && (
        <details ref={detailsRef} className={styles.disclosure}>
          <summary>{t("Add a document or take a photo")}</summary>
          <div>
            <div className={styles.notice}>
              <Lock width={20} height={20} aria-hidden="true" />
              <p>
                {t("Share only a bill, benefit notice or requested supporting document. Do not upload passwords, EBT PINs or identity documents. Your document may be read by AI to extract relevant facts for this request. It stays private. Its initial expiry is seven days after upload; you can request earlier deletion here.")}
              </p>
            </div>
            <form
              ref={formRef}
              className={`${styles.form} ${styles.space}`}
              onSubmit={upload}
            >
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={consent}
                  disabled={pending || !!attempt || !!resume}
                  onChange={(event) => {
                    setConsent(event.target.checked);
                    if (!event.target.checked) setFile(null);
                  }}
                />
                <span>
                  {t("I agree to private storage and AI processing of this document for this support request.")}{" "}
                  <Link
                    className={styles.textLink}
                    href="/support/privacy#documents"
                  >
                    {t("Read document privacy details.")}
                  </Link>
                </span>
              </label>
              {consent && (
                <div className={styles.stack}>
                  <div className={styles.upload}>
                    <Upload width={28} height={28} aria-hidden="true" />
                    <label htmlFor={`${uploadId}-file`}>
                      {t("Choose a bill or notice")}
                    </label>
                    <input
                      id={`${uploadId}-file`}
                      type="file"
                      disabled={pending || !!attempt}
                      accept="image/jpeg,image/png,application/pdf"
                      onChange={(event) => {
                        setFile(event.target.files?.[0] ?? null);
                        setError("");
                      }}
                    />
                    <p className={styles.hint}>
                      {t("JPEG, PNG or readable PDF · Up to 10 MB and five pages")}
                    </p>
                  </div>
                  <div className={styles.field}>
                    <label
                      className={`${styles.secondary} ${styles.inline}`}
                      htmlFor={`${uploadId}-camera`}
                    >
                      <Camera width={19} height={19} aria-hidden="true" />
                      {t("Take a photo")}
                    </label>
                    <input
                      id={`${uploadId}-camera`}
                      className={styles.input}
                      type="file"
                      disabled={pending || !!attempt || !!resume}
                      accept="image/jpeg,image/png"
                      capture="environment"
                      onChange={(event) => {
                        setFile(event.target.files?.[0] ?? null);
                        setError("");
                      }}
                    />
                    <p className={styles.hint}>
                      {t("Include the full page. Use good light, keep it flat, and make sure dates and amounts are readable. You can retake a photo before uploading.")}
                    </p>
                  </div>
                  {file && (
                    <p className={styles.hint}>
                      {t("Ready to upload:")} <strong>{file.name}</strong> (
                      {(file.size / 1024 / 1024).toFixed(1)} MB)
                    </p>
                  )}
                  <button
                    className={styles.button}
                    type="submit"
                    disabled={pending || !file || (uncertain && !retryReady)}
                  >
                    {t(pending ? "Uploading securely…" : uncertain ? "Retry this upload" : "Upload privately")}
                  </button>
                </div>
              )}
            </form>
          </div>
        </details>
      )}
      {uncertain && attempt && <button className={styles.quiet} disabled={pending} onClick={() => readAttempt(attempt.key, attempt.readOnlyRecovery)}>{t("Check upload status")}</button>}
      {message && (
        <p className={`${styles.success} ${styles.space}`} role="status">
          {t(message)}
        </p>
      )}
      {error && (
        <p lang={t(error) === error ? "en" : locale} className={`${styles.error} ${styles.space}`} role="alert">
          {t(error)}
        </p>
      )}
    </section>
  );
}
