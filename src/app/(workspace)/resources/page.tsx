import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { checkboxClass, outlineLinkButtonClass } from "@/lib/ui/form-classes";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listResources } from "@/lib/services/resources";
import { parseResourceListQuery } from "@/lib/validations/resource-filters";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function FlagFilter({
  name,
  label,
  defaultOn,
}: {
  name: string;
  label: string;
  defaultOn: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-700">
      <input
        type="checkbox"
        name={name}
        value="true"
        defaultChecked={defaultOn}
        className={checkboxClass}
      />
      {label}
    </label>
  );
}

export default async function ResourcesPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const filters = parseResourceListQuery(raw);

  const supabase = await createSupabaseServerClient();
  const { items, total } = await listResources(supabase, filters);
  const totalPages = Math.max(1, Math.ceil(total / filters.pageSize));

  const q = new URLSearchParams();
  if (filters.q) q.set("q", filters.q);
  if (filters.category) q.set("category", filters.category);
  if (filters.tabling) q.set("tabling", "true");
  if (filters.promotional) q.set("promotional", "true");
  if (filters.educational) q.set("educational", "true");
  if (filters.volunteer) q.set("volunteer", "true");
  if (filters.grocery) q.set("grocery", "true");

  const baseQs = q.toString();

  function pageHref(p: number) {
    const nq = new URLSearchParams(baseQs);
    nq.set("page", String(p));
    nq.set("pageSize", String(filters.pageSize));
    return `/resources?${nq.toString()}`;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Resources"
        description="Community partners and programs from your directory. Use flags and search to narrow programs that fit a family’s needs."
      />

      <Card className="p-5 sm:p-6">
        <form method="get" className="space-y-6">
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Label htmlFor="q">Search</Label>
              <Input
                id="q"
                name="q"
                placeholder="Program, organization, keywords…"
                defaultValue={filters.q}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="category">Category contains</Label>
              <Input
                id="category"
                name="category"
                placeholder="e.g. Youth"
                defaultValue={filters.category ?? ""}
                className="mt-1.5"
              />
            </div>
          </div>
          <fieldset className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <legend className="px-1 text-sm font-medium text-slate-800">
              Service flags
            </legend>
            <p className="mb-3 text-xs text-slate-600">
              Checked filters require that service to be offered.
            </p>
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              <FlagFilter
                name="tabling"
                label="Tabling at events"
                defaultOn={filters.tabling === true}
              />
              <FlagFilter
                name="promotional"
                label="Promotional materials"
                defaultOn={filters.promotional === true}
              />
              <FlagFilter
                name="educational"
                label="Educational workshops"
                defaultOn={filters.educational === true}
              />
              <FlagFilter
                name="volunteer"
                label="Volunteer support"
                defaultOn={filters.volunteer === true}
              />
              <FlagFilter
                name="grocery"
                label="Grocery giveaways"
                defaultOn={filters.grocery === true}
              />
            </div>
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <Button type="submit">Apply filters</Button>
            <Link href="/resources" className={outlineLinkButtonClass}>
              Reset
            </Link>
          </div>
        </form>
      </Card>

      <p className="text-sm text-slate-600">
        Showing{" "}
        <span className="font-medium text-slate-800">{items.length}</span> of{" "}
        <span className="font-medium text-slate-800">{total}</span> results
        {totalPages > 1
          ? ` · Page ${filters.page} of ${totalPages}`
          : null}
      </p>

      {items.length === 0 ? (
        <EmptyState
          title="No resources match"
          description="Try adjusting filters or search terms. If the directory is empty, import your CSV — see the project README."
        />
      ) : (
        <ul className="space-y-3">
          {items.map((r) => (
            <li key={r.id}>
              <Card className="p-0 transition-shadow hover:border-slate-300/90 hover:shadow-md">
                <div className="flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-start sm:gap-8">
                  <div className="min-w-0">
                    <Link
                      href={`/resources/${r.id}`}
                      className="text-base font-semibold text-slate-900 underline-offset-2 hover:text-blue-800 hover:underline"
                    >
                      {r.program_name}
                    </Link>
                    <p className="mt-1 text-sm text-slate-600">
                      {r.office_or_department}
                    </p>
                    {r.category ? (
                      <Badge className="mt-3">{r.category}</Badge>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-sm text-slate-600 sm:text-right">
                    {r.primary_contact_email ? (
                      <p className="break-all">{r.primary_contact_email}</p>
                    ) : null}
                    {r.primary_contact_phone ? (
                      <p className="tabular-nums text-slate-700">
                        {r.primary_contact_phone}
                      </p>
                    ) : null}
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 ? (
        <nav
          className="flex flex-wrap items-center gap-2 border-t border-slate-200/80 pt-6"
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
