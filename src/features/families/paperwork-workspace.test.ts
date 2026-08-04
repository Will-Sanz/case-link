import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  applyPdfMappings,
  findCompletedPdfFields,
  inspectPdfFields,
  UnsupportedPdfFieldError,
} from "@/lib/paperwork/pdf-form";

describe("fillable paperwork", () => {
  it("reads supported fields and writes only blank values", async () => {
    const document = await PDFDocument.create();
    const page = document.addPage();
    const form = document.getForm();
    const existing = form.createTextField("Existing");
    existing.setText("preserve me");
    existing.addToPage(page);
    const blank = form.createTextField("Next_Step");
    blank.setMaxLength(80);
    blank.addToPage(page);

    const fields = inspectPdfFields(document);
    expect(fields).toEqual([
      { name: "Existing", kind: "text", options: [], maxLength: null },
      { name: "Next_Step", kind: "text", options: [], maxLength: 80 },
    ]);
    expect(findCompletedPdfFields(document)).toEqual(["Existing"]);

    applyPdfMappings(document, fields, [
      { fieldName: "Existing", value: "replace", confidence: "high", source: "test", needsReview: false },
      { fieldName: "Next_Step", value: "Call the housing office", confidence: "high", source: "test", needsReview: false },
    ]);
    expect(form.getTextField("Existing").getText()).toBe("preserve me");
    expect(form.getTextField("Next_Step").getText()).toBe("Call the housing office");
  });

  it("rejects unsupported form controls", async () => {
    const document = await PDFDocument.create();
    const page = document.addPage();
    document.getForm().createButton("Submit_Button").addToPage("Submit", page);
    expect(() => inspectPdfFields(document)).toThrow(UnsupportedPdfFieldError);
  });
});
