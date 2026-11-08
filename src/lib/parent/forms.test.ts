import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { describe, it, expect } from "vitest";
import { fillVerifiedForm, type VerifiedFormContract } from "./forms";
import { fixtureNow } from "./test-fixtures";
describe("verified known forms", () => {
  it("binds exact template and field mappings without inventing a personal declaration", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.getForm().createTextField("Household size");
    pdf.getForm().createTextField("Parent signature");
    const template = await pdf.save();
    const contract: VerifiedFormContract = {
      programId: "synthetic",
      templateId: "synthetic-test-form",
      version: "1",
      templateSha256: createHash("sha256").update(template).digest("hex"),
      verifiedUntil: "2026-11-20T00:00:00Z",
      fields: { "Household size": "householdSize" },
      requiredFields: ["householdSize"],
      personalFields: ["Parent signature"],
    };
    const filled = await PDFDocument.load(
      await fillVerifiedForm(
        contract,
        template,
        { householdSize: 3 },
        fixtureNow,
      ),
    );
    expect(filled.getForm().getTextField("Household size").getText()).toBe("3");
    expect(
      filled.getForm().getTextField("Parent signature").getText(),
    ).toBeUndefined();
    await expect(
      fillVerifiedForm(
        { ...contract, fields: { "Parent signature": "name" } },
        template,
        { householdSize: 3, name: "Invented" },
        fixtureNow,
      ),
    ).rejects.toThrow("personal");
    await expect(
      fillVerifiedForm(
        { ...contract, templateSha256: "wrong" },
        template,
        { householdSize: 3 },
        fixtureNow,
      ),
    ).rejects.toThrow("differs");
    await expect(
      fillVerifiedForm(contract, template, {}, fixtureNow),
    ).rejects.toThrow("missing");
  });
});
