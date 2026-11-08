import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker as NodeWorker } from "node:worker_threads";
import { buildSync } from "esbuild";
import { PDFDocument, PDFName, PDFNumber, degrees } from "pdf-lib";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assembleSnapApplicationCandidate, SNAP_CANDIDATE_ASSEMBLY_ERROR } from "./snap-candidate-assembly";
import { SNAP_PERSONAL_PAGE_MAP as map } from "./snap-personal-pages";
import { renderSnapSigningCopy } from "./snap-signing-copy";
import { fixtureSnapApplication } from "./test-fixtures";

const template = readFileSync("data/verified-forms/snap-pa600fs-2019.pdf");
const prepared = await renderSnapSigningCopy(template, fixtureSnapApplication(new Date("2026-11-04T21:00:00Z")), new Date("2026-11-04T21:00:00Z"));
if (!prepared.bytes) throw new Error("The synthetic nonprotected signing copy must render.");
const preparation = prepared.bytes;
const rgb = Buffer.alloc(34 * 44 * 3, 255);
for (const [x, y, color] of [[0, 0, [255, 0, 0]], [33, 0, [0, 255, 0]], [0, 43, [0, 0, 255]], [33, 43, [0, 0, 0]]] as const)
  rgb.set(color, (y * 34 + x) * 3);
const png = await sharp(rgb, { raw: { width: 34, height: 44, channels: 3 } }).png().toBuffer();
const canary = "SYNTHETIC_PRIVATE_GPS_EXIF_CANARY";
const jpeg = await sharp(rgb, { raw: { width: 34, height: 44, channels: 3 } }).jpeg().withExif({ IFD0: { ImageDescription: canary } }).toBuffer();
const blob = (bytes: Uint8Array, type = "image/png") => new Blob([Uint8Array.from(bytes)], { type });
const context = { requestVersion: 2, snapshotId: "22222222-2222-4222-8222-222222222222", snapshotHash: "a".repeat(64), source: map.source,
  applyingSubjectIds: ["11111111-1111-4111-8111-111111111111"] };
const input = () => ({ context: structuredClone(context), expectedVersion: 2, expectedSnapshotId: context.snapshotId,
  preparationBytes: Uint8Array.from(preparation), pages: [{ pdfPage: 3, image: blob(png) }, { pdfPage: 7, image: blob(png) }] });
