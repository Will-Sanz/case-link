"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateFamilyMeta } from "@/app/actions/families";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { selectInputClass, textareaClass } from "@/lib/ui/form-classes";
import type { FamilyDetail } from "@/types/family";

export function UpdateFamilyForm({
  family,
  onCancel,
  onSuccess,
}: {
  family: FamilyDetail;
  onCancel?: () => void;
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [summary, setSummary] = useState(family.summary ?? "");
  const [householdNotes, setHouseholdNotes] = useState(
    family.household_notes ?? "",
  );
  const [urgency, setUrgency] = useState(family.urgency ?? "");
  const [status, setStatus] = useState(family.status);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const r = await updateFamilyMeta({
        familyId: family.id,
        summary: summary.trim() || null,
        householdNotes: householdNotes.trim() || null,
        urgency:
          urgency === ""
            ? null
            : (urgency as "low" | "medium" | "high" | "crisis"),
        status,
      });
      if (!r.ok) {
        setError(r.error);
      } else {
        router.refresh();
        onSuccess?.();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error ? (
        <p
          className="rounded-lg border border-red-200 bg-red-50/90 px-3 py-2.5 text-sm text-red-900"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="fam-status">Status</Label>
          <select
            id="fam-status"
            value={status}
            onChange={(e) =>
              setStatus(e.target.value as FamilyDetail["status"])
            }
            className={`mt-1 ${selectInputClass}`}
          >
            <option value="active">Active</option>
            <option value="on_hold">On hold</option>
            <option value="closed">Closed</option>
          </select>
        </div>
        <div>
          <Label htmlFor="fam-urgency">Urgency</Label>
          <select
            id="fam-urgency"
            value={urgency}
            onChange={(e) => setUrgency(e.target.value)}
            className={`mt-1 ${selectInputClass}`}
          >
            <option value="">Not specified</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="crisis">Crisis</option>
          </select>
        </div>
      </div>
      <div>
        <Label htmlFor="fam-summary">Summary</Label>
        <textarea
          id="fam-summary"
          rows={3}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          className={`mt-1 ${textareaClass}`}
        />
      </div>
      <div>
        <Label htmlFor="fam-circumstances">Current circumstances</Label>
        <textarea
          id="fam-circumstances"
          rows={4}
          value={householdNotes}
          onChange={(e) => setHouseholdNotes(e.target.value)}
          className={`mt-1 ${textareaClass}`}
        />
      </div>
      <div className="flex gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
