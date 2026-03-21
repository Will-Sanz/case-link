import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        name={name}
        value="true"
        defaultChecked={defaultOn}
        className="rounded border-slate-300 text-slate-800 focus:ring-slate-500"
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Resources</h1>
        <p className="mt-1 text-sm text-slate-600">
          Community partners and programs imported from your directory CSV.
        </p>
      </div>

      <Card className="p-5">
        <form method="get" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Label htmlFor="q">Search</Label>
              <Input
                id="q"
                name="q"
                placeholder="Program, organization, keywords…"
                defaultValue={filters.q}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="category">Category contains</Label>
              <Input
                id="category"
                name="category"
                placeholder="e.g. Youth"
                defaultValue={filters.category ?? ""}
                className="mt-1"
              />
            </div>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-700">
              Service flags
            </legend>
            <div className="flex flex-wrap gap-4">
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
            <Link
              href="/resources"
              className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
            >
              Reset
            </Link>
          </div>
        </form>
      </Card>

      <p className="text-sm text-slate-600">
        Showing {items.length} of {total} results
        {totalPages > 1
          ? ` · Page ${filters.page} of ${totalPages}`
          : null}
      </p>

      {items.length === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-600">
          No resources match your filters. Import the CSV if the database is
          empty — see README.
        </Card>
      ) : (
        <ul className="space-y-3">
          {items.map((r) => (
            <li key={r.id}>
              <Card className="p-5 transition hover:border-slate-300">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div>
                    <Link
                      href={`/resources/${r.id}`}
                      className="text-base font-semibold text-slate-900 hover:underline"
                    >
                      {r.program_name}
                    </Link>
                    <p className="text-sm text-slate-600">
                      {r.office_or_department}
                    </p>
                    {r.category ? (
                      <Badge className="mt-2">{r.category}</Badge>
                    ) : null}
                  </div>
                  <div className="text-right text-sm text-slate-600">
                    {r.primary_contact_email ? (
                      <p>{r.primary_contact_email}</p>
                    ) : null}
                    {r.primary_contact_phone ? (
                      <p className="tabular-nums">{r.primary_contact_phone}</p>
                    ) : null}
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 ? (
        <nav className="flex flex-wrap items-center gap-2">
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
