import { z } from "zod";
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

export const scannedPdfAnalysisJsonSchema = {
  type: "object",
  properties: {
    documentTitle: { type: "string" },
    appearsBlank: { type: "boolean" },
    containsLikelyPersonalData: { type: "boolean" },
    warnings: { type: "array", maxItems: 20, items: { type: "string" } },
    fields: {
      type: "array",
      minItems: 1,
      maxItems: 150,
      items: {
        type: "object",
        properties: {
          fieldName: { type: "string" },
          label: { type: "string" },
          pageIndex: { type: "integer" },
          kind: { type: "string", enum: ["text", "checkbox"] },
          x: { type: "number" },
          y: { type: "number" },
          width: { type: "number" },
          height: { type: "number" },
          value: { type: ["string", "null"] },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          source: { type: "string" },
          needsReview: { type: "boolean" },
        },
        required: [
          "fieldName",
          "label",
          "pageIndex",
          "kind",
          "x",
          "y",
          "width",
          "height",
          "value",
          "confidence",
          "source",
          "needsReview",
        ],
        additionalProperties: false,
      },
    },
  },
  required: [
    "documentTitle",
    "appearsBlank",
    "containsLikelyPersonalData",
    "warnings",
    "fields",
  ],
  additionalProperties: false,
} as const;

const MANUAL_ONLY_FIELD =
  /\b(name|signature|initials?|date of birth|dob|address|phone|e-?mail|student id|participant id|social security|ssn|consent|attest|certif|case manager|site name)\b/i;

export function isManualOnlyPaperworkField(fieldName: string, label: string): boolean {
  return MANUAL_ONLY_FIELD.test(`${fieldName} ${label}`);
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
