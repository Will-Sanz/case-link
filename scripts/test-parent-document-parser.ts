import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { PDFDocument, PDFName, PDFString, StandardFonts } from "pdf-lib";
import sharp from "sharp";
import {
  DocumentProcessingError,
  extractIsolatedDocument,
} from "../src/lib/parent/document-processing";
import { MAX_DOCUMENT_BYTES } from "../src/lib/parent/constants";

const run = promisify(execFile);
const lines = {
  en: [
    "Synthetic utility statement",
    "PECO",
    "Amount due $45.67",
    "Due date 2026-11-15",
  ],
  es: [
    "Comprobante de prueba",
    "PGW",
    "Importe adeudado $52.30",
    "Fecha de pago 2026-11-16",
    "Información de prueba",
  ],
};
async function textPdf(pages: string[][]) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = pdf.addPage([612, 792]);
    text.forEach((line, index) =>
      page.drawText(line, { x: 48, y: 720 - index * 36, size: 18, font }),
    );
  }
  return pdf.save({ addDefaultPage: false });
}
async function imagePdf(image: Uint8Array) {
  const pdf = await PDFDocument.create();
  const embedded = await pdf.embedPng(image);
  pdf
    .addPage([800, 400])
    .drawImage(embedded, { x: 0, y: 0, width: 800, height: 400 });
  return pdf.save();
}
async function textImage(language: "en" | "es") {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="800"><rect width="1600" height="800" fill="white"/>${lines[language].map((line, index) => `<text x="80" y="${120 + index * 110}" font-family="DejaVu Sans, Arial, sans-serif" font-size="54" fill="black">${line}</text>`).join("")}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main() {
  assert.equal(
    process.env.CASELINK_PARENT_TEST_REAL_PARSER,
    "1",
    "Explicit real-parser test opt-in is required.",
  );
  const image =
    process.env.CASELINK_DOCUMENT_PARSER_IMAGE ??
    "caselink-document-parser:local";
  assert(/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,200}$/.test(image));
  const inspected = JSON.parse(
    (
      await run("docker", ["image", "inspect", image], {
        timeout: 10000,
        maxBuffer: 1000000,
      })
    ).stdout,
  )[0];
  assert.equal(inspected.Config.User, "65534:65534");
  const checks: {
    name: string;
    passed: boolean;
    durationMs: number;
    pageCount?: number;
    characterCounts?: number[];
    exactTextMatch?: boolean;
    failureKind?: string;
  }[] = [];
  async function check(
    name: string,
    verify: () => Promise<{
      pageCount: number;
      characterCounts: number[];
      exactTextMatch: boolean;
    } | void>,
  ) {
    const start = performance.now();
    try {
      const metadata = await verify();
      checks.push({
        name,
        passed: true,
        durationMs: performance.now() - start,
        ...metadata,
      });
    } catch (error) {
      checks.push({
        name,
        passed: false,
        durationMs: performance.now() - start,
        failureKind:
          error instanceof DocumentProcessingError
            ? error.code
            : "assertion_or_test_setup_failed",
      });
    }
    process.stdout.write(
      `Parent isolated parser: ${name}: ${checks.at(-1)!.passed ? "passed" : "FAILED"}\n`,
    );
  }
  async function readable(
    bytes: Uint8Array,
    mediaType: string,
    expected: string[][],
  ) {
    const source = await extractIsolatedDocument(bytes, mediaType);
    assert.equal(source.mediaType, mediaType);
    assert.equal(source.pageCount, expected.length);
    let exactTextMatch = true;
    const withoutAccents = (text: string) =>
      text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    expected.forEach((words, page) =>
      words.forEach((word) => {
        const text = source.sourcePages[page].normalize("NFC");
        // OCR can drop Spanish accents; preserve this warning while requiring exact numbers and labels.
        exactTextMatch &&= text.includes(word);
        assert(withoutAccents(text).includes(withoutAccents(word)));
      }),
    );
    return {
      pageCount: source.pageCount,
      characterCounts: source.sourcePages.map((text) => text.length),
      exactTextMatch,
    };
  }
  async function unreadable(bytes: Uint8Array, mediaType: string) {
    await assert.rejects(
      extractIsolatedDocument(bytes, mediaType),
      (error: unknown) =>
        error instanceof DocumentProcessingError && error.code === "unreadable",
    );
  }
  const enPng = await textImage("en"),
    esPng = await textImage("es");
  const enJpeg = await sharp(enPng).jpeg({ quality: 95 }).toBuffer(),
    esJpeg = await sharp(esPng).jpeg({ quality: 95 }).toBuffer();
  const englishPdf = await textPdf([
    lines.en,
    [
      "Second synthetic page with independent source order.",
      "Amount due $60.00",
    ],
  ]);
  await check("native-pdf-english-page-order", () =>
    readable(englishPdf, "application/pdf", [
      ["PECO", "45.67", "2026-11-15"],
      ["Second synthetic page", "60.00"],
    ]),
  );
  await check("native-pdf-spanish", async () =>
    readable(await textPdf([lines.es]), "application/pdf", [
      ["PGW", "52.30", "Información"],
    ]),
  );
  for (const [language, png, jpeg] of [
    ["english", enPng, enJpeg],
    ["spanish", esPng, esJpeg],
  ] as const) {
    const expected =
      language === "english"
        ? ["PECO", "45.67", "2026-11-15", "Amount due"]
        : ["PGW", "52.30", "2026-11-16", "Importe adeudado", "Información"];
    await check(`png-ocr-${language}`, () =>
      readable(png, "image/png", [expected]),
    );
    await check(`jpeg-ocr-${language}`, () =>
      readable(jpeg, "image/jpeg", [expected]),
    );
    await check(`scanned-pdf-ocr-${language}`, async () =>
      readable(await imagePdf(png), "application/pdf", [expected]),
    );
  }
  const fivePages = Array.from({ length: 5 }, (_, index) => [
    `Synthetic page ${index + 1} of five with sufficient text for native extraction.`,
    "Amount due $20.00",
  ]);
  await check("five-page-limit-accepted", async () =>
    readable(
      await textPdf(fivePages),
      "application/pdf",
      fivePages.map((_, index) => [`Synthetic page ${index + 1}`]),
    ),
  );
  await check("six-page-limit-rejected", async () =>
    unreadable(
      await textPdf([
        ...fivePages,
        ["Synthetic sixth page outside the supported page count."],
      ]),
      "application/pdf",
    ),
  );
  await check("zero-page-pdf-rejected", async () =>
    unreadable(await textPdf([]), "application/pdf"),
  );
  await check("malformed-pdf-rejected", () =>
    unreadable(
      Buffer.from("%PDF-1.7\nmalformed synthetic test"),
      "application/pdf",
    ),
  );
  await check("malformed-png-rejected", () =>
    unreadable(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]),
      "image/png",
    ),
  );
  await check("malformed-jpeg-rejected", () =>
    unreadable(
      Buffer.from([255, 216, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      "image/jpeg",
    ),
  );
  await check("pdf-claimed-as-image-rejected", () =>
    unreadable(englishPdf, "image/png"),
  );
  await check("image-claimed-as-pdf-rejected", () =>
    unreadable(enPng, "application/pdf"),
  );
  await check("png-claimed-as-jpeg-rejected", () =>
    unreadable(enPng, "image/jpeg"),
  );
  await check("unsupported-media-type-rejected", () =>
    unreadable(enPng, "image/svg+xml"),
  );
  await check("empty-document-rejected", () =>
    unreadable(new Uint8Array(), "application/pdf"),
  );
  await check("oversized-document-rejected", () =>
    unreadable(new Uint8Array(MAX_DOCUMENT_BYTES + 1), "application/pdf"),
  );
  await check("oversized-image-pixel-budget-rejected", async () =>
    unreadable(
      await sharp({
        create: { width: 5000, height: 4001, channels: 3, background: "white" },
      })
        .png()
        .toBuffer(),
      "image/png",
    ),
  );
  await check("active-pdf-rejected", async () => {
    const pdf = await PDFDocument.load(englishPdf);
    pdf.catalog.set(
      PDFName.of("OpenAction"),
      pdf.context.obj({
        S: PDFName.of("JavaScript"),
        JS: PDFString.of("synthetic test; no action is executed"),
      }),
    );
    await unreadable(await pdf.save(), "application/pdf");
  });
  await check("embedded-file-pdf-rejected", async () => {
    const pdf = await PDFDocument.load(englishPdf);
    await pdf.attach(Buffer.from("synthetic attachment"), "synthetic.txt", {
      mimeType: "text/plain",
    });
    await unreadable(await pdf.save(), "application/pdf");
  });
  const manifest = [
    "scripts/test-parent-document-parser.ts",
    "scripts/parse-parent-document.ts",
    "src/lib/parent/document-processing.ts",
    "src/lib/parent/documents.ts",
    "src/lib/parent/constants.ts",
    "docker/parent-document-worker.Dockerfile",
    "docker/parent-document-worker.Dockerfile.dockerignore",
    "package-lock.json",
  ];
  const sourceManifest = await Promise.all(
    manifest.map(async (path) => ({
      path,
      sha256: createHash("sha256")
        .update(await readFile(path))
        .digest("hex"),
    })),
  );
  const report = {
    recordedAt: new Date().toISOString(),
    scope: "real_local_isolated_parser_synthetic_fixtures_only",
    image: {
      name: image,
      id: inspected.Id,
      defaultUser: inspected.Config.User,
    },
    checks,
    passed: checks.every((check) => check.passed),
    qualityWarnings: checks
      .filter((check) => check.exactTextMatch === false)
      .map((check) => ({
        name: check.name,
        warning: "synthetic_spanish_ocr_diacritic_not_preserved",
      })),
    modelCalls: 0,
    realFamilyDocuments: 0,
    sourceTextRecorded: false,
    fixtureFilesWritten: false,
    sourceManifest,
  };
  await mkdir("docs/verification", { recursive: true });
  await writeFile(
    "docs/verification/parent-document-parser-local.json",
    `${JSON.stringify(report, null, 2)}\n`,
    { mode: 0o600 },
  );
  process.stdout.write(
    `Parent isolated parser: ${checks.filter((check) => check.passed).length}/${checks.length} checks passed. Aggregate report: docs/verification/parent-document-parser-local.json\n`,
  );
  if (!report.passed) process.exitCode = 1;
}
void main().catch(() => {
  process.stderr.write(
    "Parent real-parser checks did not complete. Verify explicit opt-in and the locally built parser image; no source text or sensitive diagnostics are logged.\n",
  );
  process.exitCode = 1;
});
