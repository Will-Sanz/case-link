import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { CaseLinkWordmark } from "@/components/brand/caselink-mark";

export function PublicSiteShell({
  children,
  authenticated = false,
}: {
  children: ReactNode;
  /** When true, show Families link into the signed-in workspace. */
  authenticated?: boolean;
}) {
  return (
    <div className="flex min-h-full flex-col bg-[#f6f8f4]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-[#173a15] focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-[#46923c]/30"
      >
        Skip to main content
      </a>
      <a
        href="https://openai.com/index/introducing-chatgpt-futures-class-of-2026/"
        target="_blank"
        rel="noreferrer"
        className="group flex min-h-10 items-center justify-center gap-1.5 bg-[#173a15] px-4 py-2 text-center text-xs font-medium text-[#e7f3e5] transition-colors hover:bg-[#214d1e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70 sm:text-sm"
      >
        Selected for OpenAI&apos;s inaugural ChatGPT Futures Class of 2026
        <ArrowUpRight className="size-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
      </a>
      <header className="sticky top-0 z-40 border-b border-[#dce6d9]/90 bg-white/94 backdrop-blur-sm">
        <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between gap-4 px-5 sm:px-8 lg:px-10">
          <Link
            href="/"
            className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#46923c]/35 focus-visible:ring-offset-4"
          >
            <CaseLinkWordmark />
          </Link>
          <nav
            className="flex items-center gap-1 sm:gap-2"
            aria-label="Primary"
          >
            <Link
              href="/"
              className="hidden rounded-lg px-3 py-2 text-sm font-medium text-[#4e664b] transition-colors hover:bg-[#edf4eb] hover:text-[#173a15] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#46923c]/35 sm:inline-flex"
            >
              Home
            </Link>
            <Link
              href="/product"
              className="hidden rounded-lg px-3 py-2 text-sm font-medium text-[#4e664b] transition-colors hover:bg-[#edf4eb] hover:text-[#173a15] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#46923c]/35 sm:inline-flex"
            >
              Product
            </Link>
            {authenticated ? (
              <Link
                href="/families"
                className="rounded-lg px-3 py-2 text-sm font-medium text-[#4e664b] transition-colors hover:bg-[#edf4eb] hover:text-[#173a15] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#46923c]/35"
              >
                Families
              </Link>
            ) : null}
            <Link
              href="/request-demo"
              className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[#276221] px-4 text-sm font-semibold text-white shadow-[0_6px_18px_rgba(39,98,33,0.2)] transition-[background-color,transform,box-shadow] hover:-translate-y-0.5 hover:bg-[#1f531b] hover:shadow-[0_8px_22px_rgba(39,98,33,0.24)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#46923c]/35 focus-visible:ring-offset-2 active:translate-y-0"
            >
              Request a demo
            </Link>
          </nav>
        </div>
      </header>
      <main id="main-content" className="flex-1">
        {children}
      </main>
      <footer className="border-t border-[#dce6d9] bg-[#173a15] text-white">
        <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8 lg:px-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-base font-semibold">CaseLink</p>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-[#cce7c9]">
                Less time rebuilding paperwork. More time supporting families.
              </p>
            </div>
            <nav className="flex flex-col gap-2 text-sm" aria-label="Footer">
              <Link
                href="/"
                className="text-[#cce7c9] hover:text-white focus-visible:outline-none focus-visible:underline"
              >
                Home
              </Link>
              <Link href="/product" className="text-[#cce7c9] hover:text-white focus-visible:outline-none focus-visible:underline">
                Product &amp; about
              </Link>
              <Link href="/request-demo" className="text-[#cce7c9] hover:text-white focus-visible:outline-none focus-visible:underline">
                Request a demo
              </Link>
              {authenticated ? (
                <Link
                  href="/families"
                  className="text-[#cce7c9] hover:text-white focus-visible:outline-none focus-visible:underline"
                >
                  Families
                </Link>
              ) : null}
              <Link
                href="/privacy"
                className="text-[#cce7c9] hover:text-white focus-visible:outline-none focus-visible:underline"
              >
                Privacy Policy
              </Link>
              <Link
                href="/terms"
                className="text-[#cce7c9] hover:text-white focus-visible:outline-none focus-visible:underline"
              >
                Terms of Service
              </Link>
            </nav>
          </div>
          <p className="mt-8 border-t border-white/15 pt-6 text-xs text-[#acd8a7]">
            © {new Date().getFullYear()} CaseLink. Built in collaboration with
            case managers at Alain Locke School.
          </p>
        </div>
      </footer>
    </div>
  );
}
