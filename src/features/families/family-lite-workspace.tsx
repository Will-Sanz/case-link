"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { advanceStagedLeanPlanGeneration } from "@/app/actions/plans";
import { runResourceMatching } from "@/app/actions/resource-matches";
import {
  generateBarrierWorkflowForFamilyAction,
  loadBarrierWorkflowForFamilyAction,
  toggleBarrierWorkflowActionItemAction,
} from "@/app/actions/barrier-workflow";
import { FamilyPlanPanel } from "@/features/families/family-plan-panel";
import { CaseProgressWorkspace } from "@/features/families/case-progress-workspace";
import type {
  CaseNoteRow,
  CaseProgressUpdateRow,
  PlanWithSteps,
} from "@/types/family";
import { CaseAssistantChat } from "@/features/families/case-assistant-chat";
import { ArchiveFamilyFromListControl } from "@/features/families/archive-family-from-list-control";
import { FamilyOverviewSetupCanvas } from "@/features/families/family-overview-setup-canvas";
import { DEFAULT_AI_MODE } from "@/lib/ai/ai-mode";
import { cn } from "@/lib/utils/cn";
import { completedGenerationStageCount } from "@/lib/domain/plan/generation-progress";
import { validateNoPii } from "@/lib/privacy/no-pii";
import type {
  BarrierPresetLabel,
  BarrierWorkflowResult,
} from "@/types/barrier-workflow";

function savedAdditionalDetails(
  r: BarrierWorkflowResult | null | undefined,
): string {
  return (r?.additionalDetails ?? "").trim();
}

