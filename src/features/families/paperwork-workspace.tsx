"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Download,
  FileCheck2,
  FileUp,
  LockKeyhole,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PDFDocument,
} from "pdf-lib";
import {
  authorizePaperworkDownloadAction,
  mapPdfFieldsAction,
} from "@/app/actions/paperwork";
import {
  applyPdfMappings,
  applyPdfOverlayMappings,
  findCompletedPdfFields,
  inspectPdfFields,
  UnsupportedPdfFieldError,
} from "@/lib/paperwork/pdf-form";
import type {
  PdfFieldDescriptor,
  PdfFieldMapping,
  PdfOverlayField,
  ScannedPdfAnalysis,
} from "@/types/paperwork";
import { isManualOnlyPaperworkField } from "@/lib/paperwork/scanned-pdf-analysis";
import {
  acceptUpdatedPaperworkSuggestion,
  keepCurrentPaperworkValue,
  normalizePaperworkMappings,
  paperworkOutOfDateCount,
  reconcilePaperworkMappings,
} from "@/lib/paperwork/paperwork-draft-reconciliation";
import {
  deleteLocalPaperworkDraft,
  loadLocalPaperworkDraft,
  saveLocalPaperworkBlank,
  saveLocalPaperworkDraft,
  type LocalPaperworkDraft,
} from "@/lib/paperwork/local-paperwork-draft";

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_SCANNED_FILE_BYTES = 3_500_000;

function downloadName(fileName: string): string {
  const base = fileName.replace(/\.pdf$/i, "").replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "") || "caselink-form";
  return `${base}-completed.pdf`;
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function acknowledgeCurrentPlan(mapping: PdfFieldMapping): PdfFieldMapping {
  return mapping.reviewState === "out_of_date"
    ? keepCurrentPaperworkValue(mapping)
    : mapping;
}

