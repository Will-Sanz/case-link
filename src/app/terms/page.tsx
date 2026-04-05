import type { Metadata } from "next";
import { PublicSiteShell } from "@/components/layout/public-site-shell";
import { LegalDocumentBody } from "@/components/layout/legal-doc-layout";
import { TermsOfServiceSections } from "@/features/legal/legal-document-sections";
import { getSessionUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Terms of Service | CaseLink",
  description: "Terms governing use of the CaseLink case management application.",
};

export const dynamic = "force-dynamic";

export default async function TermsOfServicePage() {
  let user = null;
  try {
    user = await getSessionUser();
  } catch {
    /* env / Supabase unavailable */
  }

  return (
    <PublicSiteShell authenticated={Boolean(user)}>
      <LegalDocumentBody title="Terms of Service" lastUpdated="April 2026">
        <TermsOfServiceSections />
      </LegalDocumentBody>
    </PublicSiteShell>
  );
}
