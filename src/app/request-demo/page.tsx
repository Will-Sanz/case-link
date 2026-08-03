import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { PublicSiteShell } from "@/components/layout/public-site-shell";
import { DemoRequestForm } from "@/features/marketing/demo-request-form";

export const metadata: Metadata = {
  title: "Request a demo",
  description: "Request a guided CaseLink demo for your school or district.",
};

export default function RequestDemoPage() {
  return (
    <PublicSiteShell>
      <section className="bg-[#e7f1e4] py-16 sm:py-24" aria-labelledby="demo-title">
        <div className="mx-auto grid max-w-6xl items-start gap-12 px-5 sm:px-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
          <div className="pt-2 lg:sticky lg:top-32">
            <h1 id="demo-title" className="text-balance text-4xl font-semibold leading-[1.02] tracking-[-0.04em] text-[#173a15] sm:text-6xl">Start with the paperwork you already have.</h1>
            <p className="mt-6 max-w-lg text-lg leading-8 text-[#50644d]">
              A CaseLink demo is a practical conversation about your team&apos;s current family-support and paperwork workflow. No technical preparation is needed.
            </p>
            <div className="mt-8 flex items-start gap-3 border-t border-[#c9dbc6] pt-6 text-sm leading-6 text-[#50644d]">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-[#276221]" aria-hidden />
              We do not need student or family information to understand your process or show the product.
            </div>
          </div>
          <DemoRequestForm />
        </div>
      </section>
    </PublicSiteShell>
  );
}
