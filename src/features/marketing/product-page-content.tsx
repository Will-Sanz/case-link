import Image from "next/image";
import { Check, FileText, LockKeyhole } from "lucide-react";

function PlanPdfDetail() {
  return (
    <div className="overflow-hidden rounded-2xl bg-[var(--public-surface)] [box-shadow:var(--public-shadow-decision)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--public-rule)] px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="public-icon-tile size-9 rounded-[10px]">
            <FileText className="size-4" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold text-[var(--public-ink)]">Family support plan.pdf</p>
            <p className="text-xs text-[var(--public-ink-3)]">Reviewed plan export</p>
          </div>
        </div>
        <span className="rounded-full bg-[var(--public-attention-bg)] px-3 py-1 text-xs font-semibold text-[var(--public-attention)]">
          Ready to download
        </span>
      </div>

      <div className="grid md:grid-cols-[220px_1fr]">
        <div className="border-b border-[var(--public-rule)] bg-[var(--public-paper-2)] p-5 md:border-b-0 md:border-r">
          <p className="text-xs font-semibold text-[var(--public-ink-muted)]">Included in the PDF</p>
          <div className="mt-4 divide-y divide-[var(--public-rule)] border-y border-[var(--public-rule)]">
            {["Current barriers", "Reviewed goals", "Dated actions"].map((source) => (
              <div key={source} className="flex items-center gap-2 py-3 text-xs font-medium text-[var(--public-ink-strong)]">
                <span className="grid size-5 place-items-center rounded-full bg-[var(--public-surface)] text-[var(--public-accent)]">
                  <Check className="size-3" strokeWidth={2.5} aria-hidden />
                </span>
                {source}
              </div>
            ))}
          </div>
          <div className="mt-5 flex items-start gap-2 text-xs leading-5 text-[var(--public-ink-muted)]">
            <LockKeyhole className="mt-0.5 size-3.5 shrink-0 text-[var(--public-accent)]" aria-hidden />
            The case manager reviews the plan before creating the PDF.
          </div>
        </div>

        <div className="space-y-4 p-5">
          {[
            ["Primary goal", "Maintain stable housing", "Reviewed"],
            ["Next action", "Complete housing intake and gather required documents.", "Case manager owned"],
            ["Target date", "August 14, 2026", "Confirmed"],
          ].map(([label, value, source], index) => (
            <div key={label} className="grid gap-2 sm:grid-cols-[150px_1fr] sm:items-start">
              <p className="pt-2 text-xs font-semibold text-[var(--public-ink-muted)]">{label}</p>
              <div
                className={`rounded-lg px-3 py-2.5 text-sm leading-5 ${
                  index === 2
                    ? "bg-[var(--public-accent-soft)] text-[var(--public-accent)] ring-1 ring-inset ring-[var(--public-accent-rule)]"
                    : "bg-[var(--public-paper-2)] text-[var(--public-ink-strong)]"
                }`}
              >
                <p>{value}</p>
                <p className="mt-1 text-[11px] opacity-70">{source}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ProductPageContent() {
  return (
    <>
      <section className="border-b border-[var(--public-rule)] bg-[var(--public-paper-2)] pb-20 pt-14 sm:pb-28 sm:pt-20 lg:flex lg:min-h-[calc(100svh-7.25rem)] lg:items-center lg:pb-16 lg:pt-12" aria-labelledby="paperwork-title">
        <div className="mx-auto grid max-w-7xl items-center gap-14 px-5 sm:px-8 lg:grid-cols-[0.72fr_1.28fr] lg:gap-20 lg:px-10">
          <div className="public-hero-copy">
            <h1 id="paperwork-title" className="public-display text-balance text-[clamp(3.25rem,6vw,5.75rem)] leading-[0.94] text-[var(--public-ink)]">
              A review process, not a black box.
            </h1>
            <p className="mt-6 text-base leading-7 text-[var(--public-ink-2)] sm:text-lg sm:leading-8">
              CaseLink turns a reviewed intervention plan into a clear PDF. Nothing is submitted automatically, and the case manager remains responsible for the final plan.
            </p>
            <ul className="mt-7 space-y-3 text-sm font-medium text-[var(--public-ink-strong)]">
              <li className="flex gap-3">
                <Check className="mt-0.5 size-4 shrink-0 text-[var(--public-accent)]" aria-hidden /> Professional black-and-white plan PDF
              </li>
              <li className="flex gap-3">
                <Check className="mt-0.5 size-4 shrink-0 text-[var(--public-accent)]" aria-hidden /> Reviewed goals, actions, owners, and dates
              </li>
              <li className="flex gap-3">
                <Check className="mt-0.5 size-4 shrink-0 text-[var(--public-accent)]" aria-hidden /> Download for the software your school already uses
              </li>
            </ul>
          </div>

          <div className="public-hero-visual">
            <PlanPdfDetail />
          </div>
        </div>
      </section>

      <section id="about" className="scroll-mt-24 bg-[var(--public-paper)] py-20 sm:py-28" aria-labelledby="about-title">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 sm:px-8 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:gap-20 lg:px-10">
          <figure className="min-w-0 overflow-hidden rounded-2xl border border-[var(--public-rule)] bg-[var(--public-paper-2)]">
            <Image
              src="/marketing/caselink-team.jpg"
              alt="Three members of the CaseLink team"
              width={1080}
              height={1080}
              sizes="(min-width: 1024px) 38vw, 92vw"
              className="h-auto w-full"
            />
          </figure>

          <div>
            <h2 id="about-title" className="public-display max-w-2xl text-balance text-4xl leading-[0.98] text-[var(--public-ink)] sm:text-6xl">
              Built beside the people doing the work.
            </h2>
            <div className="mt-7 max-w-[68ch] space-y-5 border-t border-[var(--public-rule-strong)] pt-7 text-base leading-7 text-[var(--public-ink-2)] sm:text-lg sm:leading-8">
              <p>
                CaseLink began through direct work with school case managers. The need was practical: staff were doing thoughtful family-support work, then spending too much time rebuilding the same information inside administrative forms.
              </p>
              <p>
                We are a small team of University of Pennsylvania students building with those practitioners, not around them. In 2026, CaseLink was selected for OpenAI&apos;s inaugural ChatGPT Futures class.
              </p>
              <p>
                Our reason for building is simple: AI should give school staff more time for trust, follow-through, and family support—not add another complicated system to maintain.
              </p>
            </div>
          </div>
        </div>
      </section>

    </>
  );
}
