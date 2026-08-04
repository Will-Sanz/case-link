/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mapPdfFieldsAction } from "@/app/actions/paperwork";
import { PaperworkWorkspace } from "@/features/families/paperwork-workspace";
import { loadLocalPaperworkDraft } from "@/lib/paperwork/local-paperwork-draft";

vi.mock("@/app/actions/paperwork", () => ({
  authorizePaperworkDownloadAction: vi.fn(),
  mapPdfFieldsAction: vi.fn(),
}));

vi.mock("@/lib/paperwork/local-paperwork-draft", () => ({
  deleteLocalPaperworkDraft: vi.fn().mockResolvedValue(undefined),
  loadLocalPaperworkDraft: vi.fn(),
  saveLocalPaperworkBlank: vi.fn().mockResolvedValue(undefined),
  saveLocalPaperworkDraft: vi.fn().mockResolvedValue(undefined),
}));

describe("PaperworkWorkspace restored draft review", () => {
  beforeEach(() => {
    vi.mocked(loadLocalPaperworkDraft).mockReset();
    vi.mocked(mapPdfFieldsAction).mockReset();
  });

  it("preserves the existing entry and flags only a changed suggestion", async () => {
    vi.mocked(loadLocalPaperworkDraft).mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      draft: {
        v: 1,
        familyId: "20000000-0000-4000-8000-000000000002",
        planId: "10000000-0000-4000-8000-000000000001",
        reviewedAt: "2026-08-03T12:00:00.000Z",
        paperworkMode: "fillable",
        fields: [
          {
            name: "service_goal",
            kind: "text",
            options: [],
            maxLength: null,
          },
        ],
        overlayFields: [],
        mappings: [
          {
            fieldName: "service_goal",
            value: "Schedule a housing intake",
            confidence: "high",
            source: "Reviewed plan goal",
            needsReview: false,
          },
        ],
        documentTitle: "Family service plan",
        warnings: [],
        assistedByAi: true,
        updatedAt: "2026-08-03T12:01:00.000Z",
      },
    });
    vi.mocked(mapPdfFieldsAction).mockResolvedValue({
      ok: true,
      assistedByAi: true,
      mappings: [
        {
          fieldName: "service_goal",
          value: "Complete the housing intake",
          confidence: "high",
          source: "Reviewed plan goal",
          needsReview: false,
        },
      ],
    });

    render(
      <PaperworkWorkspace
        familyId="20000000-0000-4000-8000-000000000002"
        familyName="Family 014"
        hasReviewedPlan
        planId="50000000-0000-4000-8000-000000000005"
        reviewedAt="2026-08-03T13:00:00.000Z"
      />,
    );

    expect(await screen.findByText(/1 field is out of date after the plan changed/i)).toBeTruthy();
    expect(screen.getByLabelText("service_goal")).toHaveProperty(
      "value",
      "Schedule a housing intake",
    );
    expect(screen.getByText("Complete the housing intake")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Keep current entry" }));

    await waitFor(() => {
      expect(screen.queryByText("Out of date")).toBeNull();
    });
    expect(screen.getByLabelText("service_goal")).toHaveProperty(
      "value",
      "Schedule a housing intake",
    );
  });
});
