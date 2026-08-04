const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_PLAN_DAYS = 90;

function parseDateOnly(value: string | null | undefined): Date | null {
  const match = value?.match(DATE_ONLY);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return parsed;
}

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function moveWeekendToMonday(value: Date): Date {
  const day = value.getUTCDay();
  if (day === 6) return addDays(value, 2);
  if (day === 0) return addDays(value, 1);
  return value;
}

/**
 * Resolve an exact action date. A valid model-proposed date is preserved when it
 * falls within the plan window; otherwise week cadence becomes a deterministic
 * weekday date. This keeps every generated action schedulable and reviewable.
 */
export function resolveActionTargetDate({
  planStartDate,
  weekIndex,
  proposedTargetDate,
}: {
  planStartDate: string;
  weekIndex: number;
  proposedTargetDate?: string | null;
}): string {
  const start = parseDateOnly(planStartDate.slice(0, 10));
  if (!start) {
    throw new Error("Plan start date must be a valid ISO date");
  }

  const proposed = parseDateOnly(proposedTargetDate);
  if (proposed) {
    const end = addDays(start, MAX_PLAN_DAYS);
    if (proposed >= start && proposed <= end) {
      return toDateOnly(proposed);
    }
  }

  const safeWeek = Math.min(Math.max(Math.trunc(weekIndex), 1), 12);
  const offset = Math.min((safeWeek - 1) * 7 + 2, MAX_PLAN_DAYS);
  return toDateOnly(moveWeekendToMonday(addDays(start, offset)));
}
