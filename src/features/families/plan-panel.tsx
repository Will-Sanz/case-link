"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  createManualStep,
  deletePlanStep,
  generatePlan,
  updatePlanStep,
} from "@/app/actions/plans";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PlanStepRow, PlanWithSteps } from "@/types/family";

const PHASE_LABELS: Record<string, string> = {
  "30": "30-day",
  "60": "60-day",
  "90": "90-day",
};

function StepStatusBadge({
  status,
  onChange,
  disabled,
}: {
  status: PlanStepRow["status"];
  onChange?: (status: PlanStepRow["status"]) => void;
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
  if (onChange && !disabled) {
    return (
      <select
        value={status}
        onChange={(e) =>
          onChange(e.target.value as PlanStepRow["status"])
        }
        className={`rounded-full border-0 px-2 py-0.5 text-xs font-medium ${cls} focus:ring-2 focus:ring-slate-400`}
      >
        <option value="pending">pending</option>
        <option value="in_progress">in_progress</option>
        <option value="completed">completed</option>
        <option value="blocked">blocked</option>
      </select>
    );
  }
  return <Badge className={cls}>{status}</Badge>;
}

export function PlanPanel({
  familyId,
  plan,
}: {
  familyId: string;
  plan: PlanWithSteps | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [showAddStep, setShowAddStep] = useState(false);
  const [addPhase, setAddPhase] = useState<"30" | "60" | "90">("30");
  const [addTitle, setAddTitle] = useState("");
  const [addDesc, setAddDesc] = useState("");

  function handleGenerate() {
    setError(null);
    startTransition(async () => {
      const r = await generatePlan({ familyId });
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  function handleStatusChange(stepId: string, status: PlanStepRow["status"]) {
    setError(null);
    startTransition(async () => {
      const r = await updatePlanStep({ stepId, familyId, status });
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  function startEdit(step: PlanStepRow) {
    setEditingStepId(step.id);
    setEditTitle(step.title);
    setEditDesc(step.description);
  }

  function cancelEdit() {
    setEditingStepId(null);
  }

  function saveEdit() {
    if (!editingStepId) return;
    setError(null);
    startTransition(async () => {
      const r = await updatePlanStep({
        stepId: editingStepId,
        familyId,
        title: editTitle,
        description: editDesc,
      });
      if (!r.ok) setError(r.error);
      else {
        setEditingStepId(null);
        router.refresh();
      }
    });
  }

  function handleDelete(stepId: string) {
    if (!confirm("Delete this step?")) return;
    setError(null);
    startTransition(async () => {
      const r = await deletePlanStep({ stepId, familyId });
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  function handleAddStep(e: React.FormEvent) {
    e.preventDefault();
    if (!plan || !addTitle.trim()) return;
    setError(null);
    startTransition(async () => {
      const r = await createManualStep({
        familyId,
        planId: plan.id,
        phase: addPhase,
        title: addTitle.trim(),
        description: addDesc.trim(),
      });
      if (!r.ok) setError(r.error);
      else {
        setShowAddStep(false);
        setAddTitle("");
        setAddDesc("");
        router.refresh();
      }
    });
  }

  const stepsByPhase = {
    "30": plan?.steps.filter((s) => s.phase === "30") ?? [],
    "60": plan?.steps.filter((s) => s.phase === "60") ?? [],
    "90": plan?.steps.filter((s) => s.phase === "90") ?? [],
  };

  return (
    <Card>
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <CardTitle className="text-base">30 / 60 / 90 day plan</CardTitle>
          <p className="mt-1 text-sm text-slate-600">
            With an API key configured, plans are drafted by AI first; otherwise
            (or if AI fails) steps come from rules tied to goals and barriers.
            Edit or add steps anytime.
          </p>
        </div>
        {!plan ? (
          <Button
            type="button"
            onClick={handleGenerate}
            disabled={pending}
            variant="secondary"
          >
            {pending ? "Generating…" : "Generate plan"}
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={handleGenerate}
              disabled={pending}
              variant="secondary"
            >
              {pending ? "Generating…" : "Regenerate (new version)"}
            </Button>
            <Button
              type="button"
              onClick={() => setShowAddStep(true)}
              disabled={pending}
              variant="secondary"
            >
              Add step
            </Button>
          </div>
        )}
      </div>

      {error ? (
        <p className="mt-4 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      {!plan ? (
        <p className="mt-4 text-sm text-slate-600">
          No plan yet. Click &quot;Generate plan&quot; to create one from this
          family&apos;s goals and barriers.
        </p>
      ) : (
        <div className="mt-6 space-y-8">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500">
              Source:
              {plan.generation_source === "openai" ? (
                <>
                  {" "}
                  <Badge className="bg-violet-100 text-violet-900">
                    AI{plan.ai_model ? ` (${plan.ai_model})` : ""}
                  </Badge>
                </>
              ) : plan.generation_source === "manual" ? (
                <Badge className="bg-slate-100 text-slate-700">Manual</Badge>
              ) : (
                <Badge className="bg-slate-100 text-slate-700">
                  Rules-based (goals & barriers)
                </Badge>
              )}
            </span>
            {plan.summary ? (
              <span className="text-xs text-slate-400">· {plan.summary}</span>
            ) : null}
          </div>
          {(["30", "60", "90"] as const).map((phase) => (
            <div key={phase}>
              <h3 className="mb-3 text-sm font-semibold text-slate-800">
                {PHASE_LABELS[phase]} goals
              </h3>
              {stepsByPhase[phase].length === 0 ? (
                <p className="text-sm text-slate-500">
                  No steps in this phase. Add one below.
                </p>
              ) : (
                <ul className="space-y-3">
                  {stepsByPhase[phase].map((step) => (
                    <li
                      key={step.id}
                      className="rounded-lg border border-slate-100 bg-slate-50/50 p-4"
                    >
                      {editingStepId === step.id ? (
                        <div className="space-y-3">
                          <Input
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            placeholder="Title"
                            className="font-medium"
                          />
                          <textarea
                            value={editDesc}
                            onChange={(e) => setEditDesc(e.target.value)}
                            placeholder="Description"
                            rows={2}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          />
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              className="px-3 py-1.5 text-sm"
                              onClick={saveEdit}
                              disabled={pending || !editTitle.trim()}
                            >
                              Save
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              className="px-3 py-1.5 text-sm"
                              onClick={cancelEdit}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <p className="font-medium text-slate-900">
                              {step.title}
                            </p>
                            <div className="flex items-center gap-2">
                              <StepStatusBadge
                                status={step.status}
                                onChange={(s) =>
                                  handleStatusChange(step.id, s)
                                }
                                disabled={pending}
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                className="text-slate-500 py-1 px-2 text-xs"
                                onClick={() => startEdit(step)}
                              >
                                Edit
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                className="text-red-600 py-1 px-2 text-xs"
                                onClick={() => handleDelete(step.id)}
                              >
                                Delete
                              </Button>
                            </div>
                          </div>
                          {step.description ? (
                            <p className="mt-2 text-sm text-slate-600">
                              {step.description}
                            </p>
                          ) : null}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}

          {showAddStep ? (
            <form
              onSubmit={handleAddStep}
              className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-4"
            >
              <h4 className="mb-3 text-sm font-medium text-slate-800">
                Add step
              </h4>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="add-phase">Phase</Label>
                  <select
                    id="add-phase"
                    value={addPhase}
                    onChange={(e) =>
                      setAddPhase(e.target.value as "30" | "60" | "90")
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="30">30-day</option>
                    <option value="60">60-day</option>
                    <option value="90">90-day</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="add-title">Title</Label>
                  <Input
                    id="add-title"
                    value={addTitle}
                    onChange={(e) => setAddTitle(e.target.value)}
                    placeholder="Step title"
                    className="mt-1"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="add-desc">Description (optional)</Label>
                  <textarea
                    id="add-desc"
                    value={addDesc}
                    onChange={(e) => setAddDesc(e.target.value)}
                    placeholder="Details…"
                    rows={2}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    disabled={pending || !addTitle.trim()}
                  >
                    Add step
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setShowAddStep(false);
                      setAddTitle("");
                      setAddDesc("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </form>
          ) : null}
        </div>
      )}
    </Card>
  );
}
