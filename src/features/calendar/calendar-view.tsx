"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, useMemo, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { CalendarEvent, CalendarEventType } from "@/types/calendar";
import type { FamilyListItem } from "@/types/family";
import { cn } from "@/lib/utils/cn";
import { getFamilyColor } from "@/lib/utils/family-colors";
import { updatePlanStepActionItem } from "@/app/actions/plans";
import {
  addDays,
  addMonths,
  navigate,
  today,
  toKey,
  toSearchParams,
  startOfMonth,
  endOfMonth,
  type CalendarView as CalendarViewType,
} from "@/lib/utils/calendar-date";

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

function toHref(view: CalendarViewType, currentDate: Date): string {
  return `/calendar?${new URLSearchParams(toSearchParams(view, currentDate))}`;
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
  view: CalendarViewType;
  currentDateKey: string;
  dateRange: { start: string; end: string };
  monthLabel: string;
  compact?: boolean;
};

/** Google Calendar-style layout: left sidebar + large central grid + contextual detail drawer */
export function CalendarView({
  events,
  workload,
  families,
  view,
  currentDateKey,
  dateRange,
  monthLabel,
  compact = false,
}: CalendarViewProps) {
  const router = useRouter();
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);

  const currentDate = useMemo(
    () => new Date(currentDateKey + "T12:00:00"),
    [currentDateKey],
  );

  const prevHref = useMemo(
    () => toHref(view, navigate(view, currentDate, "prev")),
    [view, currentDateKey],
  );
  const nextHref = useMemo(
    () => toHref(view, navigate(view, currentDate, "next")),
    [view, currentDateKey],
  );
  const todayHref = useMemo(
    () => toHref(view, today()),
    [view],
  );

  const handleNav = useCallback(
    (e: React.MouseEvent, href: string) => {
      e.preventDefault();
      router.push(href);
    },
    [router],
  );

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
    const rangeStart = dateRange.start;
    const rangeEnd = dateRange.end;
    const overdue: CalendarEvent[] = [];
    const byDate: { date: string; label: string; events: CalendarEvent[] }[] = [];
    const eventDates = new Set<string>();
    for (const e of events) {
      if (e.date < rangeStart && e.event_type === "overdue") {
        overdue.push(e);
      } else if (e.date >= rangeStart && e.date <= rangeEnd) {
        eventDates.add(e.date);
      }
    }
    const sortedDates = [...eventDates].sort();
    for (const d of sortedDates) {
      const dayEvents = events.filter((e) => e.date === d);
      byDate.push({
        date: d,
        label: new Date(d + "T12:00:00").toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: d.slice(0, 4) !== String(new Date().getFullYear()) ? "numeric" : undefined,
        }),
        events: dayEvents,
      });
    }
    return { overdue, byDate };
  }, [events, dateRange.start, dateRange.end]);

  const miniMonthStart = startOfMonth(currentDate);
  const miniMonthEnd = endOfMonth(currentDate);
  const todayKey = toKey(today());

  return (
    <div className="flex min-h-[calc(100dvh-6rem)] w-full flex-col lg:flex-row">
      {/* Left sidebar - Google Calendar style */}
      <aside className="flex w-full shrink-0 flex-col border-b border-slate-200 bg-white lg:w-56 lg:border-b-0 lg:border-r">
        <div className="flex flex-col gap-4 p-4">
          {/* Today + prev/next */}
          <div className="flex items-center gap-1">
            <Link
              href={todayHref}
              onClick={(e) => handleNav(e, todayHref)}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
            >
              Today
            </Link>
            <div className="ml-auto flex items-center">
              <Link
                href={prevHref}
                onClick={(e) => handleNav(e, prevHref)}
                className="rounded p-1.5 text-slate-600 transition-colors hover:bg-slate-100"
                aria-label="Previous"
              >
                ‹
              </Link>
              <Link
                href={nextHref}
                onClick={(e) => handleNav(e, nextHref)}
                className="rounded p-1.5 text-slate-600 transition-colors hover:bg-slate-100"
                aria-label="Next"
              >
                ›
              </Link>
            </div>
          </div>

          {/* Month label */}
          <h2 className="text-base font-semibold text-slate-900">{monthLabel}</h2>

          {/* Mini month calendar */}
          <MiniMonthCalendar
            monthStart={miniMonthStart}
            monthEnd={miniMonthEnd}
            currentDateKey={currentDateKey}
            view={view}
            todayKey={todayKey}
          />

          {/* View switcher */}
          <div className="flex gap-0.5 rounded-lg border border-slate-200 p-0.5">
            {(["month", "week", "agenda"] as const).map((v) => {
              const viewHref = toHref(v, currentDate);
              return (
                <Link
                  key={v}
                  href={viewHref}
                  onClick={(e) => handleNav(e, viewHref)}
                  className={cn(
                    "flex-1 rounded-md px-2 py-1.5 text-center text-sm font-medium transition-colors",
                    view === v
                      ? "bg-slate-100 text-slate-900"
                      : "text-slate-600 hover:bg-slate-50",
                  )}
                >
                  {v === "month" ? "Month" : v === "week" ? "Week" : "Agenda"}
                </Link>
              );
            })}
          </div>

          {/* Workload summary */}
          <div className="space-y-1.5 border-t border-slate-100 pt-4">
            {workload.dueToday > 0 && (
              <p className="text-xs text-slate-600">
                <span className="font-medium text-blue-700">{workload.dueToday}</span> today
              </p>
            )}
            {workload.overdue > 0 && (
              <p className="text-xs text-slate-600">
                <span className="font-medium text-red-700">{workload.overdue}</span> overdue
              </p>
            )}
            {workload.blocked > 0 && (
              <p className="text-xs text-slate-600">
                <span className="font-medium text-amber-700">{workload.blocked}</span> blocked
              </p>
            )}
            <p className="text-xs text-slate-500">
              {workload.dueThisWeek} this week · {workload.activeFamilies} families
            </p>
          </div>
        </div>
      </aside>

      {/* Main calendar area - dominates */}
      <div className="relative min-h-0 flex-1 overflow-hidden bg-white">
        <div
          key={`${view}-${dateRange.start}-${dateRange.end}`}
          className="flex h-full flex-col overflow-auto"
        >
          {view === "month" && (
            <MonthGrid
              dateRange={dateRange}
              eventsByDate={eventsByDate}
              onEventClick={setSelectedEvent}
              compact={compact}
            />
          )}
          {view === "week" && (
            <WeekGrid
              dateRange={dateRange}
              eventsByDate={eventsByDate}
              onEventClick={setSelectedEvent}
              compact={compact}
            />
          )}
          {view === "agenda" && (
            <AgendaList
              agendaGroups={agendaGroups}
              onEventClick={setSelectedEvent}
              compact={compact}
            />
          )}
        </div>

        {/* Detail drawer - only when event selected, slides in from right */}
        {selectedEvent && (
          <div className="absolute inset-y-0 right-0 z-20 w-full border-l border-slate-200 bg-white shadow-lg lg:w-96">
            <EventDetailPanel
              event={selectedEvent}
              onClose={() => setSelectedEvent(null)}
              onComplete={() => setSelectedEvent(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** Mini month for sidebar - click date to navigate */
function MiniMonthCalendar({
  monthStart,
  monthEnd,
  currentDateKey,
  view,
  todayKey,
}: {
  monthStart: Date;
  monthEnd: Date;
  currentDateKey: string;
  view: CalendarViewType;
  todayKey: string;
}) {
  const router = useRouter();
  const startDay = monthStart.getDay();
  const padStart = startDay === 0 ? 6 : startDay - 1;
  const daysInMonth = monthEnd.getDate();

  const cells: { date: string | null; day: number }[] = [];
  for (let i = 0; i < padStart; i++) cells.push({ date: null, day: 0 });
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(monthStart);
    date.setDate(d);
    cells.push({ date: toKey(date), day: d });
  }

  function goToDate(dateKey: string) {
    const params = new URLSearchParams({ view, date: dateKey });
    router.push(`/calendar?${params}`);
  }

  return (
    <div className="grid grid-cols-7 gap-0.5 text-center">
      {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
        <span key={i} className="text-[10px] font-medium text-slate-400">
          {d}
        </span>
      ))}
      {cells.map((c, i) => {
        if (!c.date) return <span key={i} />;
        const isToday = c.date === todayKey;
        const isCurrent = c.date === currentDateKey;
        return (
          <button
            key={i}
            type="button"
            onClick={() => goToDate(c.date!)}
            className={cn(
              "rounded py-1 text-xs font-medium transition-colors",
              isToday && "bg-blue-500/90 text-white",
              !isToday && isCurrent && "bg-slate-200 text-slate-900",
              !isToday && !isCurrent && "text-slate-700 hover:bg-slate-100",
            )}
          >
            {c.day}
          </button>
        );
      })}
    </div>
  );
}

function EventChip({
  event,
  onClick,
  compact = false,
  size = "default",
}: {
  event: CalendarEvent;
  onClick: () => void;
  compact?: boolean;
  size?: "default" | "tiny";
}) {
  const familyColor = getFamilyColor(event.family_id);
  const isCompleted = event.completed_flag;
  const displayTitle = event.action_needed_now || `${event.family_name}${event.step_title ? `: ${event.step_title}` : ""}`;
  const isTiny = size === "tiny" || compact;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "w-full rounded border border-l-4 px-2 py-1 text-left transition-all hover:shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-400/30",
        isCompleted ? familyColor.muted : familyColor.bg,
        familyColor.border,
        isCompleted && "opacity-75",
        isTiny ? "text-[11px] leading-tight" : "text-xs",
        compact && "truncate",
      )}
      title={`${event.family_name} — ${displayTitle}`}
    >
      <span className="font-medium text-slate-800">{displayTitle}</span>
      {!compact && !isTiny && (
        <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-600">
          {event.stage && <span>{event.stage}d</span>}
          {event.priority && event.priority !== "medium" && (
            <span className="capitalize">{event.priority}</span>
          )}
          {isCompleted && <span>✓</span>}
        </span>
      )}
      {isTiny && isCompleted && <span className="ml-0.5 opacity-70">✓</span>}
    </button>
  );
}

