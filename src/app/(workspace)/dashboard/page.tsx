import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import {
  NextBestActionCarousel,
  SummaryCounts,
  ActionableNowList,
} from "@/features/dashboard/dashboard-sections";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { countResources } from "@/lib/services/resources";
import { getDashboardData } from "@/lib/services/workflow";

async function loadDashboard() {
  const supabase = await createSupabaseServerClient();
  let resourceCount = 0;
  let familyCount: number | null = null;
  let dashboardData: Awaited<ReturnType<typeof getDashboardData>> = {
    familiesNeedingAttention: [],
    actionableItems: [],
    summaryCounts: { overdue: 0, blocked: 0, dueToday: 0, escalated: 0 },
  };

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

  return { resourceCount, familyCount, dashboardData };
}

export default async function DashboardPage() {
  const { resourceCount, familyCount, dashboardData } = await loadDashboard();

  const { familiesNeedingAttention, actionableItems, summaryCounts } =
    dashboardData;

  const top5Actionable = actionableItems.slice(0, 5);
  const otherActionable = actionableItems.slice(5);
  const hasCarousel = top5Actionable.length > 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Today"
        description="Your work queue. Start with the next best action."
      />

      {hasCarousel ? (
        <section>
          <NextBestActionCarousel
            items={top5Actionable}
            families={familiesNeedingAttention}
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
                className="text-sm font-medium text-blue-600/90 underline-offset-2 hover:text-blue-600 hover:underline"
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
          <h2 className="text-xs font-medium text-slate-500">
            Rest of queue
          </h2>
          <ActionableNowList items={otherActionable} />
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Active resources"
          value={resourceCount}
          footer={
            <Link
              href="/resources"
              className="text-sm font-medium text-blue-600/90 underline-offset-2 hover:text-blue-600 hover:underline"
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
              className="text-sm font-medium text-blue-600/90 underline-offset-2 hover:text-blue-600 hover:underline"
            >
              View all families →
            </Link>
          }
        />
        <Card className="p-5 sm:col-span-2 lg:col-span-1">
          <CardTitle>Quick actions</CardTitle>
          <ul className="mt-4 space-y-1">
            <li>
              <Link
                href="/families"
                className="flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-blue-50/80"
              >
                Continue active cases
                <span className="text-slate-400" aria-hidden>→</span>
              </Link>
            </li>
            <li>
              <Link
                href="/families/new"
                className="flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-blue-50/80"
              >
                New family intake
                <span className="text-slate-400" aria-hidden>→</span>
              </Link>
            </li>
            <li>
              <Link
                href="/calendar"
                className="flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-blue-50/80"
              >
                Calendar
                <span className="text-slate-400" aria-hidden>→</span>
              </Link>
            </li>
            <li>
              <Link
                href="/resources"
                className="flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-blue-50/80"
              >
                Search resources
                <span className="text-slate-400" aria-hidden>→</span>
              </Link>
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
