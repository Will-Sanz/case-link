import type { Metadata } from "next";
import { ParentAccount } from "@/features/parent/account";
import { readParentLocale } from "@/lib/parent/locale-server";
import { parentText } from "@/lib/parent/locale";
export async function generateMetadata(): Promise<Metadata> {
  return { title: parentText(await readParentLocale(), "Your account"), robots: { index: false, follow: false } };
}
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ delete?: string }> }) {
  const { delete: deletion } = await searchParams;
  return <ParentAccount deletionOnly={deletion === "1"} />;
}
