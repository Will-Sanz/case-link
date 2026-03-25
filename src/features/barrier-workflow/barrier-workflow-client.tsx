"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_AI_MODE } from "@/lib/ai/ai-mode";
import { checkboxClass } from "@/lib/ui/form-classes";
import { advanceStagedLeanPlanGeneration } from "@/app/actions/plans";
import {
  generateBarrierWorkflowAction,
  listRecentBarrierPlanRecordsAction,
  loadBarrierWorkflowByReferenceAction,
  toggleBarrierWorkflowActionItemAction,
} from "@/app/actions/barrier-workflow";
import type {
  BarrierPresetLabel,
  BarrierWorkflowRecentRecord,
  BarrierWorkflowResult,
} from "@/types/barrier-workflow";

type PresetOption = { key: string; label: string };

export function BarrierWorkflowClient({
  barrierOptions,
}: {
  barrierOptions: readonly PresetOption[];
}) {
  const [selected, setSelected] = useState<BarrierPresetLabel[]>([]);
  const [referenceId, setReferenceId] = useState("");
  const [additionalBarriers, setAdditionalBarriers] = useState("");
  const [additionalDetails, setAdditionalDetails] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BarrierWorkflowResult | null>(null);
  const [recentRecords, setRecentRecords] = useState<BarrierWorkflowRecentRecord[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  useEffect(() => {
    let mounted = true;
    listRecentBarrierPlanRecordsAction().then((res) => {
      if (!mounted || !res.ok) return;
      setRecentRecords(res.records);
    });
    return () => {
      mounted = false;
    };
  }, []);

  function loadByReference() {
    const ref = referenceId.trim();
    if (!ref) {
      setError("Enter a Family/Case ID to reopen.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await loadBarrierWorkflowByReferenceAction(ref);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setResult(r.result);
      setSelected(
        r.result.selectedBarriers.filter((s): s is BarrierPresetLabel =>
          barrierOptions.some((o) => o.label === s),
        ),
      );
      setAdditionalDetails(r.result.additionalDetails);
      setAdditionalBarriers(r.result.additionalBarriers);
      setReferenceId(r.result.referenceId);
      const recents = await listRecentBarrierPlanRecordsAction();
      if (recents.ok) setRecentRecords(recents.records);
    });
  }

  function toggleLabel(label: BarrierPresetLabel) {
    setSelected((prev) =>
      prev.includes(label) ? prev.filter((x) => x !== label) : [...prev, label],
    );
  }

  function handleGenerate() {
    setError(null);
    startTransition(async () => {
      const r = await generateBarrierWorkflowAction({
        referenceId,
        selectedBarriers: selected,
        additionalBarriers,
        additionalDetails,
        aiMode: DEFAULT_AI_MODE,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setResult(r.result);
      const recents = await listRecentBarrierPlanRecordsAction();
      if (recents.ok) setRecentRecords(recents.records);

      if (r.ok && r.stagedPolling && r.result) {
        const ref = r.result.referenceId;
        const fid = r.result.familyId;
        void (async () => {
          for (let i = 0; i < 40; i++) {
            const adv = await advanceStagedLeanPlanGeneration({
              familyId: fid,
              aiMode: DEFAULT_AI_MODE,
            });
            if (!adv.ok) break;
            const reload = await loadBarrierWorkflowByReferenceAction(ref);
            if (reload.ok) setResult(reload.result);
            if (adv.done) break;
            await new Promise((res) => setTimeout(res, 1600));
          }
          const again = await listRecentBarrierPlanRecordsAction();
          if (again.ok) setRecentRecords(again.records);
        })();
      }
    });
  }

  function handleToggleActionItem(actionItemId: string, completed: boolean) {
    if (!result) return;
    setError(null);
    startTransition(async () => {
      const r = await toggleBarrierWorkflowActionItemAction(
        result.familyId,
        actionItemId,
        completed,
      );
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setResult(r.result);
      const recents = await listRecentBarrierPlanRecordsAction();
      if (recents.ok) setRecentRecords(recents.records);
    });
  }

  async function copyText(key: string, text: string | null) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((v) => (v === key ? null : v)), 1600);
    } catch {
      setError("Could not copy to clipboard.");
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 lg:px-8">
      <Card className="p-6 sm:p-7">
        <h1 className="text-2xl font-semibold text-slate-900 sm:text-3xl">
          Barrier-based plan builder
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
          Select barriers, add any extra barriers, then optional case details to generate a
          focused 30 / 60 / 90 day plan with Philadelphia resource matches.
        </p>

        <div className="mt-5 grid gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div>
            <Label htmlFor="reference-id">Family / Case ID</Label>
            <Input
              id="reference-id"
              className="mt-1.5"
              placeholder="e.g. FAM-1024"
              value={referenceId}
              onChange={(e) => setReferenceId(e.target.value)}
            />
          </div>
          <Button type="button" variant="secondary" disabled={pending} onClick={loadByReference}>
            Open by ID
          </Button>
          <p className="text-xs text-slate-500 sm:pb-2">Use this ID to save and revisit later.</p>
        </div>

        <div className="mt-5">
          <Label>Choose barriers</Label>
          <div className="mt-2 flex flex-wrap gap-2">
            {barrierOptions.map((opt) => {
              const on = selectedSet.has(opt.label as BarrierPresetLabel);
              return (
                <button
                  key={`${opt.key}-${opt.label}`}
                  type="button"
                  onClick={() => toggleLabel(opt.label as BarrierPresetLabel)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                    on
                      ? "border-blue-600 bg-blue-50 text-blue-900"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-5">
          <Label htmlFor="additional-barriers">Additional barriers</Label>
          <Textarea
            id="additional-barriers"
            className="mt-2 min-h-[110px]"
            placeholder="Add custom barriers (comma, semicolon, or new line separated)."
            value={additionalBarriers}
            onChange={(e) => setAdditionalBarriers(e.target.value)}
          />
        </div>

        <div className="mt-5">
          <Label htmlFor="additional-details">Additional details</Label>
          <Textarea
            id="additional-details"
            className="mt-2 min-h-[110px]"
            placeholder="Optional: add context about urgency, constraints, or specifics."
            value={additionalDetails}
            onChange={(e) => setAdditionalDetails(e.target.value)}
          />
        </div>

        {error ? (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}

        <div className="mt-5">
          <Button
            type="button"
            className="px-5 py-2.5"
            disabled={pending}
            onClick={handleGenerate}
          >
            {pending ? "Generating..." : "Generate and save"}
          </Button>
        </div>

        {recentRecords.length > 0 ? (
          <div className="mt-5 border-t border-slate-200 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Recent saved IDs
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {recentRecords.map((r) => (
                <button
                  key={`${r.referenceId}-${r.updatedAt}`}
                  type="button"
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                  onClick={() => {
                    setReferenceId(r.referenceId);
                    setError(null);
                    startTransition(async () => {
                      const loaded = await loadBarrierWorkflowByReferenceAction(r.referenceId);
                      if (!loaded.ok) return setError(loaded.error);
                      setResult(loaded.result);
                      setSelected(
                        loaded.result.selectedBarriers.filter((s): s is BarrierPresetLabel =>
                          barrierOptions.some((o) => o.label === s),
                        ),
                      );
                      setAdditionalDetails(loaded.result.additionalDetails);
                    });
                  }}
                >
                  {r.referenceId}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </Card>

      {result ? (
        <div className="grid gap-6 lg:grid-cols-[1.65fr_1fr]">
          <Card className="p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">30 / 60 / 90 day plan</CardTitle>
              <div className="flex items-center gap-3 text-xs text-slate-500">
                <span>ID: {result.referenceId}</span>
                {result.lastSavedAt ? (
                  <span>Saved {new Date(result.lastSavedAt).toLocaleString()}</span>
                ) : null}
              </div>
            </div>
            <div className="mt-4 space-y-5">
              {result.sections.map((section) => (
                <div key={section.phase} className="rounded-lg border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">
                      {section.phase}-day section
                    </h3>
                    <p className="text-xs text-slate-500">
                      Due window: {section.dueRangeLabel}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">{section.summary}</p>
                  {section.steps.length === 0 ? (
                    <p className="mt-3 text-sm text-slate-500">
                      No steps generated for this section.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {section.steps.map((step) => (
                        <div key={step.id} className="rounded-lg border border-slate-200 bg-white p-3">
                          <p className="text-sm font-semibold text-slate-900">{step.title}</p>
                          <p className="mt-1 text-sm text-slate-700 line-clamp-3">{step.description}</p>

                          {step.checklist.length > 0 ? (
                            <ul className="mt-2 space-y-1">
                              {step.checklist.slice(0, 4).map((c, idx) => (
                                <li key={`${step.id}-chk-${idx}`} className="text-xs text-slate-600">
                                  • {c}
                                </li>
                              ))}
                            </ul>
                          ) : null}

                          {step.actionItems.length > 0 ? (
                            <ul className="mt-3 space-y-2">
                              {step.actionItems.map((item) => {
                                const checked = item.status === "completed";
                                return (
                                  <li key={item.id} className="rounded border border-slate-200 bg-white p-2">
                                    <label className="flex items-start gap-2">
                                      <input
                                        type="checkbox"
                                        className={`${checkboxClass} mt-0.5`}
                                        checked={checked}
                                        onChange={(e) =>
                                          handleToggleActionItem(item.id, e.target.checked)
                                        }
                                        disabled={pending}
                                      />
                                      <span className="min-w-0">
                                        <span className="block text-sm font-medium text-slate-800">
                                          {item.title}
                                        </span>
                                        {item.description ? (
                                          <span className="block text-xs text-slate-600">
                                            {item.description}
                                          </span>
                                        ) : null}
                                      </span>
                                    </label>
                                  </li>
                                );
                              })}
                            </ul>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5 sm:p-6">
            <CardTitle className="text-base">Philadelphia nonprofit resources</CardTitle>
            {result.resources.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">
                No close matches yet. Try adding a little more barrier detail and regenerate.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                {result.resources.map((resource) => (
                  <div key={resource.id} className="rounded-lg border border-slate-200 p-3">
                    <p className="text-sm font-semibold text-slate-900">{resource.name}</p>
                    {resource.programName && resource.programName !== resource.name ? (
                      <p className="text-xs text-slate-500">{resource.programName}</p>
                    ) : null}
                    {resource.description ? (
                      <p className="mt-1 text-xs text-slate-600">{resource.description}</p>
                    ) : null}
                    <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-700">
                      {resource.contactName ? (
                        <p>
                          Contact: {resource.contactName}
                          {resource.contactTitle ? ` (${resource.contactTitle})` : ""}
                        </p>
                      ) : null}
                      {resource.primaryPhone ? <p>Phone: {resource.primaryPhone}</p> : null}
                      {resource.secondaryPhone ? <p>Alt phone: {resource.secondaryPhone}</p> : null}
                      {resource.primaryEmail ? <p>Email: {resource.primaryEmail}</p> : null}
                      {resource.secondaryEmail ? <p>Alt email: {resource.secondaryEmail}</p> : null}
                      {resource.website ? <p>Website: {resource.website}</p> : null}
                      {resource.address ? <p>Address: {resource.address}</p> : null}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      {resource.primaryEmail ? (
                        <button
                          type="button"
                          className="rounded border border-slate-200 bg-white px-2 py-1 hover:bg-slate-50"
                          onClick={() => copyText(`email-${resource.id}`, resource.primaryEmail)}
                        >
                          {copied === `email-${resource.id}` ? "Copied email" : "Copy email"}
                        </button>
                      ) : null}
                      {resource.primaryPhone ? (
                        <button
                          type="button"
                          className="rounded border border-slate-200 bg-white px-2 py-1 hover:bg-slate-50"
                          onClick={() => copyText(`phone-${resource.id}`, resource.primaryPhone)}
                        >
                          {copied === `phone-${resource.id}` ? "Copied phone" : "Copy phone"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="rounded border border-slate-200 bg-white px-2 py-1 hover:bg-slate-50"
                        onClick={() =>
                          copyText(
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
                        {copied === `all-${resource.id}` ? "Copied contact" : "Copy all contact info"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
