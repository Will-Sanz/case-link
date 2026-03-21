"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useMemo, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { CalendarEvent, CalendarEventType } from "@/types/calendar";
import type { FamilyListItem } from "@/types/family";
import { cn } from "@/lib/utils/cn";
import { updatePlanStepActionItem } from "@/app/actions/plans";

const EVENT_TYPE_LABELS: Record<CalendarEventType, string> = {
  follow_up_due: "Follow-up due",
  step_due: "Step due",
  overdue: "Overdue",
  blocked_review: "Blocked review",
  escalation_review: "Escalation",
  stale_case_check: "No activity",
  new_plan_review: "New plan",
  stage_milestone: "Stage",
};

const EVENT_TYPE_STYLES: Record<CalendarEventType, string> = {
  follow_up_due: "border-teal-200 bg-teal-50/80 text-teal-900",
  step_due: "border-slate-200 bg-slate-50/80 text-slate-800",
  overdue: "border-red-200 bg-red-50/80 text-red-900",
  blocked_review: "border-amber-200 bg-amber-50/80 text-amber-900",
  escalation_review: "border-amber-300 bg-amber-50/80 text-amber-900",
  stale_case_check: "border-slate-200 bg-slate-50/80 text-slate-700",
  new_plan_review: "border-teal-200 bg-teal-50/60 text-teal-800",
  stage_milestone: "border-slate-200 bg-slate-100 text-slate-700",
};

