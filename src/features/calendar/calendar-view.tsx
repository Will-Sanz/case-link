"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, useMemo, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { CalendarEvent, CalendarEventType } from "@/types/calendar";
import type { FamilyListItem } from "@/types/family";
import { cn } from "@/lib/utils/cn";
import { getFamilyColor } from "@/lib/utils/family-colors";
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

function buildNavParams(
  view: string,
  dateRange: { start: string; end: string },
  dir: "prev" | "next",
): Record<string, string> {
  if (view === "month") {
    const [y, m] = dateRange.start.split("-").map(Number);
    let newYear = y;
    let newMonth = dir === "next" ? m + 1 : m - 1;
    if (newMonth > 12) {
      newMonth = 1;
      newYear += 1;
    } else if (newMonth < 1) {
      newMonth = 12;
      newYear -= 1;
    }
    return {
      view,
      month: `${newYear}-${String(newMonth).padStart(2, "0")}`,
    };
  }
  const d = new Date(dateRange.start + "T12:00:00");
  d.setDate(d.getDate() + (dir === "next" ? 7 : -7));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return { view, date: `${y}-${m}-${day}` };
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
  compact?: boolean;
};

export function CalendarView({
  events,
  workload,
  families,
  view,
  dateRange,
  monthLabel,
  compact = false,
}: CalendarViewProps) {
  const router = useRouter();
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);

  const prevParams = useMemo(
    () => buildNavParams(view, dateRange, "prev"),
    [view, dateRange.start, dateRange.end],
  );
  const nextParams = useMemo(
    () => buildNavParams(view, dateRange, "next"),
    [view, dateRange.start, dateRange.end],
  );
  const todayParams = useMemo(() => buildTodayParams(view), [view]);

  const prevHref = `/calendar?${new URLSearchParams(prevParams)}`;
  const nextHref = `/calendar?${new URLSearchParams(nextParams)}`;
  const todayHref = `/calendar?${new URLSearchParams(todayParams)}`;

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

  return (
    <div className={cn("flex min-h-0 flex-1", compact ? "flex-col lg:flex-row" : "flex-col gap-6 lg:flex-row")}>
      <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", compact && "overflow-hidden")}>
        {/* Google-style toolbar */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white py-2 pl-1 pr-3">
          <div className="flex items-center gap-1">
            <Link
              href={todayHref}
              onClick={(e) => handleNav(e, todayHref)}
              className={cn(
                "rounded px-2 py-1 font-medium transition-colors",
                compact ? "text-xs text-slate-700 hover:bg-slate-100" : "text-sm",
              )}
            >
              Today
            </Link>
            <div className="flex items-center">
              <Link
                href={prevHref}
                onClick={(e) => handleNav(e, prevHref)}
                className="rounded p-1 text-slate-600 hover:bg-slate-100"
                aria-label="Previous"
              >
                <span className={compact ? "text-sm" : ""}>‹</span>
              </Link>
              <Link
                href={nextHref}
                onClick={(e) => handleNav(e, nextHref)}
                className="rounded p-1 text-slate-600 hover:bg-slate-100"
                aria-label="Next"
              >
                <span className={compact ? "text-sm" : ""}>›</span>
              </Link>
            </div>
            <span className={cn("ml-2 font-medium text-slate-800", compact ? "text-sm" : "text-base")}>
              {monthLabel}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {(["month", "week", "agenda"] as const).map((v) => {
              const viewParams = {
                view: v,
                ...(v === "month"
                  ? { month: dateRange.start.slice(0, 7) }
                  : { date: dateRange.start }),
              };
              const viewHref = `/calendar?${new URLSearchParams(viewParams)}`;
              return (
                <Link
                  key={v}
                  href={viewHref}
                  onClick={(e) => handleNav(e, viewHref)}
                  className={cn(
                    "rounded px-2.5 py-1 font-medium transition-colors",
                    compact ? "text-xs" : "text-sm",
                    view === v
                      ? "bg-slate-100 text-slate-900"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                  )}
                >
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </Link>
              );
            })}
          </div>
        </div>

        {/* Compact workload pills */}
        <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-slate-100 bg-slate-50/50 px-3 py-1.5">
          {workload.dueToday > 0 && (
            <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-medium text-teal-800">
              {workload.dueToday} today
            </span>
          )}
          {workload.overdue > 0 && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-800">
              {workload.overdue} overdue
            </span>
          )}
          {workload.blocked > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
              {workload.blocked} blocked
            </span>
          )}
          {workload.escalated > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
              {workload.escalated} escalation
            </span>
          )}
          <span className="text-[11px] text-slate-500">
            {workload.dueThisWeek} this week · {workload.activeFamilies} families
          </span>
        </div>

        {/* Main calendar area - key forces full re-render when range changes */}
        <div
          key={`${view}-${dateRange.start}-${dateRange.end}`}
          className={cn("min-h-0 flex-1 overflow-auto", compact && "border border-slate-200 bg-white")}
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
      </div>

      {/* Detail panel - narrower when compact */}
      <aside className={cn("shrink-0 border-l border-slate-200 bg-white", compact ? "w-64 lg:w-72" : "w-full lg:w-80")}>
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
        "w-full rounded border border-l-4 px-1.5 py-0.5 text-left transition-all hover:shadow-sm focus:outline-none focus:ring-1 focus:ring-teal-500/30",
        isCompleted ? familyColor.muted : familyColor.bg,
        familyColor.border,
        isCompleted && "opacity-80",
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
      <div className="flex min-h-[300px] items-center justify-center p-8">
        <EmptyState
          title="No events this month"
          description="Follow-up dates and step due dates from your plans will appear here."
          action={
            <Link
              href="/families"
              className="text-xs font-medium text-teal-800 underline-offset-2 hover:underline"
            >
              Open Families
            </Link>
          }
        />
      </div>
    );
  }

  return <MonthGridInner dateRange={dateRange} eventsByDate={eventsByDate} onEventClick={onEventClick} compact={compact} />;
}

