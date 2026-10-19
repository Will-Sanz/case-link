import { parseDateOnly, schoolDate } from "@/lib/dates";

const MAX_PLAN_DAYS = 90;

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
  const start = parseDateOnly(planStartDate.length === 10 ? planStartDate : schoolDate(new Date(planStartDate)));
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
