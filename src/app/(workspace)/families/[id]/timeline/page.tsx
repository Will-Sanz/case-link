import { redirect } from "next/navigation";
import { z } from "zod";

type PageProps = {
  params: Promise<{ id: string }>;
};

/** Timeline tab removed; old links land on the plan. */
export default async function FamilyTimelineRedirectPage({ params }: PageProps) {
  const { id } = await params;
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) redirect("/families");
  redirect(`/families/${parsed.data}/plan`);
}
