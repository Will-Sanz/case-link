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

export default async function FamiliesPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const filters = parseFamilyListQuery(raw);
  const supabase = await createSupabaseServerClient();
  const { items: rawItems, total } = await listFamilies(supabase, filters);
  const items = await enrichFamiliesWithCurrentStep(supabase, rawItems);
  const totalPages = Math.max(1, Math.ceil(total / filters.pageSize));

  const q = new URLSearchParams();
  if (filters.q) q.set("q", filters.q);
  if (filters.status) q.set("status", filters.status);
  if (filters.urgency) q.set("urgency", filters.urgency);

  const baseQs = q.toString();

  function pageHref(p: number) {
    const nq = new URLSearchParams(baseQs);
    nq.set("page", String(p));
    nq.set("pageSize", String(filters.pageSize));
    return `/families?${nq.toString()}`;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Families"
        description="Profiles you created or are assigned to. Filter by status and urgency to prioritize follow-up."
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
            <Label htmlFor="status">Status</Label>
            <select
              id="status"
              name="status"
              defaultValue={filters.status ?? ""}
              className={`mt-1.5 ${selectInputClass}`}
            >
              <option value="">Any</option>
              <option value="active">Active</option>
              <option value="on_hold">On hold</option>
              <option value="closed">Closed</option>
            </select>
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

      <p className="text-sm text-slate-600">
        <span className="font-medium text-slate-800">{items.length}</span> of{" "}
        <span className="font-medium text-slate-800">{total}</span> famil
        {total === 1 ? "y" : "ies"}
        {totalPages > 1 ? ` · Page ${filters.page} of ${totalPages}` : null}
      </p>

      {items.length === 0 ? (
        <EmptyState
          title="No families match"
          description="Try broadening your search or clearing filters. New intakes can be added anytime."
          action={
            <Link href="/families/new" className={outlineLinkButtonClass}>
              Start an intake
            </Link>
          }
        />
      ) : (
        <ul className="space-y-3">
          {items.map((f) => (
            <li key={f.id}>
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
                              <Badge className="bg-amber-100 text-amber-900">
                                Blocked
                              </Badge>
                            ) : null}
                            {f.current_step.is_escalated ? (
                              <Badge className="bg-amber-100 text-amber-900">
                                Escalation
                              </Badge>
                            ) : null}
                            {f.current_step.days_overdue != null &&
                            f.current_step.days_overdue > 0 ? (
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
          ))}
        </ul>
      )}

      {totalPages > 1 ? (
        <nav
          className="flex flex-wrap gap-2 border-t border-slate-200/80 pt-6"
          aria-label="Pagination"
        >
          {filters.page > 1 ? (
            <Link href={pageHref(filters.page - 1)} className={outlineLinkButtonClass}>
              Previous
            </Link>
          ) : null}
          {filters.page < totalPages ? (
            <Link href={pageHref(filters.page + 1)} className={outlineLinkButtonClass}>
              Next
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
