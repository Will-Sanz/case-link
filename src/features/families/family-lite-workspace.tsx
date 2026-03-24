"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { checkboxClass } from "@/lib/ui/form-classes";
import {
  generateBarrierWorkflowForFamilyAction,
  toggleBarrierWorkflowActionItemAction,
} from "@/app/actions/barrier-workflow";
import { askCaseAssistantAction } from "@/app/actions/case-assistant";
import { cn } from "@/lib/utils/cn";
import type {
  BarrierPresetLabel,
  BarrierWorkflowResult,
} from "@/types/barrier-workflow";

type TimelineItem = {
  id: string;
  phase: "30" | "60" | "90";
  title: string;
  dueDate: string | null;
  done: boolean;
};

const PHASE_STYLE: Record<"30" | "60" | "90", { dot: string; chip: string; ring: string }> = {
  "30": {
    dot: "bg-blue-500",
    chip: "bg-blue-50 text-blue-800 border-blue-200",
    ring: "border-l-blue-200",
  },
  "60": {
    dot: "bg-indigo-500",
    chip: "bg-indigo-50 text-indigo-800 border-indigo-200",
    ring: "border-l-indigo-200",
  },
  "90": {
    dot: "bg-violet-500",
    chip: "bg-violet-50 text-violet-800 border-violet-200",
    ring: "border-l-violet-200",
  },
};

function phaseLabel(phase: "30" | "60" | "90"): string {
  return `${phase}-day`;
}

