/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validatePlanExport } from "@/app/actions/plans";
import { PlanPdfExport } from "@/features/families/plan-pdf-export";
import type { PlanWithSteps } from "@/types/family";

vi.mock("@/app/actions/plans", () => ({ validatePlanExport: vi.fn() }));

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
  Font: { registerHyphenationCallback: vi.fn() },
}));

vi.mock("@/lib/domain/plan/finalize-plan-pdf", () => ({
  finalizePlanPdf: finalizePlanPdfMock,
}));

const plan: PlanWithSteps = {
  id: "10000000-0000-4000-8000-000000000001",
  family_id: "20000000-0000-4000-8000-000000000002",
  version: 3,
  review_revision: "a".repeat(64),
  summary: "Reviewed plan",
  generation_source: "openai",
  ai_model: null,
  created_at: "2026-08-01T12:00:00.000Z",
  client_display: { reviewedAt: "2026-08-04T13:00:00.000Z" },
  presentation: { sourceKind: "ai" },
  steps: [],
};

describe("PlanPdfExport", () => {
  const createObjectUrl = vi.fn<(blob: Blob) => string>(() => "blob:reviewed-plan");
  const revokeObjectUrl = vi.fn();
  let anchorClick: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(validatePlanExport).mockReset().mockResolvedValue({ ok: true });
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
    expect(new Uint8Array(await createObjectUrl.mock.calls[0][0].arrayBuffer())).toEqual(new Uint8Array([4, 5, 6]));
    expect(screen.getByText(/If the preview does not display/)).toBeTruthy();
    expect(screen.getByTitle("Family 014 reviewed plan PDF").getAttribute("src")).toContain(
      "blob:reviewed-plan",
    );

    fireEvent.click(downloadButton);
    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1));
    expect(anchorClick.mock.instances[0].href).toBe("blob:reviewed-plan");
    expect(validatePlanExport).toHaveBeenCalledTimes(3);

    unmount();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:reviewed-plan");
  });
  it("refuses to render an already stale plan", async () => {
    vi.mocked(validatePlanExport).mockResolvedValue({ ok: false, error: "Reload and review the current plan." });
    render(<PlanPdfExport plan={plan} barrierLabels={[]} />);
    await screen.findByText("Reload and review the current plan.");
    expect(pdfMock).not.toHaveBeenCalled();
    expect(anchorClick).not.toHaveBeenCalled();
  });

  it("catches an edit while the PDF is rendering", async () => {
    vi.mocked(validatePlanExport).mockResolvedValueOnce({ ok: true }).mockResolvedValue({ ok: false, error: "Changed while preparing." });
    render(<PlanPdfExport plan={plan} barrierLabels={[]} />);
    await screen.findByText("Changed while preparing.");
    expect(screen.queryByTitle("Family reviewed plan PDF")).toBeNull();
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it("blocks a stale download and duplicate download attempts", async () => {
    render(<PlanPdfExport plan={plan} barrierLabels={[]} />);
    const button = await screen.findByRole("button", { name: "Download PDF" });
    let finish!: (v: Awaited<ReturnType<typeof validatePlanExport>>) => void;
    vi.mocked(validatePlanExport).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    fireEvent.click(button);
    fireEvent.click(button);
    await act(async () => finish({ ok: false, error: "Changed after preview." }));
    await screen.findByText("Changed after preview.");
    expect(anchorClick).not.toHaveBeenCalled();
    expect(validatePlanExport).toHaveBeenCalledTimes(3);
    expect(screen.queryByTitle("Family reviewed plan PDF")).toBeNull();
  });

  it("ignores a download check that completes after leaving the preview", async () => {
    const { unmount } = render(<PlanPdfExport plan={plan} barrierLabels={[]} />);
    const button = await screen.findByRole("button", { name: "Download PDF" });
    let finish!: (v: Awaited<ReturnType<typeof validatePlanExport>>) => void;
    vi.mocked(validatePlanExport).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    fireEvent.click(button);
    unmount();
    await act(async () => finish({ ok: true }));
    expect(anchorClick).not.toHaveBeenCalled();
  });

  it.each(["render", "finalize"])("recovers from a %s failure without offering a partial PDF", async (stage) => {
    (stage === "render" ? toBlobMock : finalizePlanPdfMock).mockRejectedValueOnce(new Error("Internal rendering detail"));
    render(<PlanPdfExport plan={plan} barrierLabels={[]} />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect((await screen.findByRole("alert")).textContent).toContain("could not be prepared");
    expect(screen.queryByText("Internal rendering detail")).toBeNull();
    expect(createObjectUrl).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("button", { name: "Download PDF" });
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
  });

  it("explains unsupported characters without suggesting a retry will repair them", async () => {
    toBlobMock.mockRejectedValueOnce(Object.assign(new Error("private text"), { name: "UnsupportedPdfTextError" }));
    render(<PlanPdfExport plan={plan} barrierLabels={[]} />);
    expect((await screen.findByRole("alert")).textContent).toContain("PDF font");
    expect(screen.queryByText("private text")).toBeNull();
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it("releases the preview when the final authorization check is unavailable", async () => {
    render(<PlanPdfExport plan={plan} barrierLabels={[]} />);
    const button = await screen.findByRole("button", { name: "Download PDF" });
    vi.mocked(validatePlanExport).mockRejectedValueOnce(new Error("Offline"));
    fireEvent.click(button);
    await screen.findByRole("alert");
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:reviewed-plan");
    expect(anchorClick).not.toHaveBeenCalled();
  });

});
