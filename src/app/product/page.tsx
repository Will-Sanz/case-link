import type { Metadata } from "next";
import { PublicSiteShell } from "@/components/layout/public-site-shell";
import { ProductPageContent } from "@/features/marketing/product-page-content";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Product",
  description: "See how CaseLink guides school case managers from family intake and barriers through a reviewed intervention plan and finished PDF.",
};

export default async function ProductPage() {
  let user = null;
  try {
    user = await getSessionUser();
  } catch {
    // Env vars missing or Supabase unreachable: treat as unauthenticated
  }

  return (
    <PublicSiteShell authenticated={Boolean(user)}>
      <ProductPageContent />
    </PublicSiteShell>
  );
}
