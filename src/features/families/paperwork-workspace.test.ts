import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { inspectPdfFields } from "@/lib/paperwork/pdf-form";

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
});
