import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SupportDetail } from "@/features/parent/support-detail";
export const metadata: Metadata = {
  title: "Your support",
  robots: { index: false, follow: false },
};
export default async function SupportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      id,
    )
  )
    notFound();
  return <SupportDetail requestId={id} />;
}
