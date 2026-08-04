"use client";

import { useEffect, useState } from "react";
import { Download, Page as FileText, RefreshDouble } from "iconoir-react";
import { Button } from "@/components/ui/button";
import type { PlanWithSteps } from "@/types/family";

function sanitizeFilenamePart(name: string): string {
  return name.replace(/[^\w\-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

export function PlanPdfExport({
  plan,
  familyName,
  barrierLabels,
}: {
  plan: PlanWithSteps;
  familyName?: string;
  barrierLabels: string[];
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generationAttempt, setGenerationAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    async function generatePreview() {
      setPreviewUrl(null);
      setDownloadName(null);
      setError(null);
      setLoading(true);

      const generatedDate = new Date().toLocaleDateString(undefined, {
        dateStyle: "medium",
      });

      try {
        const [{ pdf }, { PlanPdfDocument }, { finalizePlanPdf }] = await Promise.all([
          import("@react-pdf/renderer"),
          import("@/features/families/plan-pdf-document"),
          import("@/lib/domain/plan/finalize-plan-pdf"),
        ]);
        const renderedBlob = await pdf(
          <PlanPdfDocument
            plan={plan}
            familyName={familyName}
            generatedDate={generatedDate}
            barrierLabels={barrierLabels}
          />,
        ).toBlob();
        const finalizedBytes = await finalizePlanPdf(
          new Uint8Array(await renderedBlob.arrayBuffer()),
        );
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
        setDownloadName(`family-support-plan-${namePart}${datePart}.pdf`);
        setPreviewUrl(objectUrl);
      } catch (err) {
        if (cancelled) return;
        console.error("PDF preview failed:", err);
        setError("The PDF could not be prepared. Try generating it again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void generatePreview();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [barrierLabels, familyName, generationAttempt, plan]);

  function handleDownload() {
    if (!previewUrl || !downloadName) return;
    const link = document.createElement("a");
    link.href = previewUrl;
    link.download = downloadName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  return (
    <section className="overflow-hidden rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] [box-shadow:var(--shadow-surface)]" aria-label="Reviewed plan PDF">
      <div className="flex flex-col gap-4 border-b border-[var(--color-rule)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
            <FileText className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[var(--color-ink)]">
              {downloadName ?? "Preparing reviewed plan.pdf"}
            </p>
            <p className="mt-0.5 text-xs text-[var(--color-ink-faint)]">
              {loading ? "Generating the latest PDF…" : error ? "PDF generation needs attention" : "Generated from the reviewed plan"}
            </p>
          </div>
        </div>

        {error ? (
          <Button type="button" variant="outline" className="min-h-11 w-full gap-2 sm:w-auto" onClick={() => setGenerationAttempt((attempt) => attempt + 1)}>
            <RefreshDouble className="size-4" aria-hidden />
            Try again
          </Button>
        ) : (
          <Button type="button" variant="outline" className="min-h-11 w-full gap-2 sm:w-auto" onClick={handleDownload} disabled={loading || !previewUrl}>
            <Download className="size-4" aria-hidden />
            {loading ? "Preparing PDF…" : "Download PDF"}
          </Button>
        )}
      </div>

      <div className="bg-[var(--color-paper-2)] p-3 sm:p-5">
        {previewUrl ? (
          <iframe
            title={`${familyName ?? "Family"} reviewed plan PDF`}
            src={`${previewUrl}#toolbar=0&navpanes=0&view=FitH`}
            className="h-[calc(100dvh-16rem)] min-h-[640px] w-full rounded-lg bg-white"
          />
        ) : (
          <div className="grid h-[calc(100dvh-16rem)] min-h-[640px] place-items-center rounded-lg bg-white px-6 text-center">
            <div>
              <span className="mx-auto grid size-12 place-items-center rounded-xl bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
                <FileText className="size-5" aria-hidden />
              </span>
              <p className="mt-4 text-sm font-semibold text-[var(--color-ink)]">
                {error ? "PDF preview unavailable" : "Preparing the PDF preview"}
              </p>
              <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-[var(--color-ink-muted)]" role={error ? "alert" : undefined}>
                {error ?? "CaseLink is generating the latest document from the reviewed plan."}
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
