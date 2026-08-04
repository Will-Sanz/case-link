import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const MARGIN = 42;
const FOOTER_RULE_Y = 34;
const FOOTER_TEXT_Y = 20;
const FOOTER_FONT_SIZE = 7.5;

/** Add a dependable neutral footer after layout, when the final page count is known. */
export async function finalizePlanPdf(bytes: Uint8Array): Promise<Uint8Array> {
  const document = await PDFDocument.load(bytes);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const pages = document.getPages();

  pages.forEach((page, index) => {
    const { width } = page.getSize();
    const pageLabel = `Page ${index + 1} of ${pages.length}`;
    const pageLabelWidth = font.widthOfTextAtSize(pageLabel, FOOTER_FONT_SIZE);

    page.drawLine({
      start: { x: MARGIN, y: FOOTER_RULE_Y },
      end: { x: width - MARGIN, y: FOOTER_RULE_Y },
      thickness: 0.5,
      color: rgb(0, 0, 0),
    });
    page.drawText("Family support intervention plan", {
      x: MARGIN,
      y: FOOTER_TEXT_Y,
      size: FOOTER_FONT_SIZE,
      font,
      color: rgb(0, 0, 0),
    });
    page.drawText(pageLabel, {
      x: width - MARGIN - pageLabelWidth,
      y: FOOTER_TEXT_Y,
      size: FOOTER_FONT_SIZE,
      font,
      color: rgb(0, 0, 0),
    });
  });

  return document.save();
}
