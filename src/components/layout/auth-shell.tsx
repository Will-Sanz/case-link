import type { ReactNode } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";

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
    <div className="flex min-h-full flex-col items-center justify-center bg-[#f4f6f8] px-4 py-16">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/90 text-sm font-semibold text-white">
            CL
          </div>
          <h1 className="text-lg font-semibold text-slate-900">
            {title}
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
            {subtitle}
          </p>
        </div>
        <Card className="p-6">
          {children}
        </Card>
        {showLegalLinks ? (
          <p className="mt-5 text-center text-xs text-slate-500">
            <Link
              href="/privacy"
              className="font-medium text-slate-600 underline-offset-2 hover:text-slate-800 hover:underline"
            >
              Privacy Policy
            </Link>
            <span className="mx-1.5 text-slate-300" aria-hidden>
              ·
            </span>
            <Link
              href="/terms"
              className="font-medium text-slate-600 underline-offset-2 hover:text-slate-800 hover:underline"
            >
              Terms of Service
            </Link>
          </p>
        ) : null}
        {footer ? (
          <div className="mt-6 text-center text-sm text-slate-600">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}
