"use client";
import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from "react";

export function permissionWindowCurrent(expiresAt: number, startsAt = -Infinity): boolean {
  const now = Date.now();
  return Number.isFinite(expiresAt) && startsAt <= now && now < expiresAt;
}

/** Absolute permission times are external state; server rendering stays closed. */
export function usePermissionWindow(expiresAt: number, startsAt = -Infinity, onExpired?: () => void): boolean {
  const onExpiredRef = useRef(onExpired);
  useLayoutEffect(() => { onExpiredRef.current = onExpired; }, [onExpired]);
  const snapshot = useCallback(() => permissionWindowCurrent(expiresAt, startsAt), [expiresAt, startsAt]);
  const subscribe = useCallback((changed: () => void) => {
    let timer: ReturnType<typeof setTimeout> | undefined, notified = false;
    const check = () => {
      clearTimeout(timer);
      changed();
      const now = Date.now();
      if (Number.isFinite(expiresAt) && now >= expiresAt && !notified) { notified = true; onExpiredRef.current?.(); }
      const next = startsAt > now ? startsAt : expiresAt;
      if (Number.isFinite(next) && next > now) timer = setTimeout(check, Math.min(next - now, 2_147_483_647));
    };
    check();
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [expiresAt, startsAt]);
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
