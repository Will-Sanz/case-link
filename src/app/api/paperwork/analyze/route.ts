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
      "Analyze a blank scanned or flattened school-service PDF and prepare a reviewable overlay.",
      "First determine whether the document appears blank. If handwriting, completed checkmarks, names, signatures, IDs, addresses, phone numbers, email addresses, or other likely personal data are present, set appearsBlank false and containsLikelyPersonalData true.",
      "Detect only writable blanks and meaningful checkboxes that a case manager might complete. Coordinates must be normalized 0 to 1 relative to the DISPLAYED page, with x/y at the top-left of the writable area. pageIndex is zero-based.",
      "Use only reviewedSource to suggest values. Never infer identity, eligibility, consent, signatures, attestations, dates of birth, addresses, IDs, contact information, case-manager identity, or site identity.",
      "Keep identity, signature, consent, certification, and attestation values null and mark them for review.",
      "For checkboxes, return 'true', 'false', or null only when directly supported by reviewedSource.",
      "Use a stable descriptive fieldName such as page_1_housing_concern; fieldName values must be unique.",
      "Add a warning when layout, handwriting detection, or a writable area is uncertain.",
    ].join("\n"),
    input: JSON.stringify({ pageCount, reviewedSource: source }),
    fileInputs: [
      {
        filename: "blank-form.pdf",
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
      { error: "CaseLink could not analyze this scanned form. Try again or use a fillable PDF." },
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

  if (!parsed.appearsBlank || parsed.containsLikelyPersonalData) {
    return noStoreJson(
      {
        error:
          "This PDF appears to contain completed or identifying information. For this MVP, upload only a clean blank template.",
      },
      { status: 422 },
    );
  }

  const analysis = normalizeScannedPdfAnalysis(parsed, pageCount);
  if (!analysis) {
    return noStoreJson(
      { error: "No writable areas could be identified in this scanned form." },
      { status: 422 },
    );
  }

  return noStoreJson(analysis);
}
