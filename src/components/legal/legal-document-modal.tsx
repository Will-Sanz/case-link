"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { LegalDensityProvider } from "@/components/layout/legal-doc-layout";
import {
  PrivacyPolicySections,
  TermsOfServiceSections,
} from "@/features/legal/legal-document-sections";

export type LegalModalDocument = "privacy" | "terms";

type LegalDocumentModalProps = {
  open: boolean;
  document: LegalModalDocument | null;
  onClose: () => void;
  /** When viewing Terms inside the modal, "Privacy Policy" opens the privacy doc instead of navigating. */
  onChangeDocument: (doc: LegalModalDocument) => void;
};

/**
 * Scrollable legal copy for auth screens (no full-page navigation).
 */
export function LegalDocumentModal({
  open,
  document: activeDoc,
  onClose,
  onChangeDocument,
}: LegalDocumentModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      panelRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, [open, activeDoc]);

  if (!open || !activeDoc || typeof document === "undefined") return null;

  const title = activeDoc === "privacy" ? "Privacy Policy" : "Terms of Service";

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-5"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/[0.28] backdrop-blur-[2px] transition-opacity"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative z-[1] flex max-h-[min(90dvh,56rem)] w-full max-w-[min(42rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-t-2xl border border-slate-200/90 bg-white shadow-[0_16px_48px_-12px_rgba(15,23,42,0.18),0_0_0_1px_rgba(15,23,42,0.04)] sm:max-h-[min(88dvh,52rem)] sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200/80 bg-white px-4 py-3.5 sm:px-6 sm:py-4">
          <div className="min-w-0 flex-1 pr-2">
            <h2
              id={titleId}
              className="truncate text-[0.9375rem] font-semibold tracking-[-0.01em] text-slate-900 sm:text-base"
            >
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/35 focus-visible:ring-offset-2"
            aria-label="Close"
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <LegalDensityProvider value="modal">
            <div className="mx-auto w-full max-w-prose px-5 pb-8 pt-5 sm:px-8 sm:pb-10 sm:pt-6">
              <p className="text-[11px] font-medium tabular-nums text-slate-400 sm:text-xs">
                Last updated <span className="text-slate-500">April 2026</span>
              </p>

              <div
                className={[
                  "mt-5 space-y-7 text-slate-600 sm:mt-6 sm:space-y-8",
                  "[&>p]:text-[13px] [&>p]:leading-[1.65] sm:[&>p]:text-[0.8125rem] sm:[&>p]:leading-[1.7]",
                  "[&_a]:!font-medium [&_a]:!text-slate-700 [&_a]:underline [&_a]:decoration-slate-300/80 [&_a]:underline-offset-[3px] [&_a]:transition-colors hover:[&_a]:!text-slate-900 hover:[&_a]:decoration-slate-400",
                  "[&_section_h3]:mt-4 [&_section_h3]:text-[0.8125rem] [&_section_h3]:font-semibold [&_section_h3]:leading-snug [&_section_h3]:tracking-tight [&_section_h3]:text-slate-800 sm:[&_section_h3]:text-sm",
                  "[&_section_h3:first-child]:mt-0",
                ].join(" ")}
              >
                {activeDoc === "privacy" ?
                  <PrivacyPolicySections />
                : <TermsOfServiceSections
                    privacyPolicyLink={
                      <button
                        type="button"
                        className="font-medium text-slate-700 underline decoration-slate-300/80 underline-offset-[3px] transition-colors hover:text-slate-900 hover:decoration-slate-400"
                        onClick={() => onChangeDocument("privacy")}
                      >
                        Privacy Policy
                      </button>
                    }
                  />
                }
              </div>
            </div>
          </LegalDensityProvider>
        </div>
      </div>
    </div>,
    document.body,
  );
}
