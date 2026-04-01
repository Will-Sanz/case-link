import type { ReactNode } from "react";

/** Decorative icons for barrier categories — paired with visible text labels for accessibility. */

function IconWrap({ children }: { children: ReactNode }) {
  return (
    <span
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700"
      aria-hidden
    >
      {children}
    </span>
  );
}

export function IconHousing() {
  return (
    <IconWrap>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5Z" />
      </svg>
    </IconWrap>
  );
}

export function IconEmployment() {
  return (
    <IconWrap>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="14" rx="2" />
        <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
        <path d="M2 13h20" />
      </svg>
    </IconWrap>
  );
}

export function IconFood() {
  return (
    <IconWrap>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 3v9a6 6 0 0 0 12 0V3" />
        <path d="M6 12h12" />
        <path d="M9 21h6" />
      </svg>
    </IconWrap>
  );
}

export function IconTransport() {
  return (
    <IconWrap>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 6v6h11V6a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2Z" />
        <path d="M8 18a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z" />
        <path d="M16 18a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z" />
        <path d="M19 12v3" />
        <path d="M8 12H4v4" />
      </svg>
    </IconWrap>
  );
}

export function IconChildcare() {
  return (
    <IconWrap>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="7" r="3" />
        <path d="M5 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2" />
        <circle cx="19" cy="9" r="2" />
      </svg>
    </IconWrap>
  );
}

export function IconMentalHealth() {
  return (
    <IconWrap>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5c0-1.1-.25-2.12-.7-3.02" />
      </svg>
    </IconWrap>
  );
}
