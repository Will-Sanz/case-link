import { describe, expect, it } from "vitest";
import {
  buildImportKey,
  buildSlug,
  getHeaderAndDataRowIndices,
  mapCsvRecordToResource,
} from "@/lib/db/resource-import/map-row";
import {
  orderPrimaryContactTriplet,
  parseOptionalBoolean,
  parseServiceFlag,
  slugifyPart,
} from "@/lib/db/resource-import/normalize";

describe("resource import normalization", () => {
  it("normalizes optional boolean and service flags", () => {
    expect(parseOptionalBoolean("YeS")).toBe(true);
    expect(parseOptionalBoolean("0")).toBe(false);
    expect(parseOptionalBoolean("unknown")).toBeNull();
    expect(parseServiceFlag("TRUE")).toBe(true);
    expect(parseServiceFlag("nope")).toBe(false);
  });

  it("reorders misaligned primary contact fields", () => {
    expect(orderPrimaryContactTriplet("(555) 123-4567", "TeSt@Example.org", "")).toEqual({
      title: null,
      email: "test@example.org",
      phone: "(555) 123-4567",
      phoneNorm: "5551234567",
    });
  });

  it("builds stable import keys and safe slugs", () => {
    const importKey = buildImportKey("Housing & Support", "Rapid Rehousing", "Housing");

    expect(importKey).toHaveLength(64);
    expect(buildSlug("Housing & Support", "Rapid Rehousing", importKey)).toBe(
      `housing-support-rapid-rehousing-${importKey.slice(0, 8)}`,
    );
    expect(slugifyPart("Crème brûlée / Support")).toBe("creme-brulee-support");
  });
});

describe("mapCsvRecordToResource", () => {
  it("maps a full csv row into searchable resource data", () => {
    const row = [
      "Office of Housing",
      "Rapid Rehousing",
      "Helps families move into stable housing",
      "Housing, Family Services",
      "Yes",
      "March 2026",
      "No",
      "Jordan Case",
      "Program Manager",
      "Jordan.Case@Example.org",
      "(215) 555-0100",
      "Riley Backup",
      "Coordinator",
      "backup@example.org",
      "215-555-0111",
      "Rental support, case management",
      "Bring ID and lease paperwork",
      "TRUE",
      "FALSE",
      "TRUE",
      "FALSE",
    ];

    const result = mapCsvRecordToResource(row, 7);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected parse success");

    expect(result.row.importKey).toBe(buildImportKey("Office of Housing", "Rapid Rehousing", "Housing, Family Services"));
    expect(result.row.slug).toBe(buildSlug("Office of Housing", "Rapid Rehousing", result.row.importKey));
    expect(result.row.tags).toEqual(
      expect.arrayContaining(["housing", "family services", "rapid", "rehousing", "office of housing"]),
    );
    expect(result.row.primaryContactEmail).toBe("jordan.case@example.org");
    expect(result.row.primaryContactPhoneNorm).toBe("2155550100");
    expect(result.row.tablingAtEvents).toBe(true);
    expect(result.row.promotionalMaterials).toBe(false);
    expect(result.row.searchText).toContain("rapid rehousing");
    expect(result.row.searchText).toContain("bring id and lease paperwork");
  });

  it("returns a parse issue when required columns are missing", () => {
    expect(mapCsvRecordToResource(["too", "short"], 3)).toEqual({
      ok: false,
      issue: {
        rowNumber: 3,
        message: "Expected at least 21 columns, got 2",
        rawPreview: "too,short",
      },
    });
  });

  it("returns header and data row indices for import scripts", () => {
    expect(getHeaderAndDataRowIndices()).toEqual({ headerIndex: 1, dataStartIndex: 2 });
  });
});
