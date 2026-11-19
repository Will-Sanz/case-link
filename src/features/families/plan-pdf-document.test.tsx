import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
import { pdfPlanFixtures } from "../../../tests/fixtures/pdf-plans";

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
  it("keeps the compact boundary plan on one page without a trailing decoration-only page", async () => {
    const fixture = pdfPlanFixtures().find(item => item.name === "hosted-trailing-boundary")!;
    const bytes = await renderToBuffer(<PlanPdfDocument plan={fixture.plan} familyName="Family 014" generatedDate="Oct 13, 2026" barrierLabels={fixture.barriers} />);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
  it("refuses unsupported glyphs instead of silently losing reviewed text", () => {
    expect(() => PlanPdfDocument({ plan, familyName: "確認", generatedDate: "Oct 13, 2026" }))
      .toThrow(/PDF font/);
    const unsupportedGoal = structuredClone(plan);
    unsupportedGoal.steps[0].details!.stage_goal = "Confirm 🙂";
    expect(() => PlanPdfDocument({ plan: unsupportedGoal, generatedDate: "Oct 13, 2026" }))
      .toThrow(/PDF font/);
  });

  it("accepts decomposed Latin accents after normalization", async () => {
    const accented = structuredClone(plan);
    accented.summary = "Cafe\u0301 and re\u0301sume\u0301 checklist";
    const bytes = await renderToBuffer(<PlanPdfDocument plan={accented} generatedDate="Oct 13, 2026" />);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
  });

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

  it("renders exact Waiting, leap-day, and completed-action calendar dates", async () => {
    const dated = structuredClone(plan);
    const original = dated.steps[0].action_items![0];
    dated.steps[0].action_items = [
      { ...original, id: "waiting", title: "Follow up on the referral", status: "blocked", target_date: "2020-01-01", follow_up_date: "2026-11-01", notes: "Awaiting a callback" },
      { ...original, id: "manual", title: "Review the long-term arrangement", status: "pending", target_date: "2028-02-29", notes: null },
      { ...original, id: "complete", title: "Complete intake preparation", status: "completed", target_date: null, notes: null, outcome: "Preparation completed" },
    ];
    const bytes = await finalizePlanPdf(await renderToBuffer(<PlanPdfDocument plan={dated} familyName="Family 014" generatedDate="Oct 13, 2026" barrierLabels={["Housing instability"]} />));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
    const evidence = process.env.CASELINK_PDF_EVIDENCE_DIR;
    if (evidence) {
      mkdirSync(evidence, { recursive: true });
      writeFileSync(resolve(evidence, "pilot-date-check.pdf"), bytes);
    }
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
