import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, FileText, ShieldCheck } from "lucide-react";

const workflow = [
  {
    title: "Capture context",
    body: "Document current barriers and the context needed for planning.",
  },
  {
    title: "Build the plan",
    body: "Draft goals and actions with exact target dates.",
  },
  {
    title: "Review paperwork",
    body: "Check each proposed entry and make changes.",
  },
  {
    title: "Download the PDF",
    body: "Export a completed copy for your school’s system.",
  },
];

function ProductProof() {
  return (
    <div
      className="public-hero-visual relative mx-auto w-full max-w-[700px] lg:mx-0"
      aria-label="A school case manager meeting with a caregiver and child alongside an intervention plan ready for review"
      role="img"
    >
      <div aria-hidden="true">
        <div className="relative aspect-[4/3] overflow-hidden">
          <Image
            src="/marketing/caselink-family-support.webp"
            alt=""
            fill
            priority
            sizes="(min-width: 1024px) 52vw, 92vw"
            className="object-contain object-center"
          />
        </div>

        <div className="relative z-10 mx-auto -mt-[22%] w-[94%] max-w-[590px] rounded-2xl bg-[var(--public-surface)] p-4 [box-shadow:var(--public-shadow-proof)] sm:p-5">
          <div className="flex items-center justify-between gap-4 border-b border-[var(--public-rule)] pb-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="public-icon-tile size-9 rounded-[10px]">
                <FileText className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[var(--public-ink)]">Intervention plan</p>
                <p className="text-xs text-[var(--public-ink-3)]">Housing stability</p>
              </div>
            </div>
            <span className="hidden shrink-0 rounded-full bg-[var(--public-positive-bg)] px-3 py-1 text-xs font-semibold text-[var(--public-positive)] sm:inline-flex">
              Ready for review
            </span>
          </div>

          <div className="grid gap-4 pt-4 sm:grid-cols-[0.9fr_1.1fr]">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.11em] text-[var(--public-ink-3)]">
                Reviewed plan
              </p>
              <div className="mt-3 space-y-2.5">
                {["Current barrier", "30-day action", "Case manager note"].map((item) => (
                  <div key={item} className="flex items-center gap-2 text-xs font-medium text-[var(--public-ink-2)]">
                    <span className="grid size-5 place-items-center rounded-full bg-[var(--public-accent-soft)] text-[var(--public-accent)]">
                      <Check className="size-3" strokeWidth={2.5} />
                    </span>
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-3 border-t border-[var(--public-rule-soft)] pt-4 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--public-ink-3)]">Primary need</p>
                <div className="mt-1.5 rounded-lg bg-[var(--public-paper-2)] px-3 py-2 text-xs font-medium text-[var(--public-ink-strong)]">
                  Housing stability
                </div>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--public-ink-3)]">Recommended action</p>
                <div className="mt-1.5 rounded-lg bg-[var(--public-paper-2)] px-3 py-2 text-xs leading-5 text-[var(--public-ink-strong)]">
                  Complete housing intake and gather required documents.
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-[var(--public-rule)] pt-3">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--public-ink-strong)] sm:text-xs">
              <ShieldCheck className="size-3.5 text-[var(--public-accent)]" /> Review before download
            </span>
            <span className="shrink-0 rounded-lg bg-[var(--public-accent)] px-3 py-2 text-[11px] font-semibold text-[var(--public-accent-ink)] sm:text-xs">
              Download PDF
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function HomePageContent() {
  return (
    <>
      <section className="overflow-hidden border-b border-[var(--public-rule)] bg-[var(--public-paper-hero)]" aria-labelledby="home-hero">
        <div className="mx-auto grid min-h-[720px] max-w-7xl items-center gap-12 px-5 pb-18 pt-12 sm:px-8 sm:pb-24 sm:pt-16 lg:min-h-[calc(100svh-7.25rem)] lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-8 lg:px-10 lg:pb-12 lg:pt-8">
          <div className="public-hero-copy max-w-[650px]">
            <h1
              id="home-hero"
              className="public-display text-balance text-[clamp(3.15rem,5vw,5.25rem)] leading-[0.93] text-[var(--public-ink)]"
            >
              Turn family needs into clear plans and prepared paperwork.
            </h1>
            <p className="mt-7 max-w-[60ch] text-pretty text-lg leading-8 text-[var(--public-ink-2)] sm:text-xl">
              CaseLink helps school case managers organize barriers, draft a structured intervention plan, and prepare fillable forms for manual upload to the systems their schools already use.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link href="/product" className="public-primary-action">
                Learn More <ArrowRight className="size-4" aria-hidden />
              </Link>
              <Link href="/request-demo" className="public-secondary-action">
                Request a Demo <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
          </div>

          <ProductProof />
        </div>
      </section>

      <section id="workflow" className="scroll-mt-24 border-b border-[var(--public-rule)] bg-[var(--public-surface)] py-16 sm:py-20" aria-labelledby="workflow-title">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 sm:px-8 lg:grid-cols-[minmax(0,0.55fr)_minmax(0,1.45fr)] lg:gap-20 lg:px-10">
          <div>
            <h2 id="workflow-title" className="public-display max-w-md text-balance text-4xl leading-[0.98] text-[var(--public-ink)] sm:text-5xl">
              A clear path from context to paperwork.
            </h2>
          </div>

          <ol className="relative grid gap-9 pl-8 before:absolute before:bottom-2 before:left-[0.375rem] before:top-2 before:w-px before:bg-[var(--public-rule-strong)] lg:grid-cols-4 lg:gap-7 lg:pl-0 lg:before:bottom-auto lg:before:left-[0.375rem] lg:before:right-0 lg:before:top-[0.375rem] lg:before:h-px lg:before:w-auto">
            {workflow.map(({ title, body }, index) => (
              <li key={title} className="relative min-w-0">
                <span className="absolute -left-8 top-0 z-10 block size-3 rounded-full border-2 border-[var(--public-accent)] bg-[var(--public-surface)] lg:static lg:mb-6" aria-hidden />
                <p className="text-xs font-semibold tracking-[0.08em] text-[var(--public-accent)]">Step {index + 1}</p>
                <h3 className="mt-2 text-lg font-semibold tracking-[-0.02em] text-[var(--public-ink)]">{title}</h3>
                <p className="mt-2 max-w-[31ch] text-sm leading-6 text-[var(--public-ink-3)]">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="bg-[var(--public-paper-2)]" aria-label="CaseLink recognition">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-7 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-10">
          <p className="max-w-2xl text-sm font-medium leading-6 text-[var(--public-ink-strong)]">
            Built with school case managers and selected for OpenAI&apos;s inaugural ChatGPT Futures Class of 2026.
          </p>
          <span className="shrink-0 text-sm font-semibold text-[var(--public-accent)]">
            Supported through an OpenAI grant
          </span>
        </div>
      </section>
    </>
  );
}
