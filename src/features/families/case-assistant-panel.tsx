"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { askCaseAssistantAction } from "@/app/actions/case-assistant";
import { CASE_QUICK_PROMPTS } from "@/lib/case-assistant/quick-prompts";
import { cn } from "@/lib/utils/cn";

export function CaseAssistantPanel({
  familyId,
  familyName,
}: {
  familyId: string;
  familyName: string;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [isOpen, setIsOpen] = useState(false);

  function ask(q: string) {
    if (!q.trim()) return;
    setError(null);
    setAnswer(null);
    setQuestion(q);
    startTransition(async () => {
      const r = await askCaseAssistantAction(familyId, q);
      if (r.ok) setAnswer(r.answer);
      else setError(r.error);
    });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-slate-50"
      >
        <div className="flex items-center gap-2">
          <span
            className="flex size-8 items-center justify-center rounded-lg bg-teal-100 text-teal-700"
            aria-hidden
          >
            ◉
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900">
              Case Assistant
            </p>
            <p className="text-xs text-slate-500">
              AI help for {familyName}
            </p>
          </div>
        </div>
        <span
          className={cn(
            "text-slate-400 transition-transform",
            isOpen && "rotate-180",
          )}
        >
          ▼
        </span>
      </button>

      {isOpen && (
        <div className="border-t border-slate-100 px-4 py-4">
          <p className="text-xs text-slate-500">
            Ask about this case. The assistant knows the family, plan, and resources.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {CASE_QUICK_PROMPTS.map((prompt, i) => (
              <Button
                key={i}
                type="button"
                variant="secondary"
                className="px-3 py-1.5 text-xs"
                disabled={pending}
                onClick={() => ask(prompt)}
              >
                {prompt.length > 45 ? `${prompt.slice(0, 42)}…` : prompt}
              </Button>
            ))}
          </div>
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              ask(question);
            }}
          >
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask anything about this case…"
              className="flex-1"
              disabled={pending}
            />
            <Button type="submit" disabled={pending || !question.trim()}>
              {pending ? "Thinking…" : "Ask"}
            </Button>
          </form>
          {error && (
            <p className="mt-3 text-sm text-red-700" role="alert">
              {error}
            </p>
          )}
          {answer && (
            <div className="mt-4 rounded-lg border border-teal-100 bg-teal-50/40 p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-teal-800">
                Answer
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">
                {answer}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
