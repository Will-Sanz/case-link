import { z } from "zod";
import { MAX_SNAP_PACKET_BYTES } from "./snap-packet-contract";
import { snapCaptureContextSchema, type SnapCaptureContext } from "./snap-capture-context";
import { SNAP_PERSONAL_PAGE_MAP as map } from "./snap-personal-pages";

export const SNAP_CANDIDATE_ASSEMBLY_ERROR = "The application candidate could not be assembled. Check the full-page captures and current application.";
const maxPixels = 20_000_000, maxDimension = 8192;
const inputSchema = z.object({
  context: snapCaptureContextSchema,
  expectedVersion: z.number().int().positive().max(2147483647), expectedSnapshotId: z.uuid().transform(value => value.toLowerCase()),
  preparationBytes: z.instanceof(Uint8Array).refine(value => value.length > 0 && value.length <= MAX_SNAP_PACKET_BYTES),
  pages: z.array(z.object({ pdfPage: z.union([z.literal(3), z.literal(7)]), image: z.instanceof(Blob) }).strict()).length(2),
}).strict();
export type SnapCandidateAssemblyInput = z.input<typeof inputSchema>;
export type SnapApplicationCandidate = {
  bytes: Uint8Array; contentSha256: string; byteLength: number; context: SnapCaptureContext;
  pageCount: 12; replacedPdfPages: [3, 7]; verification: "requires_private_content_verification";
};

function dimensions(bytes: Uint8Array, type: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (type === "image/png" && bytes.length >= 33 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
    && view.getUint32(8) === 13 && view.getUint32(12) === 0x49484452) return [view.getUint32(16), view.getUint32(20)];
  if (type === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) throw new Error();
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 218 || marker === 217) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) throw new Error();
      if ([192, 193, 194].includes(marker) && length >= 8) return [view.getUint16(offset + 5), view.getUint16(offset + 3)];
      offset += length;
    }
  }
  throw new Error();
}
function boundedDimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width > maxDimension || height > maxDimension || width * height > maxPixels) throw new Error();
}
function stopped(signal?: AbortSignal) { if (signal?.aborted) throw new Error(); }
function browserResult<T>(promise: Promise<T>, signal?: AbortSignal, discard?: (value: T) => void): Promise<T> {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    let finished = false;
    const abort = () => { if (!finished) { finished = true; signal.removeEventListener("abort", abort); reject(new Error()); } };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    promise.then(value => {
      signal.removeEventListener("abort", abort);
      if (finished) { try { discard?.(value); } catch {} } else { finished = true; resolve(value); }
    }, () => { signal.removeEventListener("abort", abort); if (!finished) { finished = true; reject(new Error()); } });
  });
}

/** Repaint every pixel: source EXIF/GPS, filenames and ancillary image metadata are never embedded. */
async function pageImage(image: Blob, signal?: AbortSignal): Promise<Uint8Array> {
  if (!["image/png", "image/jpeg"].includes(image.type) || image.size < 1 || image.size > MAX_SNAP_PACKET_BYTES) throw new Error();
  let input: Uint8Array<ArrayBuffer> | undefined, bitmap: ImageBitmap | undefined;
  let canvas: OffscreenCanvas | HTMLCanvasElement | undefined;
  try {
    input = new Uint8Array(await browserResult(image.arrayBuffer(), signal, value => new Uint8Array(value).fill(0))); stopped(signal);
    const [width, height] = dimensions(input, image.type); boundedDimensions(width, height);
    bitmap = await browserResult(createImageBitmap(new Blob([input], { type: image.type }), { imageOrientation: "from-image" }), signal, value => value.close()); stopped(signal);
    boundedDimensions(bitmap.width, bitmap.height);
    if (!((bitmap.width === width && bitmap.height === height) || (bitmap.width === height && bitmap.height === width))) throw new Error();
    const offscreen = typeof OffscreenCanvas === "function";
    canvas = offscreen ? new OffscreenCanvas(bitmap.width, bitmap.height) : document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { alpha: false }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!context) throw new Error();
    context.fillStyle = "white"; context.fillRect(0, 0, bitmap.width, bitmap.height);
    context.drawImage(bitmap, 0, 0);
    const output = await browserResult(offscreen
      ? (canvas as OffscreenCanvas).convertToBlob({ type: "image/png" })
      : new Promise<Blob>((resolve, reject) => (canvas as HTMLCanvasElement).toBlob(value => value ? resolve(value) : reject(new Error()), "image/png")), signal);
    stopped(signal);
    if (output.type !== "image/png" || output.size < 1 || output.size > MAX_SNAP_PACKET_BYTES) throw new Error();
    const bytes = new Uint8Array(await browserResult(output.arrayBuffer(), signal, value => new Uint8Array(value).fill(0)));
    if (signal?.aborted) { bytes.fill(0); throw new Error(); }
    return bytes;
  } finally {
    input?.fill(0); bitmap?.close();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}

