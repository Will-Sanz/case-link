/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PaperworkWorkspace } from "@/features/families/paperwork-workspace";

describe("PaperworkWorkspace", () => {
  it("opens the reviewed plan PDF for review", () => {
    render(
      <PaperworkWorkspace
        familyId="20000000-0000-4000-8000-000000000002"
        familyName="Family 014"
        hasReviewedPlan
        planReview={<div aria-label="Reviewed plan PDF">PDF preview</div>}
      />,
    );

    expect(screen.getByRole("heading", { name: "Review PDF" })).toBeTruthy();
    expect(screen.getByLabelText("Reviewed plan PDF")).toBeTruthy();
    expect(screen.getByText(/generates this document automatically/i)).toBeTruthy();
    expect(screen.queryByText(/Download the reviewed plan/i)).toBeNull();
  });

  it("sends an unreviewed plan back for review", () => {
    render(
      <PaperworkWorkspace
        familyId="20000000-0000-4000-8000-000000000002"
        familyName="Family 014"
        hasReviewedPlan={false}
      />,
    );

    expect(screen.getByRole("heading", { name: "Review the intervention plan first" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Review plan/i }).getAttribute("href")).toBe(
      "/families/20000000-0000-4000-8000-000000000002/plan",
    );
    expect(screen.queryByRole("button", { name: /Download/i })).toBeNull();
  });
});
