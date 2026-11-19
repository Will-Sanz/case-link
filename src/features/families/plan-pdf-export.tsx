"use client";

import { schoolDate, formatDateOnly } from "@/lib/dates";
import { useEffect, useRef, useState } from "react";
import { validatePlanExport } from "@/app/actions/plans";
import { Download, Page as FileText, RefreshDouble } from "iconoir-react";
import { Button } from "@/components/ui/button";
import { FamilyTakeawaySelection } from "@/features/families/family-takeaway-selection";
import { buildFamilyTakeaway, type FamilyTakeawaySelection as TakeawaySelection } from "@/features/families/family-takeaway-data";
import type { PlanWithSteps } from "@/types/family";

function sanitizeFilenamePart(name: string): string {
  return name.replace(/[^\w\-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

type PlanPdfExportProps = {
  plan: PlanWithSteps;
  familyName?: string;
  barrierLabels: string[];
};

export function PlanPdfExport(props: PlanPdfExportProps) {
  return <PlanPdfOptions key={`${props.plan.id}:${props.plan.review_revision}`} {...props} />;
}

function PlanPdfOptions(props: PlanPdfExportProps) {
  const [kind, setKind] = useState<"record" | "family">("record");
  const [takeaway, setTakeaway] = useState<TakeawaySelection | null>(null);
  return (
    <div className="space-y-5">
      <fieldset className="flex flex-wrap gap-x-6 gap-y-2">
        <legend className="mb-2 text-sm font-semibold text-[var(--color-ink)]">Choose a PDF</legend>
        {([['record', 'Record PDF'], ['family', 'Family takeaway']] as const).map(([value, label]) => (
          <label key={value} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-[var(--color-ink)]">
            <input type="radio" name="plan-pdf-kind" value={value} checked={kind === value} onChange={() => { setKind(value); setTakeaway(null); }} className="size-4 accent-[var(--color-accent)]" />
            {label}
          </label>
        ))}
      </fieldset>
      {kind === "family" ? <FamilyTakeawaySelection plan={props.plan} onPrepare={setTakeaway} onChange={() => setTakeaway(null)} /> : null}
      {kind === "record" || takeaway ? <PlanPdfPreview {...props} takeaway={kind === "family" ? takeaway! : undefined} /> : null}
    </div>
  );
}

function PlanPdfPreview({
  plan,
  familyName,
  barrierLabels,
  takeaway,
}: PlanPdfExportProps & { takeaway?: TakeawaySelection }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generationAttempt, setGenerationAttempt] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const downloadLock = useRef(false);
  const activePreview = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    async function generatePreview() {
      setPreviewUrl(null);
      setDownloadName(null);
      setError(null);
      setLoading(true);

      const generatedDate = formatDateOnly(schoolDate())!;

      try {
        const approved = await validatePlanExport({ familyId: plan.family_id, planId: plan.id, expectedRevision: plan.review_revision });
        if (!approved.ok) {
          if (!cancelled) setError(approved.error);
          return;
        }
        const [{ pdf }, { finalizePlanPdf }] = await Promise.all([
          import("@react-pdf/renderer"),
          import("@/lib/domain/plan/finalize-plan-pdf"),
        ]);
        let document;
        if (takeaway) {
          const { FamilyTakeawayDocument } = await import("@/features/families/family-takeaway-document");
          document = <FamilyTakeawayDocument data={buildFamilyTakeaway(plan, takeaway)} familyName={familyName} generatedDate={generatedDate} />;
        } else {
          const { PlanPdfDocument } = await import("@/features/families/plan-pdf-document");
          document = <PlanPdfDocument plan={plan} familyName={familyName} generatedDate={generatedDate} barrierLabels={barrierLabels} />;
        }
        const renderedBlob = await pdf(document).toBlob();
        const finalizedBytes = await finalizePlanPdf(
          new Uint8Array(await renderedBlob.arrayBuffer()),
          takeaway ? "Family takeaway - Your next steps" : undefined,
        );
        const stillApproved = await validatePlanExport({ familyId: plan.family_id, planId: plan.id, expectedRevision: plan.review_revision });
        if (!stillApproved.ok) {
          if (!cancelled) setError(stillApproved.error);
          return;
        }
        const blob = new Blob([new Uint8Array(finalizedBytes).buffer], {
          type: "application/pdf",
        });

        objectUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
          return;
        }

        const namePart = familyName ? `${sanitizeFilenamePart(familyName)}-` : "";
        const datePart = sanitizeFilenamePart(generatedDate.replace(/\s+/g, "-"));
        setDownloadName(`${takeaway ? "family-takeaway" : "family-support-plan"}-${namePart}${datePart}.pdf`);
        activePreview.current = objectUrl;
        setPreviewUrl(objectUrl);
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof Error && cause.name === "UnsupportedPdfTextError"
          ? "The PDF font cannot display some characters, such as emoji or non-Latin text. Return to the plan to review them or contact support. Your saved plan has not changed."
          : "The PDF could not be prepared. Try generating it again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void generatePreview();

    return () => {
      cancelled = true;
      activePreview.current = null;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [barrierLabels, familyName, generationAttempt, plan, takeaway]);

  async function handleDownload() {
    if (!previewUrl || !downloadName || downloadLock.current) return;
    downloadLock.current = true;
    setDownloading(true);
    try {
      const approved = await validatePlanExport({ familyId: plan.family_id, planId: plan.id, expectedRevision: plan.review_revision });
      if (activePreview.current !== previewUrl) return;
      if (!approved.ok) {
        URL.revokeObjectURL(previewUrl);
        activePreview.current = null;
        setPreviewUrl(null);
        setError(approved.error);
        return;
      }
      const link = document.createElement("a");
      link.href = previewUrl;
      link.download = downloadName;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      if (activePreview.current !== previewUrl) return;
      URL.revokeObjectURL(previewUrl);
      activePreview.current = null;
      setError("The reviewed plan could not be checked. Please try again.");
      setPreviewUrl(null);
    } finally {
      downloadLock.current = false;
      setDownloading(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] [box-shadow:var(--shadow-surface)]" aria-label={takeaway ? "Family takeaway PDF" : "Reviewed plan PDF"}>
      <div className="flex flex-col gap-4 border-b border-[var(--color-rule)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
            <FileText className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[var(--color-ink)]">
              {downloadName ?? (takeaway ? "Preparing family takeaway.pdf" : "Preparing reviewed plan.pdf")}
            </p>
            <p className="mt-0.5 text-xs text-[var(--color-ink-faint)]">
              {loading ? "Generating the latest PDF…" : error ? "PDF generation needs attention" : takeaway ? "Selected details from the reviewed plan" : "Generated from the reviewed plan"}
            </p>
          </div>
        </div>

        {error ? (
          <Button type="button" variant="outline" className="min-h-11 w-full gap-2 sm:w-auto" onClick={() => setGenerationAttempt((attempt) => attempt + 1)}>
            <RefreshDouble className="size-4" aria-hidden />
            Try again
          </Button>
        ) : (
          <Button type="button" variant="outline" className="min-h-11 w-full gap-2 sm:w-auto" onClick={handleDownload} disabled={loading || downloading || !previewUrl}>
            <Download className="size-4" aria-hidden />
            {loading ? "Preparing PDF…" : downloading ? "Checking plan…" : "Download PDF"}
          </Button>
        )}
      </div>

      <div className="bg-[var(--color-paper-2)] p-3 sm:p-5">
        {previewUrl ? (
          <>
            <p className="mb-3 text-sm text-[var(--color-ink-muted)]">If the preview does not display, use Download PDF to open the same document in your preferred PDF reader.</p>
            <iframe
              title={`${familyName ?? "Family"} ${takeaway ? "takeaway" : "reviewed plan"} PDF`}
              src={`${previewUrl}#toolbar=0&navpanes=0&view=FitH`}
              className="h-[calc(100dvh-16rem)] min-h-[640px] w-full rounded-lg bg-white"
            />
          </>
        ) : (
          <div className="grid h-[calc(100dvh-16rem)] min-h-[640px] place-items-center rounded-lg bg-white px-6 text-center">
            <div>
              <span className="mx-auto grid size-12 place-items-center rounded-xl bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
                <FileText className="size-5" aria-hidden />
              </span>
              <p className="mt-4 text-sm font-semibold text-[var(--color-ink)]">
                {error ? "PDF preview unavailable" : "Preparing the PDF preview"}
              </p>
              <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-[var(--color-ink-muted)]" role={error ? "alert" : "status"}>
                {error ?? "CaseLink is generating the latest document from the reviewed plan."}
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
