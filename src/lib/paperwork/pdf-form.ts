import {
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  type PDFField,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
} from "pdf-lib";
import type { PdfFieldDescriptor, PdfFieldMapping } from "@/types/paperwork";

export class UnsupportedPdfFieldError extends Error {
  constructor(fieldName: string) {
    super(`Unsupported PDF field: ${fieldName}`);
    this.name = "UnsupportedPdfFieldError";
  }
}

export class UnsafePdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafePdfError";
  }
}

const BLOCKED_PDF_KEYS = new Set([
  "/AA",
  "/A",
  "/EmbeddedFiles",
  "/Filespec",
  "/GoToR",
  "/GoTo",
  "/ImportData",
  "/JavaScript",
  "/JS",
  "/Launch",
  "/OpenAction",
  "/RichMedia",
  "/Sound",
  "/SubmitForm",
  "/URI",
  "/XFA",
]);

/** Accept only bounded, blank AcroForms without executable or attached content. */
export function inspectSafeBlankPdf(document: PDFDocument): PdfFieldDescriptor[] {
  const pages = document.getPageCount();
  if (pages < 1 || pages > 50) {
    throw new UnsafePdfError("Use a form with 50 pages or fewer.");
  }

  const objects = document.context.enumerateIndirectObjects();
  if (objects.length > 20_000) {
    throw new UnsafePdfError("This PDF is too complex to process safely.");
  }
  for (const [, object] of objects) {
    if (!(object instanceof PDFDict)) continue;
    for (const key of object.keys()) {
      if (BLOCKED_PDF_KEYS.has(key.toString())) {
        throw new UnsafePdfError("This PDF contains active or attached content.");
      }
    }
  }

  const form = document.getForm();
  if (form.hasXFA()) {
    throw new UnsafePdfError("Use a standard AcroForm without XFA content.");
  }
  const fields = inspectPdfFields(document);
  if (fields.length === 0) {
    throw new UnsafePdfError("Use a blank fillable PDF with standard form fields.");
  }
  if (fields.length > 150) {
    throw new UnsafePdfError("Use a form with 150 fields or fewer.");
  }
  if (fields.some((field) =>
    field.name.length > 200
    || field.options.length > 50
    || field.options.some((option) => option.length > 200)
    || (field.maxLength !== null && (field.maxLength < 1 || field.maxLength > 4000))
  )) {
    throw new UnsafePdfError("This PDF contains form fields outside the supported safety limits.");
  }
  if (findCompletedPdfFields(document).length > 0) {
    throw new UnsafePdfError("Use a blank copy with every form field empty.");
  }
  return fields;
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

function pdfFieldHasValue(field: PDFField): boolean {
  if (field instanceof PDFTextField) return Boolean(field.getText()?.trim());
  if (field instanceof PDFCheckBox) return field.isChecked();
  if (field instanceof PDFDropdown) return field.getSelected().length > 0;
  if (field instanceof PDFRadioGroup) return Boolean(field.getSelected());
  if (field instanceof PDFOptionList) return field.getSelected().length > 0;
  return true;
}

/** Returns field names that already contain a value so they can be preserved. */
export function findCompletedPdfFields(document: PDFDocument): string[] {
  return document.getForm().getFields().flatMap((field) =>
    pdfFieldHasValue(field) ? [field.getName()] : [],
  );
}

/** Applies reviewed values only to empty fields, preserving anything already completed. */
export function applyPdfMappings(
  document: PDFDocument,
  fields: PdfFieldDescriptor[],
  mappings: PdfFieldMapping[],
): void {
  const form = document.getForm();
  const mappingByName = new Map(mappings.map((mapping) => [mapping.fieldName, mapping]));

  for (const descriptor of fields) {
    const field = form.getField(descriptor.name);
    if (pdfFieldHasValue(field)) continue;
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
