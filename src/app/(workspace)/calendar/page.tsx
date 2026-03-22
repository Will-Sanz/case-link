import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCalendarEvents } from "@/lib/services/calendar";
import { listFamilies } from "@/lib/services/families";
import { CalendarView } from "@/features/calendar/calendar-view";
import {
  parseCurrentDate,
  getVisibleRange,
  today,
  type CalendarView as CalendarViewType,
} from "@/lib/utils/calendar-date";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CalendarPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const view = (typeof params.view === "string" ? params.view : "month") as CalendarViewType;
  const monthParam = typeof params.month === "string" ? params.month : null;
  const dateParam = typeof params.date === "string" ? params.date : null;

  const currentDate = parseCurrentDate(view, monthParam, dateParam);
  const { start, end, monthLabel } = getVisibleRange(view, currentDate);

  const supabase = await createSupabaseServerClient();

  const [events, familiesRes] = await Promise.all([
    getCalendarEvents(supabase, { startDate: start, endDate: end }),
    listFamilies(supabase, { q: "", page: 1, pageSize: 200 }),
  ]);

  const todayKey = today().toISOString().slice(0, 10);
  const weekEnd = new Date(todayKey);
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
    if (e.date === todayKey) dueToday++;
    if (e.date >= todayKey && e.date <= weekEndKey) dueThisWeek++;
  }
  const workload = {
    dueToday,
    overdue,
    blocked,
    escalated,
    dueThisWeek,
    activeFamilies: familyIds.size,
  };

  const currentDateKey = currentDate.toISOString().slice(0, 10);

  return (
    <div className="flex min-h-[calc(100dvh-6rem)] flex-col">
      <CalendarView
        events={events}
        workload={workload}
        families={familiesRes.items}
        view={view}
        currentDateKey={currentDateKey}
        dateRange={{ start, end }}
        monthLabel={monthLabel}
        compact
      />
    </div>
  );
}
