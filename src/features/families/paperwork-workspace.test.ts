import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  applyPdfMappings,
  applyPdfOverlayMappings,
  displayedPdfPageSize,
  displayedPointToPdfPoint,
  inspectPdfFields,
  UnsupportedPdfFieldError,
} from "@/lib/paperwork/pdf-form";

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

  it("translates displayed coordinates for rotated scanned pages", () => {
    const geometry = { width: 792, height: 612, rotation: 270 };
    expect(displayedPdfPageSize(geometry)).toEqual({ width: 612, height: 792 });
    expect(displayedPointToPdfPoint(geometry, 120, 700)).toEqual({ x: 700, y: 492 });
  });

  it("draws reviewed overlay text into a flattened PDF", async () => {
    const document = await PDFDocument.create();
    document.addPage([612, 792]);
    await applyPdfOverlayMappings(
      document,
      [
        {
          fieldName: "goal_1",
          label: "Goal",
          pageIndex: 0,
          kind: "text",
          x: 0.2,
          y: 0.2,
          width: 0.5,
          height: 0.08,
        },
      ],
      [
        {
          fieldName: "goal_1",
          value: "Secure stable housing",
          confidence: "high",
          source: "Reviewed plan",
          needsReview: false,
        },
      ],
    );
    const bytes = await document.save();
    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBe(1);
    expect(bytes.byteLength).toBeGreaterThan(500);
  });
});
