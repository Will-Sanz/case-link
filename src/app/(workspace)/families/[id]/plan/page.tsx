import { notFound } from "next/navigation";
import { z } from "zod";
import { requireAppUserWithClient } from "@/lib/auth/session";
import { getFamilyDetail } from "@/lib/services/families";
import { mapFamilyToWorkflowResult } from "@/lib/domain/family-workspace/barrier-workflow";
import { BARRIER_PRESETS } from "@/types/barrier-workflow";
import { FamilyLiteWorkspace } from "@/features/families/family-lite-workspace";

export const maxDuration = 300;

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function FamilyPlanPage({ params }: PageProps) {
  const { id } = await params;
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) notFound();
  const { supabase } = await requireAppUserWithClient();
  const family = await getFamilyDetail(supabase, parsed.data);
  if (!family) notFound();
  const unfinished = ["running", "failed"].includes(family.plan?.generation_state?.status ?? "");
  let hasPreviousReviewedPlan = false;
  if (unfinished && (family.plan?.version ?? 0) > 1) {
    const previous = await supabase.rpc("get_previous_reviewed_plan", { p_family_id: id });
    if (previous.error) throw new Error("Could not check the previous reviewed plan.");
    hasPreviousReviewedPlan = Boolean(previous.data);
  }
  return (
    <FamilyLiteWorkspace
      key={family.id}
      familyId={family.id}
      familyUpdatedAt={family.updated_at}
      familyName={family.name}
      barrierOptions={BARRIER_PRESETS}
      initialResult={mapFamilyToWorkflowResult(family.name, family.id, family.summary ?? "", null, family)}
      plan={family.plan}
      hasPreviousReviewedPlan={hasPreviousReviewedPlan}
      progressUpdates={family.progressUpdates}
      caseNotes={family.caseNotes}
      tab="plan"
    />
  );
}
