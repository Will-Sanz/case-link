import { createHash } from "node:crypto";
import { z } from "zod";
import { extractIsolatedDocument, sourceDocumentSchema, type DocumentSource } from "./document-processing";
import { MAX_DOCUMENT_BYTES } from "./constants";

export const UTILITY_INCOME_PROOF_VERSION = "utility-employment-source-fields-2026-11-13.v1";
const date = z.iso.date();
const mediaType = z.enum(["application/pdf", "image/jpeg", "image/png"]);
const contextSchema = z.object({
  programId: z.enum(["peco-cap", "pgw-crp", "pwd-tap"]), subjectId: z.uuid(), sourceId: z.uuid(),
  subjectNames: z.array(z.string().trim().min(1).max(200)).min(1).max(3),
  sourceKind: z.literal("employment"),
}).strict();
export type UtilityIncomeProofContext = z.infer<typeof contextSchema>;
const fields = ["grossCents", "periodStart", "periodEnd", "issuedOn", "payFrequency"] as const;
export const utilityIncomeProofProjectionSchema = z.object({
  version: z.literal(UTILITY_INCOME_PROOF_VERSION), programId: contextSchema.shape.programId,
  subjectId: z.uuid(), sourceId: z.uuid(), proofKind: z.enum(["pay_stub", "employer_letter"]),
  originalSha256: z.string().regex(/^[a-f0-9]{64}$/), currency: z.literal("USD"), grossCents: z.number().int().min(0).max(1_000_000_000_000),
  periodStart: date, periodEnd: date, issuedOn: date,
  payFrequency: z.enum(["weekly", "biweekly", "twice_monthly", "monthly", "yearly"]).nullable(),
  subjectMatch: z.literal("printed_name_matches_authorized_target"),
  sourceEvidence: z.array(z.object({ field: z.enum(fields), page: z.number().int().min(1).max(5),
    line: z.number().int().positive(), sourceText: z.string().min(1).max(180) }).strict()).min(4).max(25),
}).strict();
export type UtilityIncomeProofProjection = z.infer<typeof utilityIncomeProofProjectionSchema>;
type Field = typeof fields[number];
type Evidence = UtilityIncomeProofProjection["sourceEvidence"][number];
type Checked = { status: "source_fields_checked"; projection: UtilityIncomeProofProjection; authenticity: "not_established"; proofComplete: false };
type Unresolved = { status: "needs_service_validation"; reason: string; proofComplete: false };
const unresolved = (reason: string): Unresolved => ({ status: "needs_service_validation", reason, proofComplete: false });
const normalizeName = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
const validDate = (value: string) => date.safeParse(value).success && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;

