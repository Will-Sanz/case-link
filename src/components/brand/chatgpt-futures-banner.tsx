import { ArrowUpRight } from "iconoir-react";

export function ChatGptFuturesBanner() {
  return (
    <a
      href="https://openai.com/index/introducing-chatgpt-futures-class-of-2026/"
      target="_blank"
      rel="noreferrer"
      aria-label="Selected for OpenAI's inaugural ChatGPT Futures Class of 2026"
      className="flex min-h-9 items-center justify-center gap-1.5 bg-[var(--color-ink)] px-4 py-2 text-center text-xs font-medium text-[var(--color-paper)] hover:bg-[var(--color-ink-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[var(--color-accent-ink)] sm:text-sm"
    >
      <span className="hidden sm:inline">Selected for OpenAI’s inaugural</span>
      <span>ChatGPT Futures Class of 2026</span>
      <ArrowUpRight width={15} height={15} aria-hidden="true" />
    </a>
  );
}
