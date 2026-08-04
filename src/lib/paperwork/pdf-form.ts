import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  StandardFonts,
  PDFTextField,
  degrees,
  rgb,
} from "pdf-lib";
import type { PdfFieldDescriptor } from "@/types/paperwork";
import type { PdfFieldMapping, PdfOverlayField } from "@/types/paperwork";

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

/** Returns field names that already contain a value; MVP paperwork accepts blank templates only. */
export function findCompletedPdfFields(document: PDFDocument): string[] {
  return document.getForm().getFields().flatMap((field) => {
    if (field instanceof PDFTextField) return field.getText()?.trim() ? [field.getName()] : [];
    if (field instanceof PDFCheckBox) return field.isChecked() ? [field.getName()] : [];
    if (field instanceof PDFDropdown) return field.getSelected().length > 0 ? [field.getName()] : [];
    if (field instanceof PDFRadioGroup) return field.getSelected() ? [field.getName()] : [];
    if (field instanceof PDFOptionList) return field.getSelected().length > 0 ? [field.getName()] : [];
    return [field.getName()];
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

type PageGeometry = { width: number; height: number; rotation: number };

function normalizedRotation(value: number): 0 | 90 | 180 | 270 {
  const normalized = ((Math.round(value / 90) * 90) % 360 + 360) % 360;
  if (normalized === 90 || normalized === 180 || normalized === 270) return normalized;
  return 0;
}

export function displayedPdfPageSize(geometry: PageGeometry): { width: number; height: number } {
  const rotation = normalizedRotation(geometry.rotation);
  return rotation === 90 || rotation === 270
    ? { width: geometry.height, height: geometry.width }
    : { width: geometry.width, height: geometry.height };
}

/** Inverse of PDF page rotation for a point expressed in displayed bottom-left coordinates. */
export function displayedPointToPdfPoint(
  geometry: PageGeometry,
  displayedX: number,
  displayedY: number,
): { x: number; y: number } {
  const rotation = normalizedRotation(geometry.rotation);
  if (rotation === 90) {
    return { x: geometry.width - displayedY, y: displayedX };
  }
  if (rotation === 180) {
    return { x: geometry.width - displayedX, y: geometry.height - displayedY };
  }
  if (rotation === 270) {
    return { x: displayedY, y: geometry.height - displayedX };
  }
  return { x: displayedX, y: displayedY };
}

function wrapOverlayText(
  value: string,
  maxWidth: number,
  maxLines: number,
  widthOf: (text: string) => number,
): string[] {
  const output: string[] = [];
  const paragraphs = value.replace(/\r/g, "").split("\n");
  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && widthOf(candidate) > maxWidth) {
        output.push(line);
        line = word;
      } else {
        line = candidate;
      }
      if (output.length >= maxLines) break;
    }
    if (output.length >= maxLines) break;
    if (line) output.push(line);
    if (output.length >= maxLines) break;
  }
  if (output.length > maxLines) output.length = maxLines;
  if (output.length === maxLines && widthOf(output[maxLines - 1]) > maxWidth) {
    let finalLine = output[maxLines - 1];
    while (finalLine.length > 1 && widthOf(`${finalLine}…`) > maxWidth) {
      finalLine = finalLine.slice(0, -1);
    }
    output[maxLines - 1] = `${finalLine}…`;
  }
  return output;
}

/** Draw reviewed values into AI-detected writable areas in a scanned/flattened PDF. */
export async function applyPdfOverlayMappings(
  document: PDFDocument,
  overlayFields: PdfOverlayField[],
  mappings: PdfFieldMapping[],
): Promise<void> {
  const font = await document.embedFont(StandardFonts.Helvetica);
  const mappingByName = new Map(mappings.map((mapping) => [mapping.fieldName, mapping]));
  const pages = document.getPages();

  for (const field of overlayFields) {
    const page = pages[field.pageIndex];
    const value = mappingByName.get(field.fieldName)?.value.trim() ?? "";
    if (!page || !value) continue;

    const rawSize = page.getSize();
    const rotation = normalizedRotation(page.getRotation().angle);
    const geometry = { width: rawSize.width, height: rawSize.height, rotation };
    const displaySize = displayedPdfPageSize(geometry);
    const left = Math.max(0, Math.min(displaySize.width, field.x * displaySize.width));
    const top = Math.max(0, Math.min(displaySize.height, field.y * displaySize.height));
    const boxWidth = Math.max(8, Math.min(displaySize.width - left, field.width * displaySize.width));
    const boxHeight = Math.max(8, Math.min(displaySize.height - top, field.height * displaySize.height));
    // PDF page /Rotate values are clockwise. pdf-lib text rotation is counterclockwise,
    // so using the same numeric angle counteracts the displayed page rotation.
    const drawRotation = degrees(rotation);

    if (field.kind === "checkbox") {
      if (value.toLowerCase() !== "true") continue;
      const fontSize = Math.max(7, Math.min(13, boxHeight * 0.9, boxWidth * 0.9));
      const visualBaselineY = displaySize.height - top - (boxHeight + fontSize) / 2 + 1;
      const point = displayedPointToPdfPoint(
        geometry,
        left + Math.max(0, (boxWidth - font.widthOfTextAtSize("X", fontSize)) / 2),
        visualBaselineY,
      );
      page.drawText("X", {
        x: point.x,
        y: point.y,
        size: fontSize,
        font,
        rotate: drawRotation,
        color: rgb(0.05, 0.12, 0.05),
      });
      continue;
    }

    const fontSize = Math.max(6, Math.min(10, boxHeight * 0.48));
    const lineHeight = fontSize * 1.18;
    const maxLines = Math.max(1, Math.floor(boxHeight / lineHeight));
    const lines = wrapOverlayText(
      value,
      Math.max(8, boxWidth - 3),
      maxLines,
      (text) => font.widthOfTextAtSize(text, fontSize),
    );
    lines.forEach((line, lineIndex) => {
      const visualBaselineY = displaySize.height - top - fontSize - lineIndex * lineHeight;
      const point = displayedPointToPdfPoint(geometry, left + 1.5, visualBaselineY);
      page.drawText(line, {
        x: point.x,
        y: point.y,
        size: fontSize,
        font,
        rotate: drawRotation,
        color: rgb(0.05, 0.12, 0.05),
      });
    });
  }
}
