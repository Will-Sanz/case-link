/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mapPdfFieldsAction } from "@/app/actions/paperwork";
import { PaperworkWorkspace } from "@/features/families/paperwork-workspace";

vi.mock("@/app/actions/paperwork", () => ({
  authorizePaperworkDownloadAction: vi.fn(),
  mapPdfFieldsAction: vi.fn(),
}));

vi.mock("@/app/actions/families", () => ({
  recordCaseWorkflowEvent: vi.fn().mockResolvedValue({ ok: true }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("PaperworkWorkspace", () => {
  beforeEach(() => {
    vi.mocked(mapPdfFieldsAction).mockReset();
  });

  it("only offers a blank fillable PDF upload", () => {
    render(
      <PaperworkWorkspace
        familyId="20000000-0000-4000-8000-000000000002"
        familyName="Family 014"
        hasReviewedPlan
        planId="50000000-0000-4000-8000-000000000005"
        reviewedAt="2026-08-03T13:00:00.000Z"
      />,
    );

    expect(screen.getByRole("heading", { name: "Upload a blank fillable PDF" })).toBeTruthy();
    expect((screen.getByLabelText("Upload PDF") as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByText(/completed, scanned, active-content, encrypted, and non-fillable PDFs are rejected/i)).toBeTruthy();
  });

  it("ignores an older mapping response after the case manager starts a new form", async () => {
    const first = deferred<Awaited<ReturnType<typeof mapPdfFieldsAction>>>();
    const second = deferred<Awaited<ReturnType<typeof mapPdfFieldsAction>>>();
    vi.mocked(mapPdfFieldsAction)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    async function blankPdfFile(name: string, fieldName: string) {
      const document = await PDFDocument.create();
      const page = document.addPage();
      document.getForm().createTextField(fieldName).addToPage(page);
      const bytes = await document.save();
      const file = new File([], name, { type: "application/pdf" });
      Object.defineProperty(file, "size", { value: bytes.length });
      Object.defineProperty(file, "arrayBuffer", {
        value: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      });
      return file;
    }

    render(
      <PaperworkWorkspace
        familyId="20000000-0000-4000-8000-000000000002"
        familyName="Family 014"
        hasReviewedPlan
        planId="50000000-0000-4000-8000-000000000005"
        reviewedAt="2026-08-03T13:00:00.000Z"
      />,
    );

    fireEvent.change(screen.getByLabelText("Upload PDF"), {
      target: { files: [await blankPdfFile("first.pdf", "first_field")] },
    });
    await waitFor(() => expect(mapPdfFieldsAction).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole("button", { name: /start over/i }));

    fireEvent.change(screen.getByLabelText("Upload PDF"), {
      target: { files: [await blankPdfFile("second.pdf", "second_field")] },
    });
    await waitFor(() => expect(mapPdfFieldsAction).toHaveBeenCalledTimes(2));
    second.resolve({
      ok: true,
      mappings: [{
        fieldName: "second_field",
        value: "",
        confidence: "low",
        source: "No reviewed source value",
        needsReview: true,
      }],
      assistedByAi: false,
    });
    expect(await screen.findByText("second_field")).toBeTruthy();

    first.resolve({
      ok: true,
      mappings: [{
        fieldName: "first_field",
        value: "stale",
        confidence: "high",
        source: "Old form",
        needsReview: false,
      }],
      assistedByAi: false,
    });
    await waitFor(() => expect(screen.queryByText("first_field")).toBeNull());
    expect(screen.getByText("second_field")).toBeTruthy();
  });
});