const canvases: FixtureCanvas[] = [], closes: ReturnType<typeof vi.fn>[] = [];
const workerCode = buildSync({ entryPoints: ["src/lib/parent/snap-candidate-pdf-worker.ts"], bundle: true, platform: "browser", format: "iife", write: false }).outputFiles[0].text;
const pdfWorkers: FixturePdfWorker[] = [];
class FixturePdfWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  thread: NodeWorker; logs = ""; closed: Promise<void>; terminated = false;
  constructor() {
    // Exercise the real bundled worker in a credential-free native thread; only its transport is adapted.
    this.thread = new NodeWorker(`const {parentPort}=require('node:worker_threads');globalThis.postMessage=(value,transfer)=>parentPort.postMessage(value,transfer);globalThis.close=()=>parentPort.close();${workerCode};parentPort.on('message',data=>globalThis.onmessage?.({data}));`, { eval: true, stdout: true, stderr: true, env: {} });
    this.closed = new Promise(resolve => this.thread.once("exit", () => resolve())); pdfWorkers.push(this);
    this.thread.stdout.on("data", value => { this.logs += value.toString(); }); this.thread.stderr.on("data", value => { this.logs += value.toString(); });
    this.thread.on("message", data => this.onmessage?.({ data } as MessageEvent));
    this.thread.on("error", () => this.onerror?.({ preventDefault() {} } as ErrorEvent));
  }
  postMessage(value: unknown) { this.thread.postMessage(value); }
  terminate() { this.terminated = true; void this.thread.terminate(); }
}
class FixtureCanvas {
  width: number; height: number;
  context = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
  constructor(width: number, height: number) { this.width = width; this.height = height; canvases.push(this); }
  getContext() { return this.context; }
  async convertToBlob() { return blob(png); }
  toBlob(callback: (value: Blob) => void) { callback(blob(png)); }
}
function bitmap() { const close = vi.fn(); closes.push(close); return { width: 34, height: 44, close }; }
beforeEach(() => {
  canvases.length = 0; closes.length = 0; pdfWorkers.length = 0;
  // Canvas fixtures test the integration seam. Real browser EXIF/pixel proof is a separate gate.
  vi.stubGlobal("OffscreenCanvas", FixtureCanvas); vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap()));
  vi.stubGlobal("Worker", FixturePdfWorker);
});
afterEach(async () => { for (const worker of pdfWorkers) worker.terminate(); await Promise.all(pdfWorkers.map(worker => worker.closed)); expect(pdfWorkers.every(worker => !worker.logs)).toBe(true); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("full-page SNAP candidate assembly", () => {
  it("uses only the pinned current source-page map, without claiming conditional readiness", () => {
    expect(map.source).toEqual(context.source); expect(map.requiredFullPages.map(page => [page.pdfPage, page.printedPage])).toEqual([[3, 1], [7, 5]]);
    expect(map).not.toHaveProperty("submissionReady"); expect(map).not.toHaveProperty("witnessRequired");
  });
  it("replaces two whole pages and preserves all other actual PDF page objects/resources", async () => {
    const value = input(), before = Uint8Array.from(value.preparationBytes), result = await assembleSnapApplicationCandidate(value), original = await PDFDocument.load(preparation), candidate = await PDFDocument.load(result.bytes);
    expect(value.preparationBytes).toEqual(before);
    expect(result.contentSha256).toBe(createHash("sha256").update(result.bytes).digest("hex")); expect(result.byteLength).toBe(result.bytes.length);
    expect(result).toMatchObject({ context, pageCount: 12, replacedPdfPages: [3, 7], verification: "requires_private_content_verification" });
    expect(candidate.getPageCount()).toBe(12); expect(candidate.getTitle()).toBe("CaseLink SNAP application candidate");
    expect(candidate.getSubject()).not.toMatch(/unsigned|complete|filed|submission.ready/i);
    for (let index = 0; index < 12; index++) {
      expect(candidate.getPage(index).getSize()).toEqual({ width: 612, height: 792 });
      if ([2, 6].includes(index)) expect(candidate.getPage(index).node.toString()).not.toBe(original.getPage(index).node.toString());
      else expect(candidate.getPage(index).node.toString()).toBe(original.getPage(index).node.toString());
    }
    expect(canvases).toHaveLength(2); expect(canvases.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true);
    expect(closes.every(close => close.mock.calls.length === 1)).toBe(true);
    for (const canvas of canvases) { expect(canvas.context.fillRect).toHaveBeenCalledWith(0, 0, 34, 44); expect(canvas.context.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0); }
  });
  it("embeds the pixel-reencoded canvas result rather than original EXIF bytes (fixture seam)", async () => {
    expect(jpeg.includes(Buffer.from(canary))).toBe(true);
    const value = input(); value.pages[0].image = blob(jpeg, "image/jpeg");
    const result = await assembleSnapApplicationCandidate(value);
    expect(Buffer.from(result.bytes).includes(Buffer.from(canary))).toBe(false);
    expect(createImageBitmap).toHaveBeenCalledWith(expect.any(Blob), { imageOrientation: "from-image" });
    expect(canvases[0].context.drawImage).toHaveBeenCalled();
  });
  it("uses a detached native HTML canvas when OffscreenCanvas is unavailable", async () => {
    vi.stubGlobal("OffscreenCanvas", undefined); vi.stubGlobal("document", { createElement: vi.fn(() => new FixtureCanvas(0, 0)) });
    expect((await assembleSnapApplicationCandidate(input())).pageCount).toBe(12); expect(document.createElement).toHaveBeenCalledWith("canvas");
  });
  it.each(["source", "version", "snapshot", "duplicate", "missing", "extra", "wrong_page", "unexpected"])("rejects invalid %s before image decoding", async kind => {
    const value: Record<string, unknown> = input();
    if (kind === "source") value.context = { ...context, source: { ...context.source, templateSha256: "f".repeat(64) } };
    if (kind === "version") value.expectedVersion = 3;
    if (kind === "snapshot") value.expectedSnapshotId = context.applyingSubjectIds[0];
    if (kind === "duplicate") value.pages = [input().pages[0], input().pages[0]];
    if (kind === "missing") value.pages = [input().pages[0]];
    if (kind === "extra") value.pages = [...input().pages, input().pages[0]];
    if (kind === "wrong_page") value.pages = [{ ...input().pages[0], pdfPage: 1 }, input().pages[1]];
    if (kind === "unexpected") value.signature = canary;
    await expect(assembleSnapApplicationCandidate(value)).rejects.toThrow(SNAP_CANDIDATE_ASSEMBLY_ERROR); expect(createImageBitmap).not.toHaveBeenCalled();
  });
  it.each(["count", "geometry", "rotation", "unit", "form", "wrong_kind"])("rejects unsupported preparation %s", async kind => {
    const doc = await PDFDocument.load(preparation);
    if (kind === "count") doc.removePage(0);
    if (kind === "geometry") doc.getPage(0).setCropBox(0, 0, 600, 792);
    if (kind === "rotation") doc.getPage(0).setRotation(degrees(90));
    if (kind === "unit") doc.getPage(0).node.set(PDFName.of("UserUnit"), PDFNumber.of(2));
    if (kind === "form") doc.getForm().createTextField("unsupported");
    if (kind === "wrong_kind") doc.setKeywords(["different_preparation"]);
    await expect(assembleSnapApplicationCandidate({ ...input(), preparationBytes: await doc.save() })).rejects.toThrow(SNAP_CANDIDATE_ASSEMBLY_ERROR);
    expect(pdfWorkers).toHaveLength(1); expect(closes.every(close => close.mock.calls.length === 1)).toBe(true);
  });
  it.each(["mime", "empty", "large", "pixels", "corrupt"])("bounds %s image input before decode", async kind => {
    const value = input();
    if (kind === "mime") value.pages[0].image = blob(png, "image/svg+xml");
    if (kind === "empty") value.pages[0].image = blob(new Uint8Array());
    if (kind === "large") value.pages[0].image = blob(new Uint8Array(10485761));
    if (kind === "pixels") { const changed = Uint8Array.from(png); new DataView(changed.buffer).setUint32(16, 100000); value.pages[0].image = blob(changed); }
    if (kind === "corrupt") value.pages[0].image = blob(new Uint8Array([1, 2, 3]));
    await expect(assembleSnapApplicationCandidate(value)).rejects.toThrow(SNAP_CANDIDATE_ASSEMBLY_ERROR); expect(createImageBitmap).not.toHaveBeenCalled();
  });
  it.each([0, 10485761])("bounds a preparation of %s bytes before decode", async size => {
    await expect(assembleSnapApplicationCandidate({ ...input(), preparationBytes: new Uint8Array(size) })).rejects.toThrow(SNAP_CANDIDATE_ASSEMBLY_ERROR);
    expect(createImageBitmap).not.toHaveBeenCalled();
  });
  it("bounds the normalized image before embedding", async () => {
    vi.spyOn(FixtureCanvas.prototype, "convertToBlob").mockResolvedValueOnce(blob(new Uint8Array(10485761)));
    await expect(assembleSnapApplicationCandidate(input())).rejects.toThrow(SNAP_CANDIDATE_ASSEMBLY_ERROR); expect(closes[0]).toHaveBeenCalledOnce();
  });
  it("honors cancellation before reading any image", async () => {
    await expect(assembleSnapApplicationCandidate(input(), { signal: AbortSignal.abort() })).rejects.toThrow(SNAP_CANDIDATE_ASSEMBLY_ERROR);
    expect(createImageBitmap).not.toHaveBeenCalled();
  });
  it("copies preparation and scope before its first await", async () => {
    const value = input(), pending = assembleSnapApplicationCandidate(value);
    value.preparationBytes.fill(0); value.context.snapshotHash = "c".repeat(64); value.pages.reverse();
    const result = await pending; expect(result.context).toEqual(context); expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(12);
  });
  it("aborts a pending decoder promptly and closes its later bitmap without output", async () => {
    const controller = new AbortController(); let finish!: (value: ReturnType<typeof bitmap>) => void;
    vi.mocked(createImageBitmap).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = assembleSnapApplicationCandidate(input(), { signal: controller.signal });
    await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalled()); controller.abort();
    await expect(pending).rejects.toThrow(SNAP_CANDIDATE_ASSEMBLY_ERROR); const late = bitmap(); finish(late); await Promise.resolve(); expect(late.close).toHaveBeenCalledOnce();
  });
  it.each(["input", "normalized"])("aborts a delayed %s Blob read and wipes its late bytes", async kind => {
    const controller = new AbortController(); let finish!: (value: ArrayBuffer) => void, reading = false;
    class SlowBlob extends Blob { override arrayBuffer() { reading = true; return new Promise<ArrayBuffer>(resolve => { finish = resolve; }); } }
    const delayed = new SlowBlob([Uint8Array.from(png)], { type: "image/png" }), value = input();
    if (kind === "input") value.pages[0].image = delayed;
    else vi.spyOn(FixtureCanvas.prototype, "convertToBlob").mockResolvedValueOnce(delayed);
    const pending = assembleSnapApplicationCandidate(value, { signal: controller.signal });
    await vi.waitFor(() => expect(reading).toBe(true)); controller.abort(); await expect(pending).rejects.toThrow(SNAP_CANDIDATE_ASSEMBLY_ERROR);
    if (kind === "input") expect(createImageBitmap).not.toHaveBeenCalled();
    const late = Uint8Array.from(png); finish(late.buffer); await Promise.resolve(); expect(late.every(value => value === 0)).toBe(true);
  });
  it("contains native failures and never logs source bytes or private errors", async () => {
    const log = vi.spyOn(console, "log"), warn = vi.spyOn(console, "warn"), error = vi.spyOn(console, "error");
    vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error(canary));
    await expect(assembleSnapApplicationCandidate(input())).rejects.toThrow(SNAP_CANDIDATE_ASSEMBLY_ERROR);
    expect(log).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  });
  it("contains an actual pdf-lib numeric diagnostic inside its dedicated worker", async () => {
    const doc = await PDFDocument.load(preparation), secret = "987654321".repeat(80);
    doc.catalog.set(PDFName.of("Probe"), PDFNumber.of(1));
    const source = Buffer.from(await doc.save({ useObjectStreams: false })), changed = Buffer.from(source.toString("latin1").replace("/Probe 1", `/Probe ${secret}`), "latin1");
    const log = vi.spyOn(console, "log"), warn = vi.spyOn(console, "warn"), error = vi.spyOn(console, "error");
    const results = await Promise.allSettled([assembleSnapApplicationCandidate({ ...input(), preparationBytes: changed }), assembleSnapApplicationCandidate(input())]);
    expect(results.map(result => result.status)).toEqual(["rejected", "fulfilled"]);
    expect((results[0] as PromiseRejectedResult).reason.message).toBe(SNAP_CANDIDATE_ASSEMBLY_ERROR); expect(pdfWorkers).toHaveLength(2);
    await Promise.all(pdfWorkers.map(worker => worker.closed));
    expect(pdfWorkers.every(worker => !worker.logs.includes(secret))).toBe(true); expect(log).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  });
  it("terminates a stuck worker at its built-in deadline without a caller signal", async () => {
    vi.useFakeTimers(); let terminated = false;
    class StuckWorker { onmessage = null; onerror = null; postMessage() {} terminate() { terminated = true; } }
    vi.stubGlobal("Worker", StuckWorker);
    const pending = assembleSnapApplicationCandidate(input());
    const rejection = expect(pending).rejects.toThrow(SNAP_CANDIDATE_ASSEMBLY_ERROR);
    await vi.waitFor(() => expect(canvases).toHaveLength(2)); await vi.advanceTimersByTimeAsync(10001);
    await rejection; expect(terminated).toBe(true);
  });
  it("wipes a late worker reply after cancellation, including detached-buffer cleanup", async () => {
    const controller = new AbortController(); let reply!: (event: MessageEvent) => void, started = false;
    class LateWorker {
      onmessage: ((event: MessageEvent) => void) | null = null; onerror = null;
      postMessage() { reply = this.onmessage!; started = true; }
      terminate() {}
    }
    vi.stubGlobal("Worker", LateWorker);
    const pending = assembleSnapApplicationCandidate(input(), { signal: controller.signal });
    await vi.waitFor(() => expect(started).toBe(true)); controller.abort(); await expect(pending).rejects.toThrow(SNAP_CANDIDATE_ASSEMBLY_ERROR);
    const late = Uint8Array.from([1, 2, 3]); reply({ data: { ok: true, bytes: late } } as MessageEvent); expect([...late]).toEqual([0, 0, 0]);
    const detached = Uint8Array.from([4, 5, 6]); structuredClone(detached, { transfer: [detached.buffer] });
    expect(() => reply({ data: { ok: true, bytes: detached } } as MessageEvent)).not.toThrow();
  });
  it.skipIf(!process.env.CASELINK_PYTHON_BIN)("renders the actual assembled PDF and proves ten complete pages stay pixel-identical", async () => {
    const candidate = await assembleSnapApplicationCandidate(input()), directory = mkdtempSync(join(tmpdir(), "caselink-snap-assembly-"));
    try {
      writeFileSync(join(directory, "source.pdf"), preparation); writeFileSync(join(directory, "candidate.pdf"), candidate.bytes);
      const proof = JSON.parse(execFileSync(process.env.CASELINK_PYTHON_BIN!, ["-c", String.raw`
import sys,json,pypdfium2 as p
from pathlib import Path
d=Path(sys.argv[1]);a=p.PdfDocument(d/'source.pdf');b=p.PdfDocument(d/'candidate.pdf')
assert len(a)==len(b)==12
unchanged=[i for i in range(12) if i not in [2,6]]
assert all(a[i].render(scale=1.5).to_pil().tobytes()==b[i].render(scale=1.5).to_pil().tobytes() for i in unchanged)
assert all(b[i].get_size()==(612,792) for i in range(12))
corners=0
for index in [2,6]:
 image=b[index].render(scale=1.5).to_pil().convert('RGB');w,h=image.size
 for point,wanted in [((4,4),(255,0,0)),((w-5,4),(0,255,0)),((4,h-5),(0,0,255)),((w-5,h-5),(0,0,0))]:
  assert all(abs(found-expected)<30 for found,expected in zip(image.getpixel(point),wanted));corners+=1
print(json.dumps({'preservedWholePages':len(unchanged),'originalSizePages':len(b),'preservedCaptureCorners':corners}))
`, directory], { encoding: "utf8", timeout: 30000 }));
      expect(proof).toEqual({ preservedWholePages: 10, originalSizePages: 12, preservedCaptureCorners: 8 });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 30000);
  it.skipIf(!process.env.CASELINK_PYTHON_BIN)("rejects an actual encrypted preparation without requesting its password", async () => {
    const encrypted = execFileSync(process.env.CASELINK_PYTHON_BIN!, ["-c", "import io,sys;from pypdf import PdfReader,PdfWriter;r=PdfReader(io.BytesIO(sys.stdin.buffer.read()));w=PdfWriter();w.append(r);w.encrypt('SYNTHETIC-NOT-A-FAMILY-PASSWORD');out=io.BytesIO();w.write(out);sys.stdout.buffer.write(out.getvalue())"], { input: preparation, timeout: 10000 });
    await expect(assembleSnapApplicationCandidate({ ...input(), preparationBytes: new Uint8Array(encrypted) })).rejects.toThrow(SNAP_CANDIDATE_ASSEMBLY_ERROR);
    expect(pdfWorkers).toHaveLength(1);
  });
});
