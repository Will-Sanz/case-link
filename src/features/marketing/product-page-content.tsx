import Link from "next/link";
import {
  ArrowRight,
  Check,
  FileCheck2,
  FileText,
  ListChecks,
  LockKeyhole,
  ShieldCheck,
  UsersRound,
} from "lucide-react";

const features = [
  {
    title: "A focused family record",
    body: "Create a de-identified household label and capture only the context the case manager needs for planning.",
    icon: UsersRound,
  },
  {
    title: "Barriers in one clear step",
    body: "Select the barriers that apply, add de-identified context, and keep the case manager in control of what shapes the plan.",
    icon: ShieldCheck,
  },
  {
    title: "A structured intervention plan",
    body: "Turn the selected barriers into clear 30-, 60-, and 90-day actions. The case manager reviews and edits the plan before it becomes a source for paperwork.",
    icon: ListChecks,
  },
  {
    title: "A fillable-PDF workspace",
    body: "Upload a blank fillable form, review CaseLink’s proposed entries field by field, make changes, and download the completed copy for CitySpan.",
    icon: FileCheck2,
  },
];

function PaperworkDetail() {
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-[0_28px_70px_rgba(30,70,27,0.12)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#dce6d9] px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-[#edf6eb] text-[#276221]"><FileText className="size-4.5" aria-hidden /></span>
          <div>
            <p className="text-sm font-semibold text-[#173a15]">Family intake form.pdf</p>
            <p className="text-xs text-[#687b65]">Review proposed entries</p>
          </div>
        </div>
        <span className="rounded-full bg-[#fff5da] px-3 py-1 text-xs font-semibold text-[#765a16]">2 need review</span>
      </div>
      <div className="grid md:grid-cols-[220px_1fr]">
        <div className="border-b border-[#dce6d9] bg-[#f3f7f1] p-5 md:border-b-0 md:border-r">
          <p className="text-xs font-semibold text-[#5d705a]">Information sources</p>
          <div className="mt-4 space-y-2">
            {["Family profile", "Current barriers", "Reviewed plan"].map((source) => (
              <div key={source} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2.5 text-xs font-medium text-[#365134]">
                <span className="grid size-5 place-items-center rounded-full bg-[#d8ead5] text-[#276221]"><Check className="size-3" strokeWidth={2.5} aria-hidden /></span>
                {source}
              </div>
            ))}
          </div>
          <div className="mt-5 flex items-start gap-2 text-xs leading-5 text-[#5d705a]">
            <LockKeyhole className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            The PDF stays in your browser while you review and download it.
          </div>
        </div>
        <div className="space-y-4 p-5">
          {[
            ["Primary barrier", "Housing instability", "From current barriers"],
            ["30-day objective", "Complete housing intake and gather required documents.", "From reviewed plan"],
            ["Household identifier", "Review before download", "Needs your input"],
          ].map(([label, value, source], index) => (
            <div key={label} className="grid gap-2 sm:grid-cols-[150px_1fr] sm:items-start">
              <p className="pt-2 text-xs font-semibold text-[#50644d]">{label}</p>
              <div className={`rounded-lg px-3 py-2.5 text-sm leading-5 ${index === 2 ? "bg-[#fff8e8] text-[#6b5117] ring-1 ring-inset ring-[#ead9aa]" : "bg-[#f6f8f4] text-[#253f23]"}`}>
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
      <section className="bg-[#f8faf7] py-20 sm:py-28" aria-labelledby="product-title">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
          <h1 id="product-title" className="hero-reveal max-w-5xl text-balance text-[clamp(2.8rem,7vw,6rem)] font-semibold leading-[0.98] tracking-[-0.04em] text-[#173a15]">
            The paperwork assistant built around the case manager.
          </h1>
          <p className="hero-reveal-late mt-7 max-w-3xl text-lg leading-8 text-[#50644d] sm:text-xl">
            CaseLink does one job well: it carries reviewed family context from intake to intervention plan to required form—without taking judgment away from the person closest to the family.
          </p>
        </div>
      </section>

      <section className="border-y border-[#dce6d9] bg-white py-20 sm:py-24" aria-labelledby="offer-title">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
          <div className="grid gap-12 lg:grid-cols-[0.7fr_1.3fr] lg:gap-20">
            <div>
              <h2 id="offer-title" className="text-3xl font-semibold tracking-[-0.03em] text-[#173a15] sm:text-4xl">What CaseLink offers</h2>
              <p className="mt-4 max-w-lg text-base leading-7 text-[#5d705a]">
                A deliberately small set of tools that removes repeated work from a mandated process.
              </p>
            </div>
            <div className="divide-y divide-[#dce6d9] border-y border-[#dce6d9]">
              {features.map(({ title, body, icon: Icon }) => (
                <article key={title} className="grid gap-4 py-8 sm:grid-cols-[48px_1fr]">
                  <span className="grid size-11 place-items-center rounded-xl bg-[#edf6eb] text-[#276221]"><Icon className="size-5" aria-hidden /></span>
                  <div>
                    <h3 className="text-xl font-semibold tracking-[-0.02em] text-[#173a15]">{title}</h3>
                    <p className="mt-2 max-w-2xl text-base leading-7 text-[#5d705a]">{body}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#e7f1e4] py-20 sm:py-28" aria-labelledby="paperwork-title">
        <div className="mx-auto grid max-w-7xl items-center gap-14 px-5 sm:px-8 lg:grid-cols-[0.72fr_1.28fr] lg:gap-20 lg:px-10">
          <div>
            <h2 id="paperwork-title" className="text-balance text-3xl font-semibold tracking-[-0.03em] text-[#173a15] sm:text-5xl">A review process, not a black box.</h2>
            <p className="mt-5 text-base leading-7 text-[#50644d] sm:text-lg sm:leading-8">
              CaseLink proposes entries and shows where they came from. Uncertain or missing fields are called out. Nothing is final until the case manager reviews it.
            </p>
            <ul className="mt-7 space-y-3 text-sm font-medium text-[#365134]">
              <li className="flex gap-3"><Check className="mt-0.5 size-4 shrink-0 text-[#3b8132]" aria-hidden /> Supports fillable PDF forms</li>
              <li className="flex gap-3"><Check className="mt-0.5 size-4 shrink-0 text-[#3b8132]" aria-hidden /> Editable before download</li>
              <li className="flex gap-3"><Check className="mt-0.5 size-4 shrink-0 text-[#3b8132]" aria-hidden /> Manual CitySpan submission stays under your control</li>
            </ul>
          </div>
          <PaperworkDetail />
        </div>
      </section>

      <section className="bg-white py-20 sm:py-28" aria-labelledby="about-title">
        <div className="mx-auto grid max-w-7xl gap-14 px-5 sm:px-8 lg:grid-cols-2 lg:gap-24 lg:px-10">
          <div>
            <h2 id="about-title" className="max-w-xl text-balance text-3xl font-semibold tracking-[-0.03em] text-[#173a15] sm:text-5xl">Built beside the people doing the work.</h2>
          </div>
          <div className="max-w-2xl space-y-5 text-base leading-7 text-[#50644d] sm:text-lg sm:leading-8">
            <p>
              CaseLink began through work with case managers at Alain Locke School in West Philadelphia. The need was practical: staff were doing thoughtful family-support work, then spending too much time rebuilding the same information inside administrative forms.
            </p>
            <p>
              We are a small team of University of Pennsylvania students building with those practitioners, not around them. In 2026, CaseLink was selected for OpenAI&apos;s inaugural ChatGPT Futures class.
            </p>
            <p>
              Our reason for building is simple: AI should give school staff more time for trust, follow-through, and family support—not add another complicated system to maintain.
            </p>
          </div>
        </div>
      </section>

      <section className="border-t border-[#dce6d9] bg-[#f8faf7] py-20" aria-labelledby="product-cta">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-8 px-5 sm:px-8 lg:flex-row lg:items-end lg:px-10">
          <div>
            <h2 id="product-cta" className="max-w-3xl text-balance text-3xl font-semibold tracking-[-0.03em] text-[#173a15] sm:text-5xl">Let&apos;s look at your current paperwork process.</h2>
            <p className="mt-4 max-w-2xl text-base leading-7 text-[#5d705a]">No technical preparation is needed. We&apos;ll start with the forms your team already has to complete.</p>
          </div>
          <Link href="/request-demo" className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-lg bg-[#276221] px-5 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(39,98,33,0.2)] transition-[background-color,transform] hover:-translate-y-0.5 hover:bg-[#1f531b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#46923c]/35 focus-visible:ring-offset-2 active:translate-y-0">
            Request a demo <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </section>
    </>
  );
}
