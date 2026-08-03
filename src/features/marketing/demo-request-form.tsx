"use client";

import { ArrowRight } from "lucide-react";

const DEMO_EMAIL = "willsanz@engineering.upenn.edu";

const inputClass = "mt-2 min-h-12 w-full rounded-lg border border-[#cfdccc] bg-white px-3.5 text-base text-[#173a15] outline-none transition-[border-color,box-shadow] placeholder:text-[#778874] focus:border-[#46923c] focus:ring-4 focus:ring-[#46923c]/12";

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
    <form onSubmit={openEmailDraft} className="rounded-2xl bg-white p-6 shadow-[0_24px_60px_rgba(30,70,27,0.12)] sm:p-8">
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="text-sm font-semibold text-[#365134]">
          Your name
          <input name="name" autoComplete="name" required maxLength={100} className={inputClass} placeholder="Jordan Lee" />
        </label>
        <label className="text-sm font-semibold text-[#365134]">
          Work email
          <input name="email" type="email" autoComplete="email" required maxLength={254} className={inputClass} placeholder="jordan@school.org" />
        </label>
        <label className="text-sm font-semibold text-[#365134]">
          School or district
          <input name="organization" autoComplete="organization" required maxLength={160} className={inputClass} placeholder="School or district name" />
        </label>
        <label className="text-sm font-semibold text-[#365134]">
          Your role
          <input name="role" autoComplete="organization-title" required maxLength={120} className={inputClass} placeholder="Director of student services" />
        </label>
      </div>
      <label className="mt-5 block text-sm font-semibold text-[#365134]">
        What paperwork takes the most time? <span className="font-normal text-[#778874]">(optional)</span>
        <textarea name="message" rows={4} maxLength={1500} className={`${inputClass} resize-y py-3`} placeholder="Tell us about the forms or workflow you want to simplify." />
      </label>
      <button type="submit" className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#276221] px-5 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(39,98,33,0.18)] transition-[background-color,transform] hover:-translate-y-0.5 hover:bg-[#1f531b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#46923c]/35 focus-visible:ring-offset-2 active:translate-y-0">
        Open email draft
        <ArrowRight className="size-4" aria-hidden />
      </button>
      <p className="mt-4 text-center text-xs leading-5 text-[#687b65]">
        Your email app will open with these details. You choose whether to send it.
      </p>
    </form>
  );
}
