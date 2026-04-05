import type { ReactNode } from "react";

/**
 * Legal document body: matches marketing sections (max-w-5xl, full-width prose in that column).
 */
export function LegalDocumentBody({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated: string;
  children: ReactNode;
}) {
  return (
    <>
      <section
        className="border-b border-slate-200 bg-white"
        aria-labelledby="legal-doc-title"
      >
        <div className="mx-auto max-w-5xl px-4 py-12 sm:py-14 lg:py-16">
          <h1
            id="legal-doc-title"
            className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl"
          >
            {title}
          </h1>
          <p className="mt-3 text-sm text-slate-500 sm:text-base">
            Last updated: {lastUpdated}
          </p>
        </div>
      </section>
      <section className="mx-auto w-full max-w-5xl px-4 py-12 sm:py-14 lg:py-16">
        <div className="w-full space-y-8 text-sm leading-relaxed text-slate-600 sm:space-y-10 sm:text-base">
          {children}
        </div>
      </section>
    </>
  );
}

export function LegalSection({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`legal-section-${n}`} className="scroll-mt-8">
      <h2
        id={`legal-section-${n}`}
        className="text-xl font-semibold text-slate-900 sm:text-2xl"
      >
        {n}. {title}
      </h2>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

export function LegalList({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-2 pl-5 text-slate-600 sm:pl-6">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
