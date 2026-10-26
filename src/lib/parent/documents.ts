import { PDFDocument, PDFName } from "pdf-lib";
import { z } from "zod";
import sharp from "sharp";

export { DOCUMENT_CONSENT_VERSION } from "./constants";
import { MAX_DOCUMENT_BYTES } from "./constants";
export { MAX_DOCUMENT_BYTES } from "./constants";
export async function inspectDocument(
  bytes: Uint8Array,
  claimedType: string,
): Promise<{ mediaType: string; pageCount: number }> {
  if (!bytes.length || bytes.length > MAX_DOCUMENT_BYTES)
    throw new Error("Choose a readable file up to 10 MB.");
  const header = Buffer.from(bytes.subarray(0, 12));
  if (header.subarray(0, 5).toString() === "%PDF-") {
    if (claimedType !== "application/pdf")
      throw new Error("The file type does not match its contents.");
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    if (pdf.isEncrypted || pdf.getPageCount() > 5 || pdf.getPageCount() < 1)
      throw new Error("Use an unencrypted PDF with one to five pages.");
    for (const [, object] of pdf.context.enumerateIndirectObjects()) {
      const text = object.toString();
      if (/\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|XFA)\b/.test(text))
        throw new Error(
          "This PDF contains active or embedded content. Export a plain copy or enter the information manually.",
        );
    }
    if (pdf.catalog.has(PDFName.of("OpenAction")))
      throw new Error("Export a plain PDF without active content.");
    return { mediaType: "application/pdf", pageCount: pdf.getPageCount() };
  }
  const png = header
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = header[0] === 255 && header[1] === 216 && header[2] === 255;
  if (
    (png && claimedType === "image/png") ||
    (jpeg && claimedType === "image/jpeg")
  ) {
    await sharp(bytes, { limitInputPixels: 20000000, failOn: "warning" })
      .rotate()
      .toBuffer();
    return { mediaType: claimedType, pageCount: 1 };
  }
  throw new Error(
    "Choose a JPEG, PNG or readable PDF. You can also enter information manually.",
  );
}

export const extractedFactsSchema = z
  .object({
    provider: z.enum(["peco", "pgw", "pwd", "unknown"]),
    amountDue: z.number().finite().min(0).max(1000000).nullable(),
    totalBalance: z.number().finite().min(0).max(1000000).nullable(),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    shutoffDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    fields: z
      .array(
        z
          .object({
            field: z.enum([
              "provider",
              "amountDue",
              "totalBalance",
              "dueDate",
              "shutoffDate",
            ]),
            page: z.number().int().min(1).max(5),
            sourceText: z.string().min(1).max(120),
          })
          .strict(),
      )
      .max(5),
  })
  .strict();
export type ExtractedFacts = z.infer<typeof extractedFactsSchema>;
export function validateExtractedFacts(
  value: unknown,
  sourcePages: readonly string[],
): ExtractedFacts {
  const facts = extractedFactsSchema.parse(value);
  for (const [key, value] of Object.entries(facts)) {
    if (key === "fields" || value === null || value === "unknown") continue;
    const source = facts.fields.find((f) => f.field === key);
    if (!source) throw new Error("A document value has no source reference.");
    if (!sourcePages[source.page - 1]?.includes(source.sourceText))
      throw new Error(
        "The reference does not occur on the original source page.",
      );
    const labels: Record<string, RegExp> = {
      provider: /\b(PECO|PGW|Philadelphia Water|PWD)\b/i,
      amountDue: /\b(amount due|payment due|current charges)\b/i,
      totalBalance: /\b(total balance|account balance|balance due)\b/i,
      dueDate: /\b(due date|payment due|pay by)\b/i,
      shutoffDate: /\b(shut.?off|termination|disconnect)\b/i,
    };
    if (!labels[key]?.test(source.sourceText))
      throw new Error("The reference does not identify this kind of value.");
    if (typeof value === "number") {
      const amounts = [
        ...source.sourceText.matchAll(
          /(?:\$\s*)?\b(\d[\d,]*(?:\.\d{1,2})?)\b/g,
        ),
      ].map((m) => Number(m[1].replaceAll(",", "")));
      if (amounts.length !== 1 || amounts[0] !== value)
        throw new Error("The amount does not uniquely match its source.");
    }
    if (
      key === "provider" &&
      !{
        peco: /\bPECO\b/i,
        pgw: /\bPGW\b/i,
        pwd: /\b(PWD|Philadelphia Water)\b/i,
        unknown: /$a/,
      }[String(value) as ExtractedFacts["provider"]].test(source.sourceText)
    )
      throw new Error("The provider does not match its source.");
    if (key.endsWith("Date") && typeof value === "string") {
      const date = new Date(value + "T12:00:00Z");
      if (
        !Number.isFinite(date.getTime()) ||
        date.toISOString().slice(0, 10) !== value
      )
        throw new Error("A document date is invalid.");
      if (!source.sourceText.includes(value))
        throw new Error(
          "The date does not exactly match the source; clarify its format before reuse.",
        );
    }
    if (/\b\d{3}[- ]\d{2}[- ]\d{4}\b/.test(source.sourceText))
      throw new Error("A source reference contains an excluded identifier.");
  }
  return facts;
}
