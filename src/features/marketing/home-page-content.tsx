import { Card } from "@/components/ui/card";

const sectionTitle =
  "text-xl font-semibold text-slate-900 sm:text-2xl";
const body =
  "text-sm leading-relaxed text-slate-600 sm:text-base";
const bodyBlock = `mt-4 max-w-3xl space-y-4 ${body}`;

export function HomePageContent() {
  return (
    <>
      <section
        className="border-b border-slate-200 bg-white"
        aria-labelledby="hero-heading"
      >
        <div className="mx-auto max-w-5xl px-4 py-16 sm:py-20 lg:py-24">
          <h1
            id="hero-heading"
            className="max-w-3xl text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl"
          >
            Helping case managers turn complex family needs into clear next
            steps.
          </h1>
          <p className={`mt-5 max-w-3xl ${body}`}>
            At Alain Locke School in West Philadelphia, case managers support
            families facing barriers such as housing instability, food access,
            transportation, childcare, employment, and mental health
            challenges. CaseLink is an AI-powered tool built with case managers
            to help them create personalized action plans connected to local
            resources in Philadelphia.
          </p>
        </div>
      </section>

      <section
        className="mx-auto max-w-5xl px-4 py-14 sm:py-16"
        aria-labelledby="problem-heading"
      >
        <h2 id="problem-heading" className={sectionTitle}>
          The Problem
        </h2>
        <div className={bodyBlock}>
          <p>
            Families rarely face one challenge at a time. For school case
            managers, supporting a family can mean navigating housing issues,
            food insecurity, transportation barriers, childcare needs,
            employment challenges, and mental health concerns all at once.
          </p>
          <p>
            But finding the right next step often means piecing together
            information across multiple websites, organizations, and systems.
            That process takes time away from the work that matters most:
            building trust, understanding each family&apos;s situation, and
            delivering timely, thoughtful support.
          </p>
          <p>
            In high-need school communities, case managers need tools that help
            them move from identifying a barrier to taking action quickly and
            practically.
          </p>
        </div>
      </section>

      <section
        className="border-y border-slate-200 bg-white"
        aria-labelledby="what-heading"
      >
        <div className="mx-auto max-w-5xl px-4 py-14 sm:py-16">
          <h2 id="what-heading" className={sectionTitle}>
            What is CaseLink?
          </h2>
          <div className={bodyBlock}>
            <p>
              CaseLink is an AI-powered tool designed to support school case
              managers. It helps them identify key barriers, organize those
              needs, and generate personalized action plans connected to relevant
              local resources in Philadelphia.
            </p>
            <p>
              Built in close collaboration with case managers at Alain Locke
              School, CaseLink reflects the real needs they see every day.
              Rather than starting from scratch each time a family needs
              support, case managers can use CaseLink to quickly build a clearer
              path forward.
            </p>
          </div>
        </div>
      </section>

      <section
        id="how-caselink-helps"
        className="mx-auto max-w-5xl scroll-mt-24 px-4 py-14 sm:py-16"
        aria-labelledby="how-heading"
      >
        <h2 id="how-heading" className={sectionTitle}>
          How CaseLink Helps
        </h2>
        <p className={`mt-4 max-w-3xl ${body}`}>
          CaseLink helps case managers respond more efficiently, more
          practically, and more personally.
        </p>
        <ul className="mt-8 grid list-none gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <li>
            <Card className="h-full p-5">
              <h3 className="text-sm font-semibold text-slate-900">
                Identify barriers
              </h3>
              <p className={`mt-2 ${body}`}>
                Case managers can quickly select areas where a family needs
                support, from housing and employment to food access,
                transportation, childcare, and mental health.
              </p>
            </Card>
          </li>
          <li>
            <Card className="h-full p-5">
              <h3 className="text-sm font-semibold text-slate-900">
                Generate a personalized plan
              </h3>
              <p className={`mt-2 ${body}`}>
                CaseLink turns those barriers into a clear, practical action
                plan tailored to the family&apos;s needs.
              </p>
            </Card>
          </li>
          <li>
            <Card className="h-full p-5">
              <h3 className="text-sm font-semibold text-slate-900">
                Connect to local resources
              </h3>
              <p className={`mt-2 ${body}`}>
                The tool links case managers to relevant Philadelphia-based
                resources and next steps, helping them respond faster and more
                effectively.
              </p>
            </Card>
          </li>
        </ul>
        <p className={`mt-10 max-w-3xl ${body}`}>
          By reducing time spent searching for starting points and assembling
          resource lists, CaseLink helps case managers focus more of their time
          on supporting families.
        </p>
      </section>

      <section
        className="border-y border-slate-200 bg-white"
        aria-labelledby="privacy-heading"
      >
        <div className="mx-auto max-w-5xl px-4 py-14 sm:py-16">
          <h2 id="privacy-heading" className={sectionTitle}>
            Privacy Comes First
          </h2>
          <div className={bodyBlock}>
            <p>
              CaseLink is designed to make support more efficient, practical,
              and personalized, while protecting family privacy.
            </p>
            <p>
              The tool is built to help case managers think through barriers and
              identify helpful next steps without requiring confidential or
              sensitive information from families. In a setting where trust
              matters deeply, privacy is not an afterthought. It is part of the
              design.
            </p>
          </div>
        </div>
      </section>

      <section
        className="mx-auto max-w-5xl px-4 py-14 sm:py-16"
        aria-labelledby="built-with-heading"
      >
        <h2 id="built-with-heading" className={sectionTitle}>
          Built With the People Closest to the Work
        </h2>
        <p className={`mt-4 max-w-3xl ${body}`}>
          CaseLink was created by a small team of University of Pennsylvania
          students in close collaboration with case managers at Alain Locke
          School. Our goal is simple: to build practical AI tools that strengthen
          the people already doing the work of supporting families every day.
        </p>
      </section>
    </>
  );
}
