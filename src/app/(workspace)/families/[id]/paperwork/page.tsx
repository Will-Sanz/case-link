import { notFound } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getFamilyDetail } from "@/lib/services/families";
import { PaperworkWorkspace } from "@/features/families/paperwork-workspace";
import { isPlanReviewed } from "@/lib/domain/plan/review-status";

type PageProps = { params: Promise<{ id: string }> };

export default async function FamilyPaperworkPage({ params }: PageProps) {
  const { id } = await params;
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) notFound();
  const supabase = await createSupabaseServerClient();
  const family = await getFamilyDetail(supabase, parsed.data);
  if (!family) notFound();
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6 lg:px-8 lg:py-10">
      <PaperworkWorkspace
        familyId={family.id}
        familyName={family.name}
        hasReviewedPlan={isPlanReviewed(family.plan)}
      />
    </div>
  );
}
