"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { createFamilyIntake } from "@/app/actions/families";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { alertErrorClass, selectInputClass } from "@/lib/ui/form-classes";
import {
  familyIntakeFormSchema,
  type FamilyIntakeFormValues,
} from "@/lib/validations/family-intake";

export function IntakeForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<FamilyIntakeFormValues>({
    resolver: zodResolver(familyIntakeFormSchema),
    defaultValues: {
      name: "",
      summary: "",
      urgency: "",
      householdNotes: "",
      initialCaseNote: "",
      goals: [],
      barriers: [],
      members: [],
    },
  });

  async function onSubmit(data: FamilyIntakeFormValues) {
    setServerError(null);
    const result = await createFamilyIntake(data);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    if (result.familyId) {
      router.push(`/families/${result.familyId}/overview`);
    } else {
      router.push("/families");
    }
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
      {serverError ? (
        <p className={alertErrorClass} role="alert">
          {serverError}
        </p>
      ) : null}

      <Card className="border-[#dce6d9] bg-white p-6 shadow-[0_10px_30px_rgba(30,70,27,0.06)] sm:p-7">
        <CardTitle>Family profile</CardTitle>
        <p className="mt-1 text-sm text-[#5d705a]">
          Use a non-identifying household label and only the context needed for planning. Do not include names, addresses, birth dates, student IDs, or contact information.
        </p>
        <div className="mt-5 space-y-5">
          <div>
            <Label htmlFor="name">Household label</Label>
            <Input
              id="name"
              className="mt-1"
              placeholder="For example: Family 014"
              {...form.register("name")}
            />
            {form.formState.errors.name ? (
              <p className="mt-1 text-sm text-red-600">
                {form.formState.errors.name.message}
              </p>
            ) : null}
          </div>
          <div>
            <Label htmlFor="summary">Summary</Label>
            <Textarea
              id="summary"
              rows={3}
              className="mt-1.5"
              placeholder="Brief, de-identified reason for support"
              {...form.register("summary")}
            />
          </div>
          <div>
            <Label htmlFor="urgency">Urgency</Label>
            <select
              id="urgency"
              className={`mt-1.5 ${selectInputClass}`}
              {...form.register("urgency")}
            >
              <option value="">Not specified</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="crisis">Crisis</option>
            </select>
          </div>
          <div>
            <Label htmlFor="householdNotes">Current circumstances</Label>
            <Textarea
              id="householdNotes"
              rows={4}
              className="mt-1.5"
              placeholder="Only include details needed to shape the intervention plan"
              {...form.register("householdNotes")}
            />
          </div>
          <div>
            <Label htmlFor="initialCaseNote">Intake notes (optional)</Label>
            <Textarea
              id="initialCaseNote"
              rows={3}
              placeholder="Optional de-identified planning note"
              className="mt-1.5"
              {...form.register("initialCaseNote")}
            />
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3 border-t border-[#dce6d9] pt-8">
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Saving…" : "Create family profile"}
        </Button>
        <Link href="/families">
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </Link>
      </div>
    </form>
  );
}
