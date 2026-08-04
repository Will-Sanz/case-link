export type PdfFieldKind = "text" | "checkbox" | "dropdown" | "radio" | "option-list";

export type PdfFieldDescriptor = {
  name: string;
  kind: PdfFieldKind;
  options: string[];
  maxLength: number | null;
};

export type PdfFieldMapping = {
  fieldName: string;
  value: string;
  confidence: "high" | "medium" | "low";
  source: string;
  needsReview: boolean;
  /** Human review state for a browser-local paperwork draft. */
  reviewState?: "ready" | "suggested" | "accepted" | "edited" | "left_blank" | "out_of_date";
  /** Suggestion that was current when this draft field was first prepared. */
  baselineValue?: string;
  baselineSource?: string;
  /** Updated suggestion retained separately so manual work is never silently replaced. */
  proposedValue?: string;
  proposedSource?: string;
  proposedConfidence?: "high" | "medium" | "low";
  proposedNeedsReview?: boolean;
};

/** AI-detected writable area in a scanned or flattened PDF. Coordinates are normalized. */
export type PdfOverlayField = {
  fieldName: string;
  label: string;
  pageIndex: number;
  kind: "text" | "checkbox";
  /** Left edge in displayed page coordinates, 0 to 1. */
  x: number;
  /** Top edge in displayed page coordinates, 0 to 1. */
  y: number;
  width: number;
  height: number;
};

export type ScannedPdfAnalysis = {
  documentTitle: string;
  mappings: PdfFieldMapping[];
  overlayFields: PdfOverlayField[];
  warnings: string[];
  assistedByAi: true;
};
