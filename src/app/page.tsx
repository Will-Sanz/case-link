import type { Metadata } from "next";
import { PublicSiteShell } from "@/components/layout/public-site-shell";
import { HomePageContent } from "@/features/marketing/home-page-content";
import { getSessionUser } from "@/lib/auth/session";
import { ParentShell } from "@/features/parent/parent-shell";
import { ParentLanding } from "@/features/parent/landing";
export const metadata: Metadata = { title: { absolute: "CaseLink · Food support for your family" }, description: "One place to start for food, SNAP and WIC support in Philadelphia. You stay in control of your information." };
export const dynamic = "force-dynamic";
export default async function Home() {
  if (process.env.CASELINK_PRODUCT === "school") {
    let user = null;
    try { user = await getSessionUser(); } catch { /* Public school pages remain accessible while authentication is unavailable. */ }
    return <PublicSiteShell showRecognition authenticated={Boolean(user)}><HomePageContent /></PublicSiteShell>;
  }
  return <ParentShell showRecognition><ParentLanding /></ParentShell>;
}
