/** Shared Tailwind classes for native selects (keep in sync with Input focus ring). */
export const selectInputClass =
  "w-full rounded-lg border border-[var(--color-rule-strong)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-ink-strong)] transition-[border-color,box-shadow] duration-[var(--dur-short)] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-focus)] focus:outline-none focus:ring-4 focus:ring-[var(--color-accent-soft)]";

export const textareaClass =
  "w-full min-h-[5rem] rounded-lg border border-[var(--color-rule-strong)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-ink-strong)] transition-[border-color,box-shadow] duration-[var(--dur-short)] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-focus)] focus:outline-none focus:ring-4 focus:ring-[var(--color-accent-soft)]";

/** Inline padding matches Button for visual pairing with form actions. */
export const outlineLinkButtonClass =
  "inline-flex items-center justify-center rounded-lg border border-[var(--color-rule-strong)] bg-[var(--color-surface)] px-4 py-2 text-sm font-semibold text-[var(--color-ink-2)] transition-colors hover:bg-[var(--color-paper-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]/25 focus-visible:ring-offset-2";

export const alertErrorClass =
  "rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800";

export const alertInfoClass =
  "rounded-lg border border-[var(--color-rule)] bg-[var(--color-paper-2)] px-3 py-2.5 text-sm text-[var(--color-ink-2)]";

export const checkboxClass =
  "size-4 rounded border-[var(--color-rule-strong)] text-[var(--color-positive)] focus:ring-[var(--color-focus)]/25 focus:ring-offset-0";
