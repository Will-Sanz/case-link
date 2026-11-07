// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SNAP_DIRECT_CERTIFICATION_REGIONS } from "@/lib/parent/snap-direct-completion-core";
import { SnapPersonalDrawing, type SnapPersonalDrawingValue } from "./snap-personal-drawing";

const now = new Date("2026-11-06T01:30:00.000Z"), expiresAt = "2026-11-06T02:30:00.000Z";
const first = "applicant_signature_printed_page_1", second = "rights_certification_printed_page_5";
let bounds: { left: number; top: number; width: number; height: number };
const observers = new Set<Observer>(), captures = new Set<number>();
class Observer {
  constructor(readonly callback: ResizeObserverCallback) { observers.add(this); }
  observe() {} unobserve() {} disconnect() { observers.delete(this); }
}
const context = { clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), strokeStyle: "", lineWidth: 0, lineCap: "" };
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); bounds = { left: 10, top: 20, width: 400, height: 160 }; captures.clear();
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    readonly pointerId: number; readonly isPrimary: boolean;
    constructor(type: string, options: PointerEventInit) { super(type, options); this.pointerId = options.pointerId ?? 1; this.isPrimary = options.isPrimary ?? true; }
  });
  vi.stubGlobal("ResizeObserver", Observer);
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockImplementation(() => new DOMRect(bounds.left, bounds.top, bounds.width, bounds.height));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.stubGlobal("devicePixelRatio", 1);
  Object.defineProperties(HTMLCanvasElement.prototype, {
    setPointerCapture: { configurable: true, value: (id: number) => captures.add(id) },
    hasPointerCapture: { configurable: true, value: (id: number) => captures.has(id) },
    releasePointerCapture: { configurable: true, value: (id: number) => captures.delete(id) },
  });
});
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
function setup(props: Partial<Parameters<typeof SnapPersonalDrawing>[0]> = {}) {
  const change = vi.fn<(value: SnapPersonalDrawingValue | null) => void>(), recovery = vi.fn();
  const value: Parameters<typeof SnapPersonalDrawing>[0] = { actId: first, label: "First certification", instructions: "Read the first-page certification before drawing.", expiresAt, onChange: change, onRecovery: recovery, ...props };
  const page = render(<SnapPersonalDrawing {...value}/>);
  return { ...page, canvas: screen.getByRole("img", { name: `${value.label} drawing area` }) as HTMLCanvasElement, change, recovery, props: value };
}
function pointer(canvas: HTMLCanvasElement, kind: "pointerDown" | "pointerMove" | "pointerUp" | "pointerCancel" | "lostPointerCapture", x = 110, y = 60, extra: PointerEventInit = {}) {
  fireEvent[kind](canvas, { bubbles: true, pointerId: 1, isPrimary: true, button: 0, buttons: kind === "pointerUp" ? 0 : 1, clientX: x, clientY: y, ...extra });
}
function draw(canvas: HTMLCanvasElement) { pointer(canvas, "pointerDown"); pointer(canvas, "pointerMove", 210, 100); pointer(canvas, "pointerUp", 310, 140); }
const latest = (change: ReturnType<typeof setup>["change"]) => change.mock.calls.at(-1)![0];
function pdfPoints(value: SnapPersonalDrawingValue) {
  const [x0, y0, x1, y1] = SNAP_DIRECT_CERTIFICATION_REGIONS[value.actId].ink;
  return value.strokes.flat().map(point => ({ x: x0 + 1 + point.x * (x1 - x0 - 2), y: y0 + 1 + point.y * (y1 - y0 - 2) }));
}
function longStroke(canvas: HTMLCanvasElement, count: number) {
  pointer(canvas, "pointerDown", 10, 40);
  for (let i = 1; i < count; i++) pointer(canvas, "pointerMove", 10 + i / 1000 * 400, 40);
  pointer(canvas, "pointerUp", 10 + (count - 1) / 1000 * 400, 40);
}

