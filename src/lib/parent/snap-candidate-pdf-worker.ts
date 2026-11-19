import { z } from "zod";
import { MAX_SNAP_PACKET_BYTES } from "./snap-packet-contract";
import { SNAP_PERSONAL_PAGE_MAP as map } from "./snap-personal-pages";

const bytes = z.instanceof(Uint8Array).refine(value => value.length > 0 && value.length <= MAX_SNAP_PACKET_BYTES);
const inputSchema = z.object({ preparation: bytes, pages: z.array(z.object({ pdfPage: z.union([z.literal(3), z.literal(7)]), bytes }).strict()).length(2) }).strict();
const wipe = (value?: Uint8Array) => { if (value?.byteLength) value.fill(0); };

async function assemble(input: unknown): Promise<Uint8Array<ArrayBuffer>> {
  const value = inputSchema.parse(input), required = map.requiredFullPages.map(page => page.pdfPage);
  if (new Set(value.pages.map(page => page.pdfPage)).size !== required.length || required.some(page => !value.pages.some(capture => capture.pdfPage === page))) throw new Error();
  const { PDFDocument, PDFName, PDFNumber } = await import("pdf-lib");
  const document = await PDFDocument.load(value.preparation, { updateMetadata: false, throwOnInvalidObject: true, capNumbers: true });
  if (document.isEncrypted || document.getPageCount() !== map.pageCount || document.catalog.has(PDFName.of("AcroForm"))
    || !document.getKeywords()?.split(/\s+/).includes("unsigned_nonprotected_official_signing_copy")
    || !document.getKeywords()?.split(/\s+/).includes(map.source.templateId)) throw new Error();
  for (const page of document.getPages()) {
    const unit = page.node.get(PDFName.of("UserUnit"));
    if (page.getRotation().angle !== 0 || page.node.Annots()?.size() || (unit && (!(unit instanceof PDFNumber) || unit.asNumber() !== 1))) throw new Error();
    for (const box of [page.getMediaBox(), page.getCropBox(), page.getBleedBox(), page.getTrimBox(), page.getArtBox()])
      if (box.x !== 0 || box.y !== 0 || box.width !== map.width || box.height !== map.height) throw new Error();
  }
  for (const sourcePage of required) {
    const embedded = await document.embedPng(value.pages.find(page => page.pdfPage === sourcePage)!.bytes);
    document.removePage(sourcePage - 1); const replacement = document.insertPage(sourcePage - 1, [map.width, map.height]);
    const scale = Math.min(map.width / embedded.width, map.height / embedded.height), width = embedded.width * scale, height = embedded.height * scale;
    replacement.drawImage(embedded, { x: (map.width - width) / 2, y: (map.height - height) / 2, width, height });
  }
  document.setTitle("CaseLink SNAP application candidate");
  document.setSubject("Current preparation and captured full personal pages for protected review.");
  document.setKeywords([map.version, "requires_private_content_verification"]);
  document.setAuthor("CaseLink"); document.setCreator("CaseLink"); document.setProducer("CaseLink");
  const output = Uint8Array.from(await document.save());
  if (!output.length || output.length > MAX_SNAP_PACKET_BYTES) { wipe(output); throw new Error(); }
  return output;
}

const scope = globalThis as typeof globalThis & {
  postMessage?: (message: unknown, transfer: Transferable[]) => void;
  onmessage?: ((event: MessageEvent<unknown>) => void) | null;
  close?: () => void;
};
if (typeof window === "undefined" && typeof scope.postMessage === "function") {
  // This fresh worker contains no other task; parser diagnostics must never reach the parent's console.
  let diagnostic = false;
  for (const name of ["log", "warn", "error", "info", "debug"] as const) console[name] = () => { diagnostic = true; };
  scope.onmessage = async event => {
    scope.onmessage = null;
    let output: Uint8Array<ArrayBuffer> | undefined;
    const input = inputSchema.safeParse(event.data);
    try {
      if (!input.success) throw new Error();
      output = await assemble(input.data);
      if (diagnostic) throw new Error();
      scope.postMessage!({ ok: true, bytes: output }, [output.buffer]);
    } catch { scope.postMessage!({ ok: false }, []); }
    finally {
      wipe(output);
      if (input.success) { wipe(input.data.preparation); for (const page of input.data.pages) wipe(page.bytes); }
      scope.close?.();
    }
  };
}
