import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { finished } from "node:stream/promises";
import { Worker } from "node:worker_threads";
import { z } from "zod";
import source from "../../../data/verified-forms/snap-pa600fs-2019.json";

const sourceSchema = z.object({
  templateId: z.literal(source.id), templateVersion: z.literal(source.version), templateSha256: z.literal(source.sha256),
}).strict();
const inputSchema = z.object({
  bytes: z.instanceof(Uint8Array).refine(bytes => bytes.length > 0 && bytes.length <= 10 * 1024 * 1024),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/), byteLength: z.number().int().min(1).max(10 * 1024 * 1024), source: sourceSchema,
}).strict();
const reasonSchema = z.enum(["binding_mismatch", "unreadable_pdf", "unsupported_content", "unsupported_page_layout", "complexity_limit", "inspection_interrupted"]);
export type SnapFinalPdfReason = z.infer<typeof reasonSchema>;
export type SnapFinalPdfStructure = {
  ok: true; scope: "structure_only"; contentSha256: string; byteLength: number; source: z.infer<typeof sourceSchema>;
  pageCount: number; pageWidth: number; pageHeight: number; rotation: 0; userUnit: 1; staticContentChecked: true;
} | { ok: false; reason: SnapFinalPdfReason };

/** Static paper-copy structure only: no answer, handwriting, personal-act or filing verification. */
export async function inspectSnapFinalPdf(input: unknown, options: { deadline: Date; signal?: AbortSignal }): Promise<SnapFinalPdfStructure> {
  let bytes: Uint8Array | undefined;
  try {
    const remaining = options.deadline instanceof Date ? options.deadline.getTime() - Date.now() : NaN;
    if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 30_000 || options.signal?.aborted)
      return { ok: false, reason: "inspection_interrupted" };
    const checked = inputSchema.safeParse(input);
    if (!checked.success) return { ok: false, reason: "binding_mismatch" };
    const value = checked.data;
    bytes = Uint8Array.from(value.bytes);
    if (bytes.length !== value.byteLength || createHash("sha256").update(bytes).digest("hex") !== value.contentSha256)
      return { ok: false, reason: "binding_mismatch" };
    if (!/^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(Buffer.from(bytes.subarray(0, 10)).toString("ascii")) ||
      !/%%EOF[\t\r\n ]*$/.test(Buffer.from(bytes.subarray(-64)).toString("ascii"))) return { ok: false, reason: "unreadable_pdf" };
    // Parser warnings can contain document values; only fixed result codes cross this worker boundary.
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      const { PDFDocument, PDFDict, PDFArray, PDFStream, PDFName, PDFRef, PDFNumber } = require(workerData.modulePath);
      const fail = reason => { throw reason; };
      (async () => {
        try {
          const pdf = await PDFDocument.load(workerData.bytes, { updateMetadata: false, throwOnInvalidObject: true, capNumbers: true });
          if (pdf.isEncrypted) fail('unreadable_pdf');
          if (pdf.getPageCount() !== workerData.pages) fail('unsupported_page_layout');
          const objects = pdf.context.enumerateIndirectObjects();
          if (objects.length > 20000) fail('complexity_limit');
          const forbidden = new Set(['AcroForm','FT','ByteRange','DocMDP','Perms','AA','OpenAction','JavaScript','JS','Launch',
            'EmbeddedFile','EmbeddedFiles','EF','AF','RichMedia','XFA','OCProperties','OC','Collection','NeedsRendering',
            'GoTo','GoToR','GoToE','URI','Named','ResetForm','Hide','SetOCGState','Thread','Trans','SubmitForm','ImportData','Rendition','Movie','Sound','3D','PS','Crypt']);
          let count = 0; const seen = new Set();
          const inspect = (object, depth = 0) => {
            if (++count > 200000 || depth > 100) fail('complexity_limit');
            if (object instanceof PDFRef) { if (!pdf.context.lookup(object)) fail('unreadable_pdf'); return; }
            if (object instanceof PDFName) { if (forbidden.has(object.decodeText())) fail('unsupported_content'); return; }
            if (seen.has(object)) return; seen.add(object);
            if (object instanceof PDFStream) inspect(object.dict, depth + 1);
            else if (object instanceof PDFArray) object.asArray().forEach(value => inspect(value, depth + 1));
            else if (object instanceof PDFDict) for (const [key,value] of object.entries()) {
              const name = key.decodeText(), resolved = pdf.context.lookup(value);
              if (forbidden.has(name) || ['F','FFilter','FDecodeParms'].includes(name)) fail('unsupported_content');
              if (name === 'Type' && resolved instanceof PDFName && ['Action','Annot','Filespec','Sig','OCG','OCMD'].includes(resolved.decodeText())) fail('unsupported_content');
              if (name === 'A' && resolved instanceof PDFDict && resolved.has(PDFName.of('S'))) fail('unsupported_content');
              if (name === 'Subtype' && resolved instanceof PDFName && resolved.decodeText() === 'Widget') fail('unsupported_content');
              if (name === 'Annots' && (!(resolved instanceof PDFArray) || resolved.size())) fail('unsupported_content');
              if (name === 'UserUnit' && (!(resolved instanceof PDFNumber) || resolved.asNumber() !== 1)) fail('unsupported_page_layout');
              inspect(value, depth + 1);
            }
          };
          inspect(pdf.catalog);
          for (const value of Object.values(pdf.context.trailerInfo)) if (value) inspect(value);
          for (const [,object] of objects) inspect(object);
          for (const page of pdf.getPages()) {
            if (page.getRotation().angle !== 0) fail('unsupported_page_layout');
            for (const box of [page.getMediaBox(),page.getCropBox(),page.getBleedBox(),page.getTrimBox(),page.getArtBox()])
              if (box.x !== 0 || box.y !== 0 || box.width !== workerData.width || box.height !== workerData.height) fail('unsupported_page_layout');
          }
          parentPort.postMessage({ok:true});
        } catch (reason) {
          parentPort.postMessage({ok:false,reason:typeof reason === 'string' ? reason : 'unreadable_pdf'});
        }
      })();
    `, { eval: true, workerData: { bytes, modulePath: createRequire(import.meta.url).resolve("pdf-lib"), pages: source.pageCount, width: source.pageWidth, height: source.pageHeight },
      stdout: true, stderr: true, env: {}, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 } });
    let result: unknown, messages = 0, diagnostic = false, interrupted = false;
    worker.stdout.on("data", () => { diagnostic = true; }); worker.stderr.on("data", () => { diagnostic = true; });
    worker.on("message", value => { result = value; messages++; }); worker.on("error", () => { interrupted = true; });
    const exited = new Promise<number>(resolve => { worker.once("exit", resolve); });
    const stop = () => { interrupted = true; void worker.terminate(); };
    options.signal?.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(stop, Math.min(5000, Math.max(0, options.deadline.getTime() - Date.now())));
    try {
      const [code] = await Promise.all([exited, finished(worker.stdout), finished(worker.stderr)]);
      if (interrupted || options.signal?.aborted || Date.now() >= options.deadline.getTime()) return { ok: false, reason: "inspection_interrupted" };
      if (code !== 0 || diagnostic || messages !== 1) return { ok: false, reason: "unreadable_pdf" };
      const reply = z.union([z.object({ ok: z.literal(true) }).strict(), z.object({ ok: z.literal(false), reason: reasonSchema }).strict()]).safeParse(result);
      if (!reply.success) return { ok: false, reason: "unreadable_pdf" };
      if (!reply.data.ok) return reply.data;
      return { ok: true, scope: "structure_only", contentSha256: value.contentSha256, byteLength: value.byteLength, source: value.source,
        pageCount: source.pageCount, pageWidth: source.pageWidth, pageHeight: source.pageHeight, rotation: 0, userUnit: 1, staticContentChecked: true };
    } finally {
      clearTimeout(timer); options.signal?.removeEventListener("abort", stop); void worker.terminate();
    }
  } catch { return { ok: false, reason: "unreadable_pdf" }; }
  finally { bytes?.fill(0); }
}
