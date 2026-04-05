"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import { askCaseAssistantAction } from "@/app/actions/case-assistant";
import type { CaseAssistantHistoryItem } from "@/types/case-assistant";
import { Button } from "@/components/ui/button";
import { DEFAULT_AI_MODE } from "@/lib/ai/ai-mode";
import { cn } from "@/lib/utils/cn";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

const STARTER_PROMPTS = [
  "What should I prioritize this week?",
  "Draft outreach talking points for the top resource.",
  "What could block this plan and how should I prepare?",
  "How should I sequence the next three plan steps?",
  "What risks should I surface in supervision?",
];

const FOLLOW_UP_CHIPS = [
  "Go deeper on concrete next actions",
  "Suggest a short call script for the first resource",
  "What documents should I gather before outreach?",
];

function newId() {
  return crypto.randomUUID();
}

function AssistantMarkdown({ content }: { content: string }) {
  return (
    <div
      className={cn(
        "assistant-md text-[15px] leading-relaxed text-slate-800",
        "[&_a]:font-medium [&_a]:text-slate-900 [&_a]:underline decoration-slate-300 underline-offset-2",
        "[&_code]:rounded [&_code]:bg-slate-100/90 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px]",
        "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-slate-200/80 [&_pre]:bg-slate-50/90 [&_pre]:p-3 [&_pre]:text-[13px]",
        "[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3 [&_blockquote]:text-slate-600",
      )}
    >
      <ReactMarkdown
        components={{
          p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
          ul: ({ children }) => (
            <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-3 list-decimal space-y-1.5 pl-5 last:mb-0">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => (
            <strong className="font-semibold text-slate-900">{children}</strong>
          ),
          h1: ({ children }) => (
            <h3 className="mb-2 mt-4 text-base font-semibold tracking-tight text-slate-900 first:mt-0">
              {children}
            </h3>
          ),
          h2: ({ children }) => (
            <h3 className="mb-2 mt-4 text-base font-semibold tracking-tight text-slate-900 first:mt-0">
              {children}
            </h3>
          ),
          h3: ({ children }) => (
            <h4 className="mb-1.5 mt-3 text-sm font-semibold text-slate-900 first:mt-0">
              {children}
            </h4>
          ),
          a: ({ href, children }) => {
            const safe =
              typeof href === "string" &&
              (href.startsWith("https://") || href.startsWith("http://") || href.startsWith("mailto:"));
            if (!safe) {
              return <span className="text-slate-800">{children}</span>;
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1.5 px-1 py-2" aria-live="polite" aria-label="Assistant is responding">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:0ms]" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:150ms]" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:300ms]" />
    </div>
  );
}

export function CaseAssistantChat({
  familyId,
  familyName,
}: {
  familyId: string;
  familyName: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  function historyForApi(beforeUserMessage: ChatMessage[]): CaseAssistantHistoryItem[] {
    return beforeUserMessage.map((m) => ({
      role: m.role,
      content: m.content,
    }));
  }

  function submitFromInput() {
    const q = draft.trim();
    if (!q) {
      setError("Add a message to send.");
      return;
    }
    if (pending) return;
    setError(null);
    const userMsg: ChatMessage = { id: newId(), role: "user", content: q };
    const prior = historyForApi(messages);

    setMessages((prev) => [...prev, userMsg]);
    setDraft("");

    startTransition(async () => {
      const r = await askCaseAssistantAction(familyId, q, DEFAULT_AI_MODE, prior);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setMessages((prev) => [...prev, { id: newId(), role: "assistant", content: r.answer }]);
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitFromInput();
    }
  }

  function applySuggestion(text: string) {
    setDraft(text);
    setError(null);
    textareaRef.current?.focus();
  }

  function clearChat() {
    setMessages([]);
    setDraft("");
    setError(null);
  }

  const empty = messages.length === 0 && !pending;
  const showFollowUps =
    messages.length > 0 && messages[messages.length - 1]?.role === "assistant" && !pending;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-gradient-to-b from-slate-50/95 via-white to-white shadow-[0_1px_0_rgba(15,23,42,0.04)] ring-1 ring-slate-900/[0.06]">
      <header className="shrink-0 border-b border-slate-200/60 px-5 py-4 sm:px-6">
        <div className="mx-auto flex max-w-2xl flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">Case assistant</h2>
            <p className="mt-0.5 text-sm text-slate-600">
              <span className="font-medium text-slate-700">{familyName}</span>
              <span className="text-slate-400"> · </span>
              Grounded in this family&apos;s plan, barriers, and matched resources.
            </p>
          </div>
          {!empty ? (
            <button
              type="button"
              onClick={clearChat}
              className="shrink-0 text-xs font-medium text-slate-500 transition-colors hover:text-slate-800"
            >
              New conversation
            </button>
          ) : null}
        </div>
      </header>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6"
      >
        <div className="mx-auto max-w-2xl">
          {empty ? (
            <div className="flex flex-col items-center justify-center px-2 pt-4 text-center sm:pt-10">
              <div
                className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-sm font-semibold text-slate-500"
                aria-hidden
              >
                AI
              </div>
              <p className="max-w-md text-base leading-relaxed text-slate-700">
                Ask for guidance on execution, sequencing, risks, barriers, resources, or outreach,
                using this case&apos;s live context.
              </p>
              <p className="mt-6 text-[11px] font-medium uppercase tracking-wider text-slate-400">
                Suggested prompts
              </p>
              <div className="mt-3 flex w-full max-w-lg flex-wrap justify-center gap-2">
                {STARTER_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => applySuggestion(prompt)}
                    className="max-w-full rounded-xl border border-slate-200/90 bg-white/90 px-3.5 py-2.5 text-left text-[13px] leading-snug text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50/90"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {messages.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[min(100%,28rem)] rounded-2xl rounded-br-md bg-slate-900 px-4 py-3 text-[15px] leading-relaxed text-white">
                      <p className="whitespace-pre-wrap">{m.content}</p>
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className="flex justify-start">
                    <div className="max-w-[min(100%,36rem)]">
                      <AssistantMarkdown content={m.content} />
                    </div>
                  </div>
                ),
              )}
              {pending ? (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-bl-md bg-slate-100/80 px-4 py-2">
                    <TypingIndicator />
                  </div>
                </div>
              ) : null}
              {showFollowUps ? (
                <div className="border-t border-slate-200/60 pt-4">
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-slate-400">
                    Continue with
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {FOLLOW_UP_CHIPS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => applySuggestion(c)}
                        className="rounded-full border border-slate-200/90 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <div className="sticky bottom-0 z-20 shrink-0 border-t border-slate-200/70 bg-white/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md supports-[backdrop-filter]:bg-white/80 sm:px-6">
        <div className="mx-auto max-w-2xl">
          {error ? (
            <p
              className="mb-3 rounded-xl border border-red-200/90 bg-red-50/90 px-3 py-2 text-sm text-red-900"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          <div className="rounded-2xl border border-slate-200/90 bg-slate-50/50 p-1.5 shadow-inner">
            <textarea
              ref={textareaRef}
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={pending}
              placeholder="Message the assistant…"
              className="max-h-40 min-h-[3rem] w-full resize-y border-0 bg-transparent px-3 py-2.5 text-[15px] leading-relaxed text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0 disabled:opacity-60"
            />
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200/60 px-2 py-2">
              <span className="mr-auto hidden text-[10px] text-slate-400 sm:inline">
                Enter to send · Shift+Enter new line
              </span>
              <Button
                type="button"
                className="h-9 rounded-xl px-4 text-sm font-medium"
                onClick={submitFromInput}
                disabled={pending || !draft.trim()}
              >
                {pending ? "Sending…" : "Send"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
