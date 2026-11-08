import { renderToBuffer } from "@react-pdf/renderer";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { FamilyTakeawayDocument, FAMILY_TAKEAWAY_TITLE } from "./family-takeaway-document";
import { buildFamilyTakeaway } from "./family-takeaway-data";
import { familyTakeawayFixture } from "../../../tests/fixtures/family-takeaway";

describe("FamilyTakeawayDocument", () => {
  it("renders selected reviewed content as a short printable document", async () => {
    const { plan, selection } = familyTakeawayFixture();
    const bytes = await renderToBuffer(<FamilyTakeawayDocument data={buildFamilyTakeaway(plan, selection)} familyName="Family 014" generatedDate="Oct 15, 2026" />);
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBe(1);
    expect(document.getTitle()).toBe(FAMILY_TAKEAWAY_TITLE);
  });

  it("retains the existing unsupported-character guard", () => {
    const { plan, selection } = familyTakeawayFixture();
    const data = buildFamilyTakeaway(plan, selection);
    data.goals[0].actions[0].title = "確認";
    expect(() => FamilyTakeawayDocument({ data, generatedDate: "Oct 15, 2026" })).toThrow(/PDF font/);
  });
});
