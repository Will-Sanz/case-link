import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge, UrgencyBadge } from "@/features/families/urgency-status-badges";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listFamilies } from "@/lib/services/families";
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
  const { items, total } = await listFamilies(supabase, filters);
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
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Families</h1>
          <p className="mt-1 text-sm text-slate-600">
            Profiles you created or are assigned to.
          </p>
        </div>
        <Link href="/families/new">
          <Button type="button">New family intake</Button>
        </Link>
      </div>

      <Card className="p-5">
        <form method="get" className="grid gap-4 md:grid-cols-4">
          <div className="md:col-span-2">
            <Label htmlFor="q">Search</Label>
            <Input
              id="q"
              name="q"
              placeholder="Name or summary…"
              defaultValue={filters.q}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="status">Status</Label>
            <select
              id="status"
              name="status"
              defaultValue={filters.status ?? ""}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
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
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Any</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="crisis">Crisis</option>
            </select>
          </div>
          <div className="flex items-end gap-2 md:col-span-4">
            <Button type="submit">Apply</Button>
            <Link
              href="/families"
              className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
            >
              Reset
            </Link>
          </div>
        </form>
      </Card>

      <p className="text-sm text-slate-600">
        {items.length} of {total} famil{total === 1 ? "y" : "ies"}
        {totalPages > 1
          ? ` · Page ${filters.page} of ${totalPages}`
          : null}
      </p>

      {items.length === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-600">
          No families match.{" "}
          <Link href="/families/new" className="font-medium text-slate-900 underline">
            Start an intake
          </Link>
          .
        </Card>
      ) : (
        <ul className="space-y-2">
          {items.map((f) => (
            <li key={f.id}>
              <Link href={`/families/${f.id}`}>
                <Card className="p-4 transition hover:border-slate-300">
                  <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                    <div>
                      <p className="font-semibold text-slate-900">{f.name}</p>
                      {f.summary ? (
                        <p className="line-clamp-2 text-sm text-slate-600">
                          {f.summary}
                        </p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <StatusBadge status={f.status} />
                        <UrgencyBadge urgency={f.urgency} />
                        {f.creator?.email ? (
                          <Badge className="bg-white font-normal text-slate-600">
                            {f.creator.email}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    <p className="shrink-0 text-xs text-slate-500">
                      Updated {formatDt(f.updated_at)}
                    </p>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 ? (
        <nav className="flex flex-wrap gap-2">
          {filters.page > 1 ? (
            <Link
              href={pageHref(filters.page - 1)}
              className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
            >
              Previous
            </Link>
          ) : null}
          {filters.page < totalPages ? (
            <Link
              href={pageHref(filters.page + 1)}
              className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
            >
              Next
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
