/** @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanPdfExport } from "@/features/families/plan-pdf-export";
import type { PlanWithSteps } from "@/types/family";

const { pdfMock, toBlobMock, finalizePlanPdfMock } = vi.hoisted(() => ({
  pdfMock: vi.fn(),
  toBlobMock: vi.fn(),
  finalizePlanPdfMock: vi.fn(),
}));

vi.mock("@react-pdf/renderer", () => ({
  Document: ({ children }: { children: ReactNode }) => children,
  Page: ({ children }: { children: ReactNode }) => children,
  Text: ({ children }: { children: ReactNode }) => children,
  View: ({ children }: { children: ReactNode }) => children,
  StyleSheet: { create: <T,>(styles: T) => styles },
  pdf: pdfMock,
}));

vi.mock("@/lib/domain/plan/finalize-plan-pdf", () => ({
  finalizePlanPdf: finalizePlanPdfMock,
}));

const plan: PlanWithSteps = {
  id: "10000000-0000-4000-8000-000000000001",
  family_id: "20000000-0000-4000-8000-000000000002",
  version: 3,
  summary: "Reviewed plan",
  generation_source: "openai",
  ai_model: null,
  created_at: "2026-08-01T12:00:00.000Z",
  client_display: { reviewedAt: "2026-08-04T13:00:00.000Z" },
  presentation: { sourceKind: "ai" },
  steps: [],
};

describe("PlanPdfExport", () => {
  const createObjectUrl = vi.fn(() => "blob:reviewed-plan");
  const revokeObjectUrl = vi.fn();
  let anchorClick: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    toBlobMock.mockResolvedValue(new Blob([new Uint8Array([1, 2, 3])], { type: "application/pdf" }));
    pdfMock.mockReturnValue({ toBlob: toBlobMock });
    finalizePlanPdfMock.mockResolvedValue(new Uint8Array([4, 5, 6]));
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectUrl });
    anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    anchorClick.mockRestore();
  });

  it("generates the preview on entry and downloads the same PDF", async () => {
    const { unmount } = render(
      <PlanPdfExport plan={plan} familyName="Family 014" barrierLabels={["Housing"]} />,
    );

    expect(screen.getByRole("button", { name: "Preparing PDF…" }).hasAttribute("disabled")).toBe(true);

    const downloadButton = await screen.findByRole("button", { name: "Download PDF" });
    expect(pdfMock).toHaveBeenCalledTimes(1);
    expect(finalizePlanPdfMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTitle("Family 014 reviewed plan PDF").getAttribute("src")).toContain(
      "blob:reviewed-plan",
    );

    fireEvent.click(downloadButton);
    expect(anchorClick).toHaveBeenCalledTimes(1);

    unmount();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:reviewed-plan");
  });
});
