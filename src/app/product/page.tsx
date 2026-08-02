import type { Metadata } from "next";
import { PublicSiteShell } from "@/components/layout/public-site-shell";
import { ProductPageContent } from "@/features/marketing/product-page-content";

export const metadata: Metadata = {
  title: "Product and about",
  description: "See how CaseLink helps school case managers move from family context to an approved intervention plan and prepared fillable PDF.",
};

export default function ProductPage() {
  return (
    <PublicSiteShell>
      <ProductPageContent />
    </PublicSiteShell>
  );
}
