"use client";

import { cn } from "@/lib/utils/cn";
import { useAIMode } from "@/components/providers/ai-mode-provider";

type AiModeToggleProps = {
  className?: string;
  /** Smaller, softer chrome for embedding in chat composers and dense toolbars. */
  compact?: boolean;
};

/**
 * Segmented control for Fast vs Thinking AI preset. Tooltip via `title` for minimal UI noise.
 */
export function AiModeToggle({ className, compact }: AiModeToggleProps) {
  const { mode, setMode } = useAIMode();

  return (
    <div
      className={cn(
        "inline-flex rounded-lg p-0.5 font-medium",
        compact
          ? "gap-0 rounded-xl border-0 bg-slate-100/90 text-[10px] text-slate-600"
          : "rounded-lg border border-slate-200 bg-slate-50/90 text-[11px] shadow-sm",
        className,
      )}
      role="group"
      aria-label="AI generation mode"
    >
      <button
        type="button"
        onClick={() => setMode("fast")}
        title="Fast: quicker results"
        className={cn(
          "transition-colors",
          compact ? "rounded-lg px-2 py-1" : "rounded-md px-2.5 py-1",
          mode === "fast"
            ? compact
              ? "bg-white font-semibold text-slate-900 shadow-sm"
              : "bg-white text-slate-900 shadow-sm"
            : compact
              ? "text-slate-500 hover:text-slate-800"
              : "text-slate-600 hover:text-slate-900",
        )}
      >
        Fast
      </button>
      <button
        type="button"
        onClick={() => setMode("thinking")}
        title="Thinking: more detailed analysis"
        className={cn(
          "transition-colors",
          compact ? "rounded-lg px-2 py-1" : "rounded-md px-2.5 py-1",
          mode === "thinking"
            ? compact
              ? "bg-white font-semibold text-slate-900 shadow-sm"
              : "bg-white text-slate-900 shadow-sm"
            : compact
              ? "text-slate-500 hover:text-slate-800"
              : "text-slate-600 hover:text-slate-900",
        )}
      >
        Thinking
      </button>
    </div>
  );
}
