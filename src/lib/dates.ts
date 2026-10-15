/** The pilot school's calendar, shared by the browser, server, and AI context. */
export const SCHOOL_TIME_ZONE = "America/New_York";

export function schoolDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SCHOOL_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

export function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

export function addCalendarDays(value: string, days: number): string {
  const date = parseDateOnly(value);
  if (!date || !Number.isInteger(days)) throw new Error("A valid calendar date and whole days are required.");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Calendar dates never shift with the device timezone. Legacy goal timestamps retain their written date. */
export function formatDateOnly(value: string | null): string | null {
  const date = parseDateOnly(value?.slice(0, 10));
  return date ? new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC", month: "short", day: "numeric", year: "numeric",
  }).format(date) : null;
}
