import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Download, Page as FileText } from "iconoir-react";

export function PaperworkWorkspace({
  familyId,
  familyName,
  hasReviewedPlan,
  planDownload,
}: {
  familyId: string;
  familyName: string;
  hasReviewedPlan: boolean;
  planDownload?: ReactNode;
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
          downloading it as a PDF.
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
    <div className="space-y-6">
      <header className="border-b border-[var(--color-rule)] pb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
          PDF export
        </p>
        <h1 className="workspace-display mt-2 text-2xl text-[var(--color-ink)]">
          {familyName}
        </h1>
      </header>

      <section
        className="grid gap-6 rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] px-5 py-7 [box-shadow:var(--shadow-surface)] sm:px-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
        aria-labelledby="download-plan-heading"
      >
        <div className="flex gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
            <Download className="size-5" aria-hidden />
          </span>
          <div>
            <h2 id="download-plan-heading" className="text-lg font-semibold text-[var(--color-ink)]">
              Download the reviewed plan
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-ink-muted)]">
              Create a professional black-and-white PDF containing the reviewed goals,
              actions, owners, and target dates. CaseLink does not submit the file to another
              system.
            </p>
          </div>
        </div>
        <div className="w-full sm:w-auto lg:justify-self-end">{planDownload}</div>
      </section>
    </div>
  );
}
