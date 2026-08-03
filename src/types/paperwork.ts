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
