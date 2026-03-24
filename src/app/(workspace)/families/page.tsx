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
  const { items } = await listFamilies(supabase, parsed);

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

      <div className="space-y-3">
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
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span className="rounded bg-slate-100 px-2 py-1">
                {f.status === "active" ? "Plan in progress" : "No plan yet"}
              </span>
              {f.summary ? <span className="line-clamp-1">{f.summary}</span> : null}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
