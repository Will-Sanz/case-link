import type { ReactNode } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { PublicCaseLinkMark } from "@/components/brand/caselink-mark";
import styles from "./auth-shell.module.css";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  showLegalLinks = true,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Privacy / Terms links below the card (auth flows). */
  showLegalLinks?: boolean;
}) {
  return (
    <div className={`${styles.shell} public-auth flex min-h-svh flex-col items-center justify-center px-4 py-16`}>
      <div className={`${styles.content} w-full max-w-[400px]`}>
        <div className="mb-6 text-center">
          <PublicCaseLinkMark className="mx-auto mb-4 size-11" />
          <h1>
            {title}
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-[var(--public-ink-muted)]">
            {subtitle}
          </p>
        </div>
        <Card className={`${styles.card} p-6`}>
          {children}
        </Card>
        {showLegalLinks ? (
          <p className="mt-5 text-center text-xs text-[var(--public-ink-3)]">
            <Link
              href="/privacy"
              className="font-medium underline-offset-2 hover:underline"
            >
              Privacy Policy
            </Link>
            <span className="mx-1.5 text-[var(--public-rule-divider)]" aria-hidden>
              ·
            </span>
            <Link
              href="/terms"
              className="font-medium underline-offset-2 hover:underline"
            >
              Terms of Service
            </Link>
          </p>
        ) : null}
        {footer ? (
          <div className="mt-6 text-center text-sm text-[var(--public-ink-muted)]">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}
