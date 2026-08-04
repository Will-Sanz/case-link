import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, Menu } from "lucide-react";
import { PublicCaseLinkWordmark } from "@/components/brand/caselink-mark";

const navigation = [
  { href: "/product", label: "Product" },
];

const navLinkClass =
  "whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-[var(--public-ink-strong)] transition-colors hover:bg-[var(--public-accent-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--public-focus)]";

export function PublicSiteShell({
  children,
  authenticated,
}: {
  children: ReactNode;
  /** When true, show the signed-in workspace link. */
  authenticated: boolean;
}) {
  const accountLink = authenticated ?
    { href: "/families", label: "Workspace" }
  : { href: "/login", label: "Sign in" };

  return (
    <div className="public-site flex min-h-full flex-col bg-[var(--public-paper)] text-[var(--public-ink)]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-[var(--public-surface)] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-[var(--public-ink)] focus:[box-shadow:var(--public-shadow-action)] focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-[var(--public-focus)]"
      >
        Skip to main content
      </a>

      <a
        href="https://openai.com/index/introducing-chatgpt-futures-class-of-2026/"
        target="_blank"
        rel="noreferrer"
        aria-label="Selected for OpenAI's inaugural ChatGPT Futures Class of 2026"
        className="flex min-h-10 items-center justify-center gap-1.5 whitespace-nowrap bg-[var(--public-ink)] px-4 py-2 text-center text-xs font-medium text-[var(--public-paper-2)] transition-colors hover:bg-[var(--public-ink-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[var(--public-accent-ink)] sm:text-sm"
      >
        <span className="sm:hidden">OpenAI ChatGPT Futures Class of 2026</span>
        <span className="hidden sm:inline">Selected for OpenAI&apos;s inaugural ChatGPT Futures Class of 2026</span>
        <ArrowUpRight
          className="size-3.5 shrink-0"
          aria-hidden
        />
      </a>

      <header className="sticky top-0 z-40 bg-[var(--public-paper-2)]">
        <div className="mx-auto flex h-[76px] max-w-7xl items-center justify-between gap-4 px-5 sm:px-8 lg:px-10">
          <Link
            href="/"
            aria-label="CaseLink home"
            className="rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--public-focus)]"
          >
            <PublicCaseLinkWordmark />
          </Link>

          <nav className="ml-auto hidden items-center gap-2 lg:flex" aria-label="Primary">
            {navigation.map((item) => (
              <Link key={item.href} href={item.href} className={navLinkClass}>
                {item.label}
              </Link>
            ))}
            <Link href={accountLink.href} className={navLinkClass}>
              {accountLink.label}
            </Link>
            <Link href="/request-demo" className="public-primary-action min-h-11 px-5">
              Request a demo
            </Link>
          </nav>

          <details className="group relative lg:hidden">
            <summary
              className="grid size-11 cursor-pointer place-items-center rounded-lg text-[var(--public-ink)] transition-colors hover:bg-[var(--public-accent-soft)]"
              aria-label="Open navigation menu"
            >
              <Menu className="size-5" aria-hidden />
            </summary>
            <nav
              className="absolute right-0 top-[calc(100%+0.75rem)] z-50 w-[min(18rem,calc(100vw-2.5rem))] rounded-xl bg-[var(--public-surface)] p-3 [box-shadow:var(--public-shadow-menu)] ring-1 ring-[var(--public-rule)]"
              aria-label="Mobile primary"
            >
              <div className="flex flex-col gap-1">
                {navigation.map((item) => (
                  <Link key={item.href} href={item.href} className={`${navLinkClass} min-h-11`}>
                    {item.label}
                  </Link>
                ))}
                <Link href={accountLink.href} className={`${navLinkClass} min-h-11`}>
                  {accountLink.label}
                </Link>
                <Link href="/request-demo" className="public-primary-action mt-2 w-full">
                  Request a demo
                </Link>
              </div>
            </nav>
          </details>
        </div>
      </header>

      <main id="main-content" className="flex-1">
        {children}
      </main>

      <footer className="border-t border-[var(--public-rule)] bg-[var(--public-paper-2)]">
        <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8 lg:px-10 lg:py-14">
          <div className="grid gap-10 lg:grid-cols-[1fr_auto_auto] lg:gap-16">
            <div>
              <PublicCaseLinkWordmark className="scale-90 origin-left" />
              <p className="mt-4 max-w-md text-sm leading-6 text-[var(--public-ink-muted)]">
                Prepare required paperwork without rebuilding the same context.
              </p>
            </div>

            <nav className="grid content-start gap-2 text-sm" aria-label="Footer navigation">
              <p className="mb-1 font-semibold text-[var(--public-ink)]">Explore</p>
              <Link href="/product" className="text-[var(--public-ink-muted)] hover:text-[var(--public-accent)] focus-visible:outline-none focus-visible:underline">
                Product
              </Link>
              <Link href="/request-demo" className="text-[var(--public-ink-muted)] hover:text-[var(--public-accent)] focus-visible:outline-none focus-visible:underline">
                Request a demo
              </Link>
              <Link href={accountLink.href} className="text-[var(--public-ink-muted)] hover:text-[var(--public-accent)] focus-visible:outline-none focus-visible:underline">
                {accountLink.label}
              </Link>
            </nav>

            <nav className="grid content-start gap-2 text-sm" aria-label="Legal">
              <p className="mb-1 font-semibold text-[var(--public-ink)]">Legal</p>
              <Link href="/privacy" className="text-[var(--public-ink-muted)] hover:text-[var(--public-accent)] focus-visible:outline-none focus-visible:underline">
                Privacy Policy
              </Link>
              <Link href="/terms" className="text-[var(--public-ink-muted)] hover:text-[var(--public-accent)] focus-visible:outline-none focus-visible:underline">
                Terms of Service
              </Link>
            </nav>
          </div>

          <p className="mt-10 border-t border-[var(--public-rule-faint)] pt-6 text-xs text-[var(--public-ink-3)]">
            © {new Date().getFullYear()} CaseLink. Built in collaboration with school case managers.
          </p>
        </div>
      </footer>
    </div>
  );
}
