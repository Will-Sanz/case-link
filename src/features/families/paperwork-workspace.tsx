"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Download,
  FileCheck2,
  FileUp,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { PDFDocument } from "pdf-lib";
import {
  authorizePaperworkDownloadAction,
  mapPdfFieldsAction,
} from "@/app/actions/paperwork";
import { recordCaseWorkflowEvent } from "@/app/actions/families";
import {
  applyPdfMappings,
  inspectSafeBlankPdf,
  UnsafePdfError,
  UnsupportedPdfFieldError,
} from "@/lib/paperwork/pdf-form";
import { normalizePaperworkMappings } from "@/lib/paperwork/paperwork-draft-reconciliation";
import { isManualOnlyPaperworkField } from "@/lib/paperwork/field-policy";
import type { PdfFieldDescriptor, PdfFieldMapping } from "@/types/paperwork";

const MAX_FILE_BYTES = 15 * 1024 * 1024;

function downloadName(fileName: string): string {
  const base =
    fileName
      .replace(/\.pdf$/i, "")
      .replace(/[^a-z0-9-_]+/gi, "-")
      .replace(/^-+|-+$/g, "") || "caselink-form";
  return `${base}-completed.pdf`;
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function PaperworkWorkspace({
  familyId,
  familyName,
  hasReviewedPlan,
  planId,
  reviewedAt,
}: {
  familyId: string;
  familyName: string;
  hasReviewedPlan: boolean;
  planId: string | null;
  reviewedAt: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadSequenceRef = useRef(0);
  const [fileName, setFileName] = useState("");
  const [originalBytes, setOriginalBytes] = useState<Uint8Array | null>(null);
  const [fields, setFields] = useState<PdfFieldDescriptor[]>([]);
  const [mappings, setMappings] = useState<PdfFieldMapping[]>([]);
  const [assistedByAi, setAssistedByAi] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewConfirmed, setPreviewConfirmed] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    if (!hasReviewedPlan || !planId) return;
    const key = `caselink:workflow-event:paperwork_viewed:${planId}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "1");
    } catch {
      // This privacy-safe event can still be recorded when session storage is unavailable.
    }
    void recordCaseWorkflowEvent({ familyId, planId, event: "paperwork_viewed" });
  }, [familyId, hasReviewedPlan, planId]);

  function clearPreview() {
    setPreviewConfirmed(false);
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
  }

  function resetPaperwork() {
    uploadSequenceRef.current += 1;
    clearPreview();
    setOriginalBytes(null);
    setFields([]);
    setMappings([]);
    setFileName("");
    setError(null);
    setAssistedByAi(false);
    setDownloaded(false);
    setPending(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleFile(file: File | undefined) {
    resetPaperwork();
    if (!file) return;
    const uploadSequence = uploadSequenceRef.current;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("Choose a PDF file.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("This PDF is larger than 15 MB. Choose a smaller fillable form.");
      return;
    }

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const document = await PDFDocument.load(bytes, { ignoreEncryption: false });
      const discovered = inspectSafeBlankPdf(document);
      if (uploadSequence !== uploadSequenceRef.current) return;

      // The file stays in this tab. Only bounded field metadata and reviewed plan data go server-side.
      setFileName(file.name);
      setOriginalBytes(bytes);
      setFields(discovered);
      setPending(true);
      void (async () => {
        try {
          const result = await mapPdfFieldsAction({ familyId, fields: discovered });
          if (uploadSequence !== uploadSequenceRef.current) return;
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setMappings(normalizePaperworkMappings(result.mappings));
          setAssistedByAi(result.assistedByAi);
        } catch {
          if (uploadSequence === uploadSequenceRef.current) {
            setError("CaseLink could not prepare this form. Try again.");
          }
        } finally {
          if (uploadSequence === uploadSequenceRef.current) setPending(false);
        }
      })();
    } catch (caught) {
      setError(
        caught instanceof UnsafePdfError
          ? caught.message
          : caught instanceof UnsupportedPdfFieldError
            ? "This form contains a field type CaseLink cannot safely review. Use text fields, checkboxes, dropdowns, radio buttons, or option lists."
            : "CaseLink could not read this PDF. Use an unlocked, blank fillable copy.",
      );
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function updateMapping(fieldName: string, patch: Partial<PdfFieldMapping>) {
    clearPreview();
    setDownloaded(false);
    setMappings((current) =>
      current.map((mapping) =>
        mapping.fieldName === fieldName ? { ...mapping, ...patch } : mapping,
      ),
    );
  }

  function updateValue(fieldName: string, value: string) {
    updateMapping(fieldName, {
      value,
      confidence: "high",
      source: "Edited by case manager",
      needsReview: false,
      reviewState: "edited",
    });
  }

  function confirmValue(mapping: PdfFieldMapping) {
    updateMapping(mapping.fieldName, {
      source: mapping.source.startsWith("Confirmed from ")
        ? mapping.source
        : `Confirmed from ${mapping.source}`,
      needsReview: false,
      reviewState: "accepted",
    });
  }

  function leaveFieldBlank(fieldName: string) {
    updateMapping(fieldName, {
      value: "",
      confidence: "high",
      source: "Left blank by case manager",
      needsReview: false,
      reviewState: "left_blank",
    });
  }

  async function completedPdfBytes(): Promise<Uint8Array> {
    if (!originalBytes) throw new Error("Missing PDF");
    const document = await PDFDocument.load(originalBytes, { ignoreEncryption: false });
    inspectSafeBlankPdf(document);
    applyPdfMappings(document, fields, mappings);
    try {
      document.getForm().updateFieldAppearances();
    } catch {
      // Preserve existing appearances when a source form uses a font pdf-lib cannot encode.
    }
    return new Uint8Array(await document.save());
  }

  async function openPreview() {
    if (mappings.some((mapping) => mapping.needsReview)) {
      setError("Finish reviewing every field before previewing the PDF.");
      return;
    }
    setError(null);
    try {
      const saved = await completedPdfBytes();
      const url = URL.createObjectURL(
        new Blob([ownedArrayBuffer(saved)], { type: "application/pdf" }),
      );
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return url;
      });
      setPreviewConfirmed(false);
    } catch {
      setError("CaseLink could not create a preview. Start again with the original blank form.");
    }
  }

  async function downloadCompletedPdf() {
    if (!originalBytes || !planId || !reviewedAt) return;
    if (!previewConfirmed) {
      setError("Preview the completed PDF and confirm every page before downloading.");
      return;
    }
    setError(null);
    try {
      const saved = await completedPdfBytes();
      const authorization = await authorizePaperworkDownloadAction({
        familyId,
        planId,
        reviewedAt,
        fieldCount: mappings.length,
        assistedByAi,
        paperworkMode: "fillable",
      });
      if (!authorization.ok) {
        setError(authorization.error);
        return;
      }
      const url = URL.createObjectURL(
        new Blob([ownedArrayBuffer(saved)], { type: "application/pdf" }),
      );
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = downloadName(fileName);
      anchor.click();
      URL.revokeObjectURL(url);
      resetPaperwork();
      setDownloaded(true);
    } catch {
      setError("CaseLink could not write the reviewed fields into this PDF.");
    }
  }

  const reviewCount = mappings.filter((mapping) => mapping.needsReview).length;

  if (!hasReviewedPlan) {
    return (
      <section className="rounded-xl border border-[#dce6d9] bg-white p-7 text-center shadow-[0_10px_30px_rgba(30,70,27,0.06)]">
        <span className="mx-auto grid size-12 place-items-center rounded-xl bg-[#edf4eb] text-[#276221]">
          <FileCheck2 className="size-5" aria-hidden />
        </span>
        <h2 className="mt-5 text-xl font-semibold text-[#173a15]">Review the intervention plan first</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[#5d705a]">
          Check each goal, action, and target date, then mark the plan reviewed.
        </p>
        <Link href={`/families/${familyId}/plan`} className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#276221] px-4 text-sm font-semibold text-white hover:bg-[#1f531b]">
          Review plan <ArrowRight className="size-4" aria-hidden />
        </Link>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-[#dce6d9] bg-white p-6 shadow-[0_10px_30px_rgba(30,70,27,0.06)] sm:p-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-[#5d705a]">Paperwork</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-[-0.025em] text-[#173a15]">{familyName}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#5d705a]">
              Upload an unlocked, blank fillable PDF. The file remains in this tab and is cleared after download or refresh.
            </p>
          </div>
          {originalBytes ? (
            <button type="button" onClick={resetPaperwork} className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-[#50644d] hover:bg-[#edf4eb]">
              <RotateCcw className="size-4" aria-hidden /> Start over
            </button>
          ) : null}
        </div>
      </section>

      {!originalBytes ? (
        <section className="rounded-xl border border-dashed border-[#a9c7a5] bg-[#edf4eb] p-8 text-center sm:p-12">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-white text-[#276221] shadow-[0_8px_24px_rgba(39,98,33,0.1)]">
            <FileUp className="size-6" aria-hidden />
          </span>
          <h2 className="mt-5 text-xl font-semibold text-[#173a15]">Upload a blank fillable PDF</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#5d705a]">
            Completed, scanned, active-content, encrypted, and non-fillable PDFs are rejected. Maximum 15 MB, 50 pages, and 150 fields.
          </p>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event) => void handleFile(event.target.files?.[0])}
            className="sr-only"
            id="paperwork-pdf"
          />
          <label htmlFor="paperwork-pdf" className="mt-5 inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#276221] px-4 text-sm font-semibold text-white shadow-[0_6px_18px_rgba(39,98,33,0.16)] hover:bg-[#1f531b] focus-within:ring-2 focus-within:ring-[#46923c]/30 focus-within:ring-offset-2">
            <FileUp className="size-4" aria-hidden /> Upload PDF
          </label>
        </section>
      ) : pending ? (
        <section className="rounded-xl border border-[#dce6d9] bg-white p-10 text-center" role="status">
          <span className="mx-auto block size-7 animate-spin rounded-full border-[3px] border-[#cfe0cc] border-t-[#276221]" aria-hidden />
          <h2 className="mt-5 text-lg font-semibold text-[#173a15]">Preparing {fields.length} form fields…</h2>
          <p className="mt-2 text-sm text-[#5d705a]">Matching field metadata to the reviewed plan.</p>
        </section>
      ) : mappings.length > 0 ? (
        <section className="overflow-hidden rounded-xl border border-[#dce6d9] bg-white shadow-[0_10px_30px_rgba(30,70,27,0.06)]">
          <div className="flex flex-col gap-3 border-b border-[#dce6d9] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-[#173a15]">Review {fileName}</h2>
              <p className="mt-1 text-xs text-[#687b65]">
                {assistedByAi ? "AI-assisted" : "Rule-based"} field suggestions · {reviewCount} {reviewCount === 1 ? "field" : "fields"} need attention
              </p>
            </div>
            <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${reviewCount ? "bg-[#fff5da] text-[#765a16]" : "bg-[#edf4eb] text-[#276221]"}`}>
              {reviewCount ? <AlertCircle className="size-3.5" aria-hidden /> : <CheckCircle2 className="size-3.5" aria-hidden />}
              {reviewCount ? `${reviewCount} to review` : "Ready to preview"}
            </span>
          </div>
          <div className="divide-y divide-[#e2ebe0]">
            {mappings.map((mapping) => {
              const field = fields.find((item) => item.name === mapping.fieldName);
              if (!field) return null;
              const manualOnly = isManualOnlyPaperworkField(mapping.fieldName, mapping.fieldName);
              return (
                <div key={mapping.fieldName} className="grid gap-3 px-5 py-5 lg:grid-cols-[220px_1fr_180px] lg:items-start">
                  <div>
                    <p className="break-words text-sm font-semibold text-[#365134]">{mapping.fieldName}</p>
                    <p className="mt-1 text-[11px] capitalize text-[#82917f]">{field.kind.replace("-", " ")}</p>
                  </div>
                  <div>
                    {manualOnly ? (
                      <div className="rounded-lg border border-[#cfdccc] bg-[#f6f8f4] px-3 py-2.5 text-sm leading-5 text-[#5d705a]">
                        Leave blank in CaseLink. Complete this field manually after download.
                      </div>
                    ) : field.kind === "text" ? (
                      <textarea
                        aria-label={mapping.fieldName}
                        value={mapping.value}
                        maxLength={Math.min(field.maxLength ?? 4000, 4000)}
                        rows={mapping.value.length > 90 ? 3 : 1}
                        onChange={(event) => updateValue(mapping.fieldName, event.target.value)}
                        className={`w-full resize-y rounded-lg border px-3 py-2.5 text-sm leading-5 text-[#253f23] outline-none focus:border-[#46923c] focus:ring-4 focus:ring-[#46923c]/10 ${mapping.needsReview ? "border-[#d9c27e] bg-[#fffaf0]" : "border-[#cfdccc] bg-white"}`}
                      />
                    ) : (
                      <select
                        aria-label={mapping.fieldName}
                        value={mapping.value}
                        onChange={(event) => updateValue(mapping.fieldName, event.target.value)}
                        className="min-h-11 w-full rounded-lg border border-[#cfdccc] bg-white px-3 text-sm text-[#253f23]"
                      >
                        <option value="">Leave blank</option>
                        {field.kind === "checkbox" ? (
                          <>
                            <option value="true">Checked</option>
                            <option value="false">Not checked</option>
                          </>
                        ) : field.options.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    )}
                  </div>
                  <div className="text-xs leading-5">
                    <p className={mapping.needsReview ? "font-semibold text-[#8a681c]" : "font-semibold text-[#276221]"}>
                      {mapping.needsReview ? "Review needed" : "Ready"}
                    </p>
                    <p className="mt-1 text-[#687b65]">{mapping.source}</p>
                    <p className="mt-1 capitalize text-[#82917f]">{mapping.confidence} confidence</p>
                    {mapping.needsReview ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {mapping.value ? (
                          <button type="button" onClick={() => confirmValue(mapping)} className="min-h-9 rounded-lg border border-[#a9c7a5] bg-white px-3 font-semibold text-[#276221] hover:bg-[#edf4eb]">Accept suggestion</button>
                        ) : null}
                        <button type="button" onClick={() => leaveFieldBlank(mapping.fieldName)} className="min-h-9 rounded-lg px-3 font-semibold text-[#50644d] hover:bg-[#edf4eb]">
                          {mapping.value ? "Reject and leave blank" : "Confirm blank"}
                        </button>
                      </div>
                    ) : mapping.value ? (
                      <button type="button" onClick={() => leaveFieldBlank(mapping.fieldName)} className="mt-2 min-h-9 rounded-lg px-3 font-semibold text-[#50644d] hover:bg-[#edf4eb]">Leave blank instead</button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-col gap-4 border-t border-[#dce6d9] bg-[#f6f8f4] px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex max-w-xl items-start gap-2 text-xs leading-5 text-[#5d705a]">
              <Sparkles className="mt-0.5 size-3.5 shrink-0 text-[#3b8132]" aria-hidden /> Check every page before uploading the PDF to your required system. CaseLink never submits it.
            </p>
            <button type="button" onClick={() => void openPreview()} disabled={reviewCount > 0} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-[#276221] px-4 text-sm font-semibold text-white hover:bg-[#1f531b] disabled:cursor-not-allowed disabled:bg-[#9bad98]">
              <FileCheck2 className="size-4" aria-hidden /> {previewUrl ? "Refresh preview" : "Preview completed PDF"}
            </button>
          </div>
        </section>
      ) : null}

      {previewUrl ? (
        <section className="overflow-hidden rounded-xl border border-[#dce6d9] bg-white shadow-[0_10px_30px_rgba(30,70,27,0.06)]">
          <div className="flex flex-col gap-3 border-b border-[#dce6d9] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-[#173a15]">Check the completed PDF</h2>
              <p className="mt-1 text-xs leading-5 text-[#687b65]">Confirm the values on every page. Identity and signature fields must remain blank.</p>
            </div>
            <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-[#a9c7a5] bg-[#f6faf5] px-3 text-sm font-semibold text-[#276221]">
              <input type="checkbox" checked={previewConfirmed} onChange={(event) => setPreviewConfirmed(event.target.checked)} className="size-4 accent-[#276221]" />
              I reviewed every page
            </label>
          </div>
          <iframe src={previewUrl} title="Completed PDF preview" className="h-[72vh] min-h-[560px] w-full bg-slate-100" />
          <div className="flex justify-end border-t border-[#dce6d9] bg-[#f6f8f4] px-5 py-4">
            <button type="button" onClick={() => void downloadCompletedPdf()} disabled={!previewConfirmed} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#276221] px-4 text-sm font-semibold text-white hover:bg-[#1f531b] disabled:cursor-not-allowed disabled:bg-[#9bad98]">
              <Download className="size-4" aria-hidden /> Download completed PDF
            </button>
          </div>
        </section>
      ) : null}

      {downloaded ? (
        <p className="rounded-lg border border-[#b8d6b3] bg-[#edf4eb] px-4 py-3 text-sm font-medium text-[#276221]" role="status">
          Completed PDF downloaded and cleared from this tab. CaseLink did not submit it.
        </p>
      ) : null}
      {error ? <p className="rounded-lg bg-[#fef2f2] px-4 py-3 text-sm font-medium text-[#a32929]" role="alert">{error}</p> : null}
    </div>
  );
}
