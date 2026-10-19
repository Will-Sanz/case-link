import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CaseAssistantChat } from "@/features/families/case-assistant-chat";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getFamilyDetail } from "@/lib/services/families";

export const maxDuration = 300;

export default async function FamilyAssistantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createSupabaseServerClient();
  const family = await getFamilyDetail(supabase, id);
  if (!family) notFound();
  return (
    <div className="mx-auto flex min-h-[80dvh] w-full max-w-4xl flex-col gap-4 px-4 py-7 sm:px-6">
      <Link prefetch={false} href={`/families/${id}/plan`} className="self-start rounded text-sm font-semibold text-[var(--color-accent)] underline underline-offset-4 focus-visible:outline-2">
        Back to intervention plan
      </Link>
      <CaseAssistantChat key={family.id} familyId={family.id} familyName={family.name} />
    </div>
  );
}
