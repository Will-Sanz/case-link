import { NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";
import { createAiResponse } from "@/lib/ai/client";
import { requireAppUserWithClient } from "@/lib/auth/session";
import { buildPaperworkSource } from "@/lib/paperwork/pdf-field-mapper";
import {
  MAX_SCANNED_PDF_PAGES,
  normalizeScannedPdfAnalysis,
  scannedPdfAnalysisJsonSchema,
  scannedPdfModelAnalysisSchema,
  type ScannedPdfModelAnalysis,
} from "@/lib/paperwork/scanned-pdf-analysis";
import { validateFamilyNoPii } from "@/lib/privacy/no-pii";
import { getFamilyDetail } from "@/lib/services/families";
import { isPlanReviewed } from "@/lib/domain/plan/review-status";

export const runtime = "nodejs";
export const maxDuration = 180;

// Vercel Functions accept 4.5 MB request bodies. Leave room for multipart framing.
const MAX_SCANNED_PDF_BYTES = 3_500_000;

function noStoreJson(body: unknown, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

function hasPdfMagic(bytes: Uint8Array): boolean {
  return new TextDecoder("ascii").decode(bytes.slice(0, 5)) === "%PDF-";
}

export async function POST(request: Request): Promise<NextResponse> {
  let session: Awaited<ReturnType<typeof requireAppUserWithClient>>;
  try {
    session = await requireAppUserWithClient();
  } catch {
    return noStoreJson({ error: "Your session expired. Sign in again and retry." }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return noStoreJson({ error: "CaseLink could not read this upload." }, { status: 400 });
  }

  const familyId = formData.get("familyId");
  const file = formData.get("file");
  if (typeof familyId !== "string" || !z.string().uuid().safeParse(familyId).success) {
    return noStoreJson({ error: "Invalid family record." }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return noStoreJson({ error: "Choose a PDF file." }, { status: 400 });
  }
  if (file.size > MAX_SCANNED_PDF_BYTES) {
    return noStoreJson(
      { error: "Scanned PDFs must be 3.5 MB or smaller for this preview." },
      { status: 413 },
    );
  }

  const family = await getFamilyDetail(session.supabase, familyId);
  if (!family) {
    return noStoreJson({ error: "This family record could not be loaded." }, { status: 404 });
  }
  if (!isPlanReviewed(family.plan)) {
    return noStoreJson(
      { error: "Review the intervention plan before preparing paperwork." },
      { status: 409 },
    );
  }
  const privacy = validateFamilyNoPii(family);
  if (!privacy.ok) {
    return noStoreJson(
      { error: privacy.error ?? "Remove identifying text before preparing paperwork." },
      { status: 422 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!hasPdfMagic(bytes)) {
    return noStoreJson({ error: "The selected file is not a valid PDF." }, { status: 400 });
  }

  let pageCount: number;
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false });
    pageCount = pdf.getPageCount();
  } catch {
    return noStoreJson(
      { error: "CaseLink could not open this PDF. Use an unlocked copy." },
      { status: 400 },
    );
  }
  if (pageCount < 1 || pageCount > MAX_SCANNED_PDF_PAGES) {
    return noStoreJson(
      {
        error: `Scanned forms can contain up to ${MAX_SCANNED_PDF_PAGES} pages in this preview.`,
      },
      { status: 400 },
    );
  }

  const source = buildPaperworkSource(family);
  const ai = await createAiResponse({
    taskType: "pdf_field_mapping",
    aiMode: "fast",
    maxTokens: 8_192,
    requestMeta: { userId: session.user.id, route: "/api/paperwork/analyze" },
    instructions: [
      "Analyze a scanned or flattened school-service PDF and prepare a reviewable overlay for only the areas that are still empty.",
      "The PDF may be partially completed. Existing non-identifying text, handwriting, checkmarks, or other marks do not disqualify it, but never place an overlay on top of them.",
      "Set containsLikelyPersonalData true if names, signatures, IDs, addresses, phone numbers, email addresses, or other likely identifying data are present. appearsBlank should indicate whether all detected writable areas are empty.",
      "Detect only writable areas and meaningful checkboxes that visually appear empty. Coordinates must be normalized 0 to 1 relative to the DISPLAYED page, with x/y at the top-left of the writable area. pageIndex is zero-based.",
      "Use only reviewedSource to suggest values. Never infer identity, eligibility, consent, signatures, attestations, dates of birth, addresses, IDs, contact information, case-manager identity, or site identity.",
      "Keep identity, signature, consent, certification, and attestation values null and mark them for review.",
      "Fill a client/family/participant objective only when a reviewedSource action is explicitly owned by family or shared; otherwise leave it null and mark it for review.",
      "For checkboxes, return 'true', 'false', or null only when directly supported by reviewedSource.",
      "Use a stable descriptive fieldName such as page_1_housing_concern; fieldName values must be unique.",
      "Add a warning when layout, handwriting detection, or a writable area is uncertain.",
    ].join("\n"),
    input: JSON.stringify({ pageCount, reviewedSource: source }),
    fileInputs: [
      {
        filename: "form.pdf",
        fileDataBase64: Buffer.from(bytes).toString("base64"),
      },
    ],
    structuredJsonSchema: {
      name: "scanned_pdf_overlay",
      schema: scannedPdfAnalysisJsonSchema,
      strict: true,
    },
  });

  if (!ai.ok) {
    return noStoreJson(
      { error: ai.error },
      { status: 502 },
    );
  }

  let parsed: ScannedPdfModelAnalysis;
  try {
    parsed = scannedPdfModelAnalysisSchema.parse(JSON.parse(ai.text));
  } catch {
    return noStoreJson(
      { error: "CaseLink could not verify the scanned-form analysis. Please try again." },
      { status: 502 },
    );
  }

  if (parsed.containsLikelyPersonalData) {
    return noStoreJson(
      {
        error:
          "This PDF appears to contain identifying information. Use a de-identified copy.",
      },
      { status: 422 },
    );
  }

  const normalizedAnalysis = normalizeScannedPdfAnalysis(parsed, pageCount);
  if (!normalizedAnalysis) {
    return noStoreJson(
      { error: "No writable areas could be identified in this scanned form." },
      { status: 422 },
    );
  }

  const hasExplicitFamilyAction = source.planActions.some(
    (action) => action.owner === "family" || action.owner === "shared",
  );
  const analysis = hasExplicitFamilyAction
    ? normalizedAnalysis
    : {
        ...normalizedAnalysis,
        mappings: normalizedAnalysis.mappings.map((mapping) => {
          const overlay = normalizedAnalysis.overlayFields.find(
            (field) => field.fieldName === mapping.fieldName,
          );
          const label = `${mapping.fieldName} ${overlay?.label ?? ""}`.replace(/[_\-.]+/g, " ");
          if (!/\b(client|family|participant)\s+objective\b/i.test(label)) return mapping;
          return {
            ...mapping,
            value: "",
            confidence: "low" as const,
            source: "No family-owned action was explicitly confirmed",
            needsReview: true,
          };
        }),
      };

  return noStoreJson(analysis);
}
