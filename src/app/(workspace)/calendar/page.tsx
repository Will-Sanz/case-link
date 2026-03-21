import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCalendarEvents } from "@/lib/services/calendar";
import { listFamilies } from "@/lib/services/families";
import { CalendarView } from "@/features/calendar/calendar-view";

export const dynamic = "force-dynamic";

function getDateRange(
  view: string,
  monthParam: string | null,
  dateParam: string | null,
): { start: string; end: string; monthLabel: string } {
  const now = new Date();
  let start: Date;
  let end: Date;

  if (view === "agenda") {
    const base = dateParam
      ? new Date(dateParam + "T12:00:00")
      : new Date();
    start = new Date(base);
    start.setDate(start.getDate() - 7);
    end = new Date(base);
    end.setDate(end.getDate() + 30);
    const s = start.toISOString().slice(0, 10);
    const e = end.toISOString().slice(0, 10);
    return {
      start: s,
      end: e,
      monthLabel: `${start.toLocaleDateString("en-US", { month: "short", year: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", year: "numeric" })}`,
    };
  }

  if (view === "week") {
    const base = dateParam ? new Date(dateParam + "T12:00:00") : new Date();
    const day = base.getDay();
    const diff = base.getDate() - day + (day === 0 ? -6 : 1); // Monday
    start = new Date(base);
    start.setDate(diff);
    end = new Date(start);
    end.setDate(end.getDate() + 6);
    const s = start.toISOString().slice(0, 10);
    const e = end.toISOString().slice(0, 10);
    return {
      start: s,
      end: e,
      monthLabel: `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
    };
  }

  // month view
  const [y, m] = monthParam
    ? monthParam.split("-").map(Number)
    : [now.getFullYear(), now.getMonth() + 1];
  start = new Date(y, (m ?? now.getMonth() + 1) - 1, 1);
  end = new Date(y, (m ?? now.getMonth() + 1), 0);
  const s = start.toISOString().slice(0, 10);
  const e = end.toISOString().slice(0, 10);
  return {
    start: s,
    end: e,
    monthLabel: start.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
  };
}

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CalendarPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const view = (typeof params.view === "string" ? params.view : "agenda") as
    | "month"
    | "week"
    | "agenda";
  const monthParam = typeof params.month === "string" ? params.month : null;
  const dateParam = typeof params.date === "string" ? params.date : null;

  const { start, end, monthLabel } = getDateRange(view, monthParam, dateParam);

  const supabase = await createSupabaseServerClient();

  const [events, familiesRes] = await Promise.all([
    getCalendarEvents(supabase, { startDate: start, endDate: end }),
    listFamilies(supabase, { q: "", page: 1, pageSize: 200 }),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const weekEnd = new Date();
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekEndKey = weekEnd.toISOString().slice(0, 10);

  let dueToday = 0;
  let overdue = 0;
  let blocked = 0;
  let escalated = 0;
  let dueThisWeek = 0;
  const familyIds = new Set<string>();
  for (const e of events) {
    familyIds.add(e.family_id);
    if (e.event_type === "overdue") overdue++;
    if (e.blocked_flag) blocked++;
    if (e.escalated_flag) escalated++;
    if (e.date === today) dueToday++;
    if (e.date >= today && e.date <= weekEndKey) dueThisWeek++;
  }
  const workload = {
    dueToday,
    overdue,
    blocked,
    escalated,
    dueThisWeek,
    activeFamilies: familyIds.size,
  };

  return (
    <div className="-mx-4 -mb-8 -mt-8 flex min-h-[calc(100dvh-8rem)] flex-col sm:-mx-6 lg:-mb-10 lg:-mx-8 lg:-mt-10">
      <CalendarView
        events={events}
        workload={workload}
        families={familiesRes.items}
        view={view}
        dateRange={{ start, end }}
        monthLabel={monthLabel}
        compact
      />
    </div>
  );
}
