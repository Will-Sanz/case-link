import { describe, expect, it } from "vitest";
import {
  acceptUpdatedPaperworkSuggestion,
  keepCurrentPaperworkValue,
  reconcilePaperworkMappings,
} from "@/lib/paperwork/paperwork-draft-reconciliation";
import type { PdfFieldMapping } from "@/types/paperwork";

const saved: PdfFieldMapping[] = [
  {
    fieldName: "service_goal",
    value: "Schedule a housing intake",
    confidence: "high",
    source: "Reviewed plan goal",
    needsReview: false,
  },
  {
    fieldName: "case_manager_note",
    value: "Call on Tuesday morning",
    confidence: "high",
    source: "Edited by case manager",
    needsReview: false,
    reviewState: "edited",
    baselineValue: "Call this week",
    baselineSource: "Reviewed plan action",
  },
  {
    fieldName: "unchanged_field",
    value: "Stable value",
    confidence: "high",
    source: "Reviewed plan",
    needsReview: false,
  },
];

describe("paperwork draft reconciliation", () => {
  it("flags only changed plan-backed suggestions and preserves manual values", () => {
    const result = reconcilePaperworkMappings(saved, [
      {
        fieldName: "service_goal",
        value: "Complete the housing intake",
        confidence: "high",
        source: "Reviewed plan goal",
        needsReview: false,
      },
      {
        fieldName: "case_manager_note",
        value: "Call within two days",
        confidence: "high",
        source: "Reviewed plan action",
        needsReview: false,
      },
      {
        fieldName: "unchanged_field",
        value: "Stable value",
        confidence: "high",
        source: "Reviewed plan",
        needsReview: false,
      },
    ]);

    expect(result[0]).toMatchObject({
      value: "Schedule a housing intake",
      reviewState: "out_of_date",
      proposedValue: "Complete the housing intake",
      needsReview: true,
    });
    expect(result[1]).toMatchObject({
      value: "Call on Tuesday morning",
      reviewState: "out_of_date",
      proposedValue: "Call within two days",
      needsReview: true,
    });
    expect(result[2]).toMatchObject({
      value: "Stable value",
      reviewState: "ready",
      needsReview: false,
    });
  });

  it("accepts an updated suggestion without changing unrelated mappings", () => {
    const [outdated] = reconcilePaperworkMappings([saved[0]], [
      {
        fieldName: "service_goal",
        value: "Complete the housing intake",
        confidence: "medium",
        source: "Updated reviewed plan goal",
        needsReview: true,
      },
    ]);

    expect(acceptUpdatedPaperworkSuggestion(outdated)).toEqual({
      fieldName: "service_goal",
      value: "Complete the housing intake",
      confidence: "medium",
      source: "Updated reviewed plan goal",
      needsReview: false,
      reviewState: "accepted",
      baselineValue: "Complete the housing intake",
      baselineSource: "Updated reviewed plan goal",
    });
  });

  it("lets a case manager keep a manual value while acknowledging the new baseline", () => {
    const [, outdatedManual] = reconcilePaperworkMappings(saved.slice(0, 2), [
      saved[0],
      {
        fieldName: "case_manager_note",
        value: "Call within two days",
        confidence: "high",
        source: "Reviewed plan action",
        needsReview: false,
      },
    ]);

    expect(keepCurrentPaperworkValue(outdatedManual)).toMatchObject({
      value: "Call on Tuesday morning",
      source: "Edited by case manager",
      reviewState: "edited",
      needsReview: false,
      baselineValue: "Call within two days",
      baselineSource: "Reviewed plan action",
    });
  });
});
