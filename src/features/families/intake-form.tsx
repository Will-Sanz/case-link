"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { createFamilyIntake } from "@/app/actions/families";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PRESET_BARRIERS,
  PRESET_GOALS,
} from "@/lib/constants/intake-options";
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

  const goalsFA = useFieldArray({ control: form.control, name: "goals" });
  const barriersFA = useFieldArray({ control: form.control, name: "barriers" });
  const membersFA = useFieldArray({ control: form.control, name: "members" });

  const [customGoal, setCustomGoal] = useState("");
  const [customBarrier, setCustomBarrier] = useState("");

  function goalIndexByPreset(key: string) {
    return goalsFA.fields.findIndex(
      (f) => (f as { presetKey?: string }).presetKey === key,
    );
  }

  function barrierIndexByPreset(key: string) {
    return barriersFA.fields.findIndex(
      (f) => (f as { presetKey?: string }).presetKey === key,
    );
  }

  function toggleGoalPreset(value: string, label: string) {
    const i = goalIndexByPreset(value);
    if (i >= 0) goalsFA.remove(i);
    else goalsFA.append({ presetKey: value, label });
  }

  function toggleBarrierPreset(value: string, label: string) {
    const i = barrierIndexByPreset(value);
    if (i >= 0) barriersFA.remove(i);
    else barriersFA.append({ presetKey: value, label });
  }

  function addCustomGoal() {
    const t = customGoal.trim();
    if (!t) return;
    goalsFA.append({ presetKey: null, label: t });
    setCustomGoal("");
  }

  function addCustomBarrier() {
    const t = customBarrier.trim();
    if (!t) return;
    barriersFA.append({ presetKey: null, label: t });
    setCustomBarrier("");
  }

  async function onSubmit(data: FamilyIntakeFormValues) {
    setServerError(null);
    const result = await createFamilyIntake(data);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    if (result.familyId) {
      router.push(`/families/${result.familyId}`);
    } else {
      router.push("/families");
    }
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
      {serverError ? (
        <p
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800"
          role="alert"
        >
          {serverError}
        </p>
      ) : null}

      <Card>
        <CardTitle className="text-base">Household</CardTitle>
        <div className="mt-4 space-y-4">
          <div>
            <Label htmlFor="name">Household name or label</Label>
            <Input
              id="name"
              className="mt-1"
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
            <textarea
              id="summary"
              rows={3}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
              {...form.register("summary")}
            />
          </div>
          <div>
            <Label htmlFor="urgency">Urgency</Label>
            <select
              id="urgency"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
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
            <textarea
              id="householdNotes"
              rows={4}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
              {...form.register("householdNotes")}
            />
          </div>
          <div>
            <Label htmlFor="initialCaseNote">Intake notes (optional)</Label>
            <textarea
              id="initialCaseNote"
              rows={3}
              placeholder="First dated note for the file…"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
              {...form.register("initialCaseNote")}
            />
          </div>
        </div>
      </Card>

      <Card>
        <CardTitle className="text-base">Goals</CardTitle>
        <p className="mt-1 text-sm text-slate-600">
          Select one or more, or add your own.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {PRESET_GOALS.map((g) => {
            const on = goalIndexByPreset(g.value) >= 0;
            return (
              <button
                key={g.value}
                type="button"
                onClick={() => toggleGoalPreset(g.value, g.label)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                  on
                    ? "border-slate-800 bg-slate-800 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {g.label}
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder="Custom goal"
            value={customGoal}
            onChange={(e) => setCustomGoal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustomGoal();
              }
            }}
          />
          <Button type="button" variant="secondary" onClick={addCustomGoal}>
            Add custom
          </Button>
        </div>
        {goalsFA.fields.length > 0 ? (
          <ul className="mt-3 list-inside list-disc text-sm text-slate-700">
            {goalsFA.fields.map((field, index) => (
              <li key={field.id} className="flex items-center justify-between gap-2">
                <span>{form.watch(`goals.${index}.label`)}</span>
                <Button
                  type="button"
                  variant="ghost"
                  className="text-red-600"
                  onClick={() => goalsFA.remove(index)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        {form.formState.errors.goals ? (
          <p className="mt-2 text-sm text-red-600">
            {form.formState.errors.goals.message}
          </p>
        ) : null}
      </Card>

      <Card>
        <CardTitle className="text-base">Barriers</CardTitle>
        <p className="mt-1 text-sm text-slate-600">
          Select one or more, or add your own.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {PRESET_BARRIERS.map((b) => {
            const on = barrierIndexByPreset(b.value) >= 0;
            return (
              <button
                key={b.value}
                type="button"
                onClick={() => toggleBarrierPreset(b.value, b.label)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                  on
                    ? "border-slate-800 bg-slate-800 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {b.label}
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder="Custom barrier"
            value={customBarrier}
            onChange={(e) => setCustomBarrier(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustomBarrier();
              }
            }}
          />
          <Button type="button" variant="secondary" onClick={addCustomBarrier}>
            Add custom
          </Button>
        </div>
        {barriersFA.fields.length > 0 ? (
          <ul className="mt-3 list-inside list-disc text-sm text-slate-700">
            {barriersFA.fields.map((field, index) => (
              <li key={field.id} className="flex items-center justify-between gap-2">
                <span>{form.watch(`barriers.${index}.label`)}</span>
                <Button
                  type="button"
                  variant="ghost"
                  className="text-red-600"
                  onClick={() => barriersFA.remove(index)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        {form.formState.errors.barriers ? (
          <p className="mt-2 text-sm text-red-600">
            {form.formState.errors.barriers.message}
          </p>
        ) : null}
      </Card>

      <Card>
        <CardTitle className="text-base">Household members (optional)</CardTitle>
        {membersFA.fields.map((field, index) => (
          <div
            key={field.id}
            className="mt-4 space-y-3 border-t border-slate-100 pt-4 first:mt-0 first:border-0 first:pt-0"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">
                Member {index + 1}
              </span>
              <Button
                type="button"
                variant="ghost"
                className="text-red-600"
                onClick={() => membersFA.remove(index)}
              >
                Remove
              </Button>
            </div>
            <div>
              <Label>Name</Label>
              <Input
                className="mt-1"
                {...form.register(`members.${index}.displayName`)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Relationship</Label>
                <Input
                  className="mt-1"
                  {...form.register(`members.${index}.relationship`)}
                />
              </div>
              <div>
                <Label>Age (approx.)</Label>
                <Input
                  className="mt-1"
                  type="text"
                  inputMode="numeric"
                  {...form.register(`members.${index}.ageApprox`)}
                />
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <textarea
                rows={2}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                {...form.register(`members.${index}.notes`)}
              />
            </div>
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          className="mt-4"
          onClick={() =>
            membersFA.append({
              displayName: "",
              relationship: "",
              notes: "",
              ageApprox: "",
            })
          }
        >
          Add household member
        </Button>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Saving…" : "Create family profile"}
        </Button>
        <Link href="/families">
          <Button type="button" variant="secondary">
            Cancel
          </Button>
        </Link>
      </div>
    </form>
  );
}
