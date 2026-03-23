import { PageHeader } from "@/components/ui/page-header";
import { ActionQueueDashboard } from "@/features/dashboard/action-queue-dashboard";
import { bucketActionableItems } from "@/lib/dashboard/action-queue-buckets";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getDashboardData } from "@/lib/services/workflow";

async function loadDashboard() {
  const supabase = await createSupabaseServerClient();
  let dashboardData: Awaited<ReturnType<typeof getDashboardData>> = {
    familiesNeedingAttention: [],
    actionableItems: [],
    summaryCounts: { overdue: 0, blocked: 0, dueToday: 0, escalated: 0 },
  };

  try {
    dashboardData = await getDashboardData(supabase, {
      /** Homepage no longer renders family summary rows; skip that work. */
      limit: 0,
      actionableLimit: 100,
    });
  } catch {
    dashboardData = {
      familiesNeedingAttention: [],
      actionableItems: [],
      summaryCounts: { overdue: 0, blocked: 0, dueToday: 0, escalated: 0 },
    };
  }

  return dashboardData;
}

export default async function DashboardPage() {
  const { actionableItems } = await loadDashboard();
  const queueBuckets = bucketActionableItems(actionableItems);

  return (
    <div className="space-y-6 pb-2">
      <PageHeader
        title="Today"
        description="Overdue first, then today, then the next few days — your command center for follow-ups."
      />

      <section aria-label="Action queue by due date">
        <ActionQueueDashboard buckets={queueBuckets} />
      </section>
    </div>
  );
}
