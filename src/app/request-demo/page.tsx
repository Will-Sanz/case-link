import type { Metadata } from "next";
import { ShieldCheck } from "iconoir-react";
import { PublicSiteShell } from "@/components/layout/public-site-shell";
import { DemoRequestForm } from "@/features/marketing/demo-request-form";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Request a demo",
  description: "Request a guided CaseLink demo for your school or district.",
};

export default async function RequestDemoPage() {
  let user = null;
  try {
    user = await getSessionUser();
  } catch {
    // Env vars missing or Supabase unreachable: treat as unauthenticated
  }

  return (
    <PublicSiteShell authenticated={Boolean(user)}>
      <section id="for-districts" className="scroll-mt-24 bg-[var(--public-paper-2)] py-16 sm:py-24" aria-labelledby="demo-title">
        <div className="mx-auto grid max-w-6xl items-start gap-12 px-5 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
          <div className="pt-2 lg:sticky lg:top-32">
            <h1 id="demo-title" className="public-display text-balance text-[clamp(3rem,5vw,4.7rem)] leading-[0.95] text-[var(--public-ink)]">
              Start with the paperwork you already have.
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-8 text-[var(--public-ink-2)]">
              A CaseLink demo is a practical conversation about your team&apos;s current family-support and paperwork workflow. No technical preparation is needed.
            </p>
            <div className="mt-8 flex items-start gap-3 border-t border-[var(--public-rule-strong)] pt-6 text-sm leading-6 text-[var(--public-ink-2)]">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-[var(--public-accent)]" aria-hidden />
              We do not need student or family information to understand your process or show the product.
            </div>
          </div>
          <DemoRequestForm />
        </div>
      </section>
    </PublicSiteShell>
  );
}
