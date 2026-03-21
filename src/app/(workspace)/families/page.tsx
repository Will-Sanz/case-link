import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge, UrgencyBadge } from "@/features/families/urgency-status-badges";
import { outlineLinkButtonClass, selectInputClass } from "@/lib/ui/form-classes";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { enrichFamiliesWithCurrentStep, listFamilies } from "@/lib/services/families";
import { parseFamilyListQuery } from "@/lib/validations/family-list-query";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function formatDt(iso: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function FamilyCard({
  f,
  formatDt,
}: {
  f: Awaited<ReturnType<typeof enrichFamiliesWithCurrentStep>>[0];
  formatDt: (iso: string) => string;
}) {
  return (
    <li>
      <Link href={`/families/${f.id}`} className="block">
        <Card className="group p-0 transition-shadow hover:border-slate-300/90 hover:shadow-md">
          <div className="flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-900 group-hover:text-teal-900">
                {f.name}
              </p>
              {f.summary ? (
                <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-slate-600">
                  {f.summary}
                </p>
              ) : null}
              {f.current_step ? (
                <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
                  <p className="text-xs font-medium text-slate-500">
                    Current step: {f.current_step.title}
                  </p>
                  <p className="mt-0.5 text-sm text-slate-700">
                    {f.current_step.action_needed_now}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {f.current_step.is_blocked ? (
                      <Badge className="bg-amber-100 text-amber-900">Blocked</Badge>
                    ) : null}
                    {f.current_step.is_escalated ? (
                      <Badge className="bg-amber-100 text-amber-900">Escalation</Badge>
                    ) : null}
                    {f.current_step.days_overdue != null && f.current_step.days_overdue > 0 ? (
                      <Badge className="bg-red-100 text-red-900">
                        {f.current_step.days_overdue}d overdue
                      </Badge>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <StatusBadge status={f.status} />
                <UrgencyBadge urgency={f.urgency} />
                {f.creator?.email ? (
                  <Badge className="border-slate-200/60 bg-white font-normal text-slate-600">
                    {f.creator.email}
                  </Badge>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <p className="text-xs font-medium text-slate-500">
                Updated {formatDt(f.updated_at)}
              </p>
              <span className="text-xs text-slate-400">Open case →</span>
            </div>
          </div>
        </Card>
      </Link>
    </li>
  );
}

export default async function FamiliesPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const filters = parseFamilyListQuery(raw);
  const supabase = await createSupabaseServerClient();

  const activeFilters: Parameters<typeof listFamilies>[1] = {
    ...filters,
    statusIn: ["active", "on_hold"],
    status: undefined,
    pageSize: 50,
  };
  const legacyFilters: Parameters<typeof listFamilies>[1] = {
    ...filters,
    status: "closed",
    statusIn: undefined,
    pageSize: 20,
  };

  const [activeResult, legacyResult] = await Promise.all([
    listFamilies(supabase, activeFilters),
    listFamilies(supabase, legacyFilters),
  ]);

  const activeItems = await enrichFamiliesWithCurrentStep(supabase, activeResult.items);
  const legacyItems = await enrichFamiliesWithCurrentStep(supabase, legacyResult.items);

  const q = new URLSearchParams();
  if (filters.q) q.set("q", filters.q);
  if (filters.urgency) q.set("urgency", filters.urgency);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Families"
        description="Profiles you created or are assigned to. Close or delete cases when finished."
        actions={
          <Link href="/families/new">
            <Button type="button">New family intake</Button>
          </Link>
        }
      />

      <Card className="p-5 sm:p-6">
        <form method="get" className="grid gap-5 md:grid-cols-4">
          <div className="md:col-span-2">
            <Label htmlFor="q">Search</Label>
            <Input
              id="q"
              name="q"
              placeholder="Name or summary…"
              defaultValue={filters.q}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="urgency">Urgency</Label>
            <select
              id="urgency"
              name="urgency"
              defaultValue={filters.urgency ?? ""}
              className={`mt-1.5 ${selectInputClass}`}
            >
              <option value="">Any</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="crisis">Crisis</option>
            </select>
          </div>
          <div className="flex flex-wrap items-end gap-2 md:col-span-4">
            <Button type="submit">Apply filters</Button>
            <Link href="/families" className={outlineLinkButtonClass}>
              Reset
            </Link>
          </div>
        </form>
      </Card>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Active cases</h2>
        <p className="mb-4 text-sm text-slate-600">
          {activeItems.length} active or on hold
        </p>
        {activeItems.length === 0 ? (
          <EmptyState
            title="No active cases"
            description="New intakes and active cases appear here. Close cases to move them to legacy."
            action={
              <Link href="/families/new" className={outlineLinkButtonClass}>
                Start an intake
              </Link>
            }
          />
        ) : (
          <ul className="space-y-3">
            {activeItems.map((f) => (
              <FamilyCard key={f.id} f={f} formatDt={formatDt} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Legacy cases</h2>
        <p className="mb-4 text-sm text-slate-600">
          {legacyItems.length} closed
        </p>
        {legacyItems.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-slate-50/50 px-4 py-6 text-sm text-slate-500">
            No legacy cases. Close a case to move it here.
          </p>
        ) : (
          <ul className="space-y-3">
            {legacyItems.map((f) => (
              <FamilyCard key={f.id} f={f} formatDt={formatDt} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
