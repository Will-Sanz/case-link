import Link from "next/link";
import { IntakeForm } from "@/features/families/intake-form";

export default function NewFamilyPage() {
  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/families"
          className="text-sm font-medium text-teal-800 underline-offset-2 hover:text-teal-900 hover:underline"
        >
          ← Back to families
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          New family intake
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
          Capture goals, barriers, and household context. This information powers
          resource matching and the 30/60/90 plan.
        </p>
      </div>
      <div className="rounded-2xl border border-slate-200/80 bg-white p-1 shadow-sm sm:p-2">
        <div className="rounded-xl px-2 py-6 sm:px-6 sm:py-8">
          <IntakeForm />
        </div>
      </div>
    </div>
  );
}
