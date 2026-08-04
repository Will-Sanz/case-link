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
  /** Human review state for the current tab's paperwork session. */
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
