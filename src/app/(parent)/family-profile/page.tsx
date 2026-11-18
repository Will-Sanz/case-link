import type { Metadata } from "next";
import { FamilyProfile } from "@/features/parent/family-profile";
import { safeReturnPath } from "@/features/parent/api";

export const metadata: Metadata = {
  title: "Your family information",
  robots: { index: false, follow: false },
};

export default async function FamilyProfilePage({ searchParams }: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const returnTo = safeReturnPath(next);
  return <FamilyProfile returnTo={returnTo === "/family-profile" ? "/my-support" : returnTo}/>;
}
