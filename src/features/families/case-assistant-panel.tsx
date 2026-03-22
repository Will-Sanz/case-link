"use client";

import { useState, useTransition } from "react";
import ReactMarkdown from "react-markdown";
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
    <div className="rounded-lg border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors duration-150 hover:bg-slate-50"
      >
        <div className="flex items-center gap-2">
          <span
            className="flex size-8 items-center justify-center rounded-lg bg-blue-100 text-blue-700"
            aria-hidden
          >
            ◉
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900">
              Case Assistant
            </p>
            <p className="text-xs text-slate-500">
              Ask for more help
            </p>
          </div>
        </div>
        <span
          className={cn(
            "text-slate-400 transition-transform duration-200",
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
            <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50/40 p-3">
              <p className="text-xs font-medium text-blue-800">
                Answer
              </p>
              <div className="mt-2 text-sm text-slate-800">
                <ReactMarkdown
                  components={{
                    p: ({ children }) => <p className="leading-relaxed">{children}</p>,
                    ul: ({ children }) => <ul className="list-disc pl-5 space-y-0.5">{children}</ul>,
                    ol: ({ children }) => <ol className="list-decimal pl-5 space-y-0.5">{children}</ol>,
                    li: ({ children }) => <li>{children}</li>,
                    strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
                    h1: ({ children }) => <h3 className="mt-3 mb-1 font-semibold text-slate-900">{children}</h3>,
                    h2: ({ children }) => <h4 className="mt-3 mb-1 font-semibold text-slate-800">{children}</h4>,
                    h3: ({ children }) => <h4 className="mt-2 mb-1 font-medium text-slate-800">{children}</h4>,
                  }}
                >
                  {answer}
                </ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
