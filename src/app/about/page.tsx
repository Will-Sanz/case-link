import type { Metadata } from "next";
import { PublicSiteShell } from "@/components/layout/public-site-shell";
import { AboutPageContent } from "@/features/marketing/about-page-content";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "About CaseLink: Collaboration at Alain Locke School",
  description:
    "How CaseLink began with conversations at Alain Locke School, what we learned from case managers, and how the platform supports families in Philadelphia.",
};

export default async function AboutPage() {
  let user = null;
  try {
    user = await getSessionUser();
  } catch {
    // treat as unauthenticated
  }
  return (
    <PublicSiteShell activeNav="about" authenticated={Boolean(user)}>
      <AboutPageContent />
    </PublicSiteShell>
  );
}
