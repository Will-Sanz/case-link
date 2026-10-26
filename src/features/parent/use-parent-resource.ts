"use client";
import { useCallback, useEffect, useState } from "react";
import { ParentApiError, parentApi } from "./api";

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
          setResult((current) => ({
            path,
            data:
              current?.path === path &&
              error instanceof ParentApiError &&
              [0, 500, 502, 504].includes(error.status)
                ? current.data
                : null,
            error:
              error instanceof Error ? error : new Error("Please try again."),
          }));
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
