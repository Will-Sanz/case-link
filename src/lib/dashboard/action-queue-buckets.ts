/**
 * Homepage action queue bucketing by optional `due_date` on actionable items.
 *
 * ## Date handling
 * Dated buckets only apply when an attention item carries `due_date` (e.g. legacy data). Plan
 * action items no longer set follow-up dates; those items land in `undated`.
 * We compare **UTC calendar dates** (year-month-day in UTC) so bucketing is stable on servers
 * regardless of Node default timezone. This matches typical "business date" storage without time.
 *
 * ## Windows
 * - **Overdue**: due date < today (UTC)
 * - **Today**: due date === today (UTC)
 * - **Upcoming**: due date is tomorrow through today + UPCOMING_WINDOW_DAYS (inclusive end)
 *
 * Items **without** a parseable `YYYY-MM-DD` on `due_date` are not placed in these three buckets;
 * they are returned as `undated` for a separate "Other attention" section.
 */

import type { ActionableItem } from "@/lib/services/workflow";

/** Days after today included in "Upcoming" (e.g. 5 => tomorrow … today+5). */
export const UPCOMING_WINDOW_DAYS = 5;

/** ISO date prefix YYYY-MM-DD */
const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})/;

export function extractDueDateKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = iso.match(DATE_PREFIX);
  return m?.[1] ?? null;
}

/** Today's calendar date in UTC as YYYY-MM-DD. */
export function todayKeyUtc(): string {
  const n = new Date();
  const y = n.getUTCFullYear();
  const mo = String(n.getUTCMonth() + 1).padStart(2, "0");
  const d = String(n.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

export function addCalendarDaysUtc(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const u = new Date(Date.UTC(y, m - 1, d + deltaDays));
  const yy = u.getUTCFullYear();
  const mo = String(u.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(u.getUTCDate()).padStart(2, "0");
  return `${yy}-${mo}-${dd}`;
}

export type ActionQueueBuckets = {
  overdue: ActionableItem[];
  today: ActionableItem[];
  upcoming: ActionableItem[];
  /** Blocked, escalation, in progress, no activity, new plan, etc. — no dated bucket */
  undated: ActionableItem[];
};

/**
 * Split actionable items into overdue / today / upcoming / undated.
 * Items with due_date outside overdue…upcoming (e.g. due in 2 weeks) are omitted from
 * time buckets (not shown on this dashboard) to keep focus on near-term work.
 */
export function bucketActionableItems(items: ActionableItem[]): ActionQueueBuckets {
  const todayK = todayKeyUtc();
  const upcomingEndK = addCalendarDaysUtc(todayK, UPCOMING_WINDOW_DAYS);

  const overdue: ActionableItem[] = [];
  const today: ActionableItem[] = [];
  const upcoming: ActionableItem[] = [];
  const undated: ActionableItem[] = [];

  for (const item of items) {
    const key = extractDueDateKey(item.due_date ?? null);
    if (!key) {
      undated.push(item);
      continue;
    }
    if (key < todayK) {
      overdue.push(item);
    } else if (key === todayK) {
      today.push(item);
    } else if (key > todayK && key <= upcomingEndK) {
      upcoming.push(item);
    }
    // else: due beyond upcoming window — intentionally dropped from time-based queue
  }

  const byDueThenFamily = (a: ActionableItem, b: ActionableItem) => {
    const ka = extractDueDateKey(a.due_date)!;
    const kb = extractDueDateKey(b.due_date)!;
    if (ka !== kb) return ka.localeCompare(kb);
    return (a.family_name ?? "").localeCompare(b.family_name ?? "");
  };

  overdue.sort((a, b) => {
    const ka = extractDueDateKey(a.due_date)!;
    const kb = extractDueDateKey(b.due_date)!;
    if (ka !== kb) return ka.localeCompare(kb); // oldest (most overdue) first
    const da = a.days_overdue ?? 0;
    const db = b.days_overdue ?? 0;
    if (da !== db) return db - da;
    return (a.family_name ?? "").localeCompare(b.family_name ?? "");
  });

  today.sort(byDueThenFamily);
  upcoming.sort(byDueThenFamily);

  undated.sort((a, b) => {
    const order: ActionableItem["type"][] = [
      "blocked",
      "escalation",
      "overdue",
      "follow_up_today",
      "in_progress",
      "follow_up_soon",
      "new_plan",
      "no_activity",
    ];
    const ia = order.indexOf(a.type);
    const ib = order.indexOf(b.type);
    if (ia !== ib) return ia - ib;
    return (a.family_name ?? "").localeCompare(b.family_name ?? "");
  });

  return { overdue, today, upcoming, undated };
}
