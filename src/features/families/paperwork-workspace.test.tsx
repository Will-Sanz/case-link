/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PaperworkWorkspace } from "@/features/families/paperwork-workspace";

describe("PaperworkWorkspace", () => {
  it("offers only the reviewed plan PDF download", () => {
    render(
      <PaperworkWorkspace
        familyId="20000000-0000-4000-8000-000000000002"
        familyName="Family 014"
        hasReviewedPlan
        planDownload={<button type="button">Download plan PDF</button>}
      />,
    );

    expect(screen.getByRole("heading", { name: "Download the reviewed plan" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download plan PDF" })).toBeTruthy();
    expect(screen.getByText(/black-and-white PDF/i)).toBeTruthy();
    expect(screen.queryByText(/upload/i)).toBeNull();
    expect(screen.queryByLabelText(/PDF file/i)).toBeNull();
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
