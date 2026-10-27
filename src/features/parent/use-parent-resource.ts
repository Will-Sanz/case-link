"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ParentApiError, parentApi } from "./api";

type Result<T> = { path: string; data: T | null; error: Error | null };

export function useParentResource<T>(path: string) {
  const [result, setResult] = useState<Result<T> | null>(null);
  const [revision, setRevision] = useState(0);
  const pending = useRef(false);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  const reloadIfIdle = useCallback(() => {
    if (pending.current) return;
    pending.current = true;
    reload();
  }, [reload]);
  useEffect(() => {
    const controller = new AbortController();
    pending.current = true;
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
      })
      .finally(() => {
        if (!controller.signal.aborted) pending.current = false;
      });
    return () => {
      controller.abort();
      pending.current = false;
    };
  }, [path, revision]);
  const current = result?.path === path ? result : null;
  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    loading: !current,
    reload,
    reloadIfIdle,
  };
}
