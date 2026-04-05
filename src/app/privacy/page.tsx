import type { Metadata } from "next";
import { PublicSiteShell } from "@/components/layout/public-site-shell";
import { LegalDocumentBody } from "@/components/layout/legal-doc-layout";
import { PrivacyPolicySections } from "@/features/legal/legal-document-sections";
import { getSessionUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Privacy Policy | CaseLink",
  description:
    "How CaseLink collects, uses, and protects information for case managers.",
};

export const dynamic = "force-dynamic";

export default async function PrivacyPolicyPage() {
  let user = null;
  try {
    user = await getSessionUser();
  } catch {
    /* env / Supabase unavailable */
  }

  return (
    <PublicSiteShell authenticated={Boolean(user)}>
      <LegalDocumentBody title="Privacy Policy" lastUpdated="April 2026">
        <PrivacyPolicySections />
      </LegalDocumentBody>
    </PublicSiteShell>
  );
}
