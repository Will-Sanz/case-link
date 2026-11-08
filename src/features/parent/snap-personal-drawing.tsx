"use client";
import { useCallback, useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { SNAP_DIRECT_CERTIFICATION_REGIONS, type SnapDirectCompletion } from "@/lib/parent/snap-direct-completion-core";
import { SNAP_PARENT_CERTIFICATION_ACTS } from "@/lib/parent/snap-protected-operation";
import styles from "./parent.module.css";
import { usePermissionWindow } from "./use-permission-window";

export type SnapPersonalDrawingValue = SnapDirectCompletion["certifications"][number];
type Point = SnapPersonalDrawingValue["strokes"][number][number];
type Drawing = { strokes: Point[][]; pointer?: number; started?: number; completed?: number; size?: { width: number; height: number } };
const easternDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const unavailable = "Drawing is unavailable here. Choose another way to complete this step.";

function drawingBox(surface: HTMLCanvasElement) {
  const bounds = surface.getBoundingClientRect(), style = getComputedStyle(surface);
  const left = parseFloat(style.borderLeftWidth) || 0, top = parseFloat(style.borderTopWidth) || 0;
  return { left: bounds.left + left, top: bounds.top + top,
    width: bounds.width - left - (parseFloat(style.borderRightWidth) || 0), height: bounds.height - top - (parseFloat(style.borderBottomWidth) || 0) };
}

function erase(drawing: Drawing, surface: HTMLCanvasElement | null) {
  const pointer = drawing.pointer; drawing.pointer = undefined;
  for (const stroke of drawing.strokes) { for (const point of stroke) { point.x = 0; point.y = 0; } stroke.length = 0; }
  drawing.strokes.length = 0; drawing.started = undefined; drawing.completed = undefined; drawing.size = undefined;
  if (surface) {
    surface.getContext("2d")?.clearRect(0, 0, surface.width, surface.height);
    try { if (pointer !== undefined && surface.hasPointerCapture(pointer)) surface.releasePointerCapture(pointer); } catch { /* The pointer may already be cancelled. */ }
  }
}

/** Parent must remount for a changed request/snapshot/source. No saved drawing can be supplied or reused. */
type DrawingProps = {
  actId: SnapPersonalDrawingValue["actId"]; label: string; instructions: string; expiresAt: string; disabled?: boolean;
  onChange: (value: SnapPersonalDrawingValue | null) => void; onRecovery: () => void;
};
export function SnapPersonalDrawing(props: DrawingProps) {
  return <DrawingSession key={JSON.stringify([props.actId, props.expiresAt, !!props.disabled])} {...props}/>;
}
function DrawingSession({ actId, label, instructions, expiresAt, disabled = false, onChange, onRecovery }: DrawingProps) {
  const id = useId(), canvas = useRef<HTMLCanvasElement>(null), drawing = useRef<Drawing>({ strokes: [] });
  const changed = useRef(onChange);
  const [hasInk, setHasInk] = useState(false), [active, setActive] = useState(false), [message, setMessage] = useState("");
  const [expired, setExpired] = useState(false), [focused, setFocused] = useState(false);
  const timeCurrent = usePermissionWindow(Date.parse(expiresAt));
  const supported = SNAP_PARENT_CERTIFICATION_ACTS.includes(actId), inactive = disabled || expired || !supported || !timeCurrent;
  useEffect(() => { changed.current = onChange; }, [onChange]);
  const clear = useCallback((message = "") => {
    erase(drawing.current, canvas.current); setHasInk(false); setActive(false); setMessage(message); changed.current(null);
  }, []);
  useEffect(() => {
    const surface = canvas.current, session = drawing.current, expiry = Date.parse(expiresAt);
    erase(session, surface); changed.current(null);
    let timer: ReturnType<typeof setTimeout> | undefined, width = 0, height = 0;
    const expire = () => {
      if (expiry > Date.now()) { timer = setTimeout(expire, Math.min(expiry - Date.now(), 2147483647)); return; }
      setExpired(true); clear("This drawing step expired. Check the current request before drawing again.");
    };
    if (Number.isFinite(expiry) && expiry > Date.now()) timer = setTimeout(expire, Math.min(expiry - Date.now(), 2147483647));
    const resize = () => {
      if (!surface) return;
      const bounds = drawingBox(surface);
      if (!Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) || bounds.width <= 0 || bounds.height <= 0 || (bounds.width === width && bounds.height === height)) return;
      const hadInk = drawing.current.strokes.length > 0;
      width = bounds.width; height = bounds.height;
      if (hadInk) clear("The drawing area changed. Please draw again, or choose another way.");
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      surface.width = Math.min(2048, Math.ceil(width * ratio)); surface.height = Math.min(1024, Math.ceil(height * ratio));
    };
    const leave = () => clear("The drawing was cleared when you left this page. Please draw again.");
    resize(); const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(resize);
    if (surface) observer?.observe(surface);
    window.addEventListener("resize", resize); window.addEventListener("pagehide", leave);
    return () => {
      clearTimeout(timer); observer?.disconnect(); window.removeEventListener("resize", resize); window.removeEventListener("pagehide", leave);
      erase(session, surface); if (surface) { surface.width = 0; surface.height = 0; } changed.current(null);
    };
  }, [actId, clear, disabled, expiresAt, supported]);

  function ready() {
    if (inactive) return false;
    if (!Number.isFinite(Date.parse(expiresAt)) || Date.now() >= Date.parse(expiresAt)) { setExpired(true); clear("This drawing step expired. Check the current request before drawing again."); return false; }
    return true;
  }
  function point(event: PointerEvent<HTMLCanvasElement>): Point | null {
    const bounds = drawingBox(event.currentTarget), x = (event.clientX - bounds.left) / bounds.width, y = 1 - (event.clientY - bounds.top) / bounds.height;
    const size = drawing.current.size;
    if (!Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) || bounds.width <= 0 || bounds.height <= 0
      || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1 || (size && (size.width !== bounds.width || size.height !== bounds.height))) return null;
    drawing.current.size ??= { width: bounds.width, height: bounds.height };
    return { x, y };
  }
  function append(event: PointerEvent<HTMLCanvasElement>) {
    const value = point(event), session = drawing.current, stroke = session.strokes.at(-1)!;
    if (!value) { clear("Keep the drawing inside the box. Please draw again, or choose another way."); return false; }
    const previous = stroke.at(-1)!;
    if (value.x === previous.x && value.y === previous.y) return true;
    if (stroke.length >= 512 || session.strokes.reduce((count, points) => count + points.length, 0) >= 2048) {
      clear("This drawing reached its limit. Please draw again, or choose another way."); return false;
    }
    const context = event.currentTarget.getContext("2d");
    if (!context) { clear(unavailable); return false; }
    context.strokeStyle = getComputedStyle(event.currentTarget).color; context.lineWidth = 2; context.lineCap = "round";
    context.beginPath(); context.moveTo(previous.x * event.currentTarget.width, (1 - previous.y) * event.currentTarget.height);
    context.lineTo(value.x * event.currentTarget.width, (1 - value.y) * event.currentTarget.height); context.stroke(); stroke.push(value); return true;
  }
  function publish() {
    const session = drawing.current;
    setHasInk(session.strokes.length > 0); setActive(false);
    if (session.started === undefined || session.completed === undefined || !session.strokes.length || !session.size) { changed.current(null); return; }
    const [x0, y0, x1, y1] = SNAP_DIRECT_CERTIFICATION_REGIONS[actId].ink, width = x1 - x0 - 2, height = y1 - y0 - 2;
    const points = session.strokes.flat(), size = session.size;
    const minX = Math.min(...points.map(point => point.x * size.width)), maxX = Math.max(...points.map(point => point.x * size.width));
    const minY = Math.min(...points.map(point => point.y * size.height)), maxY = Math.max(...points.map(point => point.y * size.height));
    const scale = Math.min(maxX > minX ? width / (maxX - minX) : Infinity, maxY > minY ? height / (maxY - minY) : Infinity);
    if (!Number.isFinite(scale) || scale <= 0) { clear(unavailable); return; }
    // One scale preserves handwriting; only floating-point roundoff at the field endpoints is clamped.
    const fitted = session.strokes.map(stroke => stroke.map(point => ({
      x: Math.max(0, Math.min(1, .5 + (point.x * size.width - (minX + maxX) / 2) * scale / width)),
      y: Math.max(0, Math.min(1, .5 + (point.y * size.height - (minY + maxY) / 2) * scale / height)),
    })));
    changed.current({
      actId, provenance: "caller_reported_fresh_parent_drawing", startedAt: new Date(session.started).toISOString(), completedAt: new Date(session.completed).toISOString(),
      date: easternDay.format(new Date(session.completed)), strokes: fitted,
    });
  }
  function start(event: PointerEvent<HTMLCanvasElement>) {
    if (!ready() || event.button !== 0 || !event.isPrimary || drawing.current.pointer !== undefined) return;
    event.preventDefault(); const value = point(event), session = drawing.current;
    if (!value || !event.currentTarget.getContext("2d")) { clear(unavailable); return; }
    if (session.strokes.length >= 16 || session.strokes.reduce((count, points) => count + points.length, 0) >= 2048) { clear("This drawing reached its limit. Please draw again, or choose another way."); return; }
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { clear(unavailable); return; }
    session.pointer = event.pointerId; session.started ??= Date.now(); session.strokes.push([value]);
    setActive(true); setMessage(""); changed.current(null);
  }
  function move(event: PointerEvent<HTMLCanvasElement>) {
    if (drawing.current.pointer !== event.pointerId || !ready()) return;
    event.preventDefault(); if (!event.buttons) clear("The drawing was interrupted. Please draw again, or choose another way."); else append(event);
  }
  function finish(event: PointerEvent<HTMLCanvasElement>) {
    if (drawing.current.pointer !== event.pointerId || !ready()) return;
    event.preventDefault(); if (!append(event)) return;
    const session = drawing.current, stroke = session.strokes.at(-1)!;
    session.pointer = undefined;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* Capture may already have ended. */ }
    if (stroke.length < 2) { stroke[0].x = 0; stroke[0].y = 0; session.strokes.pop(); if (!session.strokes.length) session.started = undefined; }
    else if (Date.now() < session.started!) { clear("The drawing time could not be checked. Please draw again, or choose another way."); return; }
    else session.completed = Date.now();
    publish();
  }
  function cancel(event: PointerEvent<HTMLCanvasElement>) {
    if (drawing.current.pointer === event.pointerId) clear("The drawing was interrupted. Please draw again, or choose another way.");
  }
  return <fieldset className={styles.fieldset} aria-describedby={`${id}-instructions ${id}-status`}>
    <legend className={styles.legend}>{label}</legend>
    <div className={styles.field}>
      <p id={`${id}-instructions`} className={styles.hint}>{instructions} Draw with your finger, mouse or pen. If you cannot draw here, choose another way below.</p>
      <canvas ref={canvas} width={640} height={160} role="img" aria-label={`${label} drawing area`} aria-describedby={`${id}-instructions ${id}-status`}
        tabIndex={inactive ? -1 : 0} className={styles.input} style={{ height: "10rem", padding: 0, touchAction: "none", outline: focused ? "3px solid var(--color-focus)" : undefined, outlineOffset: focused ? 4 : undefined }}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel}
        onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); clear(); } }}>
        Use a drawing-capable device or choose another way below.
      </canvas>
      <p id={`${id}-status`} className={styles.hint} role="status">{message || (inactive ? "Drawing is unavailable for this step." : active ? "Drawing in progress." : hasInk ? "Drawing added on this page. Clear it to start again." : "Draw inside the empty box. Escape clears the drawing.")}</p>
      <div className={styles.inline}>
        <button type="button" className={styles.quiet} disabled={inactive || (!hasInk && !active)} onClick={() => clear()}>Clear drawing</button>
        <button type="button" className={styles.quiet} disabled={disabled} onClick={() => { clear(); onRecovery(); }}>I need another way</button>
      </div>
    </div>
  </fieldset>;
}
