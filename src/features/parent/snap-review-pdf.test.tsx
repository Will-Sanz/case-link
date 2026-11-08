// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
const mocks = vi.hoisted(() => ({ getDocument: vi.fn(), create: vi.fn(), page: vi.fn(), draw: vi.fn(), text: vi.fn(), pixels: vi.fn(), operators: vi.fn(), destroy: vi.fn(), destroyWorker: vi.fn(), terminate: vi.fn(), cancel: vi.fn(), workers: [] as EventTarget[] }));
vi.mock("pdfjs-dist", () => ({ getDocument: mocks.getDocument, PDFWorker: { create: mocks.create } }));
import { SnapReviewPdf } from "./snap-review-pdf";
const source = () => ({ arrayBuffer: async () => new Uint8Array([37, 80, 68, 70]).buffer }) as Blob;
const loaded = () => ({ numPages: 12, getPage: mocks.page });
beforeEach(() => {
  vi.clearAllMocks(); mocks.workers.length = 0; mocks.text.mockResolvedValue({ items: [{ str: "Synthetic application page" }] });
  mocks.draw.mockReturnValue({ promise: Promise.resolve(), cancel: mocks.cancel });
  mocks.operators.mockResolvedValue({ fnArray: [] });
  mocks.page.mockResolvedValue({ getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale }), render: mocks.draw, getTextContent: mocks.text, getOperatorList: mocks.operators });
  mocks.getDocument.mockReturnValue({ promise: Promise.resolve(loaded()), destroy: mocks.destroy.mockResolvedValue(undefined) });
  mocks.create.mockReturnValue({ destroy: mocks.destroyWorker });
  mocks.pixels.mockImplementation(() => ({ data: Uint8ClampedArray.from([0, 0, 0, 255]) }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ getImageData: mocks.pixels } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal("Worker", class extends EventTarget { constructor() { super(); mocks.workers.push(this); } terminate = mocks.terminate; });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("local exact SNAP PDF viewing", () => {
  it("ships the exact installed decoder and license bytes for the pinned renderer", () => {
    expect(JSON.parse(readFileSync("node_modules/pdfjs-dist/package.json", "utf8")).version).toBe("6.5.438");
    for (const name of ["jbig2_nowasm_fallback.js", "LICENSE_JBIG2", "LICENSE_PDFJS_JBIG2"])
      expect(readFileSync(`public/pdfjs/6.5.438/${name}`).equals(readFileSync(`node_modules/pdfjs-dist/wasm/${name}`))).toBe(true);
  });
  it("requires successful real-page rendering, offers page navigation and readable text, and stays in local memory", async () => {
    let finish!: () => void; mocks.draw.mockReturnValueOnce({ promise: new Promise<void>(done => { finish = done; }), cancel: mocks.cancel });
    const ready = vi.fn(); render(<SnapReviewPdf source={source()} onReady={ready}/>);
    await waitFor(() => expect(mocks.draw).toHaveBeenCalledOnce()); expect(ready).not.toHaveBeenCalledWith(true, expect.any(Number));
    finish(); await screen.findByText("Synthetic application page"); expect(ready).toHaveBeenLastCalledWith(true, 1);
    expect(screen.getByRole("group", { name: "Application page controls" })).toBeTruthy();
    const input = mocks.getDocument.mock.calls[0][0]; expect(input.url).toBeUndefined(); expect([...input.data]).toEqual([0, 0, 0, 0]);
    expect(input).toMatchObject({ verbosity: 0, stopAtErrors: true, enableXfa: false, useWorkerFetch: false, useWasm: false, wasmUrl: "/pdfjs/6.5.438/", disableAutoFetch: true });
    expect(screen.getByRole("button", { name: "Previous page" }).matches(":disabled")).toBe(true);
    for (let page = 2; page <= 12; page++) {
      fireEvent.click(screen.getByRole("button", { name: "Next page" }));
      await waitFor(() => expect(mocks.page).toHaveBeenLastCalledWith(page)); await screen.findByText("Synthetic application page");
    }
    expect(screen.getByText("Page 12 of 12")).toBeTruthy(); expect(screen.getByRole("button", { name: "Next page" }).matches(":disabled")).toBe(true);
    fireEvent.change(screen.getByRole("combobox", { name: "Page size" }), { target: { value: "2" } });
    await waitFor(() => expect((screen.getByRole("img") as HTMLCanvasElement).style.width).toBe("1224px"));
  });
  it.each([undefined, 3, 7])("starts on physical page %s only after that page renders", async initialPage => {
    let finish!: () => void; mocks.draw.mockReturnValue({ promise: new Promise<void>(resolve => { finish = resolve; }), cancel: mocks.cancel });
    const ready = vi.fn(), number = initialPage ?? 1; render(<SnapReviewPdf source={source()} onReady={ready} initialPage={initialPage}/>);
    await waitFor(() => expect(mocks.page).toHaveBeenLastCalledWith(number)); await waitFor(() => expect(mocks.draw).toHaveBeenCalled());
    expect(ready).not.toHaveBeenCalledWith(true, expect.any(Number)); expect(screen.queryByRole("img")).toBeNull();
    await act(async () => { finish(); }); expect(screen.getByRole("img", { name: `SNAP application page ${number}` })).toBeTruthy();
    expect(screen.getByText(`Page ${number} of 12`)).toBeTruthy(); expect(screen.getByText(`Read page ${number} text`)).toBeTruthy(); expect(ready).toHaveBeenLastCalledWith(true, number);
  });
  it.each([0, -1, 13, 3.5, NaN, Infinity, "3", null])("fails closed before reading any source for invalid initial page %s", async value => {
    const arrayBuffer = vi.fn(), ready = vi.fn(); render(<SnapReviewPdf source={{ arrayBuffer } as unknown as Blob} onReady={ready} initialPage={value as number}/>);
    await screen.findByRole("alert"); expect(arrayBuffer).not.toHaveBeenCalled(); expect(mocks.getDocument).not.toHaveBeenCalled(); expect(mocks.workers).toHaveLength(0);
    expect(ready).toHaveBeenLastCalledWith(false, 1); expect(screen.queryByRole("img")).toBeNull(); expect(screen.getByRole("combobox").matches(":disabled")).toBe(true);
  });
  it("uses the starting page only on mount and keeps ordinary navigation on the current document", async () => {
    const blob = source(), ready = vi.fn(), view = render(<SnapReviewPdf source={blob} onReady={ready} initialPage={3}/>);
    await screen.findByText("Read page 3 text"); fireEvent.click(screen.getByRole("button", { name: "Next page" })); await screen.findByText("Read page 4 text");
    view.rerender(<SnapReviewPdf source={blob} onReady={ready} initialPage={7}/>); expect(screen.getByText("Page 4 of 12")).toBeTruthy();
    expect(mocks.page).toHaveBeenLastCalledWith(4); expect(mocks.getDocument).toHaveBeenCalledOnce();
  });
  it("reports readiness for actual page 4, never a delayed starting page 3, including later worker failure", async () => {
    let finish!: () => void; mocks.draw.mockReturnValueOnce({ promise: new Promise<void>(resolve => { finish = resolve; }), cancel: mocks.cancel });
    const ready = vi.fn(); render(<SnapReviewPdf source={source()} onReady={ready} initialPage={3}/>);
    await waitFor(() => expect(mocks.draw).toHaveBeenCalledOnce()); expect(ready).toHaveBeenLastCalledWith(false, 3);
    fireEvent.click(screen.getByRole("button", { name: "Next page" })); await screen.findByText("Read page 4 text");
    expect(ready.mock.calls.filter(([value]) => value)).toEqual([[true, 4]]);
    await act(async () => { finish(); }); expect(ready.mock.calls.filter(([value]) => value)).toEqual([[true, 4]]);
    act(() => { mocks.workers[0].dispatchEvent(new ErrorEvent("error", { cancelable: true })); });
    expect(ready).toHaveBeenLastCalledWith(false, 4); expect(screen.getByRole("alert")).toBeTruthy();
  });
  it("never applies an old source's late page to a keyed new certification viewer", async () => {
    let finish!: (value: Awaited<ReturnType<typeof mocks.page>>) => void;
    const oldPage = vi.fn(() => new Promise(resolve => { finish = resolve; })), oldDraw = vi.fn(), oldReady = vi.fn(), newReady = vi.fn();
    mocks.getDocument.mockReturnValueOnce({ promise: Promise.resolve({ numPages: 12, getPage: oldPage }), destroy: mocks.destroy });
    const view = render(<SnapReviewPdf key="old-source" source={source()} onReady={oldReady} initialPage={3}/>); await waitFor(() => expect(oldPage).toHaveBeenCalledWith(3));
    view.rerender(<SnapReviewPdf key="new-source" source={source()} onReady={newReady} initialPage={7}/>); await screen.findByText("Read page 7 text");
    await act(async () => { finish({ getViewport: () => ({ width: 612, height: 792 }), render: oldDraw, getTextContent: async () => ({ items: [{ str: "PRIVATE_OLD_SOURCE" }] }) }); });
    expect(oldDraw).not.toHaveBeenCalled(); expect(oldReady).not.toHaveBeenCalledWith(true, expect.any(Number)); expect(newReady).toHaveBeenLastCalledWith(true, 7);
    expect(mocks.page).toHaveBeenLastCalledWith(7); expect(document.body.textContent).not.toContain("PRIVATE_OLD_SOURCE"); expect(screen.getByRole("img", { name: "SNAP application page 7" })).toBeTruthy();
  });
  it("clears old text and pixels immediately when an unkeyed viewer receives a new source", async () => {
    const ready = vi.fn(), view = render(<SnapReviewPdf source={source()} onReady={ready}/>);
    await screen.findByText("Synthetic application page"); const surface = screen.getByRole("img") as HTMLCanvasElement;
    let finish!: (value: ReturnType<typeof loaded>) => void;
    mocks.getDocument.mockReturnValueOnce({ promise: new Promise(resolve => { finish = resolve; }), destroy: mocks.destroy });
    view.rerender(<SnapReviewPdf source={source()} onReady={ready}/>);
    expect(screen.queryByText("Synthetic application page")).toBeNull(); expect(screen.queryByRole("img")).toBeNull();
    expect(surface.width).toBe(0); expect(surface.height).toBe(0); expect(ready).toHaveBeenLastCalledWith(false, 1);
    await waitFor(() => expect(mocks.getDocument).toHaveBeenCalledTimes(2));
    view.unmount(); const calls = ready.mock.calls.length;
    await act(async () => { finish(loaded()); });
    expect(ready).toHaveBeenCalledTimes(calls); expect(mocks.page).toHaveBeenCalledOnce(); expect(mocks.terminate).toHaveBeenCalledTimes(2);
  });
  it("does not mark a page readable after a renderer failure or leak private errors", async () => {
    mocks.draw.mockImplementation(() => ({ promise: Promise.reject(new Error("PRIVATE_RENDER_CANARY")), cancel: mocks.cancel }));
    const ready = vi.fn(); render(<SnapReviewPdf source={source()} onReady={ready}/>);
    await screen.findByRole("alert"); expect(ready).not.toHaveBeenCalledWith(true, expect.any(Number)); expect(document.body.textContent).not.toContain("PRIVATE_RENDER_CANARY");
  });
  it.each([{ label: "opaque white", rgba: [255, 255, 255, 255] }, { label: "transparent", rgba: [0, 0, 0, 0] }])("rejects a successfully resolved $label canvas", async ({ rgba }) => {
    const pixels = Uint8ClampedArray.from(rgba);
    mocks.pixels.mockReturnValue({ data: pixels });
    const ready = vi.fn(); render(<SnapReviewPdf source={source()} onReady={ready}/>);
    await screen.findByRole("alert"); expect(ready).not.toHaveBeenCalledWith(true, expect.any(Number));
    expect(mocks.terminate).toHaveBeenCalled(); expect([...pixels]).toEqual([0, 0, 0, 0]);
  });
  it("fails closed when printed-page inspection is unavailable", async () => {
    mocks.pixels.mockImplementation(() => { throw new Error("PRIVATE_PIXEL_CANARY"); });
    const ready = vi.fn(); render(<SnapReviewPdf source={source()} onReady={ready}/>);
    await screen.findByRole("alert"); expect(ready).not.toHaveBeenCalledWith(true, expect.any(Number));
    expect(document.body.textContent).not.toContain("PRIVATE_PIXEL_CANARY");
  });
  it.each([{ operatorCount: 0, text: [], allowed: true }, { operatorCount: 1, text: [], allowed: false }, { operatorCount: 0, text: [{ str: "Text must remain visible" }], allowed: false }])("validates official blank page 2 (%j)", async ({ operatorCount, text, allowed }) => {
    const ready = vi.fn(); render(<SnapReviewPdf source={source()} onReady={ready}/>);
    await screen.findByText("Synthetic application page"); ready.mockClear();
    mocks.pixels.mockImplementation(() => ({ data: Uint8ClampedArray.from([255, 255, 255, 255]) }));
    mocks.text.mockResolvedValue({ items: text }); mocks.operators.mockResolvedValue({ fnArray: Array(operatorCount).fill(1) });
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    if (!allowed) { await screen.findByRole("alert"); expect(ready).not.toHaveBeenCalledWith(true, expect.any(Number)); }
    else { await screen.findAllByText("This page is blank in the official SNAP form."); expect(ready).toHaveBeenLastCalledWith(true, 2); }
  });
  it("cannot report a late blank-page inspection ready after its worker fails", async () => {
    const ready = vi.fn(); render(<SnapReviewPdf source={source()} onReady={ready}/>);
    await screen.findByText("Synthetic application page"); ready.mockClear();
    let finish!: (value: { fnArray: number[] }) => void;
    mocks.pixels.mockImplementation(() => ({ data: Uint8ClampedArray.from([255, 255, 255, 255]) }));
    mocks.text.mockResolvedValue({ items: [] }); mocks.operators.mockReturnValue(new Promise(done => { finish = done; }));
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(mocks.operators).toHaveBeenCalledOnce());
    act(() => { mocks.workers[0].dispatchEvent(new ErrorEvent("error", { cancelable: true })); });
    await act(async () => { finish({ fnArray: [] }); });
    expect(screen.getByRole("alert")).toBeTruthy(); expect(ready).not.toHaveBeenCalledWith(true, expect.any(Number));
  });
  it.each([11, 13])("refuses an unexpected %s-page application", async numPages => {
    mocks.getDocument.mockReturnValue({ promise: Promise.resolve({ ...loaded(), numPages }), destroy: mocks.destroy });
    const ready = vi.fn(); render(<SnapReviewPdf source={source()} onReady={ready}/>); await screen.findByRole("alert");
    expect(ready).not.toHaveBeenCalledWith(true, expect.any(Number)); expect(mocks.page).not.toHaveBeenCalled();
  });
  it("cancels the old page and terminates its private worker when the review closes", async () => {
    let finish!: () => void; mocks.draw.mockReturnValue({ promise: new Promise<void>(done => { finish = done; }), cancel: mocks.cancel });
    const ready = vi.fn(), result = render(<SnapReviewPdf source={source()} onReady={ready}/>);
    await waitFor(() => expect(mocks.draw).toHaveBeenCalledOnce()); result.unmount(); finish();
    expect(mocks.cancel).toHaveBeenCalled(); expect(mocks.destroy).toHaveBeenCalled(); expect(mocks.destroyWorker).toHaveBeenCalled(); expect(mocks.terminate).toHaveBeenCalled();
    await Promise.resolve(); expect(ready).not.toHaveBeenCalledWith(true, expect.any(Number));
  });
  it("bounds an unresponsive document load and terminates the owned worker", async () => {
    vi.useFakeTimers(); mocks.getDocument.mockReturnValue({ promise: new Promise(() => {}), destroy: mocks.destroy });
    const ready = vi.fn(); render(<SnapReviewPdf source={source()} onReady={ready}/>);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByRole("alert")).toBeTruthy(); expect(mocks.terminate).toHaveBeenCalled(); expect(ready).not.toHaveBeenCalledWith(true, expect.any(Number));
  });
  it("terminates a worker whose page renderer does not finish", async () => {
    vi.useFakeTimers(); mocks.draw.mockImplementation(() => ({ promise: new Promise(() => {}), cancel: mocks.cancel }));
    const ready = vi.fn(); render(<SnapReviewPdf source={source()} onReady={ready}/>);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(mocks.draw).toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(15_001); });
    expect(screen.getByRole("alert")).toBeTruthy(); expect(mocks.cancel).toHaveBeenCalled(); expect(mocks.terminate).toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalledWith(true, expect.any(Number));
  });
  it.each(["error", "messageerror"])("contains a worker %s immediately, including private diagnostic text and late completion", async eventName => {
    let finish!: (document: ReturnType<typeof loaded>) => void;
    mocks.getDocument.mockReturnValue({ promise: new Promise(done => { finish = done; }), destroy: mocks.destroy });
    const ready = vi.fn(); render(<SnapReviewPdf source={source()} onReady={ready}/>);
    await waitFor(() => expect(mocks.workers).toHaveLength(1));
    const event = new ErrorEvent(eventName, { message: "PRIVATE_WORKER_CANARY", cancelable: true });
    act(() => { mocks.workers[0].dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true); expect(screen.getByRole("alert")).toBeTruthy();
    expect(mocks.terminate).toHaveBeenCalled(); expect(document.body.textContent).not.toContain("PRIVATE_WORKER_CANARY");
    await act(async () => { finish(loaded()); }); expect(ready).not.toHaveBeenCalledWith(true, expect.any(Number)); expect(mocks.draw).not.toHaveBeenCalled();
  });
  it("cannot report a late page ready after the active document's worker fails", async () => {
    let finish!: () => void; mocks.draw.mockImplementation(() => ({ promise: new Promise<void>(done => { finish = done; }), cancel: mocks.cancel }));
    const ready = vi.fn(); render(<SnapReviewPdf source={source()} onReady={ready}/>);
    await waitFor(() => expect(mocks.draw).toHaveBeenCalled());
    act(() => { mocks.workers[0].dispatchEvent(new ErrorEvent("error", { message: "PRIVATE_WORKER_CANARY", cancelable: true })); });
    expect(mocks.cancel).toHaveBeenCalled(); expect(document.querySelector("canvas")?.width).toBe(0);
    await act(async () => { finish(); });
    expect(screen.getByRole("alert")).toBeTruthy(); expect(screen.queryByRole("img")).toBeNull();
    expect(ready).not.toHaveBeenCalledWith(true, expect.any(Number)); expect(ready).toHaveBeenLastCalledWith(false, 1);
  });
});
