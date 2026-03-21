import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { StatusBadge, UrgencyBadge } from "@/features/families/urgency-status-badges";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listFamilies } from "@/lib/services/families";
import { countResources } from "@/lib/services/resources";

function formatDt(iso: string) {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
      new Date(iso),
    );
  } catch {
    return iso;
  }
}

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

  let recent: Awaited<ReturnType<typeof listFamilies>>["items"] = [];
  try {
    const listed = await listFamilies(supabase, {
      q: "",
      page: 1,
      pageSize: 6,
    });
    recent = listed.items;
  } catch {
    recent = [];
  }

  return { resourceCount, familyCount, recent };
}

export default async function DashboardPage() {
  const { resourceCount, familyCount, recent } = await loadStats();

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
          <Link
            href="/families"
            className="mt-3 inline-block text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
          >
            View all →
          </Link>
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
            </li>
            <li>
              <Link
                href="/families"
                className="font-medium text-slate-800 hover:underline"
              >
                Search families
              </Link>
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
        <div className="flex items-center justify-between gap-4">
          <CardTitle>Recent families</CardTitle>
          <Link
            href="/families"
            className="text-sm font-medium text-slate-700 hover:underline"
          >
            View all
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">
            No families yet.{" "}
            <Link href="/families/new" className="font-medium underline">
              Create an intake
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100">
            {recent.map((f) => (
              <li key={f.id} className="py-3 first:pt-0">
                <Link
                  href={`/families/${f.id}`}
                  className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center"
                >
                  <div>
                    <p className="font-medium text-slate-900">{f.name}</p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <StatusBadge status={f.status} />
                      <UrgencyBadge urgency={f.urgency} />
                    </div>
                  </div>
                  <span className="text-xs text-slate-500">
                    {formatDt(f.updated_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
