import type { Metadata } from "next";
import { PublicSiteShell } from "@/components/layout/public-site-shell";
import { HomePageContent } from "@/features/marketing/home-page-content";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    absolute: "CaseLink",
  },
  description:
    "CaseLink helps school case managers organize family context, identify barriers, build structured intervention plans, and prepare review-ready PDFs.",
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
