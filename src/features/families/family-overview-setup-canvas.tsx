"use client";

import { useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils/cn";
import type { BarrierPresetLabel } from "@/types/barrier-workflow";

type BarrierOption = { key: string; label: string };

type CustomBarrierRow = { id: string; text: string };

export function FamilyOverviewSetupCanvas({
  familyName,
  barrierOptions,
  selectedSet,
  onToggleLabel,
  customBarriers,
  onAddCustomBarrier,
  onRemoveCustomBarrier,
  additionalContext,
  onAdditionalContextChange,
  lastSavedAt,
  error,
  pending,
  generateStartedAt,
  elapsedSeconds,
  onGenerate,
  hasGeneratedThisSession,
  formatElapsed,
}: {
  familyName: string;
  barrierOptions: readonly BarrierOption[];
  selectedSet: ReadonlySet<BarrierPresetLabel>;
  onToggleLabel: (label: BarrierPresetLabel) => void;
  customBarriers: readonly CustomBarrierRow[];
  onAddCustomBarrier: (text: string) => void;
  onRemoveCustomBarrier: (id: string) => void;
  additionalContext: string;
  onAdditionalContextChange: (value: string) => void;
  lastSavedAt: string | null | undefined;
  error: string | null;
  pending: boolean;
  generateStartedAt: number | null;
  elapsedSeconds: number;
  onGenerate: () => void;
  hasGeneratedThisSession: boolean;
  formatElapsed: (seconds: number) => string;
}) {
  const [customDraft, setCustomDraft] = useState("");

  function submitCustomBarrier() {
    const v = customDraft.trim();
    if (!v) return;
    onAddCustomBarrier(v);
    setCustomDraft("");
  }

  function onCustomKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      submitCustomBarrier();
    }
  }

  const showLivePreview =
    selectedSet.size > 0 ||
    customBarriers.length > 0 ||
    Boolean(additionalContext.trim());

  const selectedTileClass = cn(
    "min-h-[52px] rounded-xl border-2 px-4 py-3 text-left text-sm font-medium leading-snug transition-colors",
    "border-blue-500 bg-blue-50/90 text-blue-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]",
  );

  return (
    <Card className="border-slate-200/90 bg-white/95 p-5 shadow-[0_1px_0_rgba(15,23,42,0.02)] sm:p-6">
      {/* 1. Header */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">{familyName}</h1>
        </div>
        {lastSavedAt ? (
          <p className="text-xs text-slate-500">Updated {new Date(lastSavedAt).toLocaleString()}</p>
        ) : null}
      </header>

      <div className="mx-auto mt-8 max-w-3xl space-y-10">
        {/* 2. Barriers */}
        <section aria-labelledby="setup-barriers-heading" className="space-y-4">
          <div>
            <h2
              id="setup-barriers-heading"
              className="text-sm font-semibold tracking-tight text-slate-900"
            >
              Barriers
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Choose everything that applies. You can adjust before generating.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {barrierOptions.map((opt) => {
              const on = selectedSet.has(opt.label as BarrierPresetLabel);
              return (
                <button
                  key={`${opt.key}-${opt.label}`}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onToggleLabel(opt.label as BarrierPresetLabel)}
                  className={cn(
                    "min-h-[52px] rounded-xl border-2 px-4 py-3 text-left text-sm font-medium leading-snug transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/35 focus-visible:ring-offset-2",
                    on
                      ? selectedTileClass
                      : "border-slate-200/90 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50/80",
                  )}
                >
                  <span className="flex items-start gap-2.5">
                    <span
                      className={cn(
                        "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 text-[10px] font-bold",
                        on
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-slate-300 bg-white text-transparent",
                      )}
                      aria-hidden
                    >
                      ✓
                    </span>
                    <span>{opt.label}</span>
                  </span>
                </button>
              );
            })}
            {customBarriers.map((row) => (
              <div key={row.id} className={cn("relative", selectedTileClass, "pr-10")}>
                <button
                  type="button"
                  className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-blue-100/80 hover:text-slate-900"
                  aria-label={`Remove barrier: ${row.text}`}
                  onClick={() => onRemoveCustomBarrier(row.id)}
                >
                  <span className="text-lg leading-none" aria-hidden>
                    ×
                  </span>
                </button>
                <div className="flex items-start gap-2.5">
                  <span
                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 border-blue-600 bg-blue-600 text-[10px] font-bold text-white"
                    aria-hidden
                  >
                    ✓
                  </span>
                  <span className="min-w-0 break-words">{row.text}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
            <Input
              id="setup-add-custom-barrier"
              className="min-h-[52px] flex-1 border-slate-200/90 py-3 text-sm"
              value={customDraft}
              onChange={(e) => setCustomDraft(e.target.value)}
              onKeyDown={onCustomKeyDown}
              placeholder="Add a barrier not listed above…"
              maxLength={200}
              aria-label="Custom barrier"
            />
            <Button
              type="button"
              variant="secondary"
              className="h-[52px] shrink-0 px-5 font-semibold sm:w-auto"
              onClick={submitCustomBarrier}
              disabled={!customDraft.trim()}
            >
              Add
            </Button>
          </div>
        </section>

        {/* 3. Additional context */}
        <section className="space-y-3">
          <Label htmlFor="family-additional-context" className="text-sm font-semibold text-slate-900">
            Additional context
          </Label>
          <Textarea
            id="family-additional-context"
            className="min-h-[120px] resize-y border-slate-200/90 bg-white text-sm leading-relaxed text-slate-800 placeholder:text-slate-400 focus-visible:border-slate-300 focus-visible:ring-blue-500/20"
            value={additionalContext}
            onChange={(e) => onAdditionalContextChange(e.target.value)}
            placeholder="Describe anything important about the situation..."
          />
        </section>

        {/* 5. Live setup preview */}
        {showLivePreview ? (
          <section className="space-y-3" aria-live="polite">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Your setup</p>
            {selectedSet.size > 0 || customBarriers.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {barrierOptions
                  .filter((o) => selectedSet.has(o.label as BarrierPresetLabel))
                  .map((o) => (
                    <span
                      key={o.key}
                      className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-800"
                    >
                      {o.label}
                    </span>
                  ))}
                {customBarriers.map((row) => (
                  <span
                    key={row.id}
                    className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-800"
                  >
                    {row.text}
                  </span>
                ))}
              </div>
            ) : null}
            {additionalContext.trim() ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-600">
                {additionalContext.trim()}
              </p>
            ) : null}
          </section>
        ) : null}

        {error ? (
          <p className="text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}

        {/* 4. Generate */}
        <div className="space-y-3 pt-1">
          <div className="flex max-w-3xl flex-wrap items-stretch gap-3">
            <Button
              type="button"
              onClick={onGenerate}
              disabled={pending}
              className={cn(
                "h-14 min-h-[3.5rem] w-full text-base font-semibold tracking-tight shadow-sm sm:min-w-[min(100%,18rem)]",
                "bg-slate-900 text-white hover:bg-slate-800",
              )}
            >
              {pending
                ? "Generating..."
                : hasGeneratedThisSession
                  ? "Regenerate Plan and Match Resources"
                  : "Generate Plan and Match Resources"}
            </Button>
          </div>
          {pending && generateStartedAt ? (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <span
                className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700"
                aria-hidden
              />
              <span>Building plan… {formatElapsed(elapsedSeconds)}</span>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
