"use client";

import { useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
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

  if (!open || !activeDoc || typeof document === "undefined") return null;

  const title = activeDoc === "privacy" ? "Privacy Policy" : "Terms of Service";

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/45 backdrop-blur-[1px]"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-[1] flex max-h-[min(92dvh,880px)] w-full max-w-2xl flex-col rounded-t-xl border border-slate-200 bg-white shadow-xl sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
          <h2 id={titleId} className="text-base font-semibold text-slate-900 sm:text-lg">
            {title}
          </h2>
          <Button type="button" variant="secondary" className="shrink-0 text-sm" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5 sm:py-5">
          <p className="mb-6 text-xs text-slate-500 sm:text-sm">Last updated: April 2026</p>
          <div className="space-y-8 text-sm leading-relaxed text-slate-600 sm:space-y-10 sm:text-base">
            {activeDoc === "privacy" ?
              <PrivacyPolicySections />
            : <TermsOfServiceSections
                privacyPolicyLink={
                  <button
                    type="button"
                    className="font-medium text-blue-600 underline-offset-2 hover:underline"
                    onClick={() => onChangeDocument("privacy")}
                  >
                    Privacy Policy
                  </button>
                }
              />
            }
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