function formatDue(dueDate: string | null): string {
  if (!dueDate) return "No date";
  return new Date(`${dueDate}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function ResourceMatchCard({
  resource,
  copied,
  onCopy,
}: {
  resource: BarrierWorkflowResult["resources"][number];
  copied: string | null;
  onCopy: (key: string, value: string | null) => void;
}) {
  const hasPrimaryContact = Boolean(resource.primaryPhone || resource.primaryEmail);

  return (
    <article className="group rounded-xl border border-slate-200/80 bg-white/90 p-4 shadow-[0_1px_0_rgba(15,23,42,0.02)] transition-colors hover:border-slate-300/80">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight text-slate-900">
            {resource.programName || resource.name}
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">{resource.name}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
            {Math.round(resource.similarityScore)}% match
          </span>
          {resource.category ? (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
              {resource.category}
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/55 px-3 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">Why this matches</p>
        <p className="mt-1 text-xs leading-relaxed text-blue-900/85">{resource.whyMatched}</p>
      </div>

      <div className="mt-3 grid gap-2 rounded-lg border border-slate-200 bg-slate-50/55 p-3">
        <div className="grid grid-cols-[70px_1fr] gap-2 text-xs">
          <span className="font-medium text-slate-500">Phone</span>
          <span className="text-slate-800">
            {resource.primaryPhone || "-"}
            {resource.secondaryPhone ? ` · ${resource.secondaryPhone}` : ""}
          </span>
        </div>
        <div className="grid grid-cols-[70px_1fr] gap-2 text-xs">
          <span className="font-medium text-slate-500">Email</span>
          <span className="break-all text-slate-800">
            {resource.primaryEmail || "-"}
            {resource.secondaryEmail ? ` · ${resource.secondaryEmail}` : ""}
          </span>
        </div>
        {resource.address ? (
          <div className="grid grid-cols-[70px_1fr] gap-2 text-xs">
            <span className="font-medium text-slate-500">Address</span>
            <span className="text-slate-800">{resource.address}</span>
          </div>
        ) : null}
        {resource.website ? (
          <div className="grid grid-cols-[70px_1fr] gap-2 text-xs">
            <span className="font-medium text-slate-500">Website</span>
            <a
              href={resource.website}
              target="_blank"
              rel="noreferrer"
              className="truncate text-blue-700 underline-offset-2 hover:underline"
            >
              {resource.website}
            </a>
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {resource.primaryPhone ? (
          <button
            type="button"
            className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            onClick={() => onCopy(`phone-${resource.id}`, resource.primaryPhone)}
          >
            {copied === `phone-${resource.id}` ? "Copied phone" : "Copy phone"}
          </button>
        ) : null}
        {resource.primaryEmail ? (
          <button
            type="button"
            className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            onClick={() => onCopy(`email-${resource.id}`, resource.primaryEmail)}
          >
            {copied === `email-${resource.id}` ? "Copied email" : "Copy email"}
          </button>
        ) : null}
        {(resource.primaryPhone || resource.primaryEmail) && hasPrimaryContact ? (
          <button
            type="button"
            className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            onClick={() =>
              onCopy(
                `all-${resource.id}`,
                [
                  resource.name,
                  resource.programName && resource.programName !== resource.name
                    ? resource.programName
                    : null,
                  resource.primaryPhone ? `Phone: ${resource.primaryPhone}` : null,
                  resource.secondaryPhone ? `Alt phone: ${resource.secondaryPhone}` : null,
                  resource.primaryEmail ? `Email: ${resource.primaryEmail}` : null,
                  resource.secondaryEmail ? `Alt email: ${resource.secondaryEmail}` : null,
                  resource.website ? `Website: ${resource.website}` : null,
                ]
                  .filter(Boolean)
                  .join("\n"),
              )
            }
          >
            {copied === `all-${resource.id}` ? "Copied contact" : "Copy contact info"}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function TimelineLane({
  phase,
  items,
  pending,
  onToggle,
}: {
  phase: "30" | "60" | "90";
  items: TimelineItem[];
  pending: boolean;
  onToggle: (id: string, checked: boolean) => void;
}) {
  const style = PHASE_STYLE[phase];
  const completeCount = items.filter((i) => i.done).length;

  return (
    <section className={cn("rounded-xl border border-slate-200 bg-white p-4", style.ring)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={cn("h-2.5 w-2.5 rounded-full", style.dot)} />
          <h3 className="text-sm font-semibold text-slate-900">{phaseLabel(phase)} horizon</h3>
        </div>
        <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", style.chip)}>
          {completeCount}/{items.length} complete
        </span>
      </div>

      {items.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No scheduled tasks in this phase.</p>
      ) : (
        <ol className="relative mt-4 space-y-3 pl-6">
          <div className="pointer-events-none absolute bottom-2 left-2 top-1 border-l border-slate-200" />
          {items.map((item) => (
            <li key={item.id} className="relative">
              <span
                className={cn(
                  "absolute -left-[20px] top-[7px] h-2.5 w-2.5 rounded-full ring-2 ring-white",
                  item.done ? "bg-emerald-500" : style.dot,
                )}
              />
              <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <label className="flex min-w-0 items-start gap-2">
                    <input
                      type="checkbox"
                      className={`${checkboxClass} mt-0.5`}
                      checked={item.done}
                      disabled={pending}
                      onChange={(e) => onToggle(item.id, e.target.checked)}
                    />
                    <p
                      className={cn(
                        "text-sm font-medium leading-snug",
                        item.done ? "text-slate-500 line-through" : "text-slate-800",
                      )}
                    >
                      {item.title}
                    </p>
                  </label>
                  <span className="shrink-0 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600">
                    {formatDue(item.dueDate)}
                  </span>
                </div>
                <p className="mt-1 text-[11px] uppercase tracking-wide text-slate-500">
                  {item.done ? "Completed" : "Upcoming"}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function FamilyLiteWorkspace({
  familyId,
  familyName,
  barrierOptions,
  initialResult,
  tab = "plan",
}: {
  familyId: string;
  familyName: string;
  barrierOptions: readonly { key: string; label: string }[];
  initialResult: BarrierWorkflowResult | null;
  tab?: "plan" | "resources" | "timeline" | "assistant";
}) {
  const [result, setResult] = useState<BarrierWorkflowResult | null>(initialResult);
  const [selected, setSelected] = useState<BarrierPresetLabel[]>(
    (initialResult?.selectedBarriers ?? []).filter((s): s is BarrierPresetLabel =>
      barrierOptions.some((o) => o.label === s),
    ),
  );
  const [details, setDetails] = useState(initialResult?.additionalDetails ?? "");
  const [pending, startTransition] = useTransition();
  const [assistantPending, startAssistantTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [assistantQuestion, setAssistantQuestion] = useState("");
  const [assistantAnswer, setAssistantAnswer] = useState<string | null>(null);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  function toggleLabel(label: BarrierPresetLabel) {
    setSelected((prev) =>
      prev.includes(label) ? prev.filter((x) => x !== label) : [...prev, label],
    );
  }

  function generate() {
    setError(null);
    startTransition(async () => {
      const r = await generateBarrierWorkflowForFamilyAction(familyId, {
        selectedBarriers: selected,
        additionalDetails: details,
      });
      if (!r.ok) return setError(r.error);
      setResult(r.result);
    });
  }

  function toggleAction(actionItemId: string, done: boolean) {
    if (!result) return;
    startTransition(async () => {
      const r = await toggleBarrierWorkflowActionItemAction(result.familyId, actionItemId, done);
      if (!r.ok) return setError(r.error);
      setResult(r.result);
    });
  }

  async function copyText(key: string, text: string | null) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((v) => (v === key ? null : v)), 1200);
    } catch {
      setError("Could not copy to clipboard.");
    }
  }

  function askAssistant() {
    const q = assistantQuestion.trim();
    if (!q) {
      setAssistantError("Enter a question for the assistant.");
      return;
    }
    setAssistantError(null);
    startAssistantTransition(async () => {
      const r = await askCaseAssistantAction(familyId, q);
      if (!r.ok) {
        setAssistantError(r.error);
        return;
      }
      setAssistantAnswer(r.answer);
    });
  }

  const timelineItems: TimelineItem[] = (result?.sections ?? [])
    .flatMap((section) =>
      section.steps.flatMap((step) =>
        step.actionItems.map((item) => ({
          id: item.id,
          phase: section.phase,
          title: item.title,
          dueDate: item.dueDate,
          done: item.status === "completed",
        })),
      ),
    )
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));

  const timelineByPhase = {
    "30": timelineItems.filter((i) => i.phase === "30"),
    "60": timelineItems.filter((i) => i.phase === "60"),
    "90": timelineItems.filter((i) => i.phase === "90"),
  };

  return (
    <div className="space-y-6">
      {tab === "plan" ? (
        <Card className="border-slate-200/90 bg-white/95 p-5 shadow-[0_1px_0_rgba(15,23,42,0.02)] sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-900">{familyName}</h1>
              <p className="text-xs text-slate-500">Family ID: {familyId}</p>
            </div>
            {result?.lastSavedAt ? (
              <p className="text-xs text-slate-500">
                Updated {new Date(result.lastSavedAt).toLocaleString()}
              </p>
            ) : null}
          </div>

          <div className="mt-5">
            <Label>Barriers</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {barrierOptions.map((opt) => {
                const on = selectedSet.has(opt.label as BarrierPresetLabel);
                return (
                  <button
                    key={`${opt.key}-${opt.label}`}
                    type="button"
                    onClick={() => toggleLabel(opt.label as BarrierPresetLabel)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                      on
                        ? "border-blue-200 bg-blue-50 text-blue-800"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50",
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-4">
            <Label htmlFor="family-details">Additional details</Label>
            <Textarea
              id="family-details"
              className="mt-1.5 min-h-[100px] border-slate-200/90 bg-slate-50/50"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
            />
          </div>

          {error ? (
            <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : null}

          <div className="mt-4">
            <Button type="button" onClick={generate} disabled={pending} className="px-4 py-2">
              {pending ? "Generating..." : result ? "Regenerate plan" : "Generate plan"}
            </Button>
          </div>
        </Card>
      ) : null}

      {result && tab === "plan" ? (
        <div>
          <Card className="border-slate-200/90 bg-white/95 p-5 shadow-[0_1px_0_rgba(15,23,42,0.02)] sm:p-6">
            <CardTitle className="text-base">30 / 60 / 90 day plan</CardTitle>
            <div className="mt-4 space-y-5">
              {result.sections.map((section) => (
                <section key={section.phase} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">{section.phase}-day</h3>
                    <p className="text-xs text-slate-500">{section.dueRangeLabel}</p>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">{section.summary}</p>
                  <div className="mt-3 space-y-3">
                    {section.steps.map((step) => (
                      <article key={step.id} className="rounded-lg border border-slate-200/90 bg-slate-50/45 p-3">
                        <p className="text-sm font-semibold text-slate-900">{step.title}</p>
                        <p className="mt-1 text-sm text-slate-700 line-clamp-3">{step.description}</p>
                        {step.actionItems.length > 0 ? (
                          <ul className="mt-3 space-y-2">
                            {step.actionItems.map((item) => (
                              <li key={item.id} className="rounded-lg border border-slate-200 bg-white p-2">
                                <label className="flex items-start gap-2">
                                  <input
                                    type="checkbox"
                                    className={`${checkboxClass} mt-0.5`}
                                    checked={item.status === "completed"}
                                    disabled={pending}
                                    onChange={(e) => toggleAction(item.id, e.target.checked)}
                                  />
                                  <span>
                                    <span className="block text-sm font-medium text-slate-800">{item.title}</span>
                                    {item.dueDate ? (
                                      <span className="block text-xs text-slate-500">
                                        Due {formatDue(item.dueDate)}
                                      </span>
                                    ) : null}
                                  </span>
                                </label>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </Card>
        </div>
      ) : null}

      {result && tab === "resources" ? (
        <div className="space-y-4">
          <Card className="border-slate-200/90 bg-gradient-to-b from-slate-50 to-white p-5 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <CardTitle className="text-base">Resource matches</CardTitle>
                <p className="mt-1 text-sm text-slate-600">
                  Curated nonprofit options matched to this family&apos;s current barriers.
                </p>
              </div>
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600">
                {result.resources.length} matches
              </span>
            </div>
          </Card>

          {result.resources.length === 0 ? (
            <Card className="p-5 sm:p-6">
              <p className="text-sm text-slate-600">No resource matches yet for this family.</p>
            </Card>
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {result.resources.map((resource) => (
                <ResourceMatchCard
                  key={resource.id}
                  resource={resource}
                  copied={copied}
                  onCopy={copyText}
                />
              ))}
            </div>
          )}
        </div>
      ) : null}

      {result && tab === "timeline" ? (
        <div className="space-y-4">
          <Card className="border-slate-200/90 bg-gradient-to-b from-slate-50 to-white p-5 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <CardTitle className="text-base">Timeline</CardTitle>
                <p className="mt-1 text-sm text-slate-600">
                  Chronological execution view grouped by 30/60/90 horizons.
                </p>
              </div>
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600">
                {timelineItems.filter((i) => i.done).length}/{timelineItems.length} complete
              </span>
            </div>
          </Card>

          <div className="space-y-4">
            <TimelineLane
              phase="30"
              items={timelineByPhase["30"]}
              pending={pending}
              onToggle={toggleAction}
            />
            <TimelineLane
              phase="60"
              items={timelineByPhase["60"]}
              pending={pending}
              onToggle={toggleAction}
            />
            <TimelineLane
              phase="90"
              items={timelineByPhase["90"]}
              pending={pending}
              onToggle={toggleAction}
            />
          </div>
        </div>
      ) : null}

      {tab === "assistant" ? (
        <div className="space-y-4">
          <Card className="border-slate-200/90 bg-gradient-to-b from-slate-50 to-white p-5 sm:p-6">
            <CardTitle className="text-base">Case assistant</CardTitle>
            <p className="mt-1 text-sm text-slate-600">
              Ask AI for execution guidance based on this family&apos;s current plan, barriers, and
              matched resources.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {[
                "What should I prioritize this week?",
                "Draft outreach talking points for the top resource.",
                "What could block this plan and how should I prepare?",
              ].map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => setAssistantQuestion(prompt)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </Card>

          <Card className="border-slate-200/90 bg-white/95 p-5 sm:p-6">
            <Label htmlFor="assistant-question">Your question</Label>
            <Textarea
              id="assistant-question"
              className="mt-1.5 min-h-[120px] border-slate-200/90 bg-slate-50/50"
              value={assistantQuestion}
              onChange={(e) => setAssistantQuestion(e.target.value)}
              placeholder="Ask about next steps, risks, resource outreach, or plan sequencing."
            />
            <div className="mt-3">
              <Button type="button" onClick={askAssistant} disabled={assistantPending}>
                {assistantPending ? "Thinking..." : "Ask assistant"}
              </Button>
            </div>
            {assistantError ? (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {assistantError}
              </p>
            ) : null}
          </Card>

          {assistantAnswer ? (
            <Card className="border-slate-200/90 bg-white/95 p-5 sm:p-6">
              <CardTitle className="text-base">Assistant response</CardTitle>
              <div className="prose prose-slate mt-3 max-w-none text-sm whitespace-pre-wrap">
                {assistantAnswer}
              </div>
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
