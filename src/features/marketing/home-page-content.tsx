import Link from "next/link";
import { Card } from "@/components/ui/card";
import {
  IconChildcare,
  IconEmployment,
  IconFood,
  IconHousing,
  IconMentalHealth,
  IconTransport,
} from "@/features/marketing/barrier-topic-icons";

const primaryLink =
  "inline-flex items-center justify-center rounded-lg bg-blue-500/90 px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40 focus-visible:ring-offset-2";
const secondaryLink =
  "inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2";

const barriers = [
  {
    title: "Housing",
    text: "Stability and shelter needs surfaced clearly so plans stay grounded in what families face first.",
    Icon: IconHousing,
  },
  {
    title: "Employment",
    text: "Work and income barriers connected to practical steps and local programs.",
    Icon: IconEmployment,
  },
  {
    title: "Food access",
    text: "Nutrition and food security needs linked to nearby resources and next actions.",
    Icon: IconFood,
  },
  {
    title: "Transportation",
    text: "Mobility challenges folded into plans so appointments and services are reachable.",
    Icon: IconTransport,
  },
  {
    title: "Childcare",
    text: "Caregiving and scheduling pressures reflected in support steps that fit real life.",
    Icon: IconChildcare,
  },
  {
    title: "Mental health",
    text: "Emotional and behavioral health needs considered alongside other urgent concerns.",
    Icon: IconMentalHealth,
  },
] as const;

export function HomePageContent() {
  return (
    <>
      <section
        className="border-b border-slate-200 bg-white"
        aria-labelledby="hero-heading"
      >
        <div className="mx-auto max-w-5xl px-4 py-16 sm:py-20 lg:py-24">
          <p className="text-sm font-medium text-blue-700">Alain Locke School · Philadelphia</p>
          <h1
            id="hero-heading"
            className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl"
          >
            Practical support plans for families, shaped by the people who know the work
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
            CaseLink helps case managers identify barriers such as housing, employment, food
            access, transportation, childcare, and mental health, and turn them into personalized
            plans tied to real resources in Philadelphia.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <Link href="/about" className={primaryLink}>
              About CaseLink
            </Link>
            <Link href="#how-caselink-helps" className={secondaryLink}>
              How it works
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-14 sm:py-16" aria-labelledby="mission-heading">
        <h2 id="mission-heading" className="text-xl font-semibold text-slate-900 sm:text-2xl">
          What CaseLink is
        </h2>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-slate-600 sm:text-base">
          CaseLink is an initiative at Alain Locke School where case managers are exploring how
          AI can strengthen the support they provide to families every day. The tool helps identify
          barriers and generate personalized support plans connected to local resources in
          Philadelphia. It was built in close collaboration with Locke’s case managers so it
          reflects the real needs they see in their work.
        </p>
      </section>

      <section
        className="border-y border-slate-200 bg-white"
        aria-labelledby="why-heading"
      >
        <div className="mx-auto max-w-5xl px-4 py-14 sm:py-16">
          <h2 id="why-heading" className="text-xl font-semibold text-slate-900 sm:text-2xl">
            Why this matters
          </h2>
          <div className="mt-6 max-w-3xl space-y-4 text-sm leading-relaxed text-slate-600 sm:text-base">
            <p>
              In conversations at the school, administrators shared that roughly 35% of the
              student body is facing homelessness, a stark reminder of how many families are
              navigating serious hardship alongside school and daily life.
            </p>
            <p>
              Case managers carry both relational work (building trust and walking alongside
              families) and heavy administrative work: tracking needs across multiple crises,
              researching resources, documenting barriers, and building support plans. A large
              share of time goes to documentation and planning work that competes with direct
              time with families. CaseLink exists to help address that gap.
            </p>
          </div>
        </div>
      </section>

      <section
        id="how-caselink-helps"
        className="mx-auto max-w-5xl scroll-mt-24 px-4 py-14 sm:py-16"
        aria-labelledby="how-heading"
      >
        <h2 id="how-heading" className="text-xl font-semibold text-slate-900 sm:text-2xl">
          How CaseLink helps
        </h2>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-slate-600 sm:text-base">
          CaseLink organizes what a family is facing and connects those needs to relevant local
          resources, so plans stay specific, actionable, and grounded in Philadelphia.
        </p>
        <ul className="mt-8 grid list-none gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {barriers.map(({ title, text, Icon }) => (
            <li key={title}>
              <Card className="h-full p-5">
                <div className="flex gap-4">
                  <Icon />
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-600">{text}</p>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section
        className="border-y border-slate-200 bg-white"
        aria-labelledby="impact-heading"
      >
        <div className="mx-auto max-w-5xl px-4 py-14 sm:py-16">
          <h2 id="impact-heading" className="text-xl font-semibold text-slate-900 sm:text-2xl">
            Impact at Locke
          </h2>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-slate-600 sm:text-base">
            The platform is now being deployed by the case management team at Locke. It is
            expected to save each case manager roughly one hour of work per day. Time that can go
            back toward listening, coordination, and direct support for families.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-14 sm:py-16" aria-labelledby="privacy-heading">
        <h2 id="privacy-heading" className="text-xl font-semibold text-slate-900 sm:text-2xl">
          Built for real work and for privacy
        </h2>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-slate-600 sm:text-base">
          CaseLink is designed to be practical, personalized, and respectful of family privacy.
          The goal is to make support more efficient without turning sensitive situations into
          unnecessary paperwork or exposure. The tool was developed by a group of students from
          the University of Pennsylvania in ongoing dialogue with Locke’s case managers.
        </p>
      </section>

      <section
        className="border-t border-slate-200 bg-slate-50/80"
        aria-labelledby="learn-more-heading"
      >
        <div className="mx-auto max-w-5xl px-4 py-14 sm:py-16">
          <h2 id="learn-more-heading" className="text-xl font-semibold text-slate-900 sm:text-2xl">
            Learn more
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-600 sm:text-base">
            Read the full story of how CaseLink started, what the team learned from case managers,
            and where the work is headed on the About page.
          </p>
          {/* TODO(caselink): When the public URL for the Alain Locke team’s post is available, add a text link or secondary button here (e.g. “Read the school’s post”) with href set to that URL. */}
          <p className="mt-4 text-sm text-slate-500">
            The Alain Locke team shared a post about what this looks like in practice. A link will
            appear here once the URL is confirmed.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link href="/about" className={primaryLink}>
              About CaseLink
            </Link>
            <Link href="/login" className={secondaryLink}>
              Sign in to CaseLink
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
