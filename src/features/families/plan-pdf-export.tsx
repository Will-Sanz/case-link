"use client";

import { useState } from "react";
import { pdf } from "@react-pdf/renderer";
import { Button } from "@/components/ui/button";
import { PlanPdfDocument } from "@/features/families/plan-pdf-document";
import type { PlanWithSteps } from "@/types/family";

export function PlanPdfExport({
  plan,
  familyName,
}: {
  plan: PlanWithSteps;
  familyName?: string;
}) {
  const [loading, setLoading] = useState(false);

  async function handleDownload() {
    setLoading(true);
    try {
      const generatedDate = new Date().toLocaleDateString(undefined, {
        dateStyle: "medium",
      });
      const blob = await pdf(
        <PlanPdfDocument
          plan={plan}
          familyName={familyName}
          generatedDate={generatedDate}
        />,
      ).toBlob();

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `30-60-90-plan-${familyName ? `${familyName.replace(/\s+/g, "-")}-` : ""}${generatedDate.replace(/\s+/g, "-")}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("PDF export failed:", err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      variant="secondary"
      className="border-slate-200"
      onClick={handleDownload}
      disabled={loading}
    >
      {loading ? "Preparing…" : "Download PDF"}
    </Button>
  );
}
