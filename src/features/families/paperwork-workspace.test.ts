import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { applyPdfMappings, inspectPdfFields, UnsupportedPdfFieldError } from "@/lib/paperwork/pdf-form";

describe("inspectPdfFields", () => {
  it("reads supported AcroForm field types and options", async () => {
    const document = await PDFDocument.create();
    const page = document.addPage();
    const form = document.getForm();
    const text = form.createTextField("Primary_Barrier");
    text.setMaxLength(80);
    text.addToPage(page);
    const checkbox = form.createCheckBox("Plan_Approved");
    checkbox.addToPage(page);
    const dropdown = form.createDropdown("Priority");
    dropdown.addOptions(["Low", "Medium", "High"]);
    dropdown.addToPage(page);

    expect(inspectPdfFields(document)).toEqual([
      { name: "Primary_Barrier", kind: "text", options: [], maxLength: 80 },
      { name: "Plan_Approved", kind: "checkbox", options: [], maxLength: null },
      { name: "Priority", kind: "dropdown", options: ["Low", "Medium", "High"], maxLength: null },
    ]);
  });

  it("clears stale values and writes the reviewed mapping", async () => {
    const document = await PDFDocument.create();
    const page = document.addPage();
    const form = document.getForm();
    const summary = form.createTextField("Family_Summary");
    summary.setText("stale value");
    summary.addToPage(page);
    const approved = form.createCheckBox("Confirmed");
    approved.check();
    approved.addToPage(page);
    const priority = form.createDropdown("Priority");
    priority.addOptions(["Low", "High"]);
    priority.select("High");
    priority.addToPage(page);
    const fields = inspectPdfFields(document);

    applyPdfMappings(document, fields, [
      { fieldName: "Family_Summary", value: "Reviewed context", confidence: "high", source: "Family summary", needsReview: false },
      { fieldName: "Confirmed", value: "false", confidence: "high", source: "Manual review", needsReview: false },
      { fieldName: "Priority", value: "", confidence: "low", source: "Confirmed blank", needsReview: false },
    ]);

    expect(form.getTextField("Family_Summary").getText()).toBe("Reviewed context");
    expect(form.getCheckBox("Confirmed").isChecked()).toBe(false);
    expect(form.getDropdown("Priority").getSelected()).toEqual([]);
  });

  it("rejects unsupported form controls instead of silently omitting them", async () => {
    const document = await PDFDocument.create();
    const page = document.addPage();
    document.getForm().createButton("Submit_Button").addToPage("Submit", page);
    expect(() => inspectPdfFields(document)).toThrow(UnsupportedPdfFieldError);
  });
});
