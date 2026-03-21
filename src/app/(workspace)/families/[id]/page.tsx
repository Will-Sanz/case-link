import { notFound } from "next/navigation";
import { z } from "zod";
import { FamilyWorkspace } from "@/features/families/family-workspace";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getFamilyDetail } from "@/lib/services/families";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function FamilyDetailPage({ params }: PageProps) {
  const { id } = await params;
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) {
    notFound();
  }

  const supabase = await createSupabaseServerClient();
  const family = await getFamilyDetail(supabase, parsed.data);

  if (!family) {
    notFound();
  }

  return <FamilyWorkspace family={family} />;
}
