import type { Metadata } from "next";
import { PublicSiteShell } from "@/components/layout/public-site-shell";
import { HomePageContent } from "@/features/marketing/home-page-content";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "CaseLink: Support for families at Alain Locke School",
  description:
    "CaseLink helps case managers at Alain Locke School in Philadelphia identify barriers and build personalized support plans connected to local resources.",
};

export default async function Home() {
  let user = null;
  try {
    user = await getSessionUser();
  } catch {
    // Env vars missing or Supabase unreachable: treat as unauthenticated
  }
  return (
    <PublicSiteShell authenticated={Boolean(user)}>
      <HomePageContent />
    </PublicSiteShell>
  );
}
