"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  generateStepHelperAction,
  saveStepHelperOutputAction,
} from "@/app/actions/step-helper";
import type { PlanStepRow } from "@/types/family";
import type { StepHelperType } from "@/types/step-helper";

/** One-click AI help inline in the step workspace. No modal required. */
export function InlineStepAiHelp({
  step,
  familyId,
  isBlocked,
  stepHelperMenu,
}: {
  step: PlanStepRow;
  familyId: string;
  isBlocked?: boolean;
  stepHelperMenu: readonly { type: string; label: string }[];
}) {
  const router = useRouter();
  const [helperType, setHelperType] = useState<StepHelperType | null>(null);
  const [helperContent, setHelperContent] = useState<string | null>(null);
  const [helperList, setHelperList] = useState<string[] | null>(null);
  const [helperPending, setHelperPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const outputRef = useRef<HTMLDivElement | null>(null);

  const aiHelper = step.ai_helper_data;
  const options = stepHelperMenu.filter(
    (o) => o.type !== "troubleshoot_blocker" || isBlocked,
  );

  useEffect(() => {
    if ((helperContent || helperList) && outputRef.current) {
      outputRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [helperContent, helperList]);

  async function handleGenerate(type: StepHelperType) {
    setHelperType(type);
    setHelperPending(true);
    setHelperContent(null);
    setHelperList(null);
    setError(null);
    const r = await generateStepHelperAction(step.id, familyId, type);
    setHelperPending(false);
    if (r.ok) {
      setHelperContent(r.content);
      setHelperList(r.listContent ?? null);
    } else setError(r.error ?? "Something went wrong");
  }

  async function handleSave() {
    if (!helperType) return;
    setError(null);
    const val = helperList ?? (helperContent ?? "");
    const r = await saveStepHelperOutputAction(
      step.id,
      familyId,
      helperType,
      Array.isArray(val) ? val : val,
    );
    if (r.ok) router.refresh();
    else setError(r.error ?? "Save failed");
  }

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
      <h4 className="text-xs font-medium text-slate-600">
        AI help
      </h4>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {options.map(({ type, label }) => (
          <Button
            key={type}
            type="button"
            variant="secondary"
            className="h-7 px-2.5 text-xs"
            disabled={helperPending}
            onClick={() => handleGenerate(type as StepHelperType)}
          >
            {helperPending && helperType === type ? "…" : label}
          </Button>
        ))}
      </div>
      {error && (
        <p className="mt-2 text-xs text-red-700" role="alert">
          {error}
        </p>
      )}
      {helperContent && helperType && (
        <div ref={outputRef} className="mt-4 rounded-lg border-2 border-blue-300 bg-blue-50/50 p-3">
          <p className="text-xs font-medium text-blue-800">
            {helperType.replace(/_/g, " ")}
          </p>
          <div className="mt-3 text-sm text-slate-800">
            {helperList ? (
              <ul className="space-y-1">
                {helperList.map((item, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="shrink-0 text-blue-600">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="whitespace-pre-wrap leading-relaxed">
                {helperContent}
              </p>
            )}
          </div>
          <Button
            type="button"
            variant="secondary"
            className="mt-3 h-7 px-3 text-xs"
            onClick={handleSave}
          >
            Save to step
          </Button>
        </div>
      )}
      {(aiHelper?.call_script ||
        aiHelper?.email_draft ||
        aiHelper?.family_explanation ||
        aiHelper?.next_step_guidance ||
        (aiHelper?.prep_checklist ?? []).length > 0 ||
        (aiHelper?.fallback_options ?? []).length > 0) && (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-medium text-slate-500">
            Saved to step
          </p>
          <div className="space-y-1.5 text-xs">
            {aiHelper?.call_script && (
              <div className="rounded border border-slate-200 bg-slate-50/60 px-2 py-1.5">
                <span className="font-medium text-slate-600">Call script:</span>{" "}
                <span className="line-clamp-2 text-slate-700">
                  {aiHelper.call_script}
                </span>
              </div>
            )}
            {aiHelper?.email_draft && (
              <div className="rounded border border-slate-200 bg-slate-50/60 px-2 py-1.5">
                <span className="font-medium text-slate-600">Email:</span>{" "}
                <span className="line-clamp-2 text-slate-700">
                  {aiHelper.email_draft}
                </span>
              </div>
            )}
            {aiHelper?.prep_checklist && aiHelper.prep_checklist.length > 0 && (
              <div className="rounded border border-slate-200 bg-slate-50/60 px-2 py-1.5">
                <span className="font-medium text-slate-600">Prep:</span>{" "}
                {aiHelper.prep_checklist.length} items
              </div>
            )}
            {aiHelper?.fallback_options &&
              aiHelper.fallback_options.length > 0 && (
                <div className="rounded border border-slate-200 bg-slate-50/60 px-2 py-1.5">
                  <span className="font-medium text-slate-600">Fallbacks:</span>{" "}
                  {aiHelper.fallback_options.length} options
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  );
}
