"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  AI_MODE_STORAGE_KEY,
  DEFAULT_AI_MODE,
  parseAiMode,
  type AiMode,
} from "@/lib/ai/ai-mode";

const MODE_CHANGE_EVENT = "planning-companion-ai-mode-change";

function readStoredMode(): AiMode {
  try {
    return parseAiMode(localStorage.getItem(AI_MODE_STORAGE_KEY));
  } catch {
    return DEFAULT_AI_MODE;
  }
}

function subscribe(onStoreChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === AI_MODE_STORAGE_KEY || e.key === null) onStoreChange();
  };
  const onLocal = () => onStoreChange();
  window.addEventListener("storage", onStorage);
  window.addEventListener(MODE_CHANGE_EVENT, onLocal);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(MODE_CHANGE_EVENT, onLocal);
  };
}

function getServerSnapshot(): AiMode {
  return DEFAULT_AI_MODE;
}

type AiModeContextValue = {
  mode: AiMode;
  setMode: (m: AiMode) => void;
};

const AiModeContext = createContext<AiModeContextValue | null>(null);

export function AiModeProvider({ children }: { children: ReactNode }) {
  const mode = useSyncExternalStore(
    subscribe,
    readStoredMode,
    getServerSnapshot,
  );

  const setMode = useCallback((m: AiMode) => {
    try {
      localStorage.setItem(AI_MODE_STORAGE_KEY, m);
      window.dispatchEvent(new Event(MODE_CHANGE_EVENT));
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);

  return <AiModeContext.Provider value={value}>{children}</AiModeContext.Provider>;
}

export function useAIMode(): AiModeContextValue {
  const ctx = useContext(AiModeContext);
  if (!ctx) {
    throw new Error("useAIMode must be used within AiModeProvider");
  }
  return ctx;
}
