import type { Metadata } from "next";
import { ParentIntake } from "@/features/parent/intake";
export const metadata: Metadata = { title: "Get support" };
export default async function GetSupportPage({
  searchParams,
}: {
  searchParams: Promise<{ need?: string }>;
}) {
  const { need } = await searchParams;
  return <ParentIntake initialNeed={need} />;
}
