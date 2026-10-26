"use client";
import { useCallback, useEffect, useState } from "react";
import { parentApi } from "./api";

type Result<T> = { path: string; data: T | null; error: Error | null };

export function useParentResource<T>(path: string) {
  const [result, setResult] = useState<Result<T> | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    parentApi<T>(path, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setResult({ path, data, error: null });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setResult({
            path,
            data: null,
            error:
              error instanceof Error ? error : new Error("Please try again."),
          });
      });
    return () => controller.abort();
  }, [path, revision]);
  const current = result?.path === path ? result : null;
  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    loading: !current,
    reload,
  };
}
