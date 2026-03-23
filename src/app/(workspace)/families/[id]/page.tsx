import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import {
  FamilyWorkspace,
  FamilyWorkspaceLoading,
} from "@/features/families/family-workspace";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getFamilyDetail } from "@/lib/services/families";
import {
  getCaseActivity,
  getNeedsAttention,
} from "@/lib/services/workflow";

type PageProps = {
  params: Promise<{ id: string }>;
};

/** Always fetch fresh family + plan after server actions (regenerate, etc.). */
export const dynamic = "force-dynamic";

export default async function FamilyDetailPage({ params }: PageProps) {
  const { id } = await params;
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) {
    notFound();
  }

  const supabase = await createSupabaseServerClient();
  const [family, needsAttention, caseActivity] = await Promise.all([
    getFamilyDetail(supabase, parsed.data),
    getNeedsAttention(supabase, { familyId: parsed.data, limit: 20 }),
    getCaseActivity(supabase, parsed.data, 25),
  ]);

  if (!family) {
    notFound();
  }

  return (
    <Suspense fallback={<FamilyWorkspaceLoading />}>
      <FamilyWorkspace
        family={{
          ...family,
          needsAttention,
          caseActivity,
        }}
      />
    </Suspense>
  );
}
