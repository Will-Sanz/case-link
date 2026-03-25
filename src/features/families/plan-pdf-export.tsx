"use client";

import { useState } from "react";
import { pdf } from "@react-pdf/renderer";
import { Button } from "@/components/ui/button";
import { PlanPdfDocument } from "@/features/families/plan-pdf-document";
import type { BarrierWorkflowResult } from "@/types/barrier-workflow";
import type { PlanWithSteps } from "@/types/family";

/** Preset + custom barriers for the case plan PDF header (deduped, order preserved). */
export function planPdfBarrierLabels(workflow: BarrierWorkflowResult): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    const k = t.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(t);
  };
  for (const b of workflow.selectedBarriers ?? []) push(b);
  for (const part of (workflow.additionalBarriers ?? "").split(/\r?\n|,|;/)) {
    push(part);
  }
  return out;
}

function sanitizeFilenamePart(name: string): string {
  return name.replace(/[^\w\-]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

export function PlanPdfExport({
  plan,
  familyName,
  workflow,
}: {
  plan: PlanWithSteps;
  familyName?: string;
  workflow: BarrierWorkflowResult;
}) {
  const [loading, setLoading] = useState(false);

  async function handleDownload() {
    setLoading(true);
    try {
      const generatedDate = new Date().toLocaleDateString(undefined, {
        dateStyle: "medium",
      });
      const barrierLabels = planPdfBarrierLabels(workflow);
      const blob = await pdf(
        <PlanPdfDocument
          plan={plan}
          familyName={familyName}
          generatedDate={generatedDate}
          barrierLabels={barrierLabels}
        />,
      ).toBlob();

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const namePart = familyName ? `${sanitizeFilenamePart(familyName)}-` : "";
      const datePart = sanitizeFilenamePart(generatedDate.replace(/\s+/g, "-"));
      a.download = `case-plan-${namePart}${datePart}.pdf`;
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
