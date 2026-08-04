"use client";

import { ArrowRight } from "iconoir-react";

const DEMO_EMAIL = "willsanz@engineering.upenn.edu";

const inputClass =
  "mt-2 min-h-12 w-full rounded-[10px] border border-[var(--public-rule-strong)] bg-[var(--public-surface)] px-3.5 text-base text-[var(--public-ink)] outline-2 outline-offset-1 outline-transparent transition-[border-color] placeholder:text-[var(--public-placeholder)] focus:border-[var(--public-focus)] focus:outline-[var(--public-focus)]";

export function DemoRequestForm() {
  function openEmailDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (field: string) => String(data.get(field) ?? "").trim();
    const organization = value("organization");
    const subject = `CaseLink demo request — ${organization}`;
    const body = [
      "Hello,",
      "",
      "I'd like to request a CaseLink demo.",
      "",
      `Name: ${value("name")}`,
      `Work email: ${value("email")}`,
      `School or district: ${organization}`,
      `Role: ${value("role")}`,
      "",
      "Paperwork context:",
      value("message") || "No additional details provided.",
    ].join("\n");

    window.location.href = `mailto:${DEMO_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  return (
    <form onSubmit={openEmailDraft} className="rounded-2xl bg-[var(--public-surface)] p-6 [box-shadow:var(--public-shadow-decision)] sm:p-8">
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="text-sm font-semibold text-[var(--public-ink-strong)]">
          Your name
          <input name="name" autoComplete="name" required maxLength={100} className={inputClass} placeholder="Jordan Lee" />
        </label>
        <label className="text-sm font-semibold text-[var(--public-ink-strong)]">
          Work email
          <input name="email" type="email" autoComplete="email" required maxLength={254} className={inputClass} placeholder="jordan@school.org" />
        </label>
        <label className="text-sm font-semibold text-[var(--public-ink-strong)]">
          School or district
          <input name="organization" autoComplete="organization" required maxLength={160} className={inputClass} placeholder="School or district name" />
        </label>
        <label className="text-sm font-semibold text-[var(--public-ink-strong)]">
          Your role
          <input name="role" autoComplete="organization-title" required maxLength={120} className={inputClass} placeholder="Director of student services" />
        </label>
      </div>
      <label className="mt-5 block text-sm font-semibold text-[var(--public-ink-strong)]">
        What paperwork takes the most time? <span className="font-normal text-[var(--public-placeholder)]">(optional)</span>
        <textarea name="message" rows={4} maxLength={1500} className={`${inputClass} resize-y py-3`} placeholder="Tell us about the forms or workflow you want to simplify." />
      </label>
      <button type="submit" className="public-primary-action mt-6 w-full">
        Open email draft
        <ArrowRight className="size-4" aria-hidden />
      </button>
      <p className="mt-4 text-center text-xs leading-5 text-[var(--public-ink-3)]">
        Your email app will open with these details. You choose whether to send it.
      </p>
    </form>
  );
}