function MonthGrid({
  dateRange,
  eventsByDate,
  onEventClick,
  compact = false,
}: {
  dateRange: { start: string; end: string };
  eventsByDate: Map<string, CalendarEvent[]>;
  onEventClick: (e: CalendarEvent) => void;
  compact?: boolean;
}) {
  const totalEvents = [...eventsByDate.values()].reduce((s, arr) => s + arr.length, 0);
  if (totalEvents === 0) {
    return (
      <div className="flex min-h-[400px] items-center justify-center p-12">
        <EmptyState
          title="No events this month"
          description="Follow-up dates and step due dates from your plans will appear here."
          action={
            <Link href="/families" className="text-sm font-medium text-blue-600 underline-offset-2 hover:underline">
              Open Families
            </Link>
          }
        />
      </div>
    );
  }

  const start = new Date(dateRange.start + "T12:00:00");
  const end = new Date(dateRange.end + "T12:00:00");
  const startDay = start.getDay();
  const padStart = startDay === 0 ? 6 : startDay - 1;
  const daysInMonth = end.getDate();
  const totalCells = Math.ceil((padStart + daysInMonth) / 7) * 7;
  const todayKey = new Date().toISOString().slice(0, 10);

  const cells: { date: string | null; day: number }[] = [];
  for (let i = 0; i < padStart; i++) cells.push({ date: null, day: 0 });
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(start);
    date.setDate(d);
    cells.push({ date: date.toISOString().slice(0, 10), day: d });
  }
  while (cells.length < totalCells) cells.push({ date: null, day: 0 });

  return (
    <div className={cn("flex-1 p-4", compact && "p-3")}>
      <div className="grid min-h-[500px] flex-1 grid-cols-7 gap-px bg-slate-200">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="bg-slate-50 py-2 text-center text-xs font-medium text-slate-600">
            {d}
          </div>
        ))}
        {cells.map((c, i) => {
          const dayEvents = c.date ? (eventsByDate.get(c.date) ?? []) : [];
          return (
            <div
              key={i}
              className={cn(
                "flex min-h-[80px] flex-col overflow-hidden bg-white p-1.5",
                !c.date && "bg-slate-50/80",
              )}
            >
              {c.date && (
                <>
                  <div
                    className={cn(
                      "mb-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-medium",
                      c.date === todayKey ? "bg-blue-500/90 text-white" : "text-slate-700",
                    )}
                  >
                    {c.day}
                  </div>
                  <div className="max-h-[140px] min-h-0 flex-1 space-y-1 overflow-y-auto">
                    {dayEvents.map((ev) => (
                      <EventChip key={ev.id} event={ev} onClick={() => onEventClick(ev)} compact size="tiny" />
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekGrid({
  dateRange,
  eventsByDate,
  onEventClick,
  compact = false,
}: {
  dateRange: { start: string; end: string };
  eventsByDate: Map<string, CalendarEvent[]>;
  onEventClick: (e: CalendarEvent) => void;
  compact?: boolean;
}) {
  const totalEvents = [...eventsByDate.values()].reduce((s, arr) => s + arr.length, 0);
  if (totalEvents === 0) {
    return (
      <div className="flex min-h-[300px] items-center justify-center p-8">
        <EmptyState
          title="No events this week"
          description="Set follow-up dates on plan steps to see them here."
          action={
            <Link href="/families" className="text-sm font-medium text-blue-600 underline-offset-2 hover:underline">
              Open Families
            </Link>
          }
        />
      </div>
    );
  }

  const start = new Date(dateRange.start + "T12:00:00");
  const todayKey = new Date().toISOString().slice(0, 10);
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
    <div className={cn("flex-1 p-4", compact && "p-3")}>
      <div className="grid h-full min-h-[400px] grid-cols-7 gap-2">
        {days.map(({ date, label }) => (
          <div
            key={date}
            className={cn(
              "min-h-0 overflow-auto rounded-lg border p-3",
              date === todayKey ? "border-blue-300 bg-blue-50/40" : "border-slate-200 bg-white",
            )}
          >
            <p className="mb-2 text-xs font-medium text-slate-700">{label}</p>
            <div className="space-y-1">
              {(eventsByDate.get(date) ?? []).map((ev) => (
                <EventChip key={ev.id} event={ev} onClick={() => onEventClick(ev)} size="tiny" />
              ))}
              {(eventsByDate.get(date) ?? []).length === 0 && (
                <p className="text-xs text-slate-400">None</p>
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
  compact = false,
}: {
  agendaGroups: {
    overdue: CalendarEvent[];
    byDate: { date: string; label: string; events: CalendarEvent[] }[];
  };
  onEventClick: (e: CalendarEvent) => void;
  compact?: boolean;
}) {
  const overdueSection = { title: "Overdue", events: agendaGroups.overdue, empty: "None" };
  const dateSections = agendaGroups.byDate.map((d) => ({
    title: d.label,
    events: d.events,
    empty: "None" as const,
  }));
  const sections =
    overdueSection.events.length > 0 ? [overdueSection, ...dateSections] : dateSections;
  const total =
    agendaGroups.overdue.length +
    agendaGroups.byDate.reduce((sum, d) => sum + d.events.length, 0);

  if (total === 0) {
    return (
      <div className="p-12">
        <EmptyState
          title="No calendar items"
          description="Set follow-up dates on plan steps to see them here."
          action={
            <Link href="/families" className="text-sm font-medium text-blue-600 underline-offset-2 hover:underline">
              Open Families
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="divide-y divide-slate-100 p-4">
      {sections.map(({ title, events, empty }) => (
        <div key={title} className={cn("py-4", compact && "py-3")}>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">{title}</h3>
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
                      <EventChip event={ev} onClick={() => onEventClick(ev)} size="tiny" />
                      {(ev.blocked_flag || ev.escalated_flag) && (
                        <div className="mt-1 flex gap-1">
                          {ev.blocked_flag && (
                            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800">Blocked</span>
                          )}
                          {ev.escalated_flag && (
                            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800">Escalation</span>
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
  event: CalendarEvent;
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

  const familyColor = getFamilyColor(event.family_id);
  const stepHref = event.step_id
    ? `/families/${event.family_id}#step-${event.step_id}`
    : `/families/${event.family_id}`;

  return (
    <div className={cn("flex h-full flex-col border-l-4", familyColor.border)}>
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
        <h3 className="font-semibold text-slate-900">Event details</h3>
        <Button variant="ghost" className="h-8 w-8 p-0" onClick={onClose} aria-label="Close">
          ✕
        </Button>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-4">
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
              {error}
            </p>
          )}
          <div>
            <p className="text-xs font-medium text-slate-500">Family</p>
            <p className="font-medium text-slate-900">{event.family_name}</p>
          </div>
          {event.step_title && (
            <div>
              <p className="text-xs font-medium text-slate-500">Step</p>
              <p className="text-slate-800">{event.step_title}</p>
            </div>
          )}
          <div>
            <p className="text-xs font-medium text-slate-500">Date</p>
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
            <p className="text-xs font-medium text-slate-500">Action needed</p>
            <p className="text-slate-800">{event.action_needed_now}</p>
          </div>
          {(event.blocked_flag || event.escalated_flag) && (
            <div className="flex gap-2">
              {event.blocked_flag && (
                <span className="rounded bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">Blocked</span>
              )}
              {event.escalated_flag && (
                <span className="rounded bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">Escalation</span>
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
      </div>
    </div>
  );
}
