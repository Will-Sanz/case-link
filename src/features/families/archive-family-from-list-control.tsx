"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { archiveFamilyFromWorkspace } from "@/app/actions/families";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function ArchiveFamilyFromListControl({ familyId }: { familyId: string }) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const r = await archiveFamilyFromWorkspace({ familyId });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setDialogOpen(false);
      router.push("/families");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5 text-right">
      <Button
        type="button"
        variant="ghost"
        className="h-auto py-1.5 text-xs font-normal text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        disabled={pending}
        onClick={() => {
          setError(null);
          setDialogOpen(true);
        }}
      >
        Remove family from my list
      </Button>

      <ConfirmDialog
        open={dialogOpen}
        onClose={() => {
          if (!pending) setDialogOpen(false);
        }}
        onConfirm={handleConfirm}
        title="Remove family from your list?"
        description="Nothing is deleted from the database—they will simply disappear from your Families list, dashboard, and calendar."
        cancelLabel="Cancel"
        confirmLabel={pending ? "Removing…" : "Remove from list"}
        pending={pending}
        danger
        error={error}
      />
    </div>
  );
}
