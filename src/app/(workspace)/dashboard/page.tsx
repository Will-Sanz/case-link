import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { SummaryCounts } from "@/features/dashboard/dashboard-sections";
import { ActionQueueDashboard } from "@/features/dashboard/action-queue-dashboard";
import { bucketActionableItems } from "@/lib/dashboard/action-queue-buckets";
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
    dashboardData = await getDashboardData(supabase, {
      limit: 15,
      actionableLimit: 100,
    });
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

  const { actionableItems, summaryCounts } = dashboardData;

  const queueBuckets = bucketActionableItems(actionableItems);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Today"
        description="Overdue first, then today, then the next few days — your command center for follow-ups."
      />

      <section aria-label="Action queue by due date">
        <ActionQueueDashboard buckets={queueBuckets} />
      </section>

      <SummaryCounts counts={summaryCounts} />

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
