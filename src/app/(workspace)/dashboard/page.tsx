import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge, UrgencyBadge } from "@/features/families/urgency-status-badges";
import {
  NextBestActionCard,
  SummaryCounts,
  ActionableNowList,
  DashboardFamilyCards,
} from "@/features/dashboard/dashboard-sections";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listFamilies } from "@/lib/services/families";
import { countResources } from "@/lib/services/resources";
import { getDashboardData } from "@/lib/services/workflow";

function formatDt(iso: string) {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
      new Date(iso),
    );
  } catch {
    return iso;
  }
}

async function loadDashboard() {
  const supabase = await createSupabaseServerClient();
  let resourceCount = 0;
  let familyCount: number | null = null;
  let dashboardData: Awaited<ReturnType<typeof getDashboardData>> = {
    familiesNeedingAttention: [],
    actionableItems: [],
    summaryCounts: { overdue: 0, blocked: 0, dueToday: 0, escalated: 0 },
  };
  let recent: Awaited<ReturnType<typeof listFamilies>>["items"] = [];

  try {
    resourceCount = await countResources(supabase);
  } catch {
    resourceCount = 0;
  }

  const { count } = await supabase
    .from("families")
    .select("*", { count: "exact", head: true });
  familyCount = count ?? 0;

  try {
    dashboardData = await getDashboardData(supabase, { limit: 15 });
  } catch {
    dashboardData = {
      familiesNeedingAttention: [],
      actionableItems: [],
      summaryCounts: { overdue: 0, blocked: 0, dueToday: 0, escalated: 0 },
    };
  }

  try {
    const listed = await listFamilies(supabase, {
      q: "",
      page: 1,
      pageSize: 8,
    });
    recent = listed.items;
  } catch {
    recent = [];
  }

  return { resourceCount, familyCount, dashboardData, recent };
}

export default async function DashboardPage() {
  const { resourceCount, familyCount, dashboardData, recent } =
    await loadDashboard();

  const {
    familiesNeedingAttention,
    actionableItems,
    summaryCounts,
  } = dashboardData;

  const nba = actionableItems[0] ?? null;
  const nbaFamily = nba
    ? familiesNeedingAttention.find((f) => f.family_id === nba.family_id)
    : null;

  const otherActionable = actionableItems.slice(1);
  const otherFamilies = nba
    ? familiesNeedingAttention.filter((f) => f.family_id !== nba.family_id)
    : familiesNeedingAttention;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Today"
        description="Your work queue. Start with the next best action."
      />

      {nba ? (
        <section>
          <NextBestActionCard
            item={nba}
            urgency={nbaFamily?.urgency ?? null}
            dueDate={nba.due_date}
            daysOverdue={nba.days_overdue}
          />
        </section>
      ) : (
        <Card className="p-8">
          <EmptyState
            className="border-0 bg-transparent"
            title="All caught up"
            description="No families need immediate attention. Check recently updated cases or browse families."
            action={
              <Link
                href="/families"
                className="text-sm font-medium text-teal-800 underline-offset-2 hover:underline"
              >
                View all families
              </Link>
            }
          />
        </Card>
      )}

      <SummaryCounts counts={summaryCounts} />

      {otherActionable.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Rest of queue
          </h2>
          <ActionableNowList items={otherActionable} />
        </section>
      )}

      {otherFamilies.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Other families needing attention
          </h2>
          <DashboardFamilyCards families={otherFamilies} />
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Active resources"
          value={resourceCount}
          footer={
            <Link
              href="/resources"
              className="text-sm font-medium text-teal-800 underline-offset-2 hover:underline"
            >
              Browse directory →
            </Link>
          }
        />
        <StatCard
          label="Families"
          value={familyCount === null ? "—" : familyCount}
          footer={
            <Link
              href="/families"
              className="text-sm font-medium text-teal-800 underline-offset-2 hover:underline"
            >
              View all families →
            </Link>
          }
        />
        <Card className="p-5 sm:col-span-2 lg:col-span-1">
          <CardTitle>Quick actions</CardTitle>
          <p className="mt-1 text-xs text-slate-500">
            Shortcuts for common tasks
          </p>
          <ul className="mt-4 space-y-0.5">
            <li>
              <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Active cases
              </p>
              <Link
                href="/families"
                className="flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                Continue active cases
                <span className="text-slate-400" aria-hidden>→</span>
              </Link>
            </li>
            <li>
              <p className="mb-1.5 mt-3 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Create or update
              </p>
              <Link
                href="/families/new"
                className="flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                New family intake
                <span className="text-slate-400" aria-hidden>→</span>
              </Link>
              <Link
                href="/calendar"
                className="flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                Calendar
                <span className="text-slate-400" aria-hidden>→</span>
              </Link>
            </li>
            <li>
              <p className="mb-1.5 mt-3 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Directory
              </p>
              <Link
                href="/resources"
                className="flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                Search resources
                <span className="text-slate-400" aria-hidden>→</span>
              </Link>
            </li>
          </ul>
        </Card>
      </div>

      <section className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Recently updated
          </h2>
          <Link
            href="/families"
            className="text-sm font-medium text-teal-800 underline-offset-2 hover:underline"
          >
            View all
          </Link>
        </div>

        <Card className="p-0">
          {recent.length === 0 ? (
            <div className="p-8">
              <EmptyState
                className="border-0 bg-transparent"
                title="No families yet"
                description="When you create intakes, they will appear here for quick access."
                action={
                  <Link
                    href="/families/new"
                    className="text-sm font-medium text-teal-800 underline-offset-2 hover:underline"
                  >
                    Start an intake
                  </Link>
                }
              />
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {recent.map((f) => (
                <li key={f.id}>
                  <Link
                    href={`/families/${f.id}`}
                    className="flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-slate-50/80 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">{f.name}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <StatusBadge status={f.status} />
                        <UrgencyBadge urgency={f.urgency} />
                      </div>
                    </div>
                    <time
                      className="shrink-0 text-xs text-slate-500"
                      dateTime={f.updated_at}
                    >
                      Updated {formatDt(f.updated_at)}
                    </time>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}
