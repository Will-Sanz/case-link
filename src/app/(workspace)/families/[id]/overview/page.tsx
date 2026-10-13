import { notFound } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getFamilyDetail } from "@/lib/services/families";
import { loadBarrierWorkflowForFamilyAction } from "@/app/actions/barrier-workflow";
import { BARRIER_PRESETS } from "@/types/barrier-workflow";
import { FamilyLiteWorkspace } from "@/features/families/family-lite-workspace";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function FamilyOverviewPage({ params }: PageProps) {
  const { id } = await params;
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) notFound();
  const supabase = await createSupabaseServerClient();
  const family = await getFamilyDetail(supabase, parsed.data);
  if (!family) notFound();
  const loaded = await loadBarrierWorkflowForFamilyAction(parsed.data);
  return (
    <FamilyLiteWorkspace
      key={family.id}
      familyId={family.id}
      familyUpdatedAt={family.updated_at}
      familyName={family.name}
      barrierOptions={BARRIER_PRESETS}
      initialResult={loaded.ok ? loaded.result : null}
      plan={family.plan}
      tab="overview"
    />
  );
}
