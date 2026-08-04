import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToBuffer } from "@react-pdf/renderer";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  PLAN_PDF_TITLE,
  PlanPdfDocument,
} from "@/features/families/plan-pdf-document";
import { finalizePlanPdf } from "@/lib/domain/plan/finalize-plan-pdf";
import type { PlanWithSteps } from "@/types/family";

const plan: PlanWithSteps = {
  id: "10000000-0000-4000-8000-000000000001",
  family_id: "20000000-0000-4000-8000-000000000002",
  version: 3,
  summary: "Move the housing intake forward.",
  generation_source: "openai",
  ai_model: null,
  created_at: "2026-08-01T12:00:00.000Z",
  client_display: { reviewedAt: "2026-08-04T13:00:00.000Z" },
  presentation: { sourceKind: "ai" },
  steps: [
    {
      id: "30000000-0000-4000-8000-000000000003",
      plan_id: "10000000-0000-4000-8000-000000000001",
      phase: "90",
      title: "Complete housing intake",
      description: "Gather the required records and complete the intake call.",
      status: "in_progress",
      priority: "high",
      due_date: null,
      assigned_to_id: null,
      sort_order: 0,
      created_at: "2026-08-01T12:00:00.000Z",
      updated_at: "2026-08-01T12:00:00.000Z",
      details: {
        stage_goal: "Secure stable housing",
        owner: "shared",
        expected_outcome: "The intake is submitted.",
        required_documents: ["Proof of income", "Current lease notice"],
      },
      action_items: [
        {
          id: "40000000-0000-4000-8000-000000000004",
          plan_step_id: "30000000-0000-4000-8000-000000000003",
          title: "Call the intake line",
          description: "Ask for the next available appointment.",
          week_index: 1,
          target_date: "2026-08-10",
          status: "in_progress",
          sort_order: 0,
          outcome: null,
          notes: "Voicemail left; call again tomorrow.",
          follow_up_date: null,
          created_at: "2026-08-01T12:00:00.000Z",
          updated_at: "2026-08-01T12:00:00.000Z",
        },
      ],
    },
  ],
};

describe("PlanPdfDocument", () => {
  it("renders a valid reviewed plan without relying on storage phases", async () => {
    const bytes = await renderToBuffer(
      <PlanPdfDocument
        plan={plan}
        familyName="Family 014"
        generatedDate="August 4, 2026"
        barrierLabels={["Housing instability"]}
      />,
    );
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBeGreaterThan(0);
    expect(document.getTitle()).toBe(PLAN_PDF_TITLE);
    expect(bytes.byteLength).toBeGreaterThan(1_000);

    const finalized = await finalizePlanPdf(bytes);
    const finalizedDocument = await PDFDocument.load(finalized);
    expect(finalizedDocument.getPageCount()).toBe(document.getPageCount());
    expect(
      [...finalizedDocument.context.enumerateIndirectObjects()].length,
    ).toBeGreaterThan([...document.context.enumerateIndirectObjects()].length);
  });

  it("keeps the printable artifact unbranded and strictly black and white", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/features/families/plan-pdf-document.tsx"),
      "utf8",
    );
    const colors = new Set(source.match(/#[0-9a-f]{6}/gi) ?? []);
    expect([...colors].map((value) => value.toUpperCase()).sort()).toEqual([
      "#000000",
      "#FFFFFF",
    ]);
    expect(source).not.toMatch(/caselink/i);
    expect(source).not.toContain("-day period");
  });
});