function assemblePdf(preparation: Uint8Array, pages: { pdfPage: 3 | 7; bytes: Uint8Array }[], signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  stopped(signal);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./snap-candidate-pdf-worker.ts", import.meta.url), { type: "module" });
    let finished = false;
    const finish = (bytes?: Uint8Array<ArrayBuffer>) => {
      if (finished) return; finished = true; clearTimeout(timer); signal?.removeEventListener("abort", abort);
      worker.onmessage = null; worker.onerror = null; worker.terminate();
      if (bytes) resolve(bytes); else reject(new Error());
    };
    const abort = () => finish();
    const timer = setTimeout(abort, 10000);
    signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = event => { event.preventDefault(); finish(); };
    worker.onmessage = event => {
      const value = z.object({ ok: z.literal(true), bytes: z.instanceof(Uint8Array).refine(bytes => bytes.length > 0 && bytes.length <= MAX_SNAP_PACKET_BYTES) }).strict().safeParse(event.data);
      try { finish(!finished && value.success ? Uint8Array.from(value.data.bytes) : undefined); }
      finally { if (event.data?.bytes instanceof Uint8Array && event.data.bytes.byteLength) event.data.bytes.fill(0); }
    };
    if (signal?.aborted) { finish(); return; }
    // Structured cloning keeps caller-owned buffers attached; only the worker's result is transferred back.
    try { worker.postMessage({ preparation, pages }); } catch { finish(); }
  });
}

/** Private-browser assembly only. The isolated server must independently validate current facts and personal pages. */
export async function assembleSnapApplicationCandidate(input: unknown, options: { signal?: AbortSignal } = {}): Promise<SnapApplicationCandidate> {
  let preparation: Uint8Array | undefined, output: Uint8Array<ArrayBuffer> | undefined;
  const images: Uint8Array[] = [];
  try {
    stopped(options.signal);
    const value = inputSchema.parse(input), pages = map.requiredFullPages.map(page => page.pdfPage);
    if (value.context.requestVersion !== value.expectedVersion || value.context.snapshotId !== value.expectedSnapshotId
      || new Set(value.pages.map(page => page.pdfPage)).size !== pages.length || pages.some(page => !value.pages.some(capture => capture.pdfPage === page))) throw new Error();
    preparation = Uint8Array.from(value.preparationBytes);
    const normalized: { pdfPage: 3 | 7; bytes: Uint8Array }[] = [];
    for (const page of pages) {
      const bytes = await pageImage(value.pages.find(capture => capture.pdfPage === page)!.image, options.signal); images.push(bytes);
      normalized.push({ pdfPage: page, bytes });
    }
    output = await assemblePdf(preparation, normalized, options.signal); stopped(options.signal);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", output)); stopped(options.signal);
    const contentSha256 = [...digest].map(value => value.toString(16).padStart(2, "0")).join("");
    return { bytes: output, contentSha256, byteLength: output.length, context: value.context,
      pageCount: 12, replacedPdfPages: [3, 7], verification: "requires_private_content_verification" };
  } catch { output?.fill(0); throw new Error(SNAP_CANDIDATE_ASSEMBLY_ERROR); }
  finally { preparation?.fill(0); for (const bytes of images) bytes.fill(0); }
}
