import { describe, expect, it } from "vitest";
import {
  normalizeScannedPdfAnalysis,
  scannedPdfModelAnalysisSchema,
} from "@/lib/paperwork/scanned-pdf-analysis";

const base = {
  documentTitle: "Family service plan",
  appearsBlank: true,
  containsLikelyPersonalData: false,
  warnings: [],
  fields: [
    {
      fieldName: "goal_1",
      label: "Goal 1",
      pageIndex: 0,
      kind: "text" as const,
      x: 0.2,
      y: 0.3,
      width: 0.5,
      height: 0.05,
      value: "Stable housing",
      confidence: "high" as const,
      source: "Reviewed plan goal",
      needsReview: false,
    },
  ],
};

describe("normalizeScannedPdfAnalysis", () => {
  it("keeps grounded writable fields", () => {
    const parsed = scannedPdfModelAnalysisSchema.parse(base);
    expect(normalizeScannedPdfAnalysis(parsed, 1)?.mappings[0]).toMatchObject({
      value: "Stable housing",
      needsReview: false,
    });
  });

  it("forces identity and signature fields blank for manual completion", () => {
    const parsed = scannedPdfModelAnalysisSchema.parse({
      ...base,
      fields: [
        {
          ...base.fields[0],
          fieldName: "participant_name",
          label: "Participant name",
          value: "A real name",
        },
      ],
    });
    expect(normalizeScannedPdfAnalysis(parsed, 1)?.mappings[0]).toMatchObject({
      value: "",
      confidence: "low",
      needsReview: true,
      source: "Complete manually outside CaseLink",
    });
  });

  it("drops duplicate and out-of-page model fields", () => {
    const parsed = scannedPdfModelAnalysisSchema.parse({
      ...base,
      fields: [
        base.fields[0],
        { ...base.fields[0], value: "duplicate" },
        { ...base.fields[0], fieldName: "page_4", pageIndex: 3 },
      ],
    });
    const normalized = normalizeScannedPdfAnalysis(parsed, 1);
    expect(normalized?.overlayFields.map((field) => field.fieldName)).toEqual(["goal_1"]);
  });
});