function MonthGridInner({
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

  const maxEvents = compact ? 6 : 4;

  return (
    <div className={cn(compact ? "p-1" : "p-3")}>
      <div className="grid min-h-[400px] grid-cols-7 gap-px bg-slate-200">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className={cn("bg-slate-50 py-1 text-center font-medium text-slate-600", compact ? "text-[10px]" : "text-xs")}>
            {d}
          </div>
        ))}
        {cells.map((c, i) => (
          <div
            key={i}
            className={cn(
              "min-h-0 overflow-hidden bg-white p-1",
              !c.date && "bg-slate-50/70",
            )}
          >
            {c.date && (
              <>
                <div
                  className={cn(
                    "mb-0.5 inline-flex items-center justify-center font-medium",
                    compact ? "h-4 w-4 text-[10px]" : "h-5 w-5 text-xs",
                    c.date === today && "rounded-full bg-blue-600 text-white",
                  )}
                >
                  {c.day}
                </div>
                <div className="space-y-0.5 overflow-hidden">
                  {(eventsByDate.get(c.date) ?? []).slice(0, maxEvents).map((ev) => (
                    <EventChip key={ev.id} event={ev} onClick={() => onEventClick(ev)} compact size="tiny" />
                  ))}
                  {(eventsByDate.get(c.date) ?? []).length > maxEvents && (
                    <span className="text-[10px] text-slate-500">
                      +{(eventsByDate.get(c.date) ?? []).length - maxEvents}
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
            <Link href="/families" className="text-xs font-medium text-teal-800 underline-offset-2 hover:underline">
              Open Families
            </Link>
          }
        />
      </div>
    );
  }

  return <WeekGridInner dateRange={dateRange} eventsByDate={eventsByDate} onEventClick={onEventClick} compact={compact} />;
}

function WeekGridInner({
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
    <div className={cn("h-full p-2", compact ? "p-1" : "p-3")}>
      <div className="grid h-full grid-cols-7 gap-1">
        {days.map(({ date, label }) => (
          <div
            key={date}
            className={cn(
              "min-h-0 overflow-auto rounded border p-2",
              date === today ? "border-blue-400 bg-blue-50/50" : "border-slate-200 bg-white",
            )}
          >
            <p className={cn("mb-1 font-medium text-slate-700", compact ? "text-[10px]" : "text-xs")}>{label}</p>
            <div className="space-y-0.5">
              {(eventsByDate.get(date) ?? []).map((ev) => (
                <EventChip key={ev.id} event={ev} onClick={() => onEventClick(ev)} size="tiny" />
              ))}
              {(eventsByDate.get(date) ?? []).length === 0 && (
                <p className="text-[10px] text-slate-400">None</p>
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
  const sections = overdueSection.events.length > 0
    ? [overdueSection, ...dateSections]
    : dateSections;

  const total =
    agendaGroups.overdue.length +
    agendaGroups.byDate.reduce((sum, d) => sum + d.events.length, 0);

  if (total === 0) {
    return (
      <div className="p-8">
        <EmptyState
          title="No calendar items"
          description="Set follow-up dates on plan steps to see them here."
          action={
            <Link href="/families" className="text-xs font-medium text-teal-800 underline-offset-2 hover:underline">
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
        <div key={title} className={compact ? "p-2" : "p-3"}>
          <h3 className={cn("mb-1.5 font-semibold text-slate-700", compact ? "text-[10px]" : "text-xs")}>{title}</h3>
          {events.length === 0 ? (
            <p className={cn("text-slate-500", compact ? "text-[10px]" : "text-xs")}>{empty}</p>
          ) : (
            <ul className="space-y-1">
              {events.map((ev) => (
                <li key={ev.id}>
                  <div className="flex items-start gap-2">
                    <span className={cn("shrink-0 text-slate-500", compact ? "text-[10px]" : "text-[11px]")}>
                      {new Date(ev.date).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: ev.date.slice(0, 4) !== String(new Date().getFullYear()) ? "numeric" : undefined,
                      })}
                    </span>
                    <div className="min-w-0 flex-1">
                      <EventChip event={ev} onClick={() => onEventClick(ev)} size="tiny" />
                      {(ev.blocked_flag || ev.escalated_flag) && (
                        <div className="mt-0.5 flex gap-1">
                          {ev.blocked_flag && (
                            <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-900">Blocked</span>
                          )}
                          {ev.escalated_flag && (
                            <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-900">Escalation</span>
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

  const familyColor = getFamilyColor(event.family_id);
  const stepHref = event.step_id
    ? `/families/${event.family_id}#step-${event.step_id}`
    : `/families/${event.family_id}`;

  return (
    <Card className={cn("sticky top-6 rounded-xl border-slate-200/90 p-5 shadow-sm transition-shadow border-l-4", familyColor.border)}>
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
