import { PDFDocument, PDFName } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { inspectSafeBlankPdf, UnsafePdfError } from "@/lib/paperwork/pdf-form";

async function blankForm() {
  const document = await PDFDocument.create();
  const page = document.addPage();
  const field = document.getForm().createTextField("service_goal");
  field.addToPage(page);
  return { document, field };
}

describe("inspectSafeBlankPdf", () => {
  it("accepts a blank standard AcroForm", async () => {
    const { document } = await blankForm();
    expect(inspectSafeBlankPdf(document)).toEqual([
      { name: "service_goal", kind: "text", options: [], maxLength: null },
    ]);
  });

  it("rejects a completed field before any mapping request", async () => {
    const { document, field } = await blankForm();
    field.setText("Jordan Smith");
    const mappingRequest = vi.fn();
    try {
      mappingRequest(inspectSafeBlankPdf(document));
    } catch (error) {
      expect(error).toBeInstanceOf(UnsafePdfError);
    }
    expect(mappingRequest).not.toHaveBeenCalled();
  });

  it("rejects active PDF actions", async () => {
    const { document } = await blankForm();
    document.catalog.set(PDFName.of("OpenAction"), PDFName.of("Blocked"));
    expect(() => inspectSafeBlankPdf(document)).toThrow("active or attached content");
  });

  it("rejects embedded files and external links", async () => {
    for (const key of ["EmbeddedFiles", "URI"]) {
      const { document } = await blankForm();
      document.catalog.set(PDFName.of(key), PDFName.of("Blocked"));
      expect(() => inspectSafeBlankPdf(document)).toThrow("active or attached content");
    }
  });

  it("rejects XFA forms", async () => {
    const { document } = await blankForm();
    document.catalog.set(PDFName.of("XFA"), PDFName.of("Blocked"));
    expect(() => inspectSafeBlankPdf(document)).toThrow("active or attached content");
  });

  it("rejects more than 50 pages", async () => {
    const { document } = await blankForm();
    for (let page = 1; page < 51; page += 1) document.addPage();
    expect(() => inspectSafeBlankPdf(document)).toThrow("50 pages or fewer");
  });

  it("rejects more than 150 fields", async () => {
    const { document } = await blankForm();
    const form = document.getForm();
    for (let field = 1; field <= 150; field += 1) {
      form.createTextField(`field_${field}`);
    }
    expect(() => inspectSafeBlankPdf(document)).toThrow("150 fields or fewer");
  });

  it("rejects excessive field options before mapping", async () => {
    const document = await PDFDocument.create();
    document.addPage();
    const dropdown = document.getForm().createDropdown("resource_choice");
    dropdown.addOptions(Array.from({ length: 51 }, (_, index) => `Option ${index}`));
    expect(() => inspectSafeBlankPdf(document)).toThrow("supported safety limits");
  });
});
