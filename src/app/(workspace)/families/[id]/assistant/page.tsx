import { redirect } from "next/navigation";

export default async function LegacyAssistantRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/families/${id}/plan`);
}
