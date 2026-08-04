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
