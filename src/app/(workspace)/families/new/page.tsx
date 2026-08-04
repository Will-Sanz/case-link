import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { IntakeForm } from "@/features/families/intake-form";

export default function NewFamilyPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-7 sm:px-6 lg:py-10">
      <Link href="/families" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"><ArrowLeft className="size-4" aria-hidden /> Families</Link>
      <header className="mt-6 border-b border-[var(--color-rule)] pb-6">
        <h1 className="workspace-display text-3xl text-[var(--color-ink)] sm:text-4xl">Add a family</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--color-ink-muted)]">Use a non-identifying household label. Add only the context needed to build a useful support plan.</p>
      </header>
      <div className="mt-8"><IntakeForm /></div>
    </div>
  );
}
