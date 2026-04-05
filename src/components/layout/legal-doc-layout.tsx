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
