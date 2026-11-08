"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFWorker, RenderTask } from "pdfjs-dist";
import styles from "./parent.module.css";

const VIEW_ERROR = "The application page could not be displayed. Try opening the exact PDF full size, or retry this review before choosing Submit.";
const BLANK_PAGE = "This page is blank in the official SNAP form.";

/** Render only the already verified local file; no PDF links, scripts, attachments or remote URLs. */
export function SnapReviewPdf({ source, onReady, initialPage = 1 }: { source: Blob; onReady: (ready: boolean, pageNumber?: number) => void; initialPage?: number }) {
  const validInitialPage = Number.isInteger(initialPage) && initialPage >= 1 && initialPage <= 12;
  const canvas = useRef<HTMLCanvasElement>(null), viewport = useRef<HTMLDivElement>(null), id = useId();
  const closeDocument = useRef<() => void>(() => {});
  const activeDocument = useRef<PDFDocumentProxy | null>(null);
  const activeRender = useRef<RenderTask | null>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  // Remount with a key to start another certification page; never reset a page on an older document.
  const [pageNumber, setPageNumber] = useState(validInitialPage ? initialPage : 1), [size, setSize] = useState(0), [width, setWidth] = useState(612);
  const currentPage = useRef(pageNumber);
  useEffect(() => { currentPage.current = pageNumber; }, [pageNumber]);
  const zoom = size || Math.min(1, width / 612);
  const [page, setPage] = useState<{ document: PDFDocumentProxy; number: number; zoom: number; text: string; officialBlank: boolean } | null>(null);
  const [error, setError] = useState(false);
  const [loadIdentity, setLoadIdentity] = useState({ source, onReady, validInitialPage });
  if (loadIdentity.source !== source || loadIdentity.onReady !== onReady || loadIdentity.validInitialPage !== validInitialPage) {
    setLoadIdentity({ source, onReady, validInitialPage });setDocument(null);setPage(null);setError(!validInitialPage);
  }
  const [renderIdentity, setRenderIdentity] = useState({ document, pageNumber, zoom });
  if (renderIdentity.document !== document || renderIdentity.pageNumber !== pageNumber || renderIdentity.zoom !== zoom) {
    setRenderIdentity({ document, pageNumber, zoom });setError(false);
  }
  const failed = error || !validInitialPage;
  const loaded = validInitialPage && page?.document === document && page?.number === pageNumber && page?.zoom === zoom;
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const resize = () => setWidth(Math.max(1, element.clientWidth - 2));
    resize(); const observer = new ResizeObserver(resize); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let closed = false, worker: Worker | undefined, pdfWorker: PDFWorker | undefined, task: PDFDocumentLoadingTask | undefined, bytes: Uint8Array | undefined;
    const close = () => {
      closed = true; activeDocument.current = null; activeRender.current?.cancel(); activeRender.current = null;
      if (canvas.current) { canvas.current.width = 0; canvas.current.height = 0; }
      void task?.destroy().catch(() => {}); pdfWorker?.destroy(); worker?.terminate(); if (bytes?.byteLength) bytes.fill(0);
    };
    const workerFailed = (event: Event) => { event.preventDefault(); if (!closed) { setError(true); onReady(false, currentPage.current); close(); } };
    closeDocument.current = close;
    onReady(false, currentPage.current);
    if (!validInitialPage) return close;
    const timer = setTimeout(() => { setError(true); onReady(false, currentPage.current); close(); }, 30_000);
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        if (closed) return;
        bytes = new Uint8Array(await source.arrayBuffer());
        if (closed) return;
        worker = new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), { type: "module" });
        worker.addEventListener("error", workerFailed); worker.addEventListener("messageerror", workerFailed);
        pdfWorker = pdfjs.PDFWorker.create({ port: worker, verbosity: 0 });
        task = pdfjs.getDocument({ data: bytes, worker: pdfWorker, verbosity: 0, stopAtErrors: true, enableXfa: false,
          useWorkerFetch: false, useWasm: false, wasmUrl: "/pdfjs/6.5.438/", maxImageSize: 20_000_000, canvasMaxAreaInBytes: 24_000_000,
          disableAutoFetch: true, disableStream: true, disableRange: true });
        const opened = await task.promise;
        if (closed) return;
        if (opened.numPages !== 12) throw new Error();
        activeDocument.current = opened;
        setDocument(opened);
      } catch { if (!closed) { setError(true); onReady(false, currentPage.current); close(); } }
      finally { clearTimeout(timer); if (bytes?.byteLength) bytes.fill(0); }
    })();
    return () => { clearTimeout(timer); close(); };
  }, [source, onReady, validInitialPage]);
  useEffect(() => {
    if (!validInitialPage || !document || !canvas.current) return;
    let closed = false, task: RenderTask | undefined;
    const live = () => !closed && activeDocument.current === document;
    const surface = canvas.current;
    onReady(false, pageNumber);
    const timer = setTimeout(() => { closed = true; task?.cancel(); surface.width = 0; surface.height = 0; setError(true); onReady(false, pageNumber); closeDocument.current(); }, 15_000);
    void (async () => {
      try {
        const selected = await document.getPage(pageNumber);
        if (!live()) return;
        const base = selected.getViewport({ scale: 1 });
        if (base.width !== 612 || base.height !== 792) throw new Error();
        const ratio = Math.min(window.devicePixelRatio || 1, 2), viewport = selected.getViewport({ scale: zoom * ratio });
        surface.width = Math.ceil(viewport.width); surface.height = Math.ceil(viewport.height);
        surface.style.width = `${612 * zoom}px`; surface.style.height = `${792 * zoom}px`;
        task = selected.render({ canvas: surface, viewport });
        activeRender.current = task;
        const [, text] = await Promise.all([task.promise, selected.getTextContent()]);
        if (!live()) return;
        // PDF.js can resolve a blank page after silently dropping an undecodable official-form image.
        const pixels = surface.getContext("2d")?.getImageData(0, 0, surface.width, surface.height).data;
        let printed = false;
        if (pixels) {
          for (let offset = 0; offset < pixels.length; offset += 4) {
            if (pixels[offset + 3] > 0 && pixels[offset] < 180 && pixels[offset + 1] < 180 && pixels[offset + 2] < 180) { printed = true; break; }
          }
          pixels.fill(0);
        }
        // The pinned twelve-page PA form has one empty page, physical page 2.
        const officialBlank = !printed && pageNumber === 2 && text.items.length === 0 && (await selected.getOperatorList()).fnArray.length === 0;
        if (!live()) return;
        if (!printed && !officialBlank) throw new Error();
        setPage({ document, number: pageNumber, zoom, text: text.items.map(item => "str" in item ? item.str : "").join(" "), officialBlank });
        onReady(true, pageNumber);
      } catch { if (live()) { surface.width = 0; surface.height = 0; setError(true); onReady(false, pageNumber); closeDocument.current(); } }
      finally { clearTimeout(timer); }
    })();
    return () => { closed = true; clearTimeout(timer); task?.cancel(); surface.width = 0; surface.height = 0; };
  }, [document, pageNumber, zoom, onReady, validInitialPage]);
  return <div className={styles.space}>
    <div className={styles.inline} role="group" aria-label="Application page controls">
      <button className={styles.quiet} type="button" disabled={!document || failed || pageNumber === 1} onClick={() => setPageNumber(value => value - 1)}>Previous page</button>
      <span role="status">Page {pageNumber} of 12</span>
      <button className={styles.quiet} type="button" disabled={!document || failed || pageNumber === 12} onClick={() => setPageNumber(value => value + 1)}>Next page</button>
      <label htmlFor={id}>Page size</label>
      <select className={styles.select} id={id} value={size} disabled={failed} onChange={event => setSize(Number(event.target.value))}>
        <option value={0}>Fit width</option><option value={1}>100%</option><option value={1.5}>150%</option><option value={2}>200%</option>
      </select>
    </div>
    {failed ? <p className={styles.error} role="alert">{VIEW_ERROR}</p> : !loaded && <p role="status">Displaying the exact application page…</p>}
    {loaded && !failed && page?.officialBlank && <p className={styles.hint}>{BLANK_PAGE}</p>}
    <div ref={viewport} className={styles.snapReviewPdf} tabIndex={0} role="region" aria-label={`Exact SNAP application, page ${pageNumber}; scroll to read the whole page`}>
      <canvas key={`${pageNumber}:${zoom}`} ref={canvas} role="img" aria-label={`SNAP application page ${pageNumber}`} hidden={!loaded || failed}/>
    </div>
    {loaded && !failed && <details className={`${styles.disclosure} ${styles.snapReviewText}`}>
      <summary>Read page {pageNumber} text</summary>
      <div><p>{page?.text || (page?.officialBlank ? BLANK_PAGE : "This page is an image. Use the exact PDF full size or ask for an accessible alternative.")}</p>
        <p className={styles.hint}>Handwritten marks and text in images may not appear in this text view.</p></div>
    </details>}
  </div>;
}