function buildNavParams(
  view: string,
  dateRange: { start: string; end: string },
  dir: "prev" | "next",
): Record<string, string> {
  const d = new Date(dateRange.start + "T12:00:00");
  if (view === "month") {
    d.setMonth(d.getMonth() + (dir === "next" ? 1 : -1));
    return { view, month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` };
  }
  if (view === "week") {
    d.setDate(d.getDate() + (dir === "next" ? 7 : -7));
    return { view, date: d.toISOString().slice(0, 10) };
  }
  d.setDate(d.getDate() + (dir === "next" ? 14 : -14));
  return { view, date: d.toISOString().slice(0, 10) };
}

function buildTodayParams(view: string): Record<string, string> {
  const today = new Date().toISOString().slice(0, 10);
  if (view === "month") {
    const [y, m] = today.split("-");
    return { view, month: `${y}-${m}` };
  }
  return { view, date: today };
}

type CalendarViewProps = {
  events: CalendarEvent[];
  workload: {
    dueToday: number;
    overdue: number;
    blocked: number;
    escalated: number;
    dueThisWeek: number;
    activeFamilies: number;
  };
  families: FamilyListItem[];
  view: "month" | "week" | "agenda";
  dateRange: { start: string; end: string };
  monthLabel: string;
};

export function CalendarView({
  events,
  workload,
  families,
  view,
  dateRange,
  monthLabel,
}: CalendarViewProps) {
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);

  const prevParams = buildNavParams(view, dateRange, "prev");
  const nextParams = buildNavParams(view, dateRange, "next");
  const todayParams = buildTodayParams(view);

  const prevHref = `/calendar?${new URLSearchParams(prevParams)}`;
  const nextHref = `/calendar?${new URLSearchParams(nextParams)}`;
  const todayHref = `/calendar?${new URLSearchParams(todayParams)}`;

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const list = map.get(e.date) ?? [];
      list.push(e);
      map.set(e.date, list);
    }
    return map;
  }, [events]);

  const agendaGroups = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowKey = tomorrow.toISOString().slice(0, 10);
    const weekEnd = new Date();
    weekEnd.setDate(weekEnd.getDate() + 7);
    const weekEndKey = weekEnd.toISOString().slice(0, 10);

    const overdue: CalendarEvent[] = [];
    const todayList: CalendarEvent[] = [];
    const tomorrowList: CalendarEvent[] = [];
    const thisWeek: CalendarEvent[] = [];
    const later: CalendarEvent[] = [];

    for (const e of events) {
      if (e.event_type === "overdue") overdue.push(e);
      else if (e.date === today) todayList.push(e);
      else if (e.date === tomorrowKey) tomorrowList.push(e);
      else if (e.date > tomorrowKey && e.date <= weekEndKey) thisWeek.push(e);
      else if (e.date > weekEndKey) later.push(e);
    }

    return { overdue, today: todayList, tomorrow: tomorrowList, thisWeek, later };
  }, [events]);

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className="min-w-0 flex-1 space-y-4">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
            {(["agenda", "week", "month"] as const).map((v) => (
              <Link
                key={v}
                href={`/calendar?${new URLSearchParams({ view: v, ...(v === "month" ? { month: dateRange.start.slice(0, 7) } : { date: dateRange.start }) })}`}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  view === v
                    ? "bg-teal-100 text-teal-900"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                )}
              >
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <Link href={prevHref}>
              <Button variant="secondary" className="px-2 py-1.5 text-sm">
                ←
              </Button>
            </Link>
            <Link href={todayHref}>
              <Button variant="secondary" className="px-3 py-1.5 text-sm">
                Today
              </Button>
            </Link>
            <Link href={nextHref}>
              <Button variant="secondary" className="px-2 py-1.5 text-sm">
                →
              </Button>
            </Link>
          </div>
          <span className="text-sm font-medium text-slate-700">{monthLabel}</span>
        </div>

        {/* Workload summary */}
        <div className="flex flex-wrap gap-3">
          {workload.dueToday > 0 && (
            <div className="rounded-lg border border-teal-200 bg-teal-50/60 px-3 py-2">
              <span className="text-sm font-medium text-teal-900">
                {workload.dueToday} due today
              </span>
            </div>
          )}
          {workload.overdue > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50/60 px-3 py-2">
              <span className="text-sm font-medium text-red-900">
                {workload.overdue} overdue
              </span>
            </div>
          )}
          {workload.blocked > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2">
              <span className="text-sm font-medium text-amber-900">
                {workload.blocked} blocked
              </span>
            </div>
          )}
          {workload.escalated > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50/60 px-3 py-2">
              <span className="text-sm font-medium text-amber-900">
                {workload.escalated} escalation
              </span>
            </div>
          )}
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
            <span className="text-sm text-slate-700">
              {workload.dueThisWeek} due this week · {workload.activeFamilies} families
            </span>
          </div>
        </div>

        {/* Main calendar area */}
        <Card className="min-h-[400px] overflow-hidden p-0">
          {view === "month" && (
            <MonthGrid
              dateRange={dateRange}
              eventsByDate={eventsByDate}
              onEventClick={setSelectedEvent}
            />
          )}
          {view === "week" && (
            <WeekGrid
              dateRange={dateRange}
              eventsByDate={eventsByDate}
              onEventClick={setSelectedEvent}
            />
          )}
          {view === "agenda" && (
            <AgendaList
              agendaGroups={agendaGroups}
              onEventClick={setSelectedEvent}
            />
          )}
        </Card>
      </div>

      {/* Detail panel */}
      <aside className="w-full shrink-0 lg:w-80">
        <EventDetailPanel
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onComplete={() => setSelectedEvent(null)}
        />
      </aside>
    </div>
  );
}

function EventChip({
  event,
  onClick,
  compact = false,
}: {
  event: CalendarEvent;
  onClick: () => void;
  compact?: boolean;
}) {
  const style = EVENT_TYPE_STYLES[event.event_type];
  const displayTitle = event.action_needed_now || `${event.family_name}${event.step_title ? `: ${event.step_title}` : ""}`;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "w-full rounded-lg border px-2 py-1.5 text-left text-sm transition-all hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30",
        style,
        compact && "truncate py-1 text-xs",
      )}
    >
      <span className="font-medium">{displayTitle}</span>
      {!compact && (
        <span className="mt-0.5 flex items-center gap-2">
          <span className="text-xs opacity-80">
            {EVENT_TYPE_LABELS[event.event_type]}
          </span>
          {event.stage && (
            <span className="rounded bg-white/60 px-1 text-xs">
              {event.stage}d
            </span>
          )}
          {event.priority && event.priority !== "medium" && (
            <span className="text-xs capitalize opacity-70">{event.priority}</span>
          )}
        </span>
      )}
    </button>
  );
}

function MonthGrid({
  dateRange,
  eventsByDate,
  onEventClick,
}: {
  dateRange: { start: string; end: string };
  eventsByDate: Map<string, CalendarEvent[]>;
  onEventClick: (e: CalendarEvent) => void;
}) {
  const totalEvents = [...eventsByDate.values()].reduce((s, arr) => s + arr.length, 0);
  if (totalEvents === 0) {
    return (
      <div className="flex min-h-[400px] items-center justify-center p-12">
        <EmptyState
          title="No events this month"
          description="Follow-up dates and step due dates from your plans will appear here. Set a follow-up date on a plan step to see it on the calendar."
          action={
            <Link
              href="/families"
              className="text-sm font-medium text-teal-800 underline-offset-2 hover:underline"
            >
              Open Families
            </Link>
          }
        />
      </div>
    );
  }

  return <MonthGridInner dateRange={dateRange} eventsByDate={eventsByDate} onEventClick={onEventClick} />;
}

function MonthGridInner({
  dateRange,
  eventsByDate,
  onEventClick,
}: {
  dateRange: { start: string; end: string };
  eventsByDate: Map<string, CalendarEvent[]>;
  onEventClick: (e: CalendarEvent) => void;
}) {
  const start = new Date(dateRange.start + "T12:00:00");
  const end = new Date(dateRange.end + "T12:00:00");
  const startDay = start.getDay();
  const padStart = startDay === 0 ? 6 : startDay - 1; // Monday first
  const daysInMonth = end.getDate();
  const totalCells = Math.ceil((padStart + daysInMonth) / 7) * 7;

  const today = new Date().toISOString().slice(0, 10);

  const cells: { date: string | null; day: number }[] = [];
  for (let i = 0; i < padStart; i++) {
    cells.push({ date: null, day: 0 });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(start);
    date.setDate(d);
    cells.push({ date: date.toISOString().slice(0, 10), day: d });
  }
  while (cells.length < totalCells) {
    cells.push({ date: null, day: 0 });
  }

  return (
    <div className="p-4">
      <div className="grid grid-cols-7 gap-px text-center">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="bg-slate-100 py-2 text-xs font-medium text-slate-600">
            {d}
          </div>
        ))}
        {cells.map((c, i) => (
          <div
            key={i}
            className={cn(
              "min-h-[100px] border-b border-r border-slate-100 bg-white p-2 last:border-r-0",
              !c.date && "bg-slate-50/50",
            )}
          >
            {c.date && (
              <>
                <div
                  className={cn(
                    "mb-1 inline-flex h-6 w-6 items-center justify-center text-xs font-medium",
                    c.date === today && "rounded-full bg-teal-600 text-white",
                  )}
                >
                  {c.day}
                </div>
                <div className="space-y-1">
                  {(eventsByDate.get(c.date) ?? []).slice(0, 3).map((ev) => (
                    <EventChip key={ev.id} event={ev} onClick={() => onEventClick(ev)} compact />
                  ))}
                  {(eventsByDate.get(c.date) ?? []).length > 3 && (
                    <span className="text-xs text-slate-500">
                      +{(eventsByDate.get(c.date) ?? []).length - 3} more
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function WeekGrid({
  dateRange,
  eventsByDate,
  onEventClick,
}: {
  dateRange: { start: string; end: string };
  eventsByDate: Map<string, CalendarEvent[]>;
  onEventClick: (e: CalendarEvent) => void;
}) {
  const totalEvents = [...eventsByDate.values()].reduce((s, arr) => s + arr.length, 0);
  if (totalEvents === 0) {
    return (
      <div className="flex min-h-[400px] items-center justify-center p-12">
        <EmptyState
          title="No events this week"
          description="Set follow-up dates on plan steps to see them here."
          action={
            <Link
              href="/families"
              className="text-sm font-medium text-teal-800 underline-offset-2 hover:underline"
            >
              Open Families
            </Link>
          }
        />
      </div>
    );
  }

  return <WeekGridInner dateRange={dateRange} eventsByDate={eventsByDate} onEventClick={onEventClick} />;
}

function WeekGridInner({
  dateRange,
  eventsByDate,
  onEventClick,
}: {
  dateRange: { start: string; end: string };
  eventsByDate: Map<string, CalendarEvent[]>;
  onEventClick: (e: CalendarEvent) => void;
}) {
  const start = new Date(dateRange.start + "T12:00:00");
  const today = new Date().toISOString().slice(0, 10);
  const days: { date: string; label: string }[] = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const dateKey = d.toISOString().slice(0, 10);
    days.push({
      date: dateKey,
      label: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
    });
  }

  return (
    <div className="p-4">
      <div className="grid grid-cols-7 gap-2">
        {days.map(({ date, label }) => (
          <div
            key={date}
            className={cn(
              "rounded-lg border p-3",
              date === today ? "border-teal-300 bg-teal-50/50" : "border-slate-200 bg-white",
            )}
          >
            <p className="mb-2 text-sm font-medium text-slate-700">{label}</p>
            <div className="space-y-1">
              {(eventsByDate.get(date) ?? []).map((ev) => (
                <EventChip key={ev.id} event={ev} onClick={() => onEventClick(ev)} />
              ))}
              {(eventsByDate.get(date) ?? []).length === 0 && (
                <p className="text-xs text-slate-400">No items</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AgendaList({
  agendaGroups,
  onEventClick,
}: {
  agendaGroups: {
    overdue: CalendarEvent[];
    today: CalendarEvent[];
    tomorrow: CalendarEvent[];
    thisWeek: CalendarEvent[];
    later: CalendarEvent[];
  };
  onEventClick: (e: CalendarEvent) => void;
}) {
  const sections = [
    { title: "Overdue", events: agendaGroups.overdue, empty: "No overdue items" },
    { title: "Today", events: agendaGroups.today, empty: "No items due today" },
    { title: "Tomorrow", events: agendaGroups.tomorrow, empty: "No items tomorrow" },
    { title: "This week", events: agendaGroups.thisWeek, empty: "Nothing this week" },
    { title: "Later", events: agendaGroups.later, empty: "Nothing upcoming" },
  ];

  const total = agendaGroups.overdue.length + agendaGroups.today.length +
    agendaGroups.tomorrow.length + agendaGroups.thisWeek.length + agendaGroups.later.length;

  if (total === 0) {
    return (
      <div className="p-12">
        <EmptyState
          title="No calendar items"
          description="As you assign follow-up dates and work through plan steps, tasks will appear here. Try opening a family and setting a next follow-up date on a step."
          action={
            <Link
              href="/families"
              className="text-sm font-medium text-teal-800 underline-offset-2 hover:underline"
            >
              Open Families
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="divide-y divide-slate-100">
      {sections.map(({ title, events, empty }) => (
        <div key={title} className="p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">{title}</h3>
          {events.length === 0 ? (
            <p className="text-sm text-slate-500">{empty}</p>
          ) : (
            <ul className="space-y-2">
              {events.map((ev) => (
                <li key={ev.id}>
                  <div className="flex items-start gap-3">
                    <span className="shrink-0 text-xs text-slate-500">
                      {new Date(ev.date).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: ev.date.slice(0, 4) !== String(new Date().getFullYear()) ? "numeric" : undefined,
                      })}
                    </span>
                    <div className="min-w-0 flex-1">
                      <EventChip event={ev} onClick={() => onEventClick(ev)} />
                      <p className="mt-1 text-xs text-slate-600">{ev.action_needed_now}</p>
                      {(ev.blocked_flag || ev.escalated_flag) && (
                        <div className="mt-1 flex gap-2">
                          {ev.blocked_flag && (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">
                              Blocked
                            </span>
                          )}
                          {ev.escalated_flag && (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">
                              Escalation
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function EventDetailPanel({
  event,
  onClose,
  onComplete,
}: {
  event: CalendarEvent | null;
  onClose: () => void;
  onComplete: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const canMarkComplete =
    event?.action_item_id &&
    event.status !== "completed" &&
    !event.completed_flag;

  async function handleMarkComplete() {
    if (!event?.action_item_id) return;
    setError(null);
    startTransition(async () => {
      const r = await updatePlanStepActionItem({
        actionItemId: event.action_item_id!,
        familyId: event.family_id,
        status: "completed",
      });
      if (!r.ok) setError(r.error);
      else {
        onComplete();
        router.refresh();
      }
    });
  }

  if (!event) {
    return (
      <Card className="sticky top-6 rounded-xl border-slate-200/90 p-6 shadow-sm">
        <p className="text-sm text-slate-500">
          Select an event to see details and actions.
        </p>
      </Card>
    );
  }

  const stepHref = event.step_id
    ? `/families/${event.family_id}#step-${event.step_id}`
    : `/families/${event.family_id}`;

  return (
    <Card className="sticky top-6 rounded-xl border-slate-200/90 p-5 shadow-sm transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-slate-900">Event details</h3>
        <Button variant="ghost" className="h-8 px-2" onClick={onClose}>
          ✕
        </Button>
      </div>
      <div className="mt-4 space-y-4">
        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
            {error}
          </p>
        )}
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Family
          </p>
          <p className="font-medium text-slate-900">{event.family_name}</p>
        </div>
        {event.stage && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Stage
            </p>
            <p className="text-slate-800">{event.stage}-day plan</p>
          </div>
        )}
        {event.step_title && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Step
            </p>
            <p className="text-slate-800">{event.step_title}</p>
          </div>
        )}
        {event.priority && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Priority
            </p>
            <p className="text-slate-800 capitalize">{event.priority}</p>
          </div>
        )}
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Type
          </p>
          <p className="text-slate-800">
            {EVENT_TYPE_LABELS[event.event_type]}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Date
          </p>
          <p className="text-slate-800">
            {new Date(event.date + "T12:00:00").toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Action needed
          </p>
          <p className="text-slate-800">{event.action_needed_now}</p>
        </div>
        {(event.blocked_flag || event.escalated_flag) && (
          <div className="flex gap-2">
            {event.blocked_flag && (
              <span className="rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900">
                Blocked
              </span>
            )}
            {event.escalated_flag && (
              <span className="rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900">
                Escalation
              </span>
            )}
          </div>
        )}
        <div className="flex flex-col gap-2 pt-4">
          {canMarkComplete && (
            <Button
              variant="primary"
              className="w-full"
              onClick={handleMarkComplete}
              disabled={pending}
            >
              {pending ? "Marking…" : "Mark complete"}
            </Button>
          )}
          <Link href={stepHref}>
            <Button variant="secondary" className="w-full">
              {event.step_id ? "Open step" : "Open case"}
            </Button>
          </Link>
          <Link href={`/families/${event.family_id}`}>
            <Button variant="ghost" className="w-full">
              Open full case
            </Button>
          </Link>
        </div>
      </div>
    </Card>
  );
}
