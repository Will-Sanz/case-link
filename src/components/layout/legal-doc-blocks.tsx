"use client";

import { createContext, useContext, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

type LegalDensity = "page" | "modal";

const LegalDensityContext = createContext<LegalDensity>("page");

export function LegalDensityProvider({
  value,
  children,
}: {
  value: LegalDensity;
  children: ReactNode;
}) {
  return <LegalDensityContext.Provider value={value}>{children}</LegalDensityContext.Provider>;
}

function useLegalDensity(): LegalDensity {
  return useContext(LegalDensityContext);
}

export function LegalSection({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: ReactNode;
}) {
  const modal = useLegalDensity() === "modal";

  return (
    <section
      aria-labelledby={`legal-section-${n}`}
      className={cn(
        "scroll-mt-8",
        modal &&
          "border-t border-slate-100/90 pt-7 first-of-type:border-t-0 first-of-type:pt-0",
      )}
    >
      <h2
        id={`legal-section-${n}`}
        className={cn(
          modal ?
            "flex gap-2.5 text-[0.9375rem] font-semibold leading-snug tracking-tight text-slate-900 sm:text-base"
          : "text-xl font-semibold text-slate-900 sm:text-2xl",
        )}
      >
        {modal ?
          <>
            <span className="w-6 shrink-0 tabular-nums font-medium text-slate-400 sm:w-7">{n}.</span>
            <span className="min-w-0">{title}</span>
          </>
        : <>
            {n}. {title}
          </>
        }
      </h2>
      <div
        className={cn(
          modal ?
            "mt-3.5 space-y-3.5 text-[13px] leading-[1.65] text-slate-600 sm:text-[0.8125rem] sm:leading-[1.7]"
          : "mt-4 space-y-4",
        )}
      >
        {children}
      </div>
    </section>
  );
}

export function LegalList({ items }: { items: string[] }) {
  const modal = useLegalDensity() === "modal";

  return (
    <ul
      className={cn(
        "text-slate-600",
        modal ?
          "list-outside list-disc space-y-2 pl-[1.2em] marker:text-slate-400/90 sm:pl-[1.25em]"
        : "list-disc space-y-2 pl-5 sm:pl-6",
      )}
    >
      {items.map((item, i) => (
        <li key={i} className={cn(modal && "leading-[1.65] sm:leading-[1.7]")}>
          {item}
        </li>
      ))}
    </ul>
  );
}
