"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type KeyboardEvent } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Check, X } from "lucide-react";
import { createFamilyIntake } from "@/app/actions/families";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PRESET_BARRIERS } from "@/lib/constants/intake-options";
import { validateNoPii } from "@/lib/privacy/no-pii";
import { alertErrorClass } from "@/lib/ui/form-classes";
import { cn } from "@/lib/utils/cn";
import {
  familyIntakeFormSchema,
  type FamilyIntakeFormValues,
} from "@/lib/validations/family-intake";

export function IntakeForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [customBarrier, setCustomBarrier] = useState("");
  const [customBarrierError, setCustomBarrierError] = useState<string | null>(null);

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

  const barriers = useWatch({ control: form.control, name: "barriers" });
  const selectedPresetKeys = new Set(
    barriers.flatMap((barrier) =>
      barrier.presetKey ? [barrier.presetKey] : [],
    ),
  );
  const customBarriers = barriers.filter((barrier) => !barrier.presetKey);

  function updateBarriers(next: FamilyIntakeFormValues["barriers"]) {
    form.setValue("barriers", next, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
  }

  function togglePreset(value: string, label: string) {
    if (selectedPresetKeys.has(value)) {
      updateBarriers(barriers.filter((barrier) => barrier.presetKey !== value));
      return;
    }

    updateBarriers([...barriers, { presetKey: value, label }]);
  }

  function addCustomBarrier() {
    const label = customBarrier.trim();
    if (!label) return;
    const privacy = validateNoPii([
      { field: "customBarrier", label: "Barrier", value: label },
    ]);
    if (!privacy.ok) {
      setCustomBarrierError(privacy.error);
      return;
    }

    const alreadyAdded = barriers.some(
      (barrier) => barrier.label.trim().toLocaleLowerCase() === label.toLocaleLowerCase(),
    );
    if (!alreadyAdded) {
      updateBarriers([...barriers, { presetKey: null, label }]);
    }
    setCustomBarrier("");
    setCustomBarrierError(null);
  }

  function onCustomBarrierKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addCustomBarrier();
  }

  async function onSubmit(data: FamilyIntakeFormValues) {
    setServerError(null);
    form.clearErrors(["name", "summary"]);
    const privacy = validateNoPii([
      { field: "name", label: "Family label", value: data.name, mode: "label" },
      { field: "summary", label: "Short description", value: data.summary },
      ...data.barriers.map((barrier, index) => ({
        field: `barriers.${index}.label`,
        label: "Barrier",
        value: barrier.label,
      })),
    ]);
    if (!privacy.ok) {
      for (const finding of privacy.findings) {
        const message = `Remove likely identifying text: “${finding.value}”.`;
        if (finding.field === "name") form.setError("name", { message });
        if (finding.field === "summary") form.setError("summary", { message });
      }
      setServerError(privacy.error);
      return;
    }
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
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
      {serverError ? (
        <p className={alertErrorClass} role="alert">
          {serverError}
        </p>
      ) : null}

      <Card className="border-[var(--color-rule)] bg-[var(--color-surface)] p-6 [box-shadow:var(--shadow-surface)] sm:p-8">
        <CardTitle className="text-xl tracking-[-0.02em] text-[var(--color-ink)]">
          Start with what you know
        </CardTitle>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-ink-muted)]">
          A label and at least one barrier are enough. You can add details or adjust the plan later.
        </p>
        <div className="mt-7 space-y-8">
          <div>
            <Label htmlFor="name">Family label</Label>
            <Input
              id="name"
              className="mt-2 min-h-12 border-[var(--color-rule-strong)] bg-[var(--color-surface)] text-base placeholder:text-[var(--color-ink-faint)] focus-visible:border-[var(--color-focus)] focus-visible:ring-[var(--color-focus)]/15"
              placeholder="For example: Family 014"
              aria-describedby={form.formState.errors.name ? "name-error" : "family-label-help"}
              autoFocus
              {...form.register("name")}
            />
            <p id="family-label-help" className="mt-2 text-xs leading-5 text-[var(--color-ink-faint)]">
              Use a non-identifying label your team will recognize.
            </p>
            {form.formState.errors.name ? (
              <p id="name-error" className="mt-2 text-sm text-red-700" role="alert">
                {form.formState.errors.name.message}
              </p>
            ) : null}
          </div>

          <fieldset>
            <legend className="text-sm font-medium text-[var(--color-ink-strong)]">Barriers</legend>
            <p className="mt-1 text-sm leading-6 text-[var(--color-ink-muted)]">
              Choose everything the family needs support with.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {PRESET_BARRIERS.map((barrier) => {
                const selected = selectedPresetKeys.has(barrier.value);
                return (
                  <button
                    key={barrier.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => togglePreset(barrier.value, barrier.label)}
                    className={cn(
                      "flex min-h-12 items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-medium transition-[border-color,background-color,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]/35 focus-visible:ring-offset-2",
                      selected
                        ? "border-[var(--color-focus)] bg-[var(--color-accent-soft)] text-[var(--color-ink)]"
                        : "border-[var(--color-rule-strong)] bg-[var(--color-surface)] text-[var(--color-ink-muted)] hover:border-[var(--color-accent-rule)] hover:bg-[var(--color-paper)]",
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-5 shrink-0 place-items-center rounded-md border-2",
                        selected
                          ? "border-[var(--color-positive)] bg-[var(--color-positive)] text-[var(--color-accent-ink)]"
                          : "border-[var(--color-rule-strong)] bg-[var(--color-surface)] text-transparent",
                      )}
                      aria-hidden
                    >
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                    <span>{barrier.label}</span>
                  </button>
                );
              })}
            </div>

            {customBarriers.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2" aria-label="Added barriers">
                {customBarriers.map((barrier) => (
                  <span
                    key={barrier.label}
                    className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-[var(--color-accent-soft)] px-3 text-sm font-medium text-[var(--color-ink-2)]"
                  >
                    {barrier.label}
                    <button
                      type="button"
                      onClick={() => updateBarriers(barriers.filter((item) => item !== barrier))}
                      className="grid size-6 place-items-center rounded-md text-[var(--color-ink-muted)] hover:bg-[var(--color-paper-3)] hover:text-[var(--color-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]/35"
                      aria-label={`Remove ${barrier.label}`}
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Input
                value={customBarrier}
                onChange={(event) => {
                  setCustomBarrier(event.target.value);
                  setCustomBarrierError(null);
                }}
                onKeyDown={onCustomBarrierKeyDown}
                className="min-h-11 flex-1 border-[var(--color-rule-strong)] bg-[var(--color-surface)] placeholder:text-[var(--color-ink-faint)] focus-visible:border-[var(--color-focus)] focus-visible:ring-[var(--color-focus)]/15"
                placeholder="Add another barrier"
                maxLength={200}
                aria-label="Another barrier"
                aria-describedby={customBarrierError ? "custom-barrier-error" : undefined}
              />
              <Button
                type="button"
                variant="secondary"
                className="min-h-11 px-5"
                onClick={addCustomBarrier}
                disabled={!customBarrier.trim()}
              >
                Add barrier
              </Button>
            </div>
            {customBarrierError ? (
              <p id="custom-barrier-error" className="mt-2 text-sm text-red-700" role="alert">
                {customBarrierError}
              </p>
            ) : null}
            {form.formState.errors.barriers ? (
              <p className="mt-3 text-sm text-red-700" role="alert">
                {form.formState.errors.barriers.message}
              </p>
            ) : null}
          </fieldset>

          <div>
            <Label htmlFor="summary">Short description (optional)</Label>
            <Textarea
              id="summary"
              rows={4}
              className="mt-2 resize-y border-[var(--color-rule-strong)] bg-[var(--color-surface)] text-sm leading-6 placeholder:text-[var(--color-ink-faint)] focus-visible:border-[var(--color-focus)] focus-visible:ring-[var(--color-focus)]/15"
              placeholder="Add only the context needed to shape the first plan."
              aria-describedby={
                form.formState.errors.summary
                  ? "description-help description-error"
                  : "description-help"
              }
              aria-invalid={Boolean(form.formState.errors.summary)}
              {...form.register("summary")}
            />
            <p id="description-help" className="mt-2 text-xs leading-5 text-[var(--color-ink-faint)]">
              Do not enter names, addresses, birth dates, student IDs, contact details, or signatures.
            </p>
            {form.formState.errors.summary ? (
              <p id="description-error" className="mt-2 text-sm text-red-700" role="alert">
                {form.formState.errors.summary.message}
              </p>
            ) : null}
          </div>
        </div>
      </Card>

      <div className="flex flex-col-reverse gap-3 border-t border-[var(--color-rule)] pt-6 sm:flex-row sm:items-center">
        <Link href="/families" className="sm:mr-auto">
          <Button type="button" variant="outline" className="w-full sm:w-auto">
            Cancel
          </Button>
        </Link>
        <Button type="submit" className="min-h-12 px-6" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Creating family…" : "Create family and continue"}
        </Button>
      </div>
    </form>
  );
}
