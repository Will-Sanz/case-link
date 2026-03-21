import { notFound } from "next/navigation";
import { z } from "zod";
import { ResourceDetailView } from "@/features/resources/resource-detail-view";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getResourceById } from "@/lib/services/resources";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ResourceDetailPage({ params }: PageProps) {
  const { id } = await params;
  const idParsed = z.string().uuid().safeParse(id);
  if (!idParsed.success) {
    notFound();
  }

  const supabase = await createSupabaseServerClient();
  const row = await getResourceById(supabase, idParsed.data);

  if (!row) {
    notFound();
  }

  return <ResourceDetailView r={row} />;
}
