"use client";

import { useState } from "react";
import { pdf } from "@react-pdf/renderer";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlanPdfDocument } from "@/features/families/plan-pdf-document";
import { finalizePlanPdf } from "@/lib/domain/plan/finalize-plan-pdf";
import type { PlanWithSteps } from "@/types/family";

function sanitizeFilenamePart(name: string): string {
  return name.replace(/[^\w\-]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setError(null);
    setLoading(true);
    try {
      const generatedDate = new Date().toLocaleDateString(undefined, {
        dateStyle: "medium",
      });
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

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const namePart = familyName ? `${sanitizeFilenamePart(familyName)}-` : "";
      const datePart = sanitizeFilenamePart(generatedDate.replace(/\s+/g, "-"));
      a.download = `family-support-plan-${namePart}${datePart}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("PDF export failed:", err);
      setError("The plan PDF could not be prepared. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <Button
        type="button"
        variant="outline"
        className="inline-flex min-h-12 w-full items-center justify-center gap-2 sm:w-auto"
        onClick={handleDownload}
        disabled={loading}
      >
        <Download className="size-4" aria-hidden />
        {loading ? "Preparing…" : "Download plan PDF"}
      </Button>
      {error ? (
        <p className="mt-2 max-w-52 text-xs font-medium text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
