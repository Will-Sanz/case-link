"use client";

import { useActionState } from "react";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { submitDemoRequest, type DemoRequestState } from "@/app/actions/demo-requests";

const initialState: DemoRequestState = { status: "idle" };

const inputClass = "mt-2 min-h-12 w-full rounded-lg border border-[#cfdccc] bg-white px-3.5 text-base text-[#173a15] outline-none transition-[border-color,box-shadow] placeholder:text-[#778874] focus:border-[#46923c] focus:ring-4 focus:ring-[#46923c]/12";

export function DemoRequestForm() {
  const [state, formAction, pending] = useActionState(submitDemoRequest, initialState);

  if (state.status === "success") {
    return (
      <div className="rounded-2xl bg-white p-7 shadow-[0_24px_60px_rgba(30,70,27,0.12)] sm:p-10" role="status">
        <span className="grid size-12 place-items-center rounded-full bg-[#d8ead5] text-[#276221]"><CheckCircle2 className="size-6" aria-hidden /></span>
        <h2 className="mt-6 text-2xl font-semibold tracking-[-0.025em] text-[#173a15]">Your request is in.</h2>
        <p className="mt-3 max-w-md text-base leading-7 text-[#5d705a]">
          Thank you. We&apos;ll review your school or district&apos;s needs and follow up at the email you provided.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="rounded-2xl bg-white p-6 shadow-[0_24px_60px_rgba(30,70,27,0.12)] sm:p-8" noValidate>
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
      <label className="absolute -left-[10000px] top-auto size-px overflow-hidden" aria-hidden="true">
        Website
        <input name="website" tabIndex={-1} autoComplete="off" />
      </label>
      {state.status === "error" ? (
        <p className="mt-5 rounded-lg bg-[#fef2f2] px-4 py-3 text-sm font-medium text-[#a32929]" role="alert">{state.message}</p>
      ) : null}
      <button type="submit" disabled={pending} className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#276221] px-5 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(39,98,33,0.18)] transition-[background-color,transform] hover:-translate-y-0.5 hover:bg-[#1f531b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#46923c]/35 focus-visible:ring-offset-2 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-65 disabled:hover:translate-y-0">
        {pending ? "Sending request…" : "Request my demo"}
        {!pending ? <ArrowRight className="size-4" aria-hidden /> : null}
      </button>
      <p className="mt-4 text-center text-xs leading-5 text-[#687b65]">
        We&apos;ll only use this information to follow up about CaseLink.
      </p>
    </form>
  );
}
