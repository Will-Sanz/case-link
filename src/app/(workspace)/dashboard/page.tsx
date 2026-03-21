import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { countResources } from "@/lib/services/resources";

async function loadStats() {
  const supabase = await createSupabaseServerClient();
  let resourceCount = 0;
  let familyCount: number | null = null;

  try {
    resourceCount = await countResources(supabase);
  } catch {
    resourceCount = 0;
  }

  const { count, error } = await supabase
    .from("families")
    .select("*", { count: "exact", head: true });

  if (!error) {
    familyCount = count ?? 0;
  }

  return { resourceCount, familyCount };
}

export default async function DashboardPage() {
  const { resourceCount, familyCount } = await loadStats();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">
          Overview of your caseload and community resources.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="p-5">
          <p className="text-sm font-medium text-slate-500">Active resources</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-900">
            {resourceCount}
          </p>
          <Link
            href="/resources"
            className="mt-3 inline-block text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
          >
            Browse directory →
          </Link>
        </Card>
        <Card className="p-5">
          <p className="text-sm font-medium text-slate-500">Families</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-900">
            {familyCount === null ? "—" : familyCount}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            {familyCount === null
              ? "RLS policies for families ship in Phase 2."
              : "Tracked in the system."}
          </p>
        </Card>
        <Card className="p-5">
          <CardTitle className="text-base">Quick actions</CardTitle>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link
                href="/families/new"
                className="font-medium text-slate-800 hover:underline"
              >
                New family intake
              </Link>
              <span className="text-slate-400"> — Phase 2</span>
            </li>
            <li>
              <Link
                href="/resources"
                className="font-medium text-slate-800 hover:underline"
              >
                Search resources
              </Link>
            </li>
          </ul>
        </Card>
      </div>

      <Card>
        <CardTitle>Recent families</CardTitle>
        <p className="mt-2 text-sm text-slate-600">
          Family list and activity will appear here after Phase 2 (intake + RLS).
        </p>
      </Card>
    </div>
  );
}
