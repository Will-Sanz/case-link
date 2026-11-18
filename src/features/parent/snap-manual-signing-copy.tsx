"use client";
import { useEffect, useMemo, useState } from "react";
import type { SupportRequest } from "@/lib/parent/domain";
import type { SnapApplicationSnapshot } from "@/lib/parent/snap-application-snapshot";
import type { SnapCaptureContext } from "@/lib/parent/snap-capture-context";
import { snapFormSource } from "@/lib/parent/snap-form-source";
import { loadSnapSigningCopyFile } from "@/lib/parent/snap-signing-copy-file";
import { useParentLocale } from "./parent-locale";
import { ParentLoading, ServiceError } from "./feedback";
import { usePermissionWindow } from "./use-permission-window";
import { SnapReviewPdf } from "./snap-review-pdf";
import styles from "./parent.module.css";

const readonlyDisplay = () => undefined;

/** A blank protected-field copy is a manual alternative, never protected capture or delivery authority. */
export function SnapManualSigningCopy({ request, snapshot, context }: {
  request: SupportRequest; snapshot: SnapApplicationSnapshot; context: SnapCaptureContext;
}) {
  const { t, locale } = useParentLocale(), [revision, setRevision] = useState(0);
  const source = snapFormSource(snapshot.source.templateId);
  const deadline = Math.min(Date.parse(request.mandate.expiresAt), Date.parse(source.contract.verifiedUntil));
  const current = usePermissionWindow(deadline) && request.status === "active";
  const scope = useMemo(() => ({ requestId: request.id, version: request.version, mandate: request.mandate, snapshot, context, revision, current }),
    [request.id, request.version, request.mandate, snapshot, context, revision, current]);
  const [result, setResult] = useState<{ scope: typeof scope; file?: { blob: Blob; url: string }; error?: Error } | null>(null);
  if (result && result.scope !== scope) setResult(null);
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener("focus", refresh); window.addEventListener("pageshow", refresh);
    return () => { window.removeEventListener("focus", refresh); window.removeEventListener("pageshow", refresh); };
  }, []);
  useEffect(() => {
    if (!current) return;
    const controller = new AbortController(); let url: string | undefined;
    const timer = setTimeout(() => { controller.abort(); if (url) URL.revokeObjectURL(url); }, Math.max(0, Math.min(2147483647, deadline - Date.now())));
    void loadSnapSigningCopyFile({ requestId: scope.requestId, requestVersion: scope.version, status: "active", mandate: scope.mandate, snapshot, context }, controller.signal)
      .then(copy => {
        try {
          if (controller.signal.aborted) return;
          const blob = new Blob([Uint8Array.from(copy.bytes)], { type: "application/pdf" }); url = URL.createObjectURL(blob);
          setResult({ scope, file: { blob, url } });
        } finally { copy.bytes.fill(0); }
      }).catch(() => { if (!controller.signal.aborted) setResult({ scope, error: new Error("The unsigned application copy could not be opened. Your saved answers are unchanged. Check the current application and try again.") }); });
    return () => { controller.abort(); clearTimeout(timer); if (url) URL.revokeObjectURL(url); };
  }, [scope, current, deadline, snapshot, context]);
  if (!current) return null;
  const view = result?.scope === scope ? result : null;
  return <section lang={locale} className={styles.space} aria-label={t("Print and complete the official SNAP form")}>
    <h3>{t("Print and complete the official SNAP form")}</h3>
    <p>{t("CaseLink cannot collect protected entries for this form right now. You can print this exact copy with your saved answers. Social Security numbers, signatures and dates stay blank; add only the required entries yourself on the official form. This copy has not been sent.")}</p>
    <p className={styles.hint}>{t("Official SNAP form:")} <span lang={source.language}>{source.contract.printedRevision}</span></p>
    {!view ? <ParentLoading label="Preparing the unsigned official copy"/> : view.error ? <ServiceError error={view.error} retry={() => setRevision(value => value + 1)} returnTo={`/support/${request.id}`}/> : view.file && <>
      <SnapReviewPdf documentLanguage={source.language} source={view.file.blob} onReady={readonlyDisplay}/>
      <a className={styles.button} href={view.file.url} target="_blank" rel="noopener noreferrer">{t("Open the exact unsigned PDF to print or save")}</a>
      <p className={styles.hint}>{t("Read and complete your own certifications on printed pages 1 and 5. Follow the official DHS instructions for filing. Printing, downloading or completing this copy does not submit it through CaseLink.")}</p>
    </>}
    <a className={styles.textLink} href={source.contract.sourceUrl}>{t("Open the official blank form and instructions")}</a>
  </section>;
}
