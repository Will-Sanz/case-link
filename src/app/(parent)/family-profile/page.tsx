import type { Metadata } from "next";
import { FamilyProfile } from "@/features/parent/family-profile";
import { safeReturnPath } from "@/features/parent/api";
import { parentText } from "@/lib/parent/locale";
import { readParentLocale } from "@/lib/parent/locale-server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: parentText(await readParentLocale(), "Your family information"), robots: { index: false, follow: false } };
}

export default async function FamilyProfilePage({ searchParams }: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const returnTo = safeReturnPath(next);
  return <FamilyProfile returnTo={returnTo === "/family-profile" ? "/my-support" : returnTo}/>;
}
