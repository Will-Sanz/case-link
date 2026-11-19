"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { z } from "zod";
import type { SupportRequest } from "@/lib/parent/domain";
import { boundedParentApi, ParentApiError } from "./api";
import { applicationSaveConfirmed } from "./application-save-reconciliation";

type Snapshot<T> = NonNullable<Parameters<typeof applicationSaveConfirmed>[1]> & { id: string; details: T };
type Draft<T> = { value: T; version: number; snapshotId: string | null };
type Attempt = { key: string; body: string };
type Context<T> = {
  request: Pick<SupportRequest, "id" | "version" | "status" | "mandate" | "intake">;
  record: Snapshot<T> | null; current: boolean; available: boolean;
  savedMessage: string; onSaved: () => void; onAccessDenied: () => void;
};
const savedReply = z.object({ snapshotId: z.uuid() });

/** Programme callers supply validated snapshots and permission; this owns only the saved-draft lifecycle. */
export function useSavedApplicationDraft<T>({ request, record, current, available, savedMessage, onSaved, onAccessDenied }: Context<T>) {
  const [draft, setDraft] = useState<Draft<T> | null>(null), [attempt, setAttempt] = useState<Attempt | null>(null);
  const [error, setError] = useState<Error | null>(null), [message, setMessage] = useState("");
  const [blocked, setBlocked] = useState(false), [uncertain, setUncertain] = useState(false), [conflict, setConflict] = useState(false);
  const [pendingWork, setPendingWork] = useState<{ scope: string; controller: AbortController } | null>(null);
  const work = useRef<AbortController | null>(null), running = useRef<AbortController | null>(null);
  const recheck = useRef({ ready: current, refresh: onSaved });
  useLayoutEffect(() => { recheck.current = { ready: current, refresh: onSaved }; });
  const permitted = available && !blocked;
  const scope = JSON.stringify({ id: request.id, version: request.version, status: request.status, needs: request.intake.needs,
    mandate: request.mandate, record: record?.id, permitted });
  const [previousScope, setPreviousScope] = useState(scope);
  if (previousScope !== scope) {
    setPreviousScope(scope);
    if (attempt) setUncertain(true);
  }
  useLayoutEffect(() => {
    const controller = new AbortController(); work.current = controller;
    return () => { controller.abort(); if (work.current === controller) work.current = null; };
  }, [scope]);
  useEffect(() => {
    if (!attempt || !uncertain || conflict) return;
    const refresh = () => {
      if (document.visibilityState === "visible" && recheck.current.ready) recheck.current.refresh();
    };
    // Paused requests and slower progress polls must also reconcile lost replies using owned reads.
    let ticks = 0;
    const timer = setInterval(() => { refresh(); if (++ticks === 6) clearInterval(timer); }, 5000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [attempt, uncertain, conflict]);
  const pending = pendingWork?.scope === scope && !pendingWork.controller.signal.aborted;
  const editingCurrent = !!draft && current && draft.version === request.version && draft.snapshotId === (record?.id ?? null);
  function reset() {
    setDraft(null); setAttempt(null); setUncertain(false); setConflict(false); setError(null); setPendingWork(null); setMessage("");
  }
  if (current && applicationSaveConfirmed(attempt, record, request.id, request.version)) {
    reset(); setMessage(savedMessage);
  }
  function begin(value: T) {
    if (!current || !permitted || pending || draft || attempt) return;
    reset(); setDraft({ value: structuredClone(value), version: request.version, snapshotId: record?.id ?? null });
  }
  function change(value: T) {
    if (!draft || !editingCurrent || !permitted || pending || uncertain || conflict) return;
    setDraft({ ...draft, value }); setAttempt(null); setError(null); setMessage("");
  }
  async function checkAccess(check: (signal: AbortSignal) => Promise<void>) {
    const controller = work.current;
    if (!controller || controller.signal.aborted || running.current === controller) return;
    running.current = controller; setPendingWork({ scope, controller }); setError(null);
    try {
      await check(controller.signal);
      if (controller.signal.aborted || work.current !== controller) return;
      setBlocked(false);
    } catch (failure) {
      if (!controller.signal.aborted && work.current === controller) {
        setBlocked(true); setError(failure instanceof Error ? failure : new Error("Your editing access could not be checked. Your draft remains on this page."));
      }
    } finally {
      if (running.current === controller) running.current = null;
      if (!controller.signal.aborted && work.current === controller) setPendingWork(null);
    }
  }
  async function save(path: string, deadline: string, buildBody: (value: T, version: number, signal: AbortSignal) => unknown | Promise<unknown>) {
    const controller = work.current, expires = Date.parse(deadline);
    if (!draft || !editingCurrent || !permitted || conflict || pending || !Number.isFinite(expires) || Date.now() >= expires ||
      !controller || controller.signal.aborted || running.current === controller) return;
    running.current = controller; setPendingWork({ scope, controller }); setError(null); setMessage("");
    try {
      let exact = attempt;
      if (!exact) {
        const body = await buildBody(draft.value, draft.version, controller.signal);
        controller.signal.throwIfAborted();
        exact = { key: crypto.randomUUID(), body: JSON.stringify(body) };
        setAttempt(exact);
      }
      const result = await boundedParentApi(path, { method: "POST", headers: { "Idempotency-Key": exact.key }, body: exact.body }, controller.signal, deadline);
      if (controller.signal.aborted || work.current !== controller) return;
      if (!savedReply.safeParse(result).success) throw new ParentApiError("The saved revision is unconfirmed. Retry the same save before changing answers.", 0);
      reset(); setMessage(savedMessage); onSaved();
    } catch (failure) {
      if (controller.signal.aborted || work.current !== controller) return;
      setError(failure instanceof Error ? failure : new Error("Your answers could not be saved. Your draft remains on this page."));
      const status = failure instanceof ParentApiError ? failure.status : 0;
      const saveStillUnknown = uncertain || status < 400 || status >= 500 || status === 401 || status === 403;
      setUncertain(saveStillUnknown); setConflict(status === 409);
      if (status === 401 || status === 403) { setBlocked(true); onAccessDenied(); }
      if (!saveStillUnknown && status >= 400 && status < 500 && status !== 409) setAttempt(null);
    } finally {
      if (running.current === controller) running.current = null;
      if (!controller.signal.aborted && work.current === controller) setPendingWork(null);
    }
  }
  return { draft, error, message, blocked, uncertain, conflict, pending, permitted, editingCurrent, begin, change, reset, save, checkAccess, setMessage };
}
