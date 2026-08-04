import { describe, expect, it } from "vitest";
import { PDFDocument, degrees } from "pdf-lib";
import {
  applyPdfMappings,
  applyPdfOverlayMappings,
  displayedPdfPageSize,
  displayedPointToPdfPoint,
  findCompletedPdfFields,
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

  it("preserves completed fields and fills only empty fields", async () => {
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
    priority.addToPage(page);
    const nextStep = form.createTextField("Next_Step");
    nextStep.addToPage(page);
    const fields = inspectPdfFields(document);

    applyPdfMappings(document, fields, [
      { fieldName: "Family_Summary", value: "Reviewed context", confidence: "high", source: "Family summary", needsReview: false },
      { fieldName: "Confirmed", value: "false", confidence: "high", source: "Manual review", needsReview: false },
      { fieldName: "Priority", value: "High", confidence: "high", source: "Reviewed plan", needsReview: false },
      { fieldName: "Next_Step", value: "Call the housing office", confidence: "high", source: "Reviewed plan", needsReview: false },
    ]);

    expect(form.getTextField("Family_Summary").getText()).toBe("stale value");
    expect(form.getCheckBox("Confirmed").isChecked()).toBe(true);
    expect(form.getDropdown("Priority").getSelected()).toEqual(["High"]);
    expect(form.getTextField("Next_Step").getText()).toBe("Call the housing office");
  });

  it("detects completed fields before a form can leave the browser", async () => {
    const document = await PDFDocument.create();
    const page = document.addPage();
    const form = document.getForm();
    form.createTextField("Blank_Field").addToPage(page);
    const completed = form.createTextField("Completed_Field");
    completed.setText("already entered");
    completed.addToPage(page);
    const checked = form.createCheckBox("Completed_Checkbox");
    checked.check();
    checked.addToPage(page);

    expect(findCompletedPdfFields(document)).toEqual([
      "Completed_Field",
      "Completed_Checkbox",
    ]);
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

  it("preserves page count and rotation when writing a later scanned page", async () => {
    const document = await PDFDocument.create();
    document.addPage([612, 792]);
    const rotatedPage = document.addPage([612, 792]);
    rotatedPage.setRotation(degrees(90));

    await applyPdfOverlayMappings(
      document,
      [
        {
          fieldName: "page_2_goal",
          label: "Goal",
          pageIndex: 1,
          kind: "text",
          x: 0.15,
          y: 0.2,
          width: 0.6,
          height: 0.08,
        },
      ],
      [
        {
          fieldName: "page_2_goal",
          value: "Complete a reviewed intake action",
          confidence: "high",
          source: "Reviewed plan action",
          needsReview: false,
        },
      ],
    );

    const bytes = await document.save();
    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBe(2);
    expect(reloaded.getPage(1).getRotation().angle).toBe(90);
    expect(bytes.byteLength).toBeGreaterThan(700);
  });
});
