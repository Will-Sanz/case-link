import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listFamilies } from "@/lib/services/families";
import { parseFamilyListQuery } from "@/lib/validations/family-list-query";
import { createSimpleFamily } from "@/app/actions/families";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";

async function createFamilyFormAction(fd: FormData) {
  "use server";
  const name = String(fd.get("name") ?? "");
  const r = await createSimpleFamily({ name });
  if (r.ok && r.familyId) {
    redirect(`/families/${r.familyId}`);
  }
}

export default async function FamiliesPage({ searchParams }: PageProps) {
  const parsed = parseFamilyListQuery(await searchParams);
  const supabase = await createSupabaseServerClient();
  const { items, total } = await listFamilies(supabase, parsed);
  const showEmptyBackground =
    total === 0 && !parsed.q?.trim();

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Families</h1>
          <p className="text-sm text-slate-600">Lightweight family planning workspace.</p>
        </div>
        <form
          action={createFamilyFormAction}
          className="flex items-center gap-2"
        >
          <Input
            name="name"
            placeholder="New family name (optional)"
            className="h-10 w-64"
          />
          <Button type="submit" className="h-10 whitespace-nowrap px-4">
            Create new family
          </Button>
        </form>
      </div>

      <form className="max-w-md">
        <Input name="q" defaultValue={parsed.q} placeholder="Search families..." />
      </form>

      <div className="relative min-h-[min(52vh,28rem)]">
        {showEmptyBackground ? (
          <p
            className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center px-6 text-center text-lg font-medium tracking-tight text-slate-300"
            role="status"
          >
            Get started by creating your first family.
          </p>
        ) : null}
        <div className={showEmptyBackground ? "relative z-10 space-y-3" : "space-y-3"}>
          {items.map((f) => (
            <Link
              key={f.id}
              href={`/families/${f.id}`}
              className="block rounded-lg border border-slate-200 bg-white p-4 hover:bg-slate-50"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">{f.name}</p>
                <p className="text-xs text-slate-500">
                  Updated {new Date(f.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </p>
              </div>
              {f.summary ? (
                <p className="mt-2 line-clamp-2 text-xs text-slate-600">{f.summary}</p>
              ) : null}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
