/**
 * Minimal calendar date utilities. Pure functions only.
 * Single source of truth: currentDate. Everything derived from it.
 */

export type CalendarView = "month" | "week" | "agenda";

export function toKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function noon(d: Date): Date {
  const c = new Date(d);
  c.setHours(12, 0, 0, 0);
  return c;
}

/** Add days (immutable) */
export function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

/** Add months (immutable) */
export function addMonths(d: Date, n: number): Date {
  const c = new Date(d);
  c.setMonth(c.getMonth() + n);
  return c;
}

/** Monday = first day of week */
function startOfWeek(d: Date): Date {
  const c = new Date(d);
  const day = c.getDay();
  const diff = c.getDate() - day + (day === 0 ? -6 : 1);
  c.setDate(diff);
  c.setHours(0, 0, 0, 0);
  return c;
}

/** First day of month */
export function startOfMonth(d: Date): Date {
  const c = new Date(d.getFullYear(), d.getMonth(), 1);
  c.setHours(0, 0, 0, 0);
  return c;
}

/** Last day of month */
export function endOfMonth(d: Date): Date {
  const c = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  c.setHours(23, 59, 59, 999);
  return c;
}

/**
 * Parse URL params into currentDate (single source of truth).
 * Default: today, month view.
 */
export function parseCurrentDate(
  view: CalendarView,
  monthParam: string | null,
  dateParam: string | null
): Date {
  const now = new Date();

  if (view === "month" && monthParam) {
    const [y, m] = monthParam.split("-").map(Number);
    return noon(new Date(y, (m ?? 1) - 1, 15));
  }

  if ((view === "week" || view === "agenda") && dateParam) {
    const d = noon(new Date(dateParam + "T12:00:00"));
    return view === "week" ? startOfWeek(d) : d;
  }

  if (view === "month") {
    return noon(new Date(now.getFullYear(), now.getMonth(), 15));
  }
  const n = noon(now);
  return view === "week" ? startOfWeek(n) : n;
}

/**
 * Derive visible range and header from currentDate + view.
 */
export function getVisibleRange(
  view: CalendarView,
  currentDate: Date
): { start: string; end: string; monthLabel: string } {
  const cur = noon(currentDate);

  if (view === "month") {
    const start = startOfMonth(cur);
    const end = endOfMonth(cur);
    return {
      start: toKey(start),
      end: toKey(end),
      monthLabel: start.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    };
  }

  if (view === "week") {
    const start = startOfWeek(cur);
    const end = addDays(start, 6);
    return {
      start: toKey(start),
      end: toKey(end),
      monthLabel: `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
    };
  }

  // agenda: 7 days back, 30 forward from currentDate
  const start = addDays(cur, -7);
  const end = addDays(cur, 30);
  return {
    start: toKey(start),
    end: toKey(end),
    monthLabel: `${start.toLocaleDateString("en-US", { month: "short", year: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", year: "numeric" })}`,
  };
}

/**
 * Compute next/prev date for navigation.
 */
export function navigate(
  view: CalendarView,
  currentDate: Date,
  direction: "prev" | "next"
): Date {
  const delta = direction === "next" ? 1 : -1;

  if (view === "month") {
    return addMonths(currentDate, delta);
  }
  if (view === "week" || view === "agenda") {
    return addDays(currentDate, delta * 7);
  }
  return addDays(currentDate, delta);
}

/**
 * Today as a Date at noon.
 */
export function today(): Date {
  return noon(new Date());
}

/**
 * Build URL search params for a given view + date.
 */
export function toSearchParams(
  view: CalendarView,
  currentDate: Date
): Record<string, string> {
  const key = toKey(currentDate);

  if (view === "month") {
    const [y, m] = key.split("-");
    return { view, month: `${y}-${m}` };
  }
  return { view, date: key };
}
