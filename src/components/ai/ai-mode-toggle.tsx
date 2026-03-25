"use client";

import { cn } from "@/lib/utils/cn";
import { useAIMode } from "@/components/providers/ai-mode-provider";

/**
 * Segmented control for Fast vs Thinking AI preset. Tooltip via `title` for minimal UI noise.
 */
export function AiModeToggle({ className }: { className?: string }) {
  const { mode, setMode } = useAIMode();

  return (
    <div
      className={cn(
        "inline-flex rounded-lg border border-slate-200 bg-slate-50/90 p-0.5 text-[11px] font-medium shadow-sm",
        className,
      )}
      role="group"
      aria-label="AI generation mode"
    >
      <button
        type="button"
        onClick={() => setMode("fast")}
        title="Faster results, lower cost, concise output"
        className={cn(
          "rounded-md px-2.5 py-1 transition-colors",
          mode === "fast"
            ? "bg-white text-slate-900 shadow-sm"
            : "text-slate-600 hover:text-slate-900",
        )}
      >
        Fast
      </button>
      <button
        type="button"
        onClick={() => setMode("thinking")}
        title="Deeper reasoning, richer detail, slower and higher cost"
        className={cn(
          "rounded-md px-2.5 py-1 transition-colors",
          mode === "thinking"
            ? "bg-white text-slate-900 shadow-sm"
            : "text-slate-600 hover:text-slate-900",
        )}
      >
        Thinking
      </button>
    </div>
  );
}
