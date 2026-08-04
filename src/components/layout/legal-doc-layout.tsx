import type { ReactNode } from "react";

export { LegalDensityProvider, LegalList, LegalSection } from "./legal-doc-blocks";

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
        className="border-b border-[var(--public-rule)] bg-[var(--public-paper-2)]"
        aria-labelledby="legal-doc-title"
      >
        <div className="mx-auto max-w-5xl px-5 py-14 sm:px-8 sm:py-18 lg:py-20">
          <h1
            id="legal-doc-title"
            className="public-display text-4xl leading-none text-[var(--public-ink)] sm:text-5xl"
          >
            {title}
          </h1>
          <p className="mt-4 text-sm text-[var(--public-ink-3)] sm:text-base">
            Last updated: {lastUpdated}
          </p>
        </div>
      </section>
      <section className="mx-auto w-full max-w-5xl px-5 py-14 sm:px-8 sm:py-18 lg:py-20">
        <div className="w-full max-w-[72ch] space-y-10 text-sm leading-7 text-[var(--public-ink-2)] sm:space-y-12 sm:text-base sm:leading-8">
          {children}
        </div>
      </section>
    </>
  );
}
