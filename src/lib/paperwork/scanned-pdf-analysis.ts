import { z } from "zod";
import { toStructuredJsonSchema } from "@/lib/ai/structured-json-schema";
import type { ScannedPdfAnalysis } from "@/types/paperwork";

export const MAX_SCANNED_PDF_PAGES = 12;

const detectedFieldSchema = z.object({
  fieldName: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(300),
  pageIndex: z.number().int().min(0).max(MAX_SCANNED_PDF_PAGES - 1),
  kind: z.enum(["text", "checkbox"]),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().gt(0).max(1),
  height: z.number().gt(0).max(1),
  value: z.union([z.string().max(4_000), z.null()]),
  confidence: z.enum(["high", "medium", "low"]),
  source: z.string().trim().min(1).max(300),
  needsReview: z.boolean(),
});

export const scannedPdfModelAnalysisSchema = z.object({
  documentTitle: z.string().trim().min(1).max(300),
  appearsBlank: z.boolean(),
  containsLikelyPersonalData: z.boolean(),
  warnings: z.array(z.string().trim().min(1).max(500)).max(20),
  fields: z.array(detectedFieldSchema).min(1).max(150),
});

export type ScannedPdfModelAnalysis = z.infer<typeof scannedPdfModelAnalysisSchema>;

export const scannedPdfAnalysisJsonSchema = toStructuredJsonSchema(scannedPdfModelAnalysisSchema);

const MANUAL_ONLY_FIELD =
  /\b(name|signature|initials?|date of birth|dob|address|phone|e-?mail|student id|participant id|social security|ssn|consent|attest|certif|site name)\b/i;

export function isManualOnlyPaperworkField(fieldName: string, label: string): boolean {
  const normalized = `${fieldName} ${label}`.replace(/[_\-.]+/g, " ");
  if (MANUAL_ONLY_FIELD.test(normalized)) return true;
  return /\b(case manager|case worker)\b.{0,30}\b(name|signature|initials?|phone|e-?mail|id)\b/i.test(
    normalized,
  );
}

/** Validate page geometry, remove duplicate model rows, and enforce manual-only fields. */
export function normalizeScannedPdfAnalysis(
  model: ScannedPdfModelAnalysis,
  pageCount: number,
): ScannedPdfAnalysis | null {
  const usedNames = new Set<string>();
  const validFields = model.fields.filter((field) => {
    if (field.pageIndex >= pageCount) return false;
    if (field.x + field.width > 1.02 || field.y + field.height > 1.02) return false;
    if (usedNames.has(field.fieldName)) return false;
    usedNames.add(field.fieldName);
    return true;
  });
  if (validFields.length === 0) return null;

  return {
    documentTitle: model.documentTitle,
    warnings: model.warnings,
    assistedByAi: true,
    overlayFields: validFields.map((field) => ({
      fieldName: field.fieldName,
      label: field.label,
      pageIndex: field.pageIndex,
      kind: field.kind,
      x: field.x,
      y: field.y,
      width: field.width,
      height: field.height,
    })),
    mappings: validFields.map((field) => {
      const manualOnly = isManualOnlyPaperworkField(field.fieldName, field.label);
      const proposed = manualOnly ? "" : (field.value?.trim() ?? "");
      const checkboxValue =
        field.kind === "checkbox" && !["true", "false"].includes(proposed.toLowerCase())
          ? ""
          : proposed;
      return {
        fieldName: field.fieldName,
        value: checkboxValue,
        confidence: manualOnly ? "low" : field.confidence,
        source: manualOnly ? "Complete manually outside CaseLink" : field.source,
        needsReview: manualOnly || field.needsReview || field.confidence !== "high",
      };
    }),
  };
}
