import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { z } from "zod";
import { createSinchFaxEmulator, sinchFaxEmulationOperationSchema, type SinchFaxEmulationEvidence } from "../src/lib/parent/sinch-fax";

export const SINCH_PROBE_ERROR = "The emulator probe could not verify this run. Reuse the same attempt directory; private details were not logged.";
const pages = 12;
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const intentSchema = z.object({
  kind: z.literal("sinch_fax_emulation_intent"), source: z.literal("public_synthetic_v1"),
  byteLength: z.number().int().positive(), operation: sinchFaxEmulationOperationSchema,
}).strict();
const summary = (state: SinchFaxEmulationEvidence["state"]) => ({ kind: "sinch_fax_emulation_probe" as const, state });

function privateFile(path: string, maximum: number) {
  const file = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(file);
    if (!info.isFile() || (info.mode & 0o7777) !== 0o600 || info.uid !== process.getuid?.() || info.size > maximum) throw new Error(SINCH_PROBE_ERROR);
    const bytes = Buffer.alloc(maximum + 1);
    let size = 0;
    while (size < bytes.length) {
      const read = readSync(file, bytes, size, bytes.length - size, null);
      if (!read) break;
      size += read;
    }
    if (size > maximum) throw new Error(SINCH_PROBE_ERROR);
    return bytes.subarray(0, size);
  } finally { closeSync(file); }
}
function syncDirectory(path: string) {
  const directory = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(directory); } finally { closeSync(directory); }
}
function durableFile(path: string, bytes: Uint8Array | string) {
  const file = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(file, bytes); fsyncSync(file); } finally { closeSync(file); }
  syncDirectory(dirname(path));
}

/** Fixed public text only; the probe accepts no document path, application answers or family data. */
export async function publicSyntheticFaxPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.setCreationDate(new Date("2026-11-04T00:00:00Z"));
  pdf.setModificationDate(new Date("2026-11-04T00:00:00Z"));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let page = 1; page <= pages; page++) pdf.addPage([612, 792]).drawText(
    `PUBLIC SYNTHETIC FAX TEST\n\nPage ${page} of ${pages}\n\nEmulator transport check only.\nNo applicant, household, signature or government filing.`,
    { font, size: 14, x: 48, y: 720, lineHeight: 24 },
  );
  return pdf.save();
}

/** One explicit directory is one attempt forever: any later run may only reconcile it. */
export async function runSinchFaxEmulatorProbe(configPath: string, attemptDirectory: string, fetcher: typeof fetch = fetch) {
  try {
    if (!isAbsolute(configPath) || !isAbsolute(attemptDirectory)) throw new Error(SINCH_PROBE_ERROR);
    const config = JSON.parse(privateFile(configPath, 16_384).toString("utf8")) as Parameters<typeof createSinchFaxEmulator>[0];
    const client = createSinchFaxEmulator({ ...config, fetcher });
    const source = await publicSyntheticFaxPdf(), contentSha256 = digest(source);
    let fresh = false;
    try { mkdirSync(attemptDirectory, { mode: 0o700 }); fresh = true; syncDirectory(dirname(attemptDirectory)); }
    catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error; }
    try {
      const info = lstatSync(attemptDirectory);
      if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o7777) !== 0o700 || info.uid !== process.getuid?.()) throw new Error(SINCH_PROBE_ERROR);
      let evidence: SinchFaxEmulationEvidence;
      if (fresh) {
        durableFile(join(attemptDirectory, "source.pdf"), source);
        evidence = await client.sendSyntheticTest({ bytes: source, contentSha256, pageCount: pages, idempotencyKey: randomUUID() }, undefined,
          async operation => {
            durableFile(join(attemptDirectory, "intent.json"), JSON.stringify({
              kind: "sinch_fax_emulation_intent", source: "public_synthetic_v1", byteLength: source.length, operation,
            }));
          });
      } else {
        const intent = intentSchema.parse(JSON.parse(privateFile(join(attemptDirectory, "intent.json"), 16_384).toString("utf8")));
        const original = privateFile(join(attemptDirectory, "source.pdf"), 1_000_000);
        if (intent.byteLength !== original.length || intent.operation.contentSha256 !== digest(original)
          || intent.operation.contentSha256 !== contentSha256 || intent.operation.pageCount !== pages) throw new Error(SINCH_PROBE_ERROR);
        const attemptedAt = Date.parse(intent.operation.attemptedAt);
        evidence = await client.reconcile(intent.operation, {
          fromTime: new Date(attemptedAt - 60_000).toISOString(), toTime: new Date(attemptedAt + 60_000).toISOString(),
        });
      }
      durableFile(join(attemptDirectory, `observation-${randomUUID()}.json`), JSON.stringify({ observedAt: new Date().toISOString(), evidence }));
      return summary(evidence.state);
    } catch { return summary("unknown"); }
  } catch { throw new Error(SINCH_PROBE_ERROR); }
}

async function main() {
  if (process.argv.length !== 4) throw new Error(SINCH_PROBE_ERROR);
  const result = await runSinchFaxEmulatorProbe(process.argv[2], process.argv[3]);
  process.stdout.write(`Sinch emulator test: ${result.state}. Emulation only; no government filing.\n`);
  if (result.state === "unknown") process.exitCode = 2;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  void main().catch(() => { process.stderr.write(`${SINCH_PROBE_ERROR}\n`); process.exitCode = 1; });