async function analyzeScannedBlank(
  familyId: string,
  bytes: Uint8Array,
): Promise<ScannedPdfAnalysis | { error: string }> {
  try {
    const body = new FormData();
    body.set("familyId", familyId);
    body.set(
      "file",
      new File([ownedArrayBuffer(bytes)], "blank-form.pdf", { type: "application/pdf" }),
      "blank-form.pdf",
    );
    const response = await fetch("/api/paperwork/analyze", {
      method: "POST",
      body,
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as
      | ScannedPdfAnalysis
      | { error?: string }
      | null;
    if (!response.ok || !payload || !("overlayFields" in payload)) {
      return {
        error:
          payload && "error" in payload && payload.error
            ? payload.error
            : "CaseLink could not analyze this scanned form.",
      };
    }
    return payload;
  } catch {
    return { error: "CaseLink could not analyze this scanned form. Check your connection and try again." };
  }
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
  const [fileName, setFileName] = useState("");
  const [originalBytes, setOriginalBytes] = useState<Uint8Array | null>(null);
  const [fields, setFields] = useState<PdfFieldDescriptor[]>([]);
  const [overlayFields, setOverlayFields] = useState<PdfOverlayField[]>([]);
  const [mappings, setMappings] = useState<PdfFieldMapping[]>([]);
  const [paperworkMode, setPaperworkMode] = useState<"fillable" | "scanned" | null>(null);
  const [documentTitle, setDocumentTitle] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewConfirmed, setPreviewConfirmed] = useState(false);
  const [blankTemplateConfirmed, setBlankTemplateConfirmed] = useState(false);
  const [assistedByAi, setAssistedByAi] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftSource, setDraftSource] = useState<{ planId: string; reviewedAt: string } | null>(null);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [sourceCheckError, setSourceCheckError] = useState<string | null>(null);
  const [sourceCheckPending, setSourceCheckPending] = useState(false);
  const restoreAttemptedFamilyRef = useRef<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const refreshDraftAgainstPlan = useCallback(
    async (draft: LocalPaperworkDraft, bytes: Uint8Array) => {
      if (!planId || !reviewedAt) return;
      setSourceCheckPending(true);
      setSourceCheckError(null);
      clearPreview();
      try {
        let currentMappings: PdfFieldMapping[];
        if (draft.paperworkMode === "fillable") {
          const result = await mapPdfFieldsAction({ familyId, fields: draft.fields });
          if (!result.ok) {
            setSourceCheckError(result.error);
            return;
          }
          currentMappings = result.mappings;
          setAssistedByAi(result.assistedByAi);
        } else {
          const analysis = await analyzeScannedBlank(familyId, bytes);
          if ("error" in analysis) {
            setSourceCheckError(analysis.error);
            return;
          }
          currentMappings = analysis.mappings;
          setOverlayFields(analysis.overlayFields);
          setFields(
            analysis.overlayFields.map((field) => ({
              name: field.fieldName,
              kind: field.kind,
              options: [],
              maxLength: null,
            })),
          );
          setDocumentTitle(analysis.documentTitle);
          setWarnings(analysis.warnings);
          setAssistedByAi(true);
        }

        const reconciled = reconcilePaperworkMappings(draft.mappings, currentMappings);
        const changedCount = paperworkOutOfDateCount(reconciled);
        setMappings(reconciled);
        setDraftSource({ planId, reviewedAt });
        setDownloaded(false);
        setDraftNotice(
          changedCount > 0
            ? `${changedCount} ${changedCount === 1 ? "field is" : "fields are"} out of date after the plan changed. Your prior entries are still here.`
            : "Paperwork draft restored. The reviewed plan changed, but these field suggestions are still current.",
        );
      } finally {
        setSourceCheckPending(false);
      }
    },
    [familyId, planId, reviewedAt],
  );

  useEffect(() => {
    if (
      !hasReviewedPlan ||
      !planId ||
      !reviewedAt ||
      restoreAttemptedFamilyRef.current === familyId
    ) {
      return;
    }
    restoreAttemptedFamilyRef.current = familyId;
    let cancelled = false;
    void loadLocalPaperworkDraft(familyId)
      .then(async ({ draft, bytes }) => {
        if (cancelled || !draft || !bytes || draft.mappings.length === 0) return;
        setOriginalBytes(bytes);
        setFileName("blank-form.pdf");
        setFields(draft.fields);
        setOverlayFields(draft.overlayFields);
        setMappings(normalizePaperworkMappings(draft.mappings));
        setPaperworkMode(draft.paperworkMode);
        setDocumentTitle(draft.documentTitle);
        setWarnings(draft.warnings);
        setAssistedByAi(draft.assistedByAi);
        setBlankTemplateConfirmed(true);
        setDraftSource({ planId: draft.planId, reviewedAt: draft.reviewedAt });
        setDraftNotice("Paperwork draft restored from this browser.");
        if (draft.planId !== planId || draft.reviewedAt !== reviewedAt) {
          await refreshDraftAgainstPlan(draft, bytes);
        }
      })
      .catch(() => {
        // Browser storage can be unavailable in private or restricted browsing.
      });
    return () => {
      cancelled = true;
    };
  }, [familyId, hasReviewedPlan, planId, refreshDraftAgainstPlan, reviewedAt]);

  useEffect(() => {
    if (
      !draftSource ||
      !originalBytes ||
      !paperworkMode ||
      mappings.length === 0
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      void saveLocalPaperworkDraft({
        v: 1,
        familyId,
        planId: draftSource.planId,
        reviewedAt: draftSource.reviewedAt,
        paperworkMode,
        fields,
        overlayFields,
        mappings,
        documentTitle,
        warnings,
        assistedByAi,
        updatedAt: new Date().toISOString(),
      }).catch(() => {
        setDraftNotice(
          "This draft is still open, but this browser could not save it for a later return.",
        );
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [
    assistedByAi,
    documentTitle,
    draftSource,
    familyId,
    fields,
    mappings,
    originalBytes,
    overlayFields,
    paperworkMode,
    warnings,
  ]);

  function clearPreview() {
    setPreviewConfirmed(false);
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
  }

  function resetPaperwork() {
    void deleteLocalPaperworkDraft(familyId).catch(() => {});
    clearPreview();
    setOriginalBytes(null);
    setFields([]);
    setOverlayFields([]);
    setMappings([]);
    setPaperworkMode(null);
    setDocumentTitle("");
    setWarnings([]);
    setFileName("");
    setError(null);
    setAssistedByAi(false);
    setBlankTemplateConfirmed(false);
    setDownloaded(false);
    setDraftSource(null);
    setDraftNotice(null);
    setSourceCheckError(null);
    setSourceCheckPending(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleFile(file: File | undefined) {
    setError(null);
    setDraftNotice(null);
    setSourceCheckError(null);
    setDraftSource(null);
    setDownloaded(false);
    setMappings([]);
    setOverlayFields([]);
    setWarnings([]);
    setDocumentTitle("");
    setPaperworkMode(null);
    clearPreview();
    setAssistedByAi(false);
    if (!file) return;
    if (!blankTemplateConfirmed) {
      setError("Confirm that the PDF is a clean blank template before selecting it.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
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
      const document = await PDFDocument.load(bytes);
      const discovered = inspectPdfFields(document);
      const completedFields = findCompletedPdfFields(document);
      if (completedFields.length > 0) {
        setError(
          `This form already contains ${completedFields.length} completed ${completedFields.length === 1 ? "field" : "fields"}. Upload a clean blank template.`,
        );
        if (inputRef.current) inputRef.current.value = "";
        return;
      }
      setFileName(file.name);
      setOriginalBytes(bytes);
      if (discovered.length > 0) {
        try {
          await saveLocalPaperworkBlank(familyId, bytes);
        } catch {
          setDraftNotice(
            "This form is open, but this browser could not save the draft for a later return.",
          );
        }
        setPaperworkMode("fillable");
        setFields(discovered);
        startTransition(async () => {
          const result = await mapPdfFieldsAction({ familyId, fields: discovered });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setMappings(normalizePaperworkMappings(result.mappings));
          setAssistedByAi(result.assistedByAi);
          if (planId && reviewedAt) setDraftSource({ planId, reviewedAt });
        });
        return;
      }

      if (file.size > MAX_SCANNED_FILE_BYTES) {
        setOriginalBytes(null);
        setFileName("");
        setError(
          "This scanned PDF is too large for secure analysis. Use a 3.5 MB or smaller copy, or a fillable PDF up to 15 MB.",
        );
        return;
      }

      try {
        await saveLocalPaperworkBlank(familyId, bytes);
      } catch {
        setDraftNotice(
          "This form is open, but this browser could not save the draft for a later return.",
        );
      }
      setPaperworkMode("scanned");
      setFields([]);
      startTransition(async () => {
        const payload = await analyzeScannedBlank(familyId, bytes);
        if ("error" in payload) {
          setOriginalBytes(null);
          setFileName("");
          setPaperworkMode(null);
          setError(payload.error);
          if (inputRef.current) inputRef.current.value = "";
          return;
        }
        setOverlayFields(payload.overlayFields);
        setFields(
          payload.overlayFields.map((field) => ({
            name: field.fieldName,
            kind: field.kind,
            options: [],
            maxLength: null,
          })),
        );
        setMappings(normalizePaperworkMappings(payload.mappings));
        setDocumentTitle(payload.documentTitle);
        setWarnings(payload.warnings);
        setAssistedByAi(true);
        if (planId && reviewedAt) setDraftSource({ planId, reviewedAt });
      });
    } catch (caught) {
      setError(caught instanceof UnsupportedPdfFieldError
        ? "This form contains a field type CaseLink cannot safely review. Use a version with text fields, checkboxes, dropdowns, radio buttons, or option lists."
        : "CaseLink could not read this PDF. It may be encrypted or damaged; try an unlocked fillable copy.");
    }
  }

  function updateValue(fieldName: string, value: string) {
    clearPreview();
    setDownloaded(false);
    setMappings((current) =>
      current.map((mapping) =>
        mapping.fieldName === fieldName
          ? {
              ...acknowledgeCurrentPlan(mapping),
              value,
              confidence: "high",
              source: "Edited by case manager",
              needsReview: false,
              reviewState: "edited" as const,
            }
          : mapping,
      ),
    );
  }

  function confirmValue(fieldName: string) {
    clearPreview();
    setDownloaded(false);
    setMappings((current) =>
      current.map((mapping) =>
        mapping.fieldName === fieldName
          ? {
              ...mapping,
              source: mapping.source.startsWith("Confirmed from ")
                ? mapping.source
                : `Confirmed from ${mapping.source}`,
              needsReview: false,
              reviewState: "accepted",
            }
          : mapping,
      ),
    );
  }

  function leaveFieldBlank(fieldName: string) {
    clearPreview();
    setDownloaded(false);
    setMappings((current) =>
      current.map((mapping) =>
        mapping.fieldName === fieldName
          ? {
              ...acknowledgeCurrentPlan(mapping),
              value: "",
              confidence: "high",
              source: "Left blank by case manager",
              needsReview: false,
              reviewState: "left_blank" as const,
            }
          : mapping,
      ),
    );
  }

  function acceptUpdatedValue(fieldName: string) {
    clearPreview();
    setDownloaded(false);
    setMappings((current) =>
      current.map((mapping) =>
        mapping.fieldName === fieldName
          ? acceptUpdatedPaperworkSuggestion(mapping)
          : mapping,
      ),
    );
  }

  function keepCurrentValue(fieldName: string) {
    clearPreview();
    setDownloaded(false);
    setMappings((current) =>
      current.map((mapping) =>
        mapping.fieldName === fieldName ? keepCurrentPaperworkValue(mapping) : mapping,
      ),
    );
  }

  function retryPaperworkSourceCheck() {
    if (!originalBytes || !paperworkMode || !draftSource) return;
    void refreshDraftAgainstPlan(
      {
        v: 1,
        familyId,
        planId: draftSource.planId,
        reviewedAt: draftSource.reviewedAt,
        paperworkMode,
        fields,
        overlayFields,
        mappings,
        documentTitle,
        warnings,
        assistedByAi,
        updatedAt: new Date().toISOString(),
      },
      originalBytes,
    );
  }

  async function completedPdfBytes(): Promise<Uint8Array> {
    if (!originalBytes) throw new Error("Missing PDF");
    const document = await PDFDocument.load(originalBytes);
    if (paperworkMode === "scanned") {
      await applyPdfOverlayMappings(document, overlayFields, mappings);
    } else {
      applyPdfMappings(document, fields, mappings);
      const form = document.getForm();
      try { form.updateFieldAppearances(); } catch { /* preserve existing appearances for fonts pdf-lib cannot encode */ }
    }
    return new Uint8Array(await document.save());
  }

  async function openPreview() {
    if (sourceCheckPending || sourceCheckError) {
      setError("Finish checking this draft against the current reviewed plan before previewing.");
      return;
    }
    const unresolved = mappings.filter((mapping) => mapping.needsReview).length;
    if (unresolved > 0) {
      setError(`Review ${unresolved} ${unresolved === 1 ? "field" : "fields"} before previewing.`);
      return;
    }
    setError(null);
    try {
      const saved = await completedPdfBytes();
      const url = URL.createObjectURL(new Blob([ownedArrayBuffer(saved)], { type: "application/pdf" }));
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return url;
      });
      setPreviewConfirmed(false);
    } catch {
      setError("CaseLink could not create a preview from this PDF. Start again with the original form.");
    }
  }

  async function downloadCompletedPdf() {
    if (!originalBytes) return;
    if (sourceCheckPending || sourceCheckError) {
      setError("Finish checking this draft against the current reviewed plan before downloading.");
      return;
    }
    const unresolved = mappings.filter((mapping) => mapping.needsReview).length;
    if (unresolved > 0) {
      setError(`Review ${unresolved} ${unresolved === 1 ? "field" : "fields"} before downloading.`);
      return;
    }
    if (paperworkMode === "scanned" && !previewConfirmed) {
      setError("Open the completed PDF preview and confirm the placement before downloading.");
      return;
    }
    setError(null);
    try {
      const saved = await completedPdfBytes();
      if (!planId || !reviewedAt) {
        setError("Review the current plan again before downloading this paperwork.");
        return;
      }
      const authorization = await authorizePaperworkDownloadAction({
        familyId,
        planId,
        reviewedAt,
        fieldCount: mappings.length,
        assistedByAi,
        paperworkMode: paperworkMode ?? "fillable",
      });
      if (!authorization.ok) {
        setError(
          authorization.outOfDate
            ? "The reviewed plan changed after this form was prepared. Return to the plan, complete its review, then reopen Paperwork; this browser will preserve your entries and flag only affected fields."
            : authorization.error,
        );
        return;
      }
      const url = URL.createObjectURL(new Blob([ownedArrayBuffer(saved)], { type: "application/pdf" }));
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = downloadName(fileName);
      anchor.click();
      URL.revokeObjectURL(url);
      setDownloaded(true);
    } catch {
      setError("CaseLink could not write the reviewed fields into this PDF. Reload the original fillable form and try again.");
    }
  }

  const reviewCount = mappings.filter((mapping) => mapping.needsReview).length;
  const outOfDateCount = paperworkOutOfDateCount(mappings);
  const sourceCheckBlocked = sourceCheckPending || Boolean(sourceCheckError);
  const paperworkBlocked = reviewCount > 0 || sourceCheckBlocked;

  if (!hasReviewedPlan) {
    return (
      <section className="rounded-xl border border-[#dce6d9] bg-white p-7 text-center shadow-[0_10px_30px_rgba(30,70,27,0.06)]">
        <span className="mx-auto grid size-12 place-items-center rounded-xl bg-[#edf4eb] text-[#276221]"><FileCheck2 className="size-5" aria-hidden /></span>
        <h2 className="mt-5 text-xl font-semibold text-[#173a15]">Review the intervention plan first</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[#5d705a]">Check each goal, action, and target date, then mark the plan reviewed. Only reviewed plan information can be carried into paperwork.</p>
        <Link href={`/families/${familyId}/plan`} className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#276221] px-4 text-sm font-semibold text-white hover:bg-[#1f531b]">Review plan <ArrowRight className="size-4" aria-hidden /></Link>
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
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#5d705a]">Upload a clean blank PDF. CaseLink proposes entries from the reviewed family plan, then you check uncertain fields and the completed document before download.</p>
          </div>
          {originalBytes ? <button type="button" onClick={resetPaperwork} className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-[#50644d] hover:bg-[#edf4eb]"><RotateCcw className="size-4" aria-hidden /> Start over</button> : null}
        </div>
        <div className="mt-5 flex items-start gap-2 rounded-lg bg-[#edf4eb] px-4 py-3 text-xs leading-5 text-[#50644d]"><LockKeyhole className="mt-0.5 size-4 shrink-0 text-[#276221]" aria-hidden /> Upload only a blank template—never a completed form or identifying attachment. Fillable forms stay in your browser; blank scanned forms are sent temporarily for AI layout analysis and are not written to CaseLink storage.</div>
      </section>

      {draftNotice ? (
        <p
          className="rounded-lg border border-[#cfe0cc] bg-[#f3f8f1] px-4 py-3 text-sm text-[#365134]"
          role="status"
        >
          {draftNotice}
        </p>
      ) : null}

      {sourceCheckPending ? (
        <div
          className="flex items-center gap-3 rounded-lg border border-[#dce6d9] bg-white px-4 py-3 text-sm text-[#50644d]"
          role="status"
          aria-live="polite"
        >
          <span
            className="size-4 shrink-0 animate-spin rounded-full border-2 border-[#cfe0cc] border-t-[#276221]"
            aria-hidden
          />
          Checking this saved draft against the current reviewed plan…
        </div>
      ) : null}

      {sourceCheckError ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3" role="alert">
          <p className="text-sm font-semibold text-amber-950">Could not check the updated plan</p>
          <p className="mt-1 text-sm leading-6 text-amber-900">
            Your paperwork entries are still saved in this browser. Retry before downloading so
            CaseLink can identify only the fields that changed.
          </p>
          <Button
            type="button"
            variant="secondary"
            className="mt-3"
            onClick={retryPaperworkSourceCheck}
            disabled={sourceCheckPending}
          >
            Retry plan check
          </Button>
        </section>
      ) : null}

      {!originalBytes ? (
        <section className="rounded-xl border border-dashed border-[#a9c7a5] bg-[#edf4eb] p-8 text-center sm:p-12">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-white text-[#276221] shadow-[0_8px_24px_rgba(39,98,33,0.1)]"><FileUp className="size-6" aria-hidden /></span>
          <h2 className="mt-5 text-xl font-semibold text-[#173a15]">Choose a clean blank PDF</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#5d705a]">Fillable forms up to 15 MB are completed in your browser. Scanned or flattened forms up to 3.5 MB can use the reviewed AI overlay.</p>
          <label className="mx-auto mt-5 flex max-w-lg cursor-pointer items-start gap-3 rounded-xl border border-[#cfe0cc] bg-white px-4 py-3 text-left text-sm leading-5 text-[#365134]">
            <input
              type="checkbox"
              checked={blankTemplateConfirmed}
              onChange={(event) => {
                setBlankTemplateConfirmed(event.target.checked);
                setError(null);
              }}
              className="mt-0.5 size-4 shrink-0 accent-[#276221]"
            />
            <span>
              I confirm this is a clean blank template with no names, handwriting, completed
              checkmarks, contact details, IDs, or signatures.
            </span>
          </label>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event) => void handleFile(event.target.files?.[0])}
            className="sr-only"
            id="paperwork-pdf"
            disabled={!blankTemplateConfirmed}
          />
          <label
            htmlFor="paperwork-pdf"
            aria-disabled={!blankTemplateConfirmed}
            className={`mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold text-white focus-within:ring-2 focus-within:ring-[#46923c]/30 focus-within:ring-offset-2 ${
              blankTemplateConfirmed
                ? "cursor-pointer bg-[#276221] shadow-[0_6px_18px_rgba(39,98,33,0.16)] hover:bg-[#1f531b]"
                : "cursor-not-allowed bg-[#9bad98]"
            }`}
          >
            <FileUp className="size-4" aria-hidden /> Select PDF
          </label>
        </section>
      ) : pending ? (
        <section className="rounded-xl border border-[#dce6d9] bg-white p-10 text-center" role="status">
          <span className="mx-auto block size-7 animate-spin rounded-full border-[3px] border-[#cfe0cc] border-t-[#276221]" aria-hidden />
          <h2 className="mt-5 text-lg font-semibold text-[#173a15]">
            {paperworkMode === "scanned"
              ? "Reading the blank form layout…"
              : `Preparing ${fields.length} form fields…`}
          </h2>
          <p className="mt-2 text-sm text-[#5d705a]">
            {paperworkMode === "scanned"
              ? "Detecting writable areas before matching them to reviewed plan facts."
              : "Matching the form to the reviewed profile and completed plan."}
          </p>
        </section>
      ) : mappings.length ? (
        <section className="overflow-hidden rounded-xl border border-[#dce6d9] bg-white shadow-[0_10px_30px_rgba(30,70,27,0.06)]">
          <div className="flex flex-col gap-3 border-b border-[#dce6d9] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-[#173a15]">
                Review {documentTitle || fileName}
              </h2>
              <p className="mt-1 text-xs text-[#687b65]">
                {paperworkMode === "scanned"
                  ? "AI-detected scanned-form overlay"
                  : assistedByAi
                    ? "AI-assisted fillable fields"
                    : "Rule-based fillable fields"} · {reviewCount} {reviewCount === 1 ? "field" : "fields"} need attention
              </p>
            </div>
            <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${paperworkBlocked ? "bg-[#fff5da] text-[#765a16]" : "bg-[#edf4eb] text-[#276221]"}`}>{paperworkBlocked ? <AlertCircle className="size-3.5" aria-hidden /> : <CheckCircle2 className="size-3.5" aria-hidden />}{sourceCheckBlocked ? "Plan check needed" : outOfDateCount ? `${outOfDateCount} out of date` : reviewCount ? `${reviewCount} to review` : "Ready to download"}</span>
          </div>
          {outOfDateCount > 0 ? (
            <div className="border-b border-[#eadcae] bg-[#fffaf0] px-5 py-4 text-sm leading-6 text-[#765a16]">
              <p className="font-semibold">The reviewed plan changed</p>
              <p className="mt-1">
                Only affected suggestions are marked below. Your manual entries and every unchanged
                field remain in place until you choose what to keep.
              </p>
            </div>
          ) : null}
          {warnings.length > 0 ? (
            <div className="border-b border-[#eadcae] bg-[#fffaf0] px-5 py-3 text-xs leading-5 text-[#765a16]">
              <p className="font-semibold">Check these layout notes in the preview</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {warnings.map((warning, index) => (
                  <li key={`${warning}-${index}`}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="divide-y divide-[#e2ebe0]">
            {mappings.map((mapping) => {
              const field = fields.find((item) => item.name === mapping.fieldName);
              if (!field) return null;
              const overlay = overlayFields.find((item) => item.fieldName === mapping.fieldName);
              const displayLabel = overlay?.label || mapping.fieldName;
              const needsReview = mapping.needsReview;
              const outOfDate = mapping.reviewState === "out_of_date";
              const manualOnly = isManualOnlyPaperworkField(mapping.fieldName, displayLabel);
              return (
                <div key={mapping.fieldName} className="grid gap-3 px-5 py-5 lg:grid-cols-[220px_1fr_180px] lg:items-start">
                  <div>
                    <p className="break-words text-sm font-semibold text-[#365134]">{displayLabel}</p>
                    <p className="mt-1 text-[11px] capitalize text-[#82917f]">
                      {field.kind.replace("-", " ")}
                      {overlay ? ` · page ${overlay.pageIndex + 1}` : ""}
                    </p>
                  </div>
                  <div>
                    {manualOnly ? (
                      <div className="rounded-lg border border-[#cfdccc] bg-[#f6f8f4] px-3 py-2.5 text-sm leading-5 text-[#5d705a]">
                        Leave blank in CaseLink. Complete this field manually after download.
                      </div>
                    ) : field.kind === "text" ? (
                      <textarea
                        aria-label={displayLabel}
                        value={mapping.value}
                        maxLength={field.maxLength ?? undefined}
                        rows={mapping.value.length > 90 ? 3 : 1}
                        onChange={(event) => updateValue(mapping.fieldName, event.target.value)}
                        className={`w-full resize-y rounded-lg border px-3 py-2.5 text-sm leading-5 text-[#253f23] outline-none focus:border-[#46923c] focus:ring-4 focus:ring-[#46923c]/10 ${needsReview ? "border-[#d9c27e] bg-[#fffaf0]" : "border-[#cfdccc] bg-white"}`}
                      />
                    ) : field.kind === "checkbox" ? (
                      <select
                        aria-label={displayLabel}
                        value={mapping.value}
                        onChange={(event) => updateValue(mapping.fieldName, event.target.value)}
                        className="min-h-11 w-full rounded-lg border border-[#cfdccc] bg-white px-3 text-sm text-[#253f23]"
                      >
                        <option value="">Leave blank</option>
                        <option value="true">Checked</option>
                        <option value="false">Not checked</option>
                      </select>
                    ) : (
                      <select
                        aria-label={displayLabel}
                        value={mapping.value}
                        onChange={(event) => updateValue(mapping.fieldName, event.target.value)}
                        className="min-h-11 w-full rounded-lg border border-[#cfdccc] bg-white px-3 text-sm text-[#253f23]"
                      >
                        <option value="">Leave blank</option>
                        {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    )}
                  </div>
                  <div className="text-xs leading-5">
                    <p className={needsReview ? "font-semibold text-[#8a681c]" : "font-semibold text-[#276221]"}>{outOfDate ? "Out of date" : needsReview ? "Review needed" : "Ready"}</p>
                    <p className="mt-1 text-[#687b65]">
                      {outOfDate ? `Current entry: ${mapping.source}` : mapping.source}
                    </p>
                    {outOfDate ? (
                      <div className="mt-2 rounded-md border border-[#eadcae] bg-[#fffaf0] p-2.5 text-[#765a16]">
                        <p className="font-semibold">Updated suggestion</p>
                        <p className="mt-1 whitespace-pre-wrap">
                          {mapping.proposedValue?.trim() || "Leave blank"}
                        </p>
                        <p className="mt-1 text-[11px] text-[#8a7948]">
                          {mapping.proposedSource ?? "Current reviewed plan"}
                        </p>
                      </div>
                    ) : (
                      <p className="mt-1 capitalize text-[#82917f]">{mapping.confidence} confidence</p>
                    )}
                    {outOfDate ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => acceptUpdatedValue(mapping.fieldName)}
                          className="min-h-9 rounded-lg border border-[#a9c7a5] bg-white px-3 font-semibold text-[#276221] hover:bg-[#edf4eb]"
                        >
                          Use updated suggestion
                        </button>
                        <button
                          type="button"
                          onClick={() => keepCurrentValue(mapping.fieldName)}
                          className="min-h-9 rounded-lg px-3 font-semibold text-[#50644d] hover:bg-[#edf4eb]"
                        >
                          Keep current entry
                        </button>
                      </div>
                    ) : needsReview ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {mapping.value ? (
                          <button type="button" onClick={() => confirmValue(mapping.fieldName)} className="min-h-9 rounded-lg border border-[#a9c7a5] bg-white px-3 font-semibold text-[#276221] hover:bg-[#edf4eb]">Accept suggestion</button>
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
            <p className="flex max-w-xl items-start gap-2 text-xs leading-5 text-[#5d705a]"><Sparkles className="mt-0.5 size-3.5 shrink-0 text-[#3b8132]" aria-hidden /> Check the completed PDF before uploading it to your required system. CaseLink does not submit it for you.</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              {paperworkMode === "scanned" ? (
                <button
                  type="button"
                  onClick={() => void openPreview()}
                  disabled={reviewCount > 0 || sourceCheckBlocked}
                  className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-[#a9c7a5] bg-white px-4 text-sm font-semibold text-[#276221] hover:bg-[#edf4eb] disabled:cursor-not-allowed disabled:text-[#9bad98]"
                >
                  <FileCheck2 className="size-4" aria-hidden />
                  {previewUrl ? "Refresh preview" : "Preview completed PDF"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void downloadCompletedPdf()}
                disabled={
                  reviewCount > 0 ||
                  sourceCheckBlocked ||
                  (paperworkMode === "scanned" && !previewConfirmed)
                }
                className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-[#276221] px-4 text-sm font-semibold text-white shadow-[0_6px_18px_rgba(39,98,33,0.16)] hover:bg-[#1f531b] disabled:cursor-not-allowed disabled:bg-[#9bad98] disabled:shadow-none"
              >
                <Download className="size-4" aria-hidden />
                {sourceCheckBlocked
                  ? "Check current plan"
                  : reviewCount > 0
                  ? "Finish field review"
                  : paperworkMode === "scanned" && !previewConfirmed
                    ? "Confirm preview to download"
                    : "Download completed PDF"}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {previewUrl && paperworkMode === "scanned" ? (
        <section className="overflow-hidden rounded-xl border border-[#dce6d9] bg-white shadow-[0_10px_30px_rgba(30,70,27,0.06)]">
          <div className="flex flex-col gap-3 border-b border-[#dce6d9] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-[#173a15]">Check the completed PDF</h2>
              <p className="mt-1 text-xs leading-5 text-[#687b65]">
                Confirm values and placement on every page. Identity and signature fields must remain blank.
              </p>
            </div>
            <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-[#a9c7a5] bg-[#f6faf5] px-3 text-sm font-semibold text-[#276221]">
              <input
                type="checkbox"
                checked={previewConfirmed}
                onChange={(event) => setPreviewConfirmed(event.target.checked)}
                className="size-4 accent-[#276221]"
              />
              I reviewed every page
            </label>
          </div>
          <iframe
            src={previewUrl}
            title="Completed PDF preview"
            className="h-[72vh] min-h-[560px] w-full bg-slate-100"
          />
        </section>
      ) : null}

      {downloaded ? (
        <p className="rounded-lg border border-[#b8d6b3] bg-[#edf4eb] px-4 py-3 text-sm font-medium text-[#276221]" role="status">
          Completed PDF downloaded. CaseLink did not submit it anywhere; upload it manually to your required system after your final check.
        </p>
      ) : null}

      {error ? <p className="rounded-lg bg-[#fef2f2] px-4 py-3 text-sm font-medium text-[#a32929]" role="alert">{error}</p> : null}
    </div>
  );
}
