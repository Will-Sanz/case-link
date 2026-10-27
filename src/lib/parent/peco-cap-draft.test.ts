import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  PECO_CAP_TEMPLATE_SHA256,
  renderPecoCapPreparationDraft,
  type PecoCapDraftInput,
} from "./peco-cap-draft";

const template = readFileSync(
  resolve("tests/fixtures/parent/peco-cap-2026.pdf"),
);
const now = new Date("2026-10-26T12:00:00Z");
const input: PecoCapDraftInput = {
  accountNumber: "SYNTHETIC-PECO-12345",
  applicant: {
    firstName: "María",
    lastName: "González",
    dateOfBirth: "1988-04-17",
    incomeSource: "Employment",
  },
  address: {
    street: "123 Synthetic Lane",
    city: "Philadelphia",
    state: "PA",
    zip: "19104",
  },
  householdMembers: [
    {
      firstName: "Lucía",
      lastName: "González",
      dateOfBirth: "2017-09-06",
      relationship: "Child",
      incomeSource: "None",
    },
  ],
};
const genericError =
  "The PECO CAP preparation draft could not be created from the supplied information.";

describe("unsigned PECO CAP preparation draft", () => {
  it("keeps the exact source unchanged and produces two static Letter pages with the original link", async () => {
    const result = await PDFDocument.load(
      await renderPecoCapPreparationDraft(template, input, now),
    );
    expect(createHash("sha256").update(template).digest("hex")).toBe(
      PECO_CAP_TEMPLATE_SHA256,
    );
    expect(result.getPageCount()).toBe(2);
    expect(result.catalog.has(PDFName.of("AcroForm"))).toBe(false);
    let links = 0;
    for (const page of result.getPages()) {
      expect(page.getSize()).toEqual({ width: 612, height: 792 });
      const annotations = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
      for (const reference of annotations?.asArray() ?? []) {
        const annotation = result.context.lookup(reference, PDFDict);
        expect(annotation.get(PDFName.of("Subtype"))?.toString()).toBe("/Link");
        expect(annotation.toString()).toContain("mailto:PECOCAP@exeloncorp.com");
        links++;
      }
    }
    expect(links).toBe(1);
    for (const [, object] of result.context.enumerateIndirectObjects())
      expect(object.toString()).not.toMatch(/\/Subtype\s*\/Widget|\/FT\s*\/Sig/);
  });

  it("accepts an explicit SMS choice only with a supplied cell number", async () => {
    await expect(
      renderPecoCapPreparationDraft(
        template,
        {
          ...input,
          applicant: { ...input.applicant, middleInitial: "L" },
          address: { ...input.address, apartment: "2B" },
          homePhone: "555-0101",
          cellPhone: "555-0100",
          smsUpdates: true,
        },
        now,
      ),
    ).resolves.toBeInstanceOf(Uint8Array);
    await expect(
      renderPecoCapPreparationDraft(template, { ...input, smsUpdates: false }, now),
    ).resolves.toBeInstanceOf(Uint8Array);
    await expect(
      renderPecoCapPreparationDraft(template, { ...input, smsUpdates: true }, now),
    ).rejects.toMatchObject({ message: genericError });
  });

  it("adds household continuation pages instead of losing people beyond the five official rows", async () => {
    const people = Array.from({ length: 28 }, (_, index) => ({
      ...input.householdMembers[0],
      firstName: `Synthetic ${index + 1}`,
    }));
    const result = await PDFDocument.load(
      await renderPecoCapPreparationDraft(
        template,
        { ...input, householdMembers: people },
        now,
      ),
    );
    expect(result.getPageCount()).toBe(4);
  });

  it("wraps supplied household names and income sources within their verified rows", async () => {
    await expect(
      renderPecoCapPreparationDraft(template, {
        ...input,
        applicant: {
          ...input.applicant,
          firstName: "María Elena Antonia",
          lastName: "De la Cruz Montenegro",
          incomeSource: "Seasonal employment and pension",
        },
      }, now),
    ).resolves.toBeInstanceOf(Uint8Array);
  });

  it.each([
    { ...input, accountNumber: undefined },
    { ...input, accountNumber: " " },
    { ...input, applicant: { ...input.applicant, incomeSource: undefined } },
    { ...input, signature: "PRIVATE SIGNATURE" },
    { ...input, ssn: "PRIVATE IDENTIFIER" },
    { ...input, applicant: { ...input.applicant, itin: "PRIVATE IDENTIFIER" } },
    { ...input, applicant: { ...input.applicant, password: "PRIVATE PASSWORD" } },
    { ...input, authCode: "PRIVATE CODE" },
    { ...input, outreach: "Social Service Agency" },
    { ...input, applicant: { ...input.applicant, incomeAmount: 1200 } },
    { ...input, applicant: { ...input.applicant, incomeSource: "LIHEAP Data Sharing" } },
    { ...input, applicant: { ...input.applicant, incomeSource: "LIHEAP data-sharing" } },
    { ...input, applicant: { ...input.applicant, incomeSource: "LIHEAP income sharing" } },
    { ...input, applicant: { ...input.applicant, dateOfBirth: "2025-02-29" } },
    { ...input, applicant: { ...input.applicant, dateOfBirth: "2027-01-01" } },
    { ...input, applicant: { ...input.applicant, dateOfBirth: "2010-01-01" } },
    { ...input, applicant: { ...input.applicant, firstName: "🙂" } },
    { ...input, applicant: { ...input.applicant, firstName: "Name\nControl" } },
    { ...input, applicant: { ...input.applicant, firstName: "W".repeat(70) } },
    { ...input, address: { ...input.address, street: "W".repeat(155) } },
    {
      ...input,
      householdMembers: [{ ...input.householdMembers[0], incomeSource: "W".repeat(70) }],
    },
    {
      ...input,
      householdMembers: [{ ...input.householdMembers[0], dateOfBirth: "2027-01-01" }],
    },
  ])("rejects missing, private-channel, invalid or unrenderable facts without echoing them", async (value) => {
    await expect(
      renderPecoCapPreparationDraft(template, value, now),
    ).rejects.toMatchObject({ message: genericError });
  });

  it("rejects an invalid rehearsal date without exposing input", async () => {
    await expect(
      renderPecoCapPreparationDraft(template, input, new Date("invalid")),
    ).rejects.toMatchObject({ message: genericError });
  });

  it("rejects a changed source before preparing any application", async () => {
    await expect(
      renderPecoCapPreparationDraft(template.subarray(1), input, now),
    ).rejects.toThrow("differs from its reviewed source");
  });
});
