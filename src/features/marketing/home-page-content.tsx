import Link from "next/link";
import {
  ArrowRight,
  Check,
  FileText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

function ProductProof() {
  return (
    <div className="hero-reveal-late relative mx-auto w-full max-w-[660px] lg:mx-0" aria-label="Illustration of CaseLink preparing a family form">
      <div className="relative overflow-hidden rounded-2xl bg-white p-3 shadow-[0_30px_80px_rgba(30,70,27,0.16)] sm:p-5">
        <div className="flex items-center justify-between border-b border-[#e2ebe0] pb-4">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-xl bg-[#edf6eb] text-[#276221]">
              <FileText className="size-4.5" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-semibold text-[#173a15]">Family support form</p>
              <p className="text-xs text-[#687b65]">6 fields ready for review</p>
            </div>
          </div>
          <span className="hidden rounded-full bg-[#edf6eb] px-3 py-1 text-xs font-semibold text-[#276221] sm:inline-flex">
            Review ready
          </span>
        </div>

        <div className="grid gap-4 pt-5 md:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-xl bg-[#f3f7f1] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#5d705a]">Reviewed plan</p>
            <p className="mt-4 text-sm font-semibold text-[#173a15]">Housing stability</p>
            <p className="mt-1 text-xs leading-5 text-[#5d705a]">
              Connect the family with housing intake support and prepare the required documentation.
            </p>
            <div className="mt-4 space-y-2">
              {["Housing barrier", "30-day action", "Case manager note"].map((item) => (
                <div key={item} className="flex items-center gap-2 text-xs text-[#365134]">
                  <span className="grid size-5 place-items-center rounded-full bg-[#d8ead5] text-[#276221]">
                    <Check className="size-3" strokeWidth={2.5} aria-hidden />
                  </span>
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-[#dce6d9] p-4">
            <div>
              <p className="text-[11px] font-medium text-[#687b65]">Primary need</p>
              <div className="mt-1.5 rounded-lg bg-[#f6f8f4] px-3 py-2 text-sm font-medium text-[#253f23]">
                Housing stability
              </div>
            </div>
            <div>
              <p className="text-[11px] font-medium text-[#687b65]">Recommended action</p>
              <div className="mt-1.5 rounded-lg bg-[#f6f8f4] px-3 py-2 text-sm leading-5 text-[#253f23]">
                Complete housing intake and collect proof of residence.
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-[#e2ebe0] pt-3">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#276221]">
                <ShieldCheck className="size-3.5" aria-hidden /> Review before download
              </span>
              <span className="rounded-lg bg-[#276221] px-3 py-2 text-xs font-semibold text-white">Download PDF</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function HomePageContent() {
  return (
    <>
      <section className="overflow-hidden bg-[#e7f1e4]" aria-labelledby="home-hero">
        <div className="mx-auto grid min-h-[680px] max-w-7xl items-center gap-14 px-5 py-16 sm:px-8 sm:py-20 lg:min-h-[calc(100svh-7.0625rem)] lg:grid-cols-[0.95fr_1.05fr] lg:px-10 lg:py-12">
          <div className="hero-reveal max-w-2xl">
            <h1 id="home-hero" className="text-balance text-[clamp(2.8rem,5vw,4.75rem)] font-semibold leading-[0.98] tracking-[-0.04em] text-[#173a15]">
              Turn family needs into clear plans and prepared paperwork.
            </h1>
            <p className="mt-7 max-w-xl text-pretty text-lg leading-8 text-[#4e664b] sm:text-xl">
              CaseLink helps school case managers organize barriers, draft a structured intervention plan, and prepare fillable forms for manual upload to the systems their schools already use.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link href="/request-demo" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[#276221] px-5 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(39,98,33,0.2)] transition-[background-color,transform,box-shadow] hover:-translate-y-0.5 hover:bg-[#1f531b] hover:shadow-[0_12px_30px_rgba(39,98,33,0.24)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#46923c]/40 focus-visible:ring-offset-2 active:translate-y-0">
                Request a demo <ArrowRight className="size-4" aria-hidden />
              </Link>
              <Link href="/product" className="inline-flex min-h-12 items-center justify-center rounded-lg px-5 text-sm font-semibold text-[#276221] transition-colors hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#46923c]/40">
                See how CaseLink works
              </Link>
            </div>
          </div>
          <ProductProof />
        </div>
      </section>

      <section className="border-y border-[#dce6d9] bg-white" aria-label="CaseLink recognition">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-7 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-10">
          <p className="max-w-2xl text-sm font-medium leading-6 text-[#365134]">
            Built with school case managers and selected for OpenAI&apos;s inaugural ChatGPT Futures Class of 2026.
          </p>
          <span className="inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-[#276221]">
            <Sparkles className="size-4" aria-hidden /> Supported through an OpenAI grant
          </span>
        </div>
      </section>

      <section className="bg-[#f8faf7] py-20 sm:py-28" aria-labelledby="home-focus">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 sm:px-8 lg:grid-cols-2 lg:gap-24 lg:px-10">
          <div>
            <h2 id="home-focus" className="max-w-xl text-balance text-3xl font-semibold leading-tight tracking-[-0.03em] text-[#173a15] sm:text-5xl">
              The administrative work should not crowd out the human work.
            </h2>
          </div>
          <div className="max-w-2xl space-y-6 text-base leading-7 text-[#50644d] sm:text-lg sm:leading-8">
            <p>
              Case managers already know their families. The friction is turning that understanding into a plan and then re-entering it into required paperwork.
            </p>
            <p>
              CaseLink creates one dependable handoff: capture current barriers, review a structured plan, and use that context to prepare a fillable PDF for the software your school already uses.
            </p>
            <Link href="/product" className="group inline-flex items-center gap-2 font-semibold text-[#276221] underline decoration-[#8bca84] decoration-2 underline-offset-4 transition-colors hover:text-[#1f531b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#46923c]/35">
              Explore the product <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden />
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-[#276221] py-20 text-white sm:py-24" aria-labelledby="home-cta">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-8 px-5 sm:px-8 lg:flex-row lg:items-end lg:px-10">
          <div>
            <h2 id="home-cta" className="max-w-3xl text-balance text-3xl font-semibold tracking-[-0.03em] sm:text-5xl">
              See how CaseLink fits alongside your current paperwork process.
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-7 text-[#cce7c9]">
              We&apos;ll learn about your current process and walk through CaseLink without requiring a technical setup.
            </p>
          </div>
          <Link href="/request-demo" className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-lg bg-white px-5 text-sm font-semibold text-[#276221] shadow-[0_8px_24px_rgba(11,36,10,0.2)] transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(11,36,10,0.28)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#276221] active:translate-y-0">
            Request a demo <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </section>
    </>
  );
}