/** Matches server `parseAdditionalBarriers` splitting; preserves order, case-insensitive dedupe. */
function parseBarrierLinesOrdered(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of input.split(/\r?\n|,|;/)) {
    const t = part.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function initialCustomBarriers(
  r: BarrierWorkflowResult | null | undefined,
): { id: string; text: string }[] {
  if (!r) return [];
  return parseBarrierLinesOrdered(r.additionalBarriers ?? "").map((text) => ({
    id: crypto.randomUUID(),
    text,
  }));
}

function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${String(secs).padStart(2, "0")}s`;
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
  const title = (resource.programName || resource.name).trim();
  const nameDiffers = resource.name.trim() && resource.name.trim() !== title;
  const contextLine =
    nameDiffers
      ? resource.name.trim()
      : resource.description?.trim() && resource.description.trim() !== title
        ? resource.description.trim()
        : null;

  return (
    <article className="group rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] p-4 shadow-[0_1px_0_rgba(15,23,42,0.02)] transition-colors hover:border-[var(--color-rule-strong)]">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold tracking-tight text-[var(--color-ink)]">{title}</h3>
        {contextLine ? (
          <p className="mt-0.5 text-xs text-[var(--color-ink-faint)]">{contextLine}</p>
        ) : null}
      </div>

      <div className="mt-4 grid gap-2 rounded-lg border border-[var(--color-rule)] bg-[var(--color-paper)] p-3">
        <div className="grid grid-cols-[70px_1fr] gap-2 text-xs">
          <span className="font-medium text-[var(--color-ink-faint)]">Phone</span>
          <span className="text-[var(--color-ink-strong)]">
            {resource.primaryPhone || "-"}
            {resource.secondaryPhone ? ` · ${resource.secondaryPhone}` : ""}
          </span>
        </div>
        <div className="grid grid-cols-[70px_1fr] gap-2 text-xs">
          <span className="font-medium text-[var(--color-ink-faint)]">Email</span>
          <span className="break-all text-[var(--color-ink-strong)]">
            {resource.primaryEmail || "-"}
            {resource.secondaryEmail ? ` · ${resource.secondaryEmail}` : ""}
          </span>
        </div>
        {resource.address ? (
          <div className="grid grid-cols-[70px_1fr] gap-2 text-xs">
            <span className="font-medium text-[var(--color-ink-faint)]">Address</span>
            <span className="text-[var(--color-ink-strong)]">{resource.address}</span>
          </div>
        ) : null}
        {resource.website ? (
          <div className="grid grid-cols-[70px_1fr] gap-2 text-xs">
            <span className="font-medium text-[var(--color-ink-faint)]">Website</span>
            <a
              href={resource.website}
              target="_blank"
              rel="noreferrer"
              className="truncate text-[var(--color-accent)] underline-offset-2 hover:underline"
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
            className="rounded-md border border-[var(--color-rule)] bg-[var(--color-surface)] px-2.5 py-1 text-xs font-medium text-[var(--color-ink-2)] hover:bg-[var(--color-paper)]"
            onClick={() => onCopy(`phone-${resource.id}`, resource.primaryPhone)}
          >
            {copied === `phone-${resource.id}` ? "Copied phone" : "Copy phone"}
          </button>
        ) : null}
        {resource.primaryEmail ? (
          <button
            type="button"
            className="rounded-md border border-[var(--color-rule)] bg-[var(--color-surface)] px-2.5 py-1 text-xs font-medium text-[var(--color-ink-2)] hover:bg-[var(--color-paper)]"
            onClick={() => onCopy(`email-${resource.id}`, resource.primaryEmail)}
          >
            {copied === `email-${resource.id}` ? "Copied email" : "Copy email"}
          </button>
        ) : null}
        {(resource.primaryPhone || resource.primaryEmail) && hasPrimaryContact ? (
          <button
            type="button"
            className="rounded-md border border-[var(--color-rule)] bg-[var(--color-surface)] px-2.5 py-1 text-xs font-medium text-[var(--color-ink-2)] hover:bg-[var(--color-paper)]"
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

export function FamilyLiteWorkspace({
  familyId,
  familyName,
  barrierOptions,
  initialResult,
  plan,
  progressUpdates = [],
  caseNotes = [],
  tab = "plan",
}: {
  familyId: string;
  familyName: string;
  barrierOptions: readonly { key: string; label: string }[];
  initialResult: BarrierWorkflowResult | null;
  /** Latest `plans` + `plan_steps` from the server, canonical for edit + PDF. */
  plan: PlanWithSteps | null;
  progressUpdates?: CaseProgressUpdateRow[];
  caseNotes?: CaseNoteRow[];
  tab?: "overview" | "plan" | "resources" | "assistant";
}) {
  const router = useRouter();
  const [result, setResult] = useState<BarrierWorkflowResult | null>(initialResult);
  const [selected, setSelected] = useState<BarrierPresetLabel[]>(
    (initialResult?.selectedBarriers ?? []).filter((s): s is BarrierPresetLabel =>
      barrierOptions.some((o) => o.label === s),
    ),
  );
  const [additionalContext, setAdditionalContext] = useState(() =>
    savedAdditionalDetails(initialResult),
  );
  const [customBarriers, setCustomBarriers] = useState(() =>
    initialCustomBarriers(initialResult),
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [localPlanGenerating, setLocalPlanGenerating] = useState(false);
  const [generateStartedAt, setGenerateStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [hasGeneratedThisSession, setHasGeneratedThisSession] = useState(false);
  const [resourceRetrying, setResourceRetrying] = useState(false);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const serverPlanStillGenerating = plan?.generation_state?.status === "running";
  const planGenerateBusy = localPlanGenerating || serverPlanStillGenerating;
  const savedGenerationStages = completedGenerationStageCount(plan?.generation_state);
  const generationStageLabel =
    savedGenerationStages === 0
      ? "Drafting the first actions"
      : savedGenerationStages === 1
        ? "Adding follow-up actions"
        : savedGenerationStages === 2
          ? "Checking the complete plan"
          : "Plan ready";

  const stagedPollRef = useRef<Promise<void> | null>(null);
  const resumePollStartedRef = useRef(false);

  const planGenerationStatus = plan?.generation_state?.status;

  const runStagedPlanPolling = useCallback(async () => {
    if (stagedPollRef.current) {
      await stagedPollRef.current;
      return;
    }
    const promise = (async () => {
      try {
        for (let i = 0; i < 6; i++) {
          const adv = await advanceStagedLeanPlanGeneration({
            familyId,
            aiMode: DEFAULT_AI_MODE,
          });
          if (!adv.ok) {
            setError(
              `Plan preparation paused. Your completed work is saved. ${adv.error}`,
            );
            const reload = await loadBarrierWorkflowForFamilyAction(familyId);
            if (reload.ok) setResult(reload.result);
            router.refresh();
            break;
          }
          const reload = await loadBarrierWorkflowForFamilyAction(familyId);
          if (reload.ok) setResult(reload.result);
          router.refresh();
          if (adv.done) {
            if (tab === "overview") router.push(`/families/${familyId}/plan`);
            break;
          }
          await new Promise((res) => setTimeout(res, 250));
        }
      } finally {
        stagedPollRef.current = null;
      }
    })();
    stagedPollRef.current = promise;
    await promise;
  }, [familyId, router, tab]);

  useEffect(() => {
    setResult(initialResult);
  }, [initialResult]);

  /**
   * If the user landed or refreshed while a staged plan is still running, resume polling once.
   * Ref guard avoids re-starting on every parent revalidation while status stays "running".
   */
  useEffect(() => {
    if (planGenerationStatus !== "running") {
      resumePollStartedRef.current = false;
      return;
    }
    if (resumePollStartedRef.current) return;
    resumePollStartedRef.current = true;
    setLocalPlanGenerating(true);
    void (async () => {
      try {
        await runStagedPlanPolling();
      } finally {
        setLocalPlanGenerating(false);
        resumePollStartedRef.current = false;
      }
    })();
  }, [planGenerationStatus, runStagedPlanPolling]);

  useEffect(() => {
    if (!planGenerateBusy) {
      setGenerateStartedAt(null);
      setElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    setGenerateStartedAt(startedAt);
    setElapsedSeconds(0);
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [planGenerateBusy]);

  function toggleLabel(label: BarrierPresetLabel) {
    setSelected((prev) =>
      prev.includes(label) ? prev.filter((x) => x !== label) : [...prev, label],
    );
  }

  function addCustomBarrier(raw: string) {
    const text = raw.trim().slice(0, 200);
    if (!text) return;
    const privacy = validateNoPii([
      { field: "customBarrier", label: "Barrier", value: text },
    ]);
    if (!privacy.ok) {
      setError(privacy.error);
      return;
    }
    const key = text.toLowerCase();
    const matchingPreset = barrierOptions.find((o) => o.label.toLowerCase() === key);
    if (matchingPreset) {
      const label = matchingPreset.label as BarrierPresetLabel;
      setSelected((prev) => (prev.includes(label) ? prev : [...prev, label]));
      return;
    }
    if (selected.some((s) => s.toLowerCase() === key)) return;
    if (customBarriers.some((b) => b.text.toLowerCase() === key)) return;
    setCustomBarriers((prev) => [...prev, { id: crypto.randomUUID(), text }]);
  }

  function removeCustomBarrier(id: string) {
    setCustomBarriers((prev) => prev.filter((b) => b.id !== id));
  }

  function generate() {
    setError(null);
    const privacy = validateNoPii([
      { field: "name", label: "Family label", value: familyName, mode: "label" },
      { field: "additionalContext", label: "Additional context", value: additionalContext },
      ...customBarriers.map((barrier, index) => ({
        field: `customBarriers.${index}`,
        label: "Barrier",
        value: barrier.text,
      })),
    ]);
    if (!privacy.ok) {
      setError(privacy.error);
      return;
    }
    setLocalPlanGenerating(true);
    void (async () => {
      try {
        const r = await generateBarrierWorkflowForFamilyAction(familyId, {
          selectedBarriers: selected,
          additionalBarriers: customBarriers.map((b) => b.text).join("\n"),
          additionalDetails: additionalContext.trim(),
          aiMode: DEFAULT_AI_MODE,
        });
        if (!r.ok) {
          setError(r.error);
          router.refresh();
          return;
        }
        setResult(r.result);
        setHasGeneratedThisSession(true);

        if (r.stagedPolling) {
          await runStagedPlanPolling();
        } else {
          router.push(`/families/${familyId}/plan`);
        }
      } finally {
        setLocalPlanGenerating(false);
      }
    })();
  }

  function toggleAction(actionItemId: string, done: boolean, expectedUpdatedAt: string) {
    startTransition(async () => {
      const r = await toggleBarrierWorkflowActionItemAction(
        familyId,
        actionItemId,
        done,
        expectedUpdatedAt,
      );
      if (!r.ok) return setError(r.error);
      setResult(r.result);
      router.refresh();
    });
  }

  async function retryResources() {
    if (resourceRetrying) return;
    setResourceRetrying(true);
    setError(null);
    try {
      const match = await runResourceMatching({ familyId });
      if (!match.ok) {
        setError(match.error);
        return;
      }
      const reload = await loadBarrierWorkflowForFamilyAction(familyId);
      if (!reload.ok) {
        setError(reload.error);
        return;
      }
      setResult(reload.result);
      router.refresh();
    } finally {
      setResourceRetrying(false);
    }
  }

  async function continueDraft() {
    if (planGenerateBusy) return;
    setError(null);
    setLocalPlanGenerating(true);
    try {
      await runStagedPlanPolling();
    } finally {
      setLocalPlanGenerating(false);
    }
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

  return (
    <div
      className={cn(
        tab === "assistant"
          ? "flex min-h-0 flex-1 flex-col"
          : "mx-auto w-full max-w-6xl space-y-6 px-4 py-7 sm:px-6 lg:px-8 lg:py-10",
      )}
    >
      {tab !== "overview" && error ? (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {tab === "overview" ? (
        <div className="space-y-3">
          <FamilyOverviewSetupCanvas
            familyName={familyName}
            barrierOptions={barrierOptions}
            selectedSet={selectedSet}
            onToggleLabel={toggleLabel}
            customBarriers={customBarriers}
            onAddCustomBarrier={addCustomBarrier}
            onRemoveCustomBarrier={removeCustomBarrier}
            additionalContext={additionalContext}
            onAdditionalContextChange={setAdditionalContext}
            lastSavedAt={result?.lastSavedAt}
            error={error}
            generateBusy={planGenerateBusy}
            generateStartedAt={generateStartedAt}
            elapsedSeconds={elapsedSeconds}
            onGenerate={generate}
            hasGeneratedThisSession={hasGeneratedThisSession}
            formatElapsed={formatElapsed}
          />
          <div className="flex justify-end pt-1">
            <ArchiveFamilyFromListControl familyId={familyId} />
          </div>
        </div>
      ) : null}

      {tab === "plan" ? (
        <Card className="border-[var(--color-rule)] bg-[var(--color-surface)] p-5 [box-shadow:var(--shadow-surface)] sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-[var(--color-ink-muted)]">Intervention plan</p>
              <h1 className="workspace-display mt-1 text-2xl text-[var(--color-ink)]">{familyName}</h1>
            </div>
            {result?.lastSavedAt ? (
              <p className="text-xs text-[var(--color-ink-faint)]">
                Updated {new Date(result.lastSavedAt).toLocaleString()}
              </p>
            ) : null}
          </div>
        </Card>
      ) : null}

      {tab === "plan" && plan ? (
        <CaseProgressWorkspace
          key={`${plan.id}:${progressUpdates[0]?.id ?? plan.created_at}`}
          familyId={familyId}
          plan={plan}
          updates={progressUpdates}
          earlierNotes={caseNotes}
        />
      ) : null}

      {tab === "plan" && planGenerateBusy ? (
        <div
          className="rounded-xl border border-[var(--color-rule-strong)] bg-[var(--color-accent-soft)] px-4 py-3 text-sm text-[var(--color-ink)]"
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{generationStageLabel}…</p>
            <p className="text-xs text-[var(--color-ink-muted)]">{savedGenerationStages} of 3 stages safely saved</p>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-rule)]" aria-hidden>
            <div
              className="h-full origin-left rounded-full bg-[var(--color-positive)] transition-transform duration-500"
              style={{ transform: `scaleX(${savedGenerationStages / 3})` }}
            />
          </div>
          <p className="mt-2 text-xs leading-relaxed text-[var(--color-ink-muted)]">
            You can leave this page and return. Each completed pass is saved automatically.
          </p>
        </div>
      ) : null}

      {(result || plan) && tab === "plan" ? (
        <Card className="border-[var(--color-rule)] bg-[var(--color-surface)] p-5 [box-shadow:var(--shadow-surface)] sm:p-6">
          <FamilyPlanPanel
            familyId={familyId}
            plan={plan}
            workflow={result}
            onToggleActionItem={toggleAction}
            actionToggleDisabled={pending}
            onRetryResources={retryResources}
            resourceRetrying={resourceRetrying}
            onContinueDraft={continueDraft}
            continueDraftPending={planGenerateBusy}
          />
        </Card>
      ) : null}

      {result && tab === "resources" ? (
        <div className="space-y-4">
          <Card className="border-[var(--color-rule)] bg-gradient-to-b from-[var(--color-paper)] to-white p-5 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <CardTitle className="text-base">Resource matches</CardTitle>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
                  Options from your organization&apos;s resource directory matched to this family&apos;s barriers.
                </p>
              </div>
              <span className="rounded-full border border-[var(--color-rule)] bg-[var(--color-surface)] px-2.5 py-1 text-xs text-[var(--color-ink-muted)]">
                {result.resources.length} matches
              </span>
            </div>
          </Card>

          {result.resourceStatus === "unavailable" ? (
            <Card className="border-amber-200 bg-amber-50 p-5 sm:p-6">
              <p className="text-sm font-medium text-amber-950">Resource matching is unavailable.</p>
              <p className="mt-1 text-sm leading-relaxed text-amber-900">
                {result.resourceStatusMessage?.trim() ||
                  "The plan is saved, but the resource directory could not be checked."}
              </p>
              <Button
                type="button"
                variant="secondary"
                className="mt-4"
                onClick={retryResources}
                disabled={resourceRetrying}
              >
                {resourceRetrying ? "Trying again…" : "Retry resource matching"}
              </Button>
            </Card>
          ) : result.resources.length === 0 ? (
            <Card className="p-5 sm:p-6">
              <p className="text-sm text-[var(--color-ink-muted)]">
                No directory matches were found. Do not treat this as confirmation that no service exists.
              </p>
              <Button
                type="button"
                variant="secondary"
                className="mt-4"
                onClick={retryResources}
                disabled={resourceRetrying}
              >
                {resourceRetrying ? "Checking again…" : "Check resources again"}
              </Button>
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

      {tab === "assistant" ? (
        <CaseAssistantChat familyId={familyId} familyName={familyName} />
      ) : null}
    </div>
  );
}
