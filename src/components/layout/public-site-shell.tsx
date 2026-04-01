import type { ReactNode } from "react";
import Link from "next/link";

export function PublicSiteShell({
  children,
  authenticated = false,
}: {
  children: ReactNode;
  /** When true, show entry to the signed-in workspace instead of Sign in. */
  authenticated?: boolean;
}) {
  return (
    <div className="flex min-h-full flex-col bg-[#f4f6f8]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-slate-900 focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-400/40"
      >
        Skip to main content
      </a>
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:py-4">
          <Link
            href="/"
            className="flex items-center gap-3 text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40 focus-visible:ring-offset-2 rounded-md"
          >
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/90 text-sm font-semibold text-white"
              aria-hidden
            >
              CL
            </span>
            <span className="text-base font-semibold tracking-tight">
              CaseLink
            </span>
          </Link>
          <nav
            className="flex flex-wrap items-center gap-1 sm:gap-2"
            aria-label="Primary"
          >
            <Link
              href="/"
              className="rounded-md bg-blue-50/70 px-3 py-2 text-sm font-medium text-blue-700 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40 focus-visible:ring-offset-2"
            >
              Home
            </Link>
            {authenticated ? (
              <Link
                href="/families"
                className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40 focus-visible:ring-offset-2"
              >
                Families
              </Link>
            ) : (
              <Link
                href="/login"
                className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40 focus-visible:ring-offset-2"
              >
                Sign in
              </Link>
            )}
          </nav>
        </div>
      </header>
      <main id="main-content" className="flex-1">
        {children}
      </main>
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-900">CaseLink</p>
              <p className="mt-1 max-w-md text-sm leading-relaxed text-slate-600">
                An initiative connected to Alain Locke School in Philadelphia,
                supporting case managers who work with families every day.
              </p>
            </div>
            <nav className="flex flex-col gap-2 text-sm" aria-label="Footer">
              <Link
                href="/"
                className="text-slate-600 hover:text-slate-900 focus-visible:outline-none focus-visible:underline"
              >
                Home
              </Link>
              {authenticated ? (
                <Link
                  href="/families"
                  className="text-slate-600 hover:text-slate-900 focus-visible:outline-none focus-visible:underline"
                >
                  Families
                </Link>
              ) : (
                <Link
                  href="/login"
                  className="text-slate-600 hover:text-slate-900 focus-visible:outline-none focus-visible:underline"
                >
                  Sign in
                </Link>
              )}
            </nav>
          </div>
          <p className="mt-8 border-t border-slate-200 pt-6 text-xs text-slate-500">
            © {new Date().getFullYear()} CaseLink. Built in collaboration with
            case managers at Alain Locke School.
          </p>
        </div>
      </footer>
    </div>
  );
}
