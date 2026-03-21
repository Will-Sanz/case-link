"use client";

import { useState } from "react";
import { addCaseNote } from "@/app/actions/families";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function AddCaseNoteForm({ familyId }: { familyId: string }) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const r = await addCaseNote({ familyId, body });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setBody("");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      {error ? (
        <p
          className="rounded-lg border border-red-200 bg-red-50/90 px-3 py-2.5 text-sm text-red-900"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      <Label htmlFor={`note-${familyId}`}>Add note</Label>
      <Textarea
        id={`note-${familyId}`}
        rows={3}
        required
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className="mt-1.5"
        placeholder="Dated entry for the case file…"
      />
      <Button type="submit" disabled={pending} variant="secondary">
        {pending ? "Saving…" : "Save note"}
      </Button>
    </form>
  );
}
