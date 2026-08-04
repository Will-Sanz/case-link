import type { Metadata } from "next";
import { PublicSiteShell } from "@/components/layout/public-site-shell";
import { HomePageContent } from "@/features/marketing/home-page-content";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Family support plans, made manageable",
  description:
    "CaseLink helps school case managers turn family needs into reviewed intervention plans and professional PDF exports.",
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
