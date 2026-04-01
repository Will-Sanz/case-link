import Link from "next/link";

const primaryLink =
  "inline-flex items-center justify-center rounded-lg bg-blue-500/90 px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40 focus-visible:ring-offset-2";
const secondaryLink =
  "inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2";

export function AboutPageContent() {
  return (
    <>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-3xl px-4 py-14 sm:py-16">
          <p className="text-sm font-medium text-blue-700">CaseLink</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            About CaseLink
          </h1>
          <p className="mt-4 text-base leading-relaxed text-slate-600 sm:text-lg">
            A collaboration focused on helping case managers at Alain Locke School better
            support families—through clearer plans, local resources, and less time lost to
            administrative burden.
          </p>
        </div>
      </header>

      <article className="mx-auto max-w-3xl px-4 py-12 sm:py-14">
        <div>
          <section id="how-it-started" className="scroll-mt-24">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
              How it started
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-slate-600 sm:text-base">
              CaseLink began after conversations at Alain Locke School in Philadelphia. School
              administrators shared that roughly 35% of the student body is facing homelessness—a
              figure that underscored how many families are carrying heavy challenges alongside
              school and everyday life. In that context, case managers are exploring how AI can
              strengthen the support they provide to families every day.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-slate-600 sm:text-base">
              That led to deeper conversations with case managers: the people doing the daily work
              of supporting these families. A group of students from the University of
              Pennsylvania spent time learning their role, understanding the workflow, and
              identifying where the heaviest administrative burden sat.
            </p>
          </section>

          <section className="mt-12 scroll-mt-24">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
              What we learned
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-slate-600 sm:text-base">
              Case managers are often supporting families through overlapping crises—housing
              instability, employment gaps, food access, transportation, childcare, and mental
              health needs—while also managing a significant administrative workload. Much of
              that work goes toward documenting barriers, researching resources, and building out
              support plans. That effort matters, but it can pull time away from direct
              connection with families.
            </p>
          </section>

          <section className="mt-12 scroll-mt-24">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
              Why CaseLink was built
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-slate-600 sm:text-base">
              CaseLink was designed to reduce that administrative burden so case managers can
              spend more time on the relational work only they can do. The product was built with
              close collaboration from the people doing this work every day at Locke—not as a
              generic tool, but as something grounded in their actual priorities and constraints.
            </p>
          </section>

          <section className="mt-12 scroll-mt-24">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
              What CaseLink does
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-slate-600 sm:text-base">
              CaseLink helps case managers identify the barriers a family is facing—including
              housing, food access, employment, mental health, transportation, and
              childcare—and generate personalized support plans connected to real local resources
              in Philadelphia. The aim is practical plans families can use, not generic checklists.
            </p>
          </section>

          <section className="mt-12 scroll-mt-24">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
              Where things stand
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-slate-600 sm:text-base">
              The platform is now being deployed by the case management team at Locke. It is
              expected to save each case manager roughly one hour of work per day—time that can
              return to coordination, follow-through, and face-to-face support.
            </p>
          </section>

          <section className="mt-12 scroll-mt-24">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
              What’s next
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-slate-600 sm:text-base">
              The work continues through learning and iteration: refining the tool alongside case
              managers, listening to what helps in real situations, and looking for thoughtful
              ways to expand impact over time—without losing sight of privacy, dignity, and the
              human side of this work.
            </p>
          </section>
        </div>

        <div className="mt-14 flex flex-col gap-3 border-t border-slate-200 pt-10 sm:flex-row sm:flex-wrap">
          <Link href="/" className={primaryLink}>
            Back to Home
          </Link>
          <Link href="/login" className={secondaryLink}>
            Sign in to CaseLink
          </Link>
        </div>
      </article>
    </>
  );
}
