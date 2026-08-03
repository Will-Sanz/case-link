import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, CircleAlert, ListChecks, UsersRound } from "lucide-react";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getFamilyDetail } from "@/lib/services/families";
import { UpdateFamilyForm } from "@/features/families/update-family-form";

type PageProps = { params: Promise<{ id: string }> };

export default async function FamilyProfilePage({ params }: PageProps) {
  const { id } = await params;
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) notFound();
  const supabase = await createSupabaseServerClient();
  const family = await getFamilyDetail(supabase, parsed.data);
  if (!family) notFound();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6 lg:px-8 lg:py-10">
      <header className="flex flex-col gap-5 border-b border-[#dce6d9] pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link href="/families" className="text-sm font-semibold text-[#5d705a] hover:text-[#276221]">Families</Link>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-[#173a15] sm:text-4xl">{family.name}</h1>
          <p className="mt-2 text-sm text-[#687b65]">Family profile · Updated {new Date(family.updated_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
        </div>
        <Link href={`/families/${family.id}/overview`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#276221] px-4 text-sm font-semibold text-white shadow-[0_6px_18px_rgba(39,98,33,0.16)] transition-[background-color,transform] hover:-translate-y-px hover:bg-[#1f531b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#46923c]/30 focus-visible:ring-offset-2 active:translate-y-0">
          Review barriers <ArrowRight className="size-4" aria-hidden />
        </Link>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_320px]">
        <section aria-labelledby="family-details" className="rounded-xl bg-white p-6 shadow-[0_12px_34px_rgba(30,70,27,0.07)] sm:p-7">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-[#edf4eb] text-[#276221]"><UsersRound className="size-5" aria-hidden /></span>
            <div><h2 id="family-details" className="text-lg font-semibold text-[#173a15]">Current context</h2><p className="text-xs text-[#687b65]">Used to create and update the plan</p></div>
          </div>
          <div className="mt-6"><UpdateFamilyForm family={family} /></div>
        </section>

        <aside className="space-y-5">
          <section className="rounded-xl border border-[#dce6d9] bg-[#edf4eb] p-5">
            <div className="flex items-center gap-2 text-[#276221]"><CircleAlert className="size-4" aria-hidden /><h2 className="text-sm font-semibold">Privacy reminder</h2></div>
            <p className="mt-3 text-sm leading-6 text-[#50644d]">Use a household label instead of names. Do not enter dates of birth, student IDs, addresses, or other identifying information.</p>
          </section>
          <section className="rounded-xl border border-[#dce6d9] bg-white p-5">
            <div className="flex items-center gap-2 text-[#173a15]"><ListChecks className="size-4 text-[#3b8132]" aria-hidden /><h2 className="text-sm font-semibold">Planning context</h2></div>
            <dl className="mt-4 divide-y divide-[#e2ebe0] text-sm">
              <div className="flex justify-between gap-4 py-3"><dt className="text-[#687b65]">Goals</dt><dd className="font-semibold text-[#365134]">{family.goals.length}</dd></div>
              <div className="flex justify-between gap-4 py-3"><dt className="text-[#687b65]">Barriers</dt><dd className="font-semibold text-[#365134]">{family.barriers.length}</dd></div>
              <div className="flex justify-between gap-4 py-3"><dt className="text-[#687b65]">Plan</dt><dd className="font-semibold text-[#365134]">{family.plan ? "Created" : "Not created"}</dd></div>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}
