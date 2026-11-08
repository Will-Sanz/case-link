import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { inspectDocument, validateExtractedFacts } from "./documents";
describe("private document trust boundary", () => {
  it("validates real files and rejects spoofed, truncated and oversized page counts", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    expect(await inspectDocument(await pdf.save(), "application/pdf")).toEqual({
      mediaType: "application/pdf",
      pageCount: 1,
    });
    for (let i = 0; i < 5; i++) pdf.addPage();
    await expect(
      inspectDocument(await pdf.save(), "application/pdf"),
    ).rejects.toThrow();
    const image = await sharp({
      create: { width: 20, height: 20, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    expect((await inspectDocument(image, "image/png")).pageCount).toBe(1);
    await expect(
      inspectDocument(image.subarray(0, 12), "image/png"),
    ).rejects.toThrow();
    await expect(inspectDocument(image, "application/pdf")).rejects.toThrow();
  });
  it("requires original source, exact amount semantics and source page", () => {
    const facts = {
      provider: "unknown",
      amountDue: 12,
      totalBalance: null,
      dueDate: null,
      shutoffDate: null,
      fields: [
        { field: "amountDue", page: 1, sourceText: "Amount due $12.00" },
      ],
    };
    expect(validateExtractedFacts(facts, ["Amount due $12.00"]).amountDue).toBe(
      12,
    );
    expect(() =>
      validateExtractedFacts(
        {
          ...facts,
          fields: [
            { field: "amountDue", page: 1, sourceText: "Total balance $312" },
          ],
        },
        ["Total balance $312"],
      ),
    ).toThrow();
    expect(() => validateExtractedFacts(facts, ["Nothing matching"])).toThrow();
    expect(() =>
      validateExtractedFacts(
        {
          ...facts,
          dueDate: "2026-11-20",
          fields: [
            ...facts.fields,
            { field: "dueDate", page: 1, sourceText: "Other text" },
          ],
        },
        ["Amount due $12.00 Other text"],
      ),
    ).toThrow();
  });
});
