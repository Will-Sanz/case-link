import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Page as FileText } from "iconoir-react";

export function PaperworkWorkspace({
  familyId,
  familyName,
  hasReviewedPlan,
  planReview,
}: {
  familyId: string;
  familyName: string;
  hasReviewedPlan: boolean;
  planReview?: ReactNode;
}) {
  if (!hasReviewedPlan) {
    return (
      <section className="rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] p-7 text-center [box-shadow:var(--shadow-surface)]">
        <span className="mx-auto grid size-12 place-items-center rounded-xl bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
          <FileText className="size-5" aria-hidden />
        </span>
        <h1 className="mt-5 text-xl font-semibold text-[var(--color-ink)]">
          Review the intervention plan first
        </h1>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[var(--color-ink-muted)]">
          Check each goal, action, and target date, then mark the plan reviewed before
          opening its PDF.
        </p>
        <Link
          href={`/families/${familyId}/plan`}
          className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 text-sm font-semibold text-[var(--color-accent-ink)] hover:bg-[var(--color-accent-hover)]"
        >
          Review plan <ArrowRight className="size-4" aria-hidden />
        </Link>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <header className="border-b border-[var(--color-rule)] pb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
          {familyName}
        </p>
        <h1 className="workspace-display mt-2 text-2xl text-[var(--color-ink)]">
          Review PDF
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-ink-muted)]">
          CaseLink generates this document automatically from the reviewed plan. Check the PDF below, then download it when ready.
        </p>
      </header>
      {planReview}
    </div>
  );
}