/** Isolated service only. This checks source fields, not identity, authenticity, completeness or authority. */
export async function validateUtilityIncomeProof(input: {
  bytes: Uint8Array; mediaType: string; context: unknown; now: Date; signal?: AbortSignal;
  extractSource?: (bytes: Uint8Array, mediaType: string) => Promise<DocumentSource>;
}): Promise<Checked | Unresolved> {
  let sourceBytes: Uint8Array | undefined;
  try {
    const context = contextSchema.parse(structuredClone(input.context)), now = new Date(input.now), type = input.mediaType, signal = input.signal;
    if (!(input.bytes instanceof Uint8Array) || !input.bytes.length || input.bytes.length > MAX_DOCUMENT_BYTES ||
      !mediaType.safeParse(type).success || !Number.isFinite(now.getTime())) return unresolved("unsupported_document");
    if (signal?.aborted) return unresolved("processing_stopped");
    const bytes = sourceBytes = Uint8Array.from(input.bytes), originalSha256 = createHash("sha256").update(bytes).digest("hex");
    const source = sourceDocumentSchema.parse(await (input.extractSource ?? extractIsolatedDocument)(bytes, type));
    if (signal?.aborted) return unresolved("processing_stopped");
    if (source.mediaType !== type) return unresolved("source_type_mismatch");
    const lines = source.sourcePages.flatMap((page, index) => page.split(/\r?\n/).map((raw, line) => ({
      text: raw.trim().replace(/[ \t]+/g, " "), page: index + 1, line: line + 1,
    })));
    const kinds = new Set(lines.flatMap(({ text }) => /^(?:SYNTHETIC )?(?:PAY STUB|EARNINGS STATEMENT)$/i.test(text) ? ["pay_stub" as const]
      : /^(?:SYNTHETIC )?EMPLOY(?:ER|MENT) VERIFICATION(?: LETTER)?$/i.test(text) ? ["employer_letter" as const] : []));
    if (kinds.size !== 1) return unresolved("proof_kind_unresolved");
    const names = [...new Set(lines.flatMap(({ text }) => text.match(/^(?:Employee|Employee Name): (.+)$/i)?.[1] ?? []).map(normalizeName))];
    if (names.length !== 1 || !context.subjectNames.some(name => normalizeName(name) === names[0])) return unresolved("subject_match_unresolved");
    if (!lines.some(({ text }) => /^(?:Employer|Employer Name|Company): .+$/i.test(text))) return unresolved("issuer_unresolved");
    const values = new Map<Field, Set<string>>(), evidence: Evidence[] = [];
    const add = (field: Field, value: string, sourceLine: typeof lines[number]) => {
      const found = values.get(field) ?? new Set<string>(); found.add(value); values.set(field, found);
      if (sourceLine.text.length <= 180) evidence.push({ field, page: sourceLine.page, line: sourceLine.line, sourceText: sourceLine.text });
    };
    const declaredCurrencies = lines.flatMap(({ text }) => {
      const documentCurrency = text.match(/^Currency: (.*)$/i)?.[1];
      const grossCurrency = text.match(/^Gross (?:Pay|Earnings|Income)(?: \(([A-Za-z]{3})\))?: (?:([A-Za-z]{3}) )?/i);
      return [documentCurrency, grossCurrency?.[1], grossCurrency?.[2]].filter((value): value is string => value !== undefined).map(value => value.toUpperCase());
    });
    if (declaredCurrencies.some(value => value !== "USD")) return unresolved("currency_unresolved");
    const currencyUsd = lines.some(({ text }) => /^Currency: USD$/i.test(text));
    for (const line of lines) {
      const gross = line.text.match(/^Gross (?:Pay|Earnings|Income)( \(USD\))?: (USD )?\$?((?:0|[1-9]\d{0,10}|[1-9]\d{0,2}(?:,\d{3}){1,3}))(?:\.(\d{2}))?$/i);
      if (gross && (gross[1] || gross[2] || currencyUsd)) {
        const cents = Number(gross[3].replaceAll(",", "")) * 100 + Number(gross[4] ?? "0");
        if (Number.isSafeInteger(cents) && cents <= 1_000_000_000_000) add("grossCents", String(cents), line);
      }
      for (const [field, label] of [["periodStart", "(?:Pay )?Period Start"], ["periodEnd", "(?:Pay )?Period End"], ["issuedOn", "(?:Issue|Pay) Date"]] as const) {
        const value = line.text.match(new RegExp(`^${label}: (\\d{4}-\\d{2}-\\d{2})$`, "i"))?.[1];
        if (value && validDate(value)) add(field, value, line);
      }
      const frequency = line.text.match(/^Pay Frequency: (weekly|biweekly|twice monthly|semi-monthly|monthly|yearly|annually)$/i)?.[1]?.toLowerCase();
      if (frequency) add("payFrequency", ({ "twice monthly": "twice_monthly", "semi-monthly": "twice_monthly", annually: "yearly" } as Record<string, string>)[frequency] ?? frequency, line);
    }
    for (const field of ["grossCents", "periodStart", "periodEnd", "issuedOn"] as const)
      if (values.get(field)?.size !== 1) return unresolved(`${field}_unresolved`);
    if ((values.get("payFrequency")?.size ?? 0) > 1) return unresolved("payFrequency_unresolved");
    const get = (field: Field) => [...(values.get(field) ?? [])][0];
    const proofKind = [...kinds][0], periodStart = get("periodStart"), periodEnd = get("periodEnd"), issuedOn = get("issuedOn");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    if (periodStart > periodEnd || periodEnd > issuedOn || issuedOn > today) return unresolved("source_dates_conflict");
    if (proofKind === "employer_letter" && !get("payFrequency")) return unresolved("payFrequency_unresolved");
    // shortcut: only explicit, unambiguous labeled employment fields; extend from measured real layouts, never guesses.
    const projection = utilityIncomeProofProjectionSchema.parse({ version: UTILITY_INCOME_PROOF_VERSION,
      programId: context.programId, subjectId: context.subjectId, sourceId: context.sourceId, proofKind, originalSha256,
      currency: "USD", grossCents: Number(get("grossCents")), periodStart, periodEnd, issuedOn,
      payFrequency: get("payFrequency") ?? null, subjectMatch: "printed_name_matches_authorized_target", sourceEvidence: evidence });
    return { status: "source_fields_checked", projection, authenticity: "not_established", proofComplete: false };
  } catch { return unresolved("source_validation_unavailable"); }
  finally { sourceBytes?.fill(0); }
}
