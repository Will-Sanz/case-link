import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  ChecklistProgressBadge,
  StepStatusBadge,
} from "@/features/families/step-status-badge";
import type { ActionQueueBuckets } from "@/lib/dashboard/action-queue-buckets";
import { UPCOMING_WINDOW_DAYS } from "@/lib/dashboard/action-queue-buckets";
import type { ActionableItem } from "@/lib/services/workflow";
import { cn } from "@/lib/utils/cn";
import {
  formatQueueTiming,
  getQueueCtaLabel,
  queueItemHref,
} from "./dashboard-queue-utils";

const UNDATED_TYPE_LABEL: Record<ActionableItem["type"], string> = {
  overdue: "Overdue",
  blocked: "Blocked",
  follow_up_today: "Due today",
  follow_up_soon: "Due soon",
  escalation: "Escalation",
  in_progress: "In progress",
  no_activity: "No activity",
  new_plan: "New plan",
};

function ActionTitle({ item }: { item: ActionableItem }) {
  const raw = item.action_item_title ?? item.step_title ?? item.action;
  const title = raw.replace(/^\s*[^:]+:\s*/, "").trim() || item.action;
  return (
    <p className="font-semibold leading-snug text-slate-900 line-clamp-2">{title}</p>
  );
}

function QueueRow({
  item,
  bucket,
  timingClassName,
}: {
  item: ActionableItem;
  bucket: "overdue" | "today" | "upcoming" | "undated";
  timingClassName: string;
}) {
  const href = queueItemHref(item);
  const timing =
    bucket === "undated" ?
      UNDATED_TYPE_LABEL[item.type]
    : formatQueueTiming(item, bucket);

  return (
    <li>
      <Link
        href={href}
        className="flex flex-col gap-2 rounded-lg border border-slate-200/90 bg-white px-4 py-3 transition-colors hover:border-blue-200 hover:bg-blue-50/30 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
      >
        <div className="min-w-0 flex-1 space-y-1">
          <ActionTitle item={item} />
          <p className="text-sm text-slate-600">{item.family_name}</p>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex rounded-md px-2 py-0.5 text-xs font-semibold",
                timingClassName,
              )}
            >
              {timing}
            </span>
            {item.checklist_progress && item.checklist_progress.total > 0 ? (
              <ChecklistProgressBadge
                completed={item.checklist_progress.completed}
                total={item.checklist_progress.total}
                showBar
              />
            ) : null}
            {item.step_status && bucket !== "undated" ? (
              <StepStatusBadge
                status={
                  item.step_status as
                    | "pending"
                    | "in_progress"
                    | "completed"
                    | "blocked"
                }
              />
            ) : null}
          </div>
        </div>
        <span className="shrink-0 rounded-lg bg-blue-500/90 px-4 py-2 text-center text-sm font-medium text-white sm:min-w-[8.5rem]">
          {getQueueCtaLabel(item)}
        </span>
      </Link>
    </li>
  );
}

function QueueSection({
  title,
  description,
  count,
  items,
  bucket,
  timingClassName,
  sectionClassName,
  headerClassName,
  emptyTitle,
  emptyDescription,
}: {
  title: string;
  description: string;
  count: number;
  items: ActionableItem[];
  bucket: "overdue" | "today" | "upcoming" | "undated";
  timingClassName: string;
  sectionClassName: string;
  headerClassName: string;
  emptyTitle: string;
  emptyDescription: string;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border bg-white shadow-sm",
        sectionClassName,
      )}
    >
      <div className={cn("border-b px-4 py-3 sm:px-5", headerClassName)}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold tracking-tight text-slate-900 sm:text-lg">
              {title}
            </h2>
            <p className="mt-0.5 text-xs text-slate-600 sm:text-sm">{description}</p>
          </div>
          <Badge
            className={cn(
              "min-w-[2.25rem] justify-center text-sm font-bold tabular-nums",
              bucket === "overdue" && "border-red-200 bg-red-100 text-red-900",
              bucket === "today" && "border-blue-200 bg-blue-100 text-blue-900",
              bucket === "upcoming" && "border-slate-200 bg-slate-100 text-slate-800",
              bucket === "undated" && "border-slate-200 bg-slate-50 text-slate-700",
            )}
          >
            {count}
          </Badge>
        </div>
      </div>
      <div className="p-3 sm:p-4">
        {items.length === 0 ?
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-4 py-8 text-center">
            <p className="text-sm font-medium text-slate-700">{emptyTitle}</p>
            <p className="mt-1 text-xs text-slate-500">{emptyDescription}</p>
          </div>
        : <ul className="space-y-2">
            {items.map((item, idx) => (
              <QueueRow
                key={`${item.family_id}-${item.step_id}-${item.action}-${item.due_date ?? ""}-${idx}`}
                item={item}
                bucket={bucket}
                timingClassName={timingClassName}
              />
            ))}
          </ul>
        }
      </div>
    </section>
  );
}

export function ActionQueueDashboard({ buckets }: { buckets: ActionQueueBuckets }) {
  const { overdue, today, upcoming, undated } = buckets;
  const datedTotal = overdue.length + today.length + upcoming.length;
  const hasAnything = datedTotal > 0 || undated.length > 0;

  if (!hasAnything) {
    return (
      <Card className="border-slate-200 p-8">
        <EmptyState
          className="border-0 bg-transparent"
          title="All caught up"
          description="No dated follow-ups in the next few days and nothing else flagged. Browse families or the calendar when you're ready."
          action={
            <Link
              href="/families"
              className="text-sm font-medium text-blue-600/90 underline-offset-2 hover:text-blue-600 hover:underline"
            >
              View all families
            </Link>
          }
        />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <QueueSection
        title="Overdue"
        description="Past due, handle these first."
        count={overdue.length}
        items={overdue}
        bucket="overdue"
        timingClassName="bg-red-100 text-red-900 border border-red-200/80"
        sectionClassName="border-red-200/80 ring-1 ring-red-100/60"
        headerClassName="border-red-100 bg-red-50/90"
        emptyTitle="Nothing overdue"
        emptyDescription="You're on top of past-due follow-ups. Nice work."
      />

      <QueueSection
        title="Today"
        description="Due today, don't let these slip."
        count={today.length}
        items={today}
        bucket="today"
        timingClassName="bg-blue-100 text-blue-900 border border-blue-200/80"
        sectionClassName="border-blue-200/60"
        headerClassName="border-blue-100 bg-blue-50/70"
        emptyTitle="Nothing due today"
        emptyDescription="No items dated for today in this window."
      />

      <QueueSection
        title="Upcoming"
        description={`Next ${UPCOMING_WINDOW_DAYS} days, plan ahead.`}
        count={upcoming.length}
        items={upcoming}
        bucket="upcoming"
        timingClassName="bg-slate-100 text-slate-800 border border-slate-200"
        sectionClassName="border-slate-200"
        headerClassName="border-slate-100 bg-slate-50/80"
        emptyTitle="Nothing coming up soon"
        emptyDescription={`No due dates in the next ${UPCOMING_WINDOW_DAYS} days (excluding today).`}
      />

      {undated.length > 0 ?
        <QueueSection
          title="Other attention"
          description="No due date on file, still worth a look."
          count={undated.length}
          items={undated}
          bucket="undated"
          timingClassName="bg-amber-50 text-amber-900 border border-amber-200/70"
          sectionClassName="border-amber-200/50"
          headerClassName="border-amber-100 bg-amber-50/40"
          emptyTitle=""
          emptyDescription=""
        />
      : null}
    </div>
  );
}
