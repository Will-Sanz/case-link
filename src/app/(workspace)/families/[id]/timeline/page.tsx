import { redirect } from "next/navigation";

export default async function LegacyTimelineRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/families/${id}/profile`);
}
