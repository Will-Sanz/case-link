import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
} from "pdf-lib";
import type { PdfFieldDescriptor } from "@/types/paperwork";
import type { PdfFieldMapping } from "@/types/paperwork";

export class UnsupportedPdfFieldError extends Error {
  constructor(fieldName: string) {
    super(`Unsupported PDF field: ${fieldName}`);
    this.name = "UnsupportedPdfFieldError";
  }
}

export function inspectPdfFields(document: PDFDocument): PdfFieldDescriptor[] {
  return document.getForm().getFields().flatMap<PdfFieldDescriptor>((field) => {
    const name = field.getName();
    if (field instanceof PDFTextField) return [{ name, kind: "text", options: [], maxLength: field.getMaxLength() ?? null }];
    if (field instanceof PDFCheckBox) return [{ name, kind: "checkbox", options: [], maxLength: null }];
    if (field instanceof PDFDropdown) return [{ name, kind: "dropdown", options: field.getOptions(), maxLength: null }];
    if (field instanceof PDFRadioGroup) return [{ name, kind: "radio", options: field.getOptions(), maxLength: null }];
    if (field instanceof PDFOptionList) return [{ name, kind: "option-list", options: field.getOptions(), maxLength: null }];
    throw new UnsupportedPdfFieldError(name);
  });
}

/** Clears every supported field before applying the reviewed mapping values. */
export function applyPdfMappings(
  document: PDFDocument,
  fields: PdfFieldDescriptor[],
  mappings: PdfFieldMapping[],
): void {
  const form = document.getForm();
  const mappingByName = new Map(mappings.map((mapping) => [mapping.fieldName, mapping]));

  for (const descriptor of fields) {
    const field = form.getField(descriptor.name);
    const value = mappingByName.get(descriptor.name)?.value ?? "";
    if (field instanceof PDFTextField) field.setText(value);
    else if (field instanceof PDFCheckBox) {
      if (value.toLowerCase() === "true") field.check();
      else field.uncheck();
    } else if (field instanceof PDFDropdown) {
      field.clear();
      if (value) field.select(value);
    } else if (field instanceof PDFRadioGroup) {
      field.clear();
      if (value) field.select(value);
    } else if (field instanceof PDFOptionList) {
      field.clear();
      if (value) field.select(value);
    } else {
      throw new UnsupportedPdfFieldError(descriptor.name);
    }
  }
}