describe("fresh local personal drawing (mock canvas; no native handwriting or acceptance proof)", () => {
  it.each([first, second] as const)("emits the exact %s payload from actual event times with proportional PDF coordinates and Eastern date", actId => {
    const { canvas, change } = setup({ actId }); expect(latest(change)).toBeNull();
    pointer(canvas, "pointerDown"); act(() => { vi.advanceTimersByTime(10); }); pointer(canvas, "pointerMove", 210, 100);
    act(() => { vi.advanceTimersByTime(10); }); pointer(canvas, "pointerUp", 310, 140);
    const value = latest(change)!;
    expect({ ...value, strokes: undefined }).toEqual({ actId, provenance: "caller_reported_fresh_parent_drawing", startedAt: now.toISOString(), completedAt: "2026-11-06T01:30:00.020Z", date: "2026-11-05", strokes: undefined });
    const expected = actId === first ? [{ x: 202.25, y: 69 }, { x: 218.5, y: 62.5 }, { x: 234.75, y: 56 }]
      : [{ x: 117.25, y: 333 }, { x: 146, y: 321.5 }, { x: 174.75, y: 310 }];
    for (const [index, point] of pdfPoints(value).entries()) { expect(point.x).toBeCloseTo(expected[index].x, 10); expect(point.y).toBeCloseTo(expected[index].y, 10); }
    expect(context.moveTo).toHaveBeenCalledWith(100, 40); expect(context.lineTo).toHaveBeenCalledWith(300, 120);
    expect(captures.size).toBe(0); expect(screen.getByRole("status").textContent).toContain("Drawing added on this page");
    expect(document.querySelector("input,textarea,form")).toBeNull(); expect(JSON.stringify(latest(change))).not.toMatch(/signatureVerified|submissionReady|policy|owner|ssn/i);
  });
  it("invalidates a completed value while another stroke is in progress and copies data before giving it to the caller", () => {
    const { canvas, change } = setup(); draw(canvas); const supplied = latest(change)!, original = structuredClone(supplied); supplied.strokes[0][0].x = 99; supplied.strokes.push([{ x: 99, y: 99 }]);
    pointer(canvas, "pointerDown", 210, 60); expect(latest(change)).toBeNull(); pointer(canvas, "pointerUp", 310, 60);
    expect(latest(change)!.strokes).toEqual([original.strokes[0], [{ x: .5, y: 1 }, { x: original.strokes[0][2].x, y: 1 }]]);
  });
  it("does not turn a click, repeated point, secondary button or second pointer into handwriting", () => {
    const { canvas, change } = setup(); pointer(canvas, "pointerDown", 110, 60, { button: 2 }); pointer(canvas, "pointerUp", 310, 140);
    pointer(canvas, "pointerDown", 110, 60, { isPrimary: false }); pointer(canvas, "pointerUp", 310, 140);
    pointer(canvas, "pointerDown"); pointer(canvas, "pointerMove"); pointer(canvas, "pointerUp");
    expect(change.mock.calls.every(([value]) => value === null)).toBe(true); expect(context.stroke).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Clear drawing" }).matches(":disabled")).toBe(true);
  });
  it("ignores an unrelated pointer and restores the same prior value after an empty extra stroke", () => {
    const { canvas, change } = setup(); draw(canvas); const original = latest(change)!;
    pointer(canvas, "pointerDown"); pointer(canvas, "pointerMove", 410, 180, { pointerId: 2 }); pointer(canvas, "pointerUp");
    expect(latest(change)).toEqual(original);
  });
  it.each(["pointerCancel", "lostPointerCapture"] as const)("clears all ink and the caller value on %s", kind => {
    const { canvas, change } = setup(); draw(canvas); pointer(canvas, "pointerDown"); pointer(canvas, kind);
    expect(latest(change)).toBeNull(); expect(captures.size).toBe(0); expect(screen.getByRole("status").textContent).toContain("interrupted");
    pointer(canvas, "pointerUp", 310, 140); expect(latest(change)).toBeNull();
  });
  it.each(["outside", "button_released", "clock_backwards"])("rejects %s input without a truncated or falsely fresh value", reason => {
    const { canvas, change } = setup(); draw(canvas); pointer(canvas, "pointerDown");
    if (reason === "outside") pointer(canvas, "pointerMove", 411, 100);
    if (reason === "button_released") pointer(canvas, "pointerMove", 210, 100, { buttons: 0 });
    if (reason === "clock_backwards") { vi.setSystemTime(new Date(now.getTime() - 1)); pointer(canvas, "pointerUp", 310, 140); }
    expect(latest(change)).toBeNull(); expect(screen.getByRole("button", { name: "Clear drawing" }).matches(":disabled")).toBe(true);
  });
  it.each(([first, second] as const).flatMap(actId => [280, 900].flatMap(width => ["square", "horizontal", "vertical", "wide", "tall", "nearby"].map(shape => ({ actId, width, shape })))))
  ("preserves actual CSS/backing-canvas shape in PDF points for $actId at width$width: $shape", ({ actId, width, shape }) => {
    bounds.width = width;
    const { canvas, change } = setup({ actId });
    const points = shape === "square" ? [[30, 30], [130, 30], [130, 130], [30, 130], [30, 30]]
      : shape === "horizontal" ? [[30, 80], [120, 80], [220, 80]] : shape === "vertical" ? [[80, 20], [80, 100], [80, 140]]
        : shape === "wide" ? [[0, 80], [width, 81]] : shape === "tall" ? [[width / 2, 0], [width / 2 + .01, 160]] : [[80, 80], [80.001, 80.001]];
    pointer(canvas, "pointerDown", bounds.left + points[0][0], bounds.top + points[0][1]);
    for (const point of points.slice(1, -1)) pointer(canvas, "pointerMove", bounds.left + point[0], bounds.top + point[1]);
    pointer(canvas, "pointerUp", bounds.left + points.at(-1)![0], bounds.top + points.at(-1)![1]);
    const value = latest(change)!, output = pdfPoints(value);
    expect(value.strokes).toHaveLength(1); expect(value.strokes[0]).toHaveLength(points.length);
    expect(value.strokes[0].every(point => Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1)).toBe(true);
    // These are the actual draw commands sent to the mocked native canvas, converted back to CSS pixels.
    const painted = [context.moveTo.mock.calls[0], ...context.lineTo.mock.calls].map(([x, y]) => [x * width / canvas.width, y * bounds.height / canvas.height]);
    for (const [index, point] of painted.entries()) { expect(point[0]).toBeCloseTo(points[index][0], 9); expect(point[1]).toBeCloseTo(points[index][1], 9); }
    const [x0, y0, x1, y1] = SNAP_DIRECT_CERTIFICATION_REGIONS[actId].ink;
    const spanX = Math.max(...points.map(point => point[0])) - Math.min(...points.map(point => point[0]));
    const spanY = Math.max(...points.map(point => point[1])) - Math.min(...points.map(point => point[1]));
    const outX = Math.max(...output.map(point => point.x)) - Math.min(...output.map(point => point.x));
    const outY = Math.max(...output.map(point => point.y)) - Math.min(...output.map(point => point.y));
    const scale = spanX ? outX / spanX : outY / spanY;
    for (const [index, point] of output.entries()) {
      expect(point.x - output[0].x).toBeCloseTo((points[index][0] - points[0][0]) * scale, 8);
      expect(point.y - output[0].y).toBeCloseTo(-(points[index][1] - points[0][1]) * scale, 8);
    }
    expect((Math.min(...output.map(point => point.x)) + Math.max(...output.map(point => point.x))) / 2).toBeCloseTo((x0 + x1) / 2, 10);
    expect((Math.min(...output.map(point => point.y)) + Math.max(...output.map(point => point.y))) / 2).toBeCloseTo((y0 + y1) / 2, 10);
    expect(Math.max(outX / (x1 - x0 - 2), outY / (y1 - y0 - 2))).toBeCloseTo(1, 9);
  });
  it("rejects a size change before ResizeObserver delivery instead of stretching earlier ink", () => {
    const { canvas, change } = setup(); pointer(canvas, "pointerDown"); bounds.width = 500; pointer(canvas, "pointerUp", 310, 140);
    expect(latest(change)).toBeNull(); expect(screen.getByRole("button", { name: "Clear drawing" }).matches(":disabled")).toBe(true);
  });
  it.each([first, second] as const)("excludes the visible pad border from pointer/paint/fit geometry for %s", actId => {
    const { canvas, change } = setup({ actId }); draw(canvas); const original = latest(change)!.strokes;
    canvas.style.borderStyle = "solid"; canvas.style.borderWidth = "3px 2px";
    act(() => { for (const observer of observers) observer.callback([], observer as unknown as ResizeObserver); });
    expect(canvas.width).toBe(396); expect(canvas.height).toBe(154);
    context.moveTo.mockClear(); context.lineTo.mockClear();
    pointer(canvas, "pointerDown", 112, 63); pointer(canvas, "pointerMove", 212, 103); pointer(canvas, "pointerUp", 312, 143);
    expect(latest(change)!.strokes.map(stroke => stroke.length)).toEqual(original.map(stroke => stroke.length));
    for (const [index, point] of latest(change)!.strokes[0].entries()) { expect(point.x).toBeCloseTo(original[0][index].x, 12); expect(point.y).toBeCloseTo(original[0][index].y, 12); }
    expect(context.moveTo.mock.calls[0][0]).toBeCloseTo(100, 10); expect(context.moveTo.mock.calls[0][1]).toBeCloseTo(40, 10);
    expect(context.lineTo.mock.calls.at(-1)![0]).toBeCloseTo(300, 10); expect(context.lineTo.mock.calls.at(-1)![1]).toBeCloseTo(120, 10);
  });
  it.each([0, NaN, Infinity])("cannot publish from invalid CSS dimensions: %s", width => {
    const { canvas, change } = setup(); bounds.width = width; draw(canvas); expect(latest(change)).toBeNull();
  });
  it("accepts exactly 16 strokes and rejects a seventeenth instead of silently dropping it", () => {
    const { canvas, change } = setup(); for (let i = 0; i < 16; i++) { pointer(canvas, "pointerDown"); pointer(canvas, "pointerUp", 310, 140); }
    expect(latest(change)!.strokes).toHaveLength(16); pointer(canvas, "pointerDown"); expect(latest(change)).toBeNull(); expect(screen.getByRole("status").textContent).toContain("limit");
  });
  it("accepts 512 points in one stroke and rejects overflow without publishing a partial value", () => {
    const { canvas, change } = setup(); longStroke(canvas, 512); expect(latest(change)!.strokes[0]).toHaveLength(512);
    fireEvent.click(screen.getByRole("button", { name: "Clear drawing" }));
    pointer(canvas, "pointerDown", 10, 40); for (let i = 1; i <= 512; i++) pointer(canvas, "pointerMove", 10 + i / 1000 * 400, 40);
    expect(latest(change)).toBeNull(); expect(screen.getByRole("status").textContent).toContain("limit");
  });
  it("accepts exactly 2048 total points and clears if another point would be added", () => {
    const { canvas, change } = setup(); for (let i = 0; i < 4; i++) longStroke(canvas, 512);
    expect(latest(change)!.strokes.reduce((count, points) => count + points.length, 0)).toBe(2048);
    pointer(canvas, "pointerDown"); expect(latest(change)).toBeNull(); expect(screen.getByRole("status").textContent).toContain("limit");
  });
  it("clears on resize without resampling or reusing the prior drawing", () => {
    const { canvas, change } = setup(); draw(canvas); const original = latest(change)!; bounds.width = 500;
    act(() => { for (const observer of observers) observer.callback([], observer as unknown as ResizeObserver); });
    expect(latest(change)).toBeNull(); expect(canvas.width).toBe(500); expect(canvas.height).toBe(160); expect(screen.getByRole("status").textContent).toContain("area changed");
    draw(canvas); expect(latest(change)!.strokes).toEqual(original.strokes);
  });
  it("supports native resize cleanup even when ResizeObserver is unavailable", () => {
    vi.stubGlobal("ResizeObserver", undefined); const { canvas, change } = setup(); draw(canvas); bounds.width = 500;
    fireEvent(window, new Event("resize")); expect(latest(change)).toBeNull(); expect(canvas.width).toBe(500);
  });
  it("uses bounded backing pixels for high-density or unusually wide areas", () => {
    vi.stubGlobal("devicePixelRatio", 10); bounds.width = 10000; bounds.height = 10000; const { canvas } = setup();
    expect(canvas.width).toBe(2048); expect(canvas.height).toBe(1024);
  });
  it("clears on disable and never restores or prefills a drawing on reenable or act change", () => {
    const { canvas, change, props, rerender } = setup(); draw(canvas);
    rerender(<SnapPersonalDrawing {...props} disabled/>); expect(latest(change)).toBeNull(); expect(canvas.width).toBe(0); expect(screen.getByRole("img").tabIndex).toBe(-1); draw(canvas); expect(latest(change)).toBeNull();
    expect(screen.getByRole("button", { name: "I need another way" }).matches(":disabled")).toBe(true);
    rerender(<SnapPersonalDrawing {...props} actId={second}/>); expect(latest(change)).toBeNull(); expect(screen.getByRole("button", { name: "Clear drawing" }).matches(":disabled")).toBe(true);
    draw(screen.getByRole("img") as HTMLCanvasElement); expect(latest(change)!.actId).toBe(second);
  });
  it.each(["invalid", "2026-11-06T01:30:00.000Z"])("keeps an invalid/expired step closed: %s", expiry => {
    const { canvas, change } = setup({ expiresAt: expiry }); draw(canvas); expect(latest(change)).toBeNull(); expect(canvas.tabIndex).toBe(-1); expect(screen.getByRole("status").textContent).toContain("unavailable");
  });
  it("wipes at exact expiry, releases active capture and ignores late events", () => {
    const { canvas, change, props, rerender } = setup({ expiresAt: new Date(now.getTime() + 1000).toISOString() }); draw(canvas); pointer(canvas, "pointerDown");
    act(() => { vi.advanceTimersByTime(1000); }); expect(latest(change)).toBeNull(); expect(captures.size).toBe(0); expect(canvas.tabIndex).toBe(-1);
    pointer(canvas, "pointerUp", 310, 140); expect(latest(change)).toBeNull(); expect(screen.getByRole("status").textContent).toContain("expired");
    rerender(<SnapPersonalDrawing {...props} expiresAt={expiresAt}/>); expect(latest(change)).toBeNull(); expect(canvas.width).toBe(0); draw(canvas); expect(latest(change)).toBeNull(); draw(screen.getByRole("img") as HTMLCanvasElement); expect(latest(change)).not.toBeNull();
  });
  it("does not expire early when the explicit deadline exceeds the native timer range", () => {
    const { canvas, change } = setup({ expiresAt: new Date(now.getTime() + 2147484647).toISOString() }); draw(canvas);
    act(() => { vi.advanceTimersByTime(2147483647); }); expect(canvas.tabIndex).toBe(0);
    act(() => { vi.advanceTimersByTime(1000); }); expect(latest(change)).toBeNull(); expect(canvas.tabIndex).toBe(-1);
  });
  it("clears memory and pixels on pagehide and unmount, disconnecting timers and resize observation", () => {
    const { canvas, change, unmount } = setup(); draw(canvas); fireEvent(window, new Event("pagehide")); expect(latest(change)).toBeNull(); draw(canvas); pointer(canvas, "pointerDown");
    unmount(); expect(latest(change)).toBeNull(); expect(captures.size).toBe(0); expect(canvas.width).toBe(0); expect(canvas.height).toBe(0); expect(observers.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
    const calls = change.mock.calls.length; pointer(canvas, "pointerUp", 310, 140); expect(change).toHaveBeenCalledTimes(calls);
  });
  it("keeps the current callback without clearing fresh input on ordinary parent rerenders", () => {
    const { canvas, props, rerender } = setup(); draw(canvas); const next = vi.fn(); rerender(<SnapPersonalDrawing {...props} onChange={next}/>);
    expect(next).not.toHaveBeenCalled(); pointer(canvas, "pointerDown"); pointer(canvas, "pointerUp", 310, 140); expect(next.mock.calls.at(-1)![0]).not.toBeNull();
  });
  it("provides named keyboard controls and genuine recovery without a typed-name substitute", () => {
    const { canvas, change, recovery } = setup(); expect(screen.getByRole("group", { name: "First certification" })).toBeTruthy();
    expect(canvas.getAttribute("aria-describedby")).toBeTruthy(); act(() => { canvas.focus(); }); expect(document.activeElement).toBe(canvas); expect(canvas.style.outline).toBe("3px solid var(--color-focus)");
    draw(canvas); fireEvent.keyDown(canvas, { key: "Escape" }); expect(latest(change)).toBeNull(); draw(canvas);
    const button = screen.getByRole("button", { name: "I need another way" }); button.focus(); expect(document.activeElement).toBe(button); fireEvent.click(button);
    expect(latest(change)).toBeNull(); expect(recovery).toHaveBeenCalledOnce(); expect(document.querySelector("input,textarea,form")).toBeNull();
  });
  it("offers recovery when a native drawing context is unavailable", () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null); const { canvas, change, recovery } = setup(); pointer(canvas, "pointerDown");
    expect(latest(change)).toBeNull(); expect(screen.getByRole("status").textContent).toContain("Drawing is unavailable here"); fireEvent.click(screen.getByRole("button", { name: "I need another way" })); expect(recovery).toHaveBeenCalledOnce();
  });
});
