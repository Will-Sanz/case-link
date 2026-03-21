import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge, UrgencyBadge } from "@/features/families/urgency-status-badges";
import {
  DashboardFamilyCards,
  ActionableNowList,
  CurrentStepByFamily,
  SummaryCounts,
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

  return (
    <div className="space-y-10">
      <PageHeader
        title="Dashboard"
        description="Your daily command center. What needs action now, who to follow up with, and what's blocked."
      />

      <SummaryCounts counts={summaryCounts} />

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
          Families needing attention
        </h2>
        <p className="text-sm text-slate-600">
          Cases with overdue steps, follow-ups due, blockers, or escalation.
        </p>
        {familiesNeedingAttention.length > 0 ? (
          <DashboardFamilyCards families={familiesNeedingAttention} />
        ) : (
          <Card className="p-8">
            <EmptyState
              className="border-0 bg-transparent"
              title="All caught up"
              description="No families need immediate attention. Check recently updated cases below."
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
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
          Actionable now
        </h2>
        <p className="text-sm text-slate-600">
          The highest-priority actions across your caseload.
        </p>
        {actionableItems.length > 0 ? (
          <ActionableNowList items={actionableItems} />
        ) : (
          <Card className="p-6">
            <p className="text-sm text-slate-600">
              No overdue, blocked, or due-today items. Use the families list to
              find work.
            </p>
          </Card>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
          Current step by family
        </h2>
        <p className="text-sm text-slate-600">
          Where each case stands operationally.
        </p>
        {familiesNeedingAttention.length > 0 ? (
          <CurrentStepByFamily families={familiesNeedingAttention} />
        ) : (
          <Card className="p-6">
            <p className="text-sm text-slate-600">
              No active steps. Generate a plan for a family to see their current
              step here.
            </p>
          </Card>
        )}
      </section>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Active resources"
          value={resourceCount}
          footer={
            <Link
              href="/resources"
              className="text-sm font-medium text-teal-800 underline-offset-2 hover:text-teal-900 hover:underline"
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
              className="text-sm font-medium text-teal-800 underline-offset-2 hover:text-teal-900 hover:underline"
            >
              View all families →
            </Link>
          }
        />
        <Card className="p-5 sm:col-span-2 lg:col-span-1">
          <CardTitle>Quick actions</CardTitle>
          <ul className="mt-4 space-y-1">
            {[
              { href: "/families/new", label: "New family intake" },
              { href: "/families", label: "Search families" },
              { href: "/resources", label: "Search resources" },
            ].map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50"
                >
                  {item.label}
                  <span className="text-slate-400" aria-hidden>
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <section className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
              Recently updated
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Cases with recent activity.
            </p>
          </div>
          <Link
            href="/families"
            className="text-sm font-medium text-teal-800 underline-offset-2 hover:text-teal-900 hover:underline"
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
