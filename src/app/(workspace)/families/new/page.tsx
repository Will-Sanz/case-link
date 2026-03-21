import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { IntakeForm } from "@/features/families/intake-form";

export default function NewFamilyPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/families"
          className="text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          ← Families
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          New family intake
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Capture goals, barriers, and household context for matching and
          planning.
        </p>
      </div>
      <Card className="border-none bg-transparent p-0 shadow-none">
        <CardTitle className="sr-only">Intake form</CardTitle>
        <IntakeForm />
      </Card>
    </div>
  );
}
