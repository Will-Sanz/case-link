"use client";

import { useState, type KeyboardEvent } from "react";
import { Check, Xmark } from "iconoir-react";
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
  generateBusy,
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
  /** True while plan generation (including staged 60/90 phases) is in progress. */
  generateBusy: boolean;
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
    "border-[var(--color-focus)] bg-[var(--color-accent-soft)] text-[var(--color-ink)]",
  );

  return (
    <Card className="border-[var(--color-rule)] bg-[var(--color-surface)] p-5 [box-shadow:var(--shadow-surface)] sm:p-7">
      {/* 1. Header */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-[var(--color-ink-muted)]">Barriers</p>
          <h1 className="workspace-display mt-1 text-2xl text-[var(--color-ink)]">{familyName}</h1>
        </div>
        {lastSavedAt ? (
          <p className="text-xs text-[var(--color-ink-faint)]">Updated {new Date(lastSavedAt).toLocaleString()}</p>
        ) : null}
      </header>

      <div className="mx-auto mt-8 max-w-3xl space-y-10">
        {/* 2. Barriers */}
        <section aria-labelledby="setup-barriers-heading" className="space-y-4">
          <div>
            <h2
              id="setup-barriers-heading"
              className="text-sm font-semibold tracking-tight text-[var(--color-ink)]"
            >
              Barriers
            </h2>
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
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
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]/35 focus-visible:ring-offset-2",
                    on
                      ? selectedTileClass
                      : "border-[var(--color-rule)] bg-[var(--color-surface)] text-[var(--color-ink-muted)] hover:border-[var(--color-accent-rule)] hover:bg-[var(--color-paper)]",
                  )}
                >
                  <span className="flex items-start gap-2.5">
                    <span
                      className={cn(
                        "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 text-[10px] font-bold",
                        on
                          ? "border-[var(--color-positive)] bg-[var(--color-positive)] text-[var(--color-accent-ink)]"
                          : "border-[var(--color-rule-strong)] bg-[var(--color-surface)] text-transparent",
                      )}
                      aria-hidden="true"
                    >
                      <Check
                        className="h-4 w-4"
                        strokeWidth={2.5}
                        aria-hidden="true"
                      />
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
                  className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-paper-3)] hover:text-[var(--color-ink)]"
                  aria-label={`Remove barrier: ${row.text}`}
                  onClick={() => onRemoveCustomBarrier(row.id)}
                >
                  <Xmark className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
                </button>
                <div className="flex items-start gap-2.5">
                  <span
                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 border-[var(--color-positive)] bg-[var(--color-positive)] text-[10px] font-bold text-[var(--color-accent-ink)]"
                    aria-hidden="true"
                  >
                    <Check
                      className="h-4 w-4"
                      strokeWidth={2.5}
                      aria-hidden="true"
                    />
                  </span>
                  <span className="min-w-0 break-words">{row.text}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
            <Input
              id="setup-add-custom-barrier"
              className="min-h-[52px] flex-1 border-[var(--color-rule-strong)] py-3 text-sm"
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
          <Label htmlFor="family-additional-context" className="text-sm font-semibold text-[var(--color-ink)]">
            Additional context
          </Label>
          <Textarea
            id="family-additional-context"
            className="min-h-[120px] resize-y border-[var(--color-rule-strong)] bg-[var(--color-surface)] text-sm leading-relaxed text-[var(--color-ink-strong)] placeholder:text-[var(--color-ink-faint)] focus-visible:border-[var(--color-focus)] focus-visible:ring-[var(--color-focus)]/15"
            value={additionalContext}
            onChange={(e) => onAdditionalContextChange(e.target.value)}
            placeholder="Describe anything important about the situation..."
            aria-describedby="family-additional-context-help"
          />
          <p id="family-additional-context-help" className="text-xs leading-5 text-[var(--color-ink-faint)]">
            Keep this de-identified. Do not include names, addresses, birth dates, student IDs,
            contact details, or signatures.
          </p>
        </section>

        {/* 5. Live setup preview */}
        {showLivePreview ? (
          <section className="space-y-3" aria-live="polite">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">Context</p>
            {selectedSet.size > 0 || customBarriers.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {barrierOptions
                  .filter((o) => selectedSet.has(o.label as BarrierPresetLabel))
                  .map((o) => (
                    <span
                      key={o.key}
                      className="rounded-lg bg-[var(--color-accent-soft)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink-2)]"
                    >
                      {o.label}
                    </span>
                  ))}
                {customBarriers.map((row) => (
                  <span
                    key={row.id}
                    className="rounded-lg bg-[var(--color-accent-soft)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink-2)]"
                  >
                    {row.text}
                  </span>
                ))}
              </div>
            ) : null}
            {additionalContext.trim() ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-ink-muted)]">
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
              disabled={generateBusy}
              className={cn(
                "h-14 min-h-[3.5rem] w-full text-base font-semibold tracking-tight shadow-sm sm:min-w-[min(100%,18rem)]",
                "bg-[var(--color-accent)] text-[var(--color-accent-ink)] hover:bg-[var(--color-accent-hover)]",
              )}
            >
              {generateBusy
                ? "Drafting action plan…"
                : hasGeneratedThisSession
                  ? "Draft a new action plan"
                  : "Draft action plan"}
            </Button>
          </div>
          {generateBusy && generateStartedAt ? (
            <div className="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
              <span
                className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-rule-strong)] border-t-[var(--color-accent)]"
                aria-hidden
              />
              <span>Preparing actions and target dates… {formatElapsed(elapsedSeconds)}</span>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
