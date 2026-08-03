import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { IntakeForm } from "@/features/families/intake-form";

export default function NewFamilyPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-7 sm:px-6 lg:py-10">
      <Link href="/families" className="inline-flex items-center gap-2 text-sm font-semibold text-[#50644d] hover:text-[#276221]"><ArrowLeft className="size-4" aria-hidden /> Families</Link>
      <header className="mt-6 border-b border-[#dce6d9] pb-6">
        <h1 className="text-3xl font-semibold tracking-[-0.035em] text-[#173a15] sm:text-4xl">Add a family</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[#5d705a]">Use a non-identifying household label. Add only the context needed to build a useful support plan.</p>
      </header>
      <div className="mt-8"><IntakeForm /></div>
    </div>
  );
}
