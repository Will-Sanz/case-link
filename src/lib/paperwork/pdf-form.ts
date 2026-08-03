import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
} from "pdf-lib";
import type { PdfFieldDescriptor } from "@/types/paperwork";

export function inspectPdfFields(document: PDFDocument): PdfFieldDescriptor[] {
  return document.getForm().getFields().flatMap<PdfFieldDescriptor>((field) => {
    const name = field.getName();
    if (field instanceof PDFTextField) return [{ name, kind: "text", options: [], maxLength: field.getMaxLength() ?? null }];
    if (field instanceof PDFCheckBox) return [{ name, kind: "checkbox", options: [], maxLength: null }];
    if (field instanceof PDFDropdown) return [{ name, kind: "dropdown", options: field.getOptions(), maxLength: null }];
    if (field instanceof PDFRadioGroup) return [{ name, kind: "radio", options: field.getOptions(), maxLength: null }];
    if (field instanceof PDFOptionList) return [{ name, kind: "option-list", options: field.getOptions(), maxLength: null }];
    return [];
  });
}
