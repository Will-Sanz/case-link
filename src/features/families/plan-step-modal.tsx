"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { createPortal } from "react-dom";
import { deletePlanStep, updatePlanStep } from "@/app/actions/plans";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { textareaClass } from "@/lib/ui/form-classes";
import { cn } from "@/lib/utils/cn";
import type { PlanStepRow, PlanWithSteps } from "@/types/family";

const PHASE_LABELS: Record<string, string> = {
  "30": "30-day",
  "60": "60-day",
  "90": "90-day",
};

function ModalStatusSelect({
  status,
  onChange,
  disabled,
}: {
  status: PlanStepRow["status"];
  onChange: (s: PlanStepRow["status"]) => void;
  disabled?: boolean;
}) {
  const cls =
    status === "completed"
      ? "bg-emerald-100 text-emerald-900"
      : status === "in_progress"
        ? "bg-amber-100 text-amber-900"
        : status === "blocked"
          ? "bg-red-100 text-red-900"
          : "bg-slate-100 text-slate-700";
  return (
    <select
      value={status}
      onChange={(e) =>
        onChange(e.target.value as PlanStepRow["status"])
      }
      disabled={disabled}
      className={cn(
        "w-full max-w-[220px] rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium",
        cls,
        "focus:outline-none focus:ring-2 focus:ring-teal-600/25",
      )}
    >
      <option value="pending">Pending</option>
      <option value="in_progress">In progress</option>
      <option value="completed">Completed</option>
      <option value="blocked">Blocked</option>
    </select>
  );
}

function useIsClient(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

type PlanStepModalInnerProps = {
  step: PlanStepRow;
  plan: PlanWithSteps;
  familyId: string;
  onClose: () => void;
};

function PlanStepModalInner({
  step,
  plan,
  familyId,
  onClose,
}: PlanStepModalInnerProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(step.title);
  const [description, setDescription] = useState(step.description);
  const [status, setStatus] = useState<PlanStepRow["status"]>(step.status);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const handleStatusChange = useCallback(
    (next: PlanStepRow["status"]) => {
      setStatus(next);
      setError(null);
      startTransition(async () => {
        const r = await updatePlanStep({
          stepId: step.id,
          familyId,
          status: next,
        });
        if (!r.ok) {
          setError(r.error);
          setStatus(step.status);
        } else {
          router.refresh();
        }
      });
    },
    [step.id, step.status, familyId, router],
  );

  const saveEdit = useCallback(() => {
    setError(null);
    startTransition(async () => {
      const r = await updatePlanStep({
        stepId: step.id,
        familyId,
        title: title.trim(),
        description: description.trim(),
      });
      if (!r.ok) {
        setError(r.error);
      } else {
        setEditing(false);
        router.refresh();
      }
    });
  }, [step.id, familyId, title, description, router]);

  const handleDelete = useCallback(() => {
    if (!confirm("Delete this plan step?")) return;
    setError(null);
    startTransition(async () => {
      const r = await deletePlanStep({ stepId: step.id, familyId });
      if (!r.ok) {
        setError(r.error);
      } else {
        onClose();
        router.refresh();
      }
    });
  }, [step.id, familyId, onClose, router]);

  const planMeta = plan;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center sm:p-6">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]"
        aria-label="Close dialog"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-step-modal-title"
        className="relative z-10 flex max-h-[min(90vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-xl shadow-slate-900/15"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              {PHASE_LABELS[step.phase] ?? step.phase} phase · Plan v
              {planMeta.version}
            </p>
            <h2
              id="plan-step-modal-title"
              className="mt-1 text-lg font-semibold leading-snug text-slate-900"
            >
              {editing ? "Edit step" : step.title}
            </h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {planMeta.generation_source === "openai" ? (
                <Badge className="border-teal-200/80 bg-teal-50 text-teal-900">
                  AI draft
                  {planMeta.ai_model ? ` · ${planMeta.ai_model}` : ""}
                </Badge>
              ) : planMeta.generation_source === "manual" ? (
                <Badge className="bg-slate-100 text-slate-700">Manual</Badge>
              ) : (
                <Badge className="bg-slate-100 text-slate-700">
                  Rules / resources
                </Badge>
              )}
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            className="shrink-0 px-2 text-slate-500 hover:text-slate-800"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error ? (
            <p
              className="mb-4 rounded-lg border border-red-200 bg-red-50/90 px-3 py-2 text-sm text-red-900"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          <div>
            <Label className="text-slate-700">Status</Label>
            <div className="mt-1.5">
              <ModalStatusSelect
                status={status}
                onChange={handleStatusChange}
                disabled={pending || editing}
              />
            </div>
          </div>

          {editing ? (
            <div className="mt-5 space-y-4">
              <div>
                <Label htmlFor="modal-step-title">Title</Label>
                <Input
                  id="modal-step-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="modal-step-desc">Description</Label>
                <textarea
                  id="modal-step-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={10}
                  className={`mt-1.5 ${textareaClass}`}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={saveEdit}
                  disabled={pending || !title.trim()}
                >
                  Save
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setEditing(false);
                    setTitle(step.title);
                    setDescription(step.description);
                  }}
                  disabled={pending}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-5">
              <Label className="text-slate-700">Full detail</Label>
              {description.trim() ? (
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                  {description}
                </p>
              ) : (
                <p className="mt-2 text-sm text-slate-500">
                  No description yet. Use Edit to add contacts, intake steps, or
                  follow-up notes.
                </p>
              )}
            </div>
          )}

          {planMeta.summary ? (
            <p className="mt-4 border-t border-slate-100 pt-4 text-xs text-slate-500">
              {planMeta.summary}
            </p>
          ) : null}
        </div>

        {!editing ? (
          <div className="flex shrink-0 flex-wrap gap-2 border-t border-slate-100 bg-slate-50/80 px-5 py-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEditing(true)}
              disabled={pending}
            >
              Edit
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="text-red-700 hover:text-red-800"
              onClick={handleDelete}
              disabled={pending}
            >
              Delete
            </Button>
            <Button
              type="button"
              variant="outline"
              className="ml-auto"
              onClick={onClose}
            >
              Close
            </Button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export function PlanStepModal({
  step,
  plan,
  familyId,
  onClose,
}: {
  step: PlanStepRow;
  plan: PlanWithSteps;
  familyId: string;
  onClose: () => void;
}) {
  const isClient = useIsClient();

  if (!isClient) {
    return null;
  }

  return (
    <PlanStepModalInner
      step={step}
      plan={plan}
      familyId={familyId}
      onClose={onClose}
    />
  );
}
