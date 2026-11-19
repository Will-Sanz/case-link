"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SupportRequest } from "@/lib/parent/domain";
import { supportUpdateReceiptSchema, type SupportUpdate, type SupportUpdateReceipt } from "@/lib/parent/support-update";
import { parentApi, ParentApiError } from "./api";

type Context = { request: SupportRequest; update: { ownerId: string; receipt: SupportUpdateReceipt | null; expiresAt?: string | null; issuedAt?: string | null } };
type Attempt = { key: string; body: string; value: SupportUpdate; ownerId: string; expiresAt: string; verifiedId?: string };
type Phase = "idle" | "pending" | "checking" | "reviewing" | "reviewing_access" | "access_lost" | "unknown" | "conflict";
const unknownMessage = "We couldn’t confirm this save. Your accepted changes are kept here. Check the saved result before changing them.";

/** One exact accepted edit, using the existing request route and its owned receipt. */
function currentReadDenied(cause: unknown) { return cause instanceof ParentApiError && [401, 403, 404].includes(cause.status); }
export function useSupportUpdate(requestId: string, onSaved: (request: SupportRequest, superseded: boolean) => void, onAccessLost?: () => void) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  // A completed read reschedules the bounded check even when React batches phase changes.
  const [readCycle, setReadCycle] = useState(0);
  const [stateScope, setStateScope] = useState(requestId);
  if (stateScope !== requestId) { setStateScope(requestId); setPhase("idle"); setError(""); }
  const scope = useRef({ id: requestId, generation: 0 });
  const automaticChecks = useRef(0);
  const attempt = useRef<Attempt | null>(null), running = useRef(false), controller = useRef<AbortController | null>(null);
  const savedCallback = useRef(onSaved), accessCallback = useRef(onAccessLost);
  useLayoutEffect(() => { savedCallback.current = onSaved; accessCallback.current = onAccessLost; }, [onSaved, onAccessLost]);
  useLayoutEffect(() => {
    const ownedScope = scope.current; ownedScope.id = requestId;
    attempt.current = null; running.current = false;
    return () => { ownedScope.generation++; controller.current?.abort(); };
  }, [requestId]);

  const execute = useCallback(async (build?: (expiresAt: string) => SupportUpdate, resend = false) => {
    if (running.current) return;
    running.current = true;
    const generation = scope.current.generation;
    const abort = new AbortController(); controller.current = abort;
    const live = () => !abort.signal.aborted && scope.current.id === requestId && scope.current.generation === generation;
    const timer = setTimeout(() => abort.abort(), 30_000);
    setPhase(attempt.current ? "checking" : "pending"); setError("");
    let ownedAccessLost = false;
    try {
      let accepted = attempt.current;
      const firstWrite = !accepted;
      const key = accepted?.key ?? crypto.randomUUID();
      const read = async () => {
        const context = await parentApi<Context>(`/requests/${requestId}?updateKey=${key}`, { signal: abort.signal }).catch(cause => { ownedAccessLost = currentReadDenied(cause); throw cause; });
        if (!live()) return null;
        if (!context.request || context.request.id !== requestId || !context.update?.ownerId) throw new Error(unknownMessage);
        if (accepted && context.update.ownerId !== accepted.ownerId) {
          ownedAccessLost = true; throw new ParentApiError("This support request is unavailable, or its permission has changed.", 403);
        }
        return context;
      };
      let context = await read();
      if (!context) return;
      if (!accepted) {
        if (!build || !context.update.expiresAt || !context.update.issuedAt) throw new Error("Authorization timing is temporarily unavailable.");
        const value = build(context.update.expiresAt);
        accepted = { key, body: JSON.stringify(value), value, ownerId: context.update.ownerId, expiresAt: context.update.expiresAt };
        attempt.current = accepted; automaticChecks.current = 0;
        resend = true;
      }
      const receipt = context.update.receipt;
      if (receipt && (receipt.key !== key || receipt.requestId !== requestId || receipt.action !== accepted.value.action || receipt.baseVersion !== accepted.value.version))
        throw new ParentApiError("This request changed. Review the latest saved information.", 409);
      // A metadata read alone cannot certify the full accepted body. A discovered
      // receipt is verified by the exact POST; that RPC acknowledges without a write.
      if ((receipt && accepted.verifiedId !== receipt.id) || (!receipt && resend)) {
        if (!receipt && !firstWrite && (context.request.version !== accepted.value.version || !["active", "paused"].includes(context.request.status)))
          throw new ParentApiError("This request changed. Review the latest saved information.", 409);
        if (!receipt && (!context.update.issuedAt || !(Date.parse(accepted.expiresAt) > Date.parse(context.update.issuedAt)))) {
          setPhase("unknown"); setError("The original save window ended. Check the saved result; this accepted edit will not be sent again."); return;
        }
        const posted = await parentApi<{ update: { ownerId: string; receipt: SupportUpdateReceipt } }>(`/requests/${requestId}`, {
          method: "POST", body: accepted.body, headers: { "Idempotency-Key": key }, signal: abort.signal,
        }).catch(cause => {
          // Only a rejected NEW write proves that this packet was not committed.
          if (!receipt && cause instanceof ParentApiError && cause.supportUpdateRejected) attempt.current = null;
          throw cause;
        });
        if (!live()) return;
        const recorded = supportUpdateReceiptSchema.parse(posted.update?.receipt);
        if (posted.update.ownerId !== accepted.ownerId) { ownedAccessLost = true; throw new ParentApiError("This support request is unavailable, or its permission has changed.", 403); }
        if (recorded.key !== key || recorded.requestId !== requestId ||
          recorded.action !== accepted.value.action || recorded.baseVersion !== accepted.value.version)
          throw new Error(unknownMessage);
        accepted.verifiedId = recorded.id;
        // Recheck current owned read access after the write, including a session
        // switch while its response was in flight. Never render that old reply.
        context = await read();
        if (!context) return;
      }
      const recorded = context.update.receipt;
      if (!recorded || recorded.id !== accepted.verifiedId || context.request.version < recorded.resultVersion) {
        if (!recorded && (context.request.version !== accepted.value.version || !["active", "paused"].includes(context.request.status)))
          throw new ParentApiError("This request changed. Review the latest saved information.", 409);
        setPhase("unknown"); setError(unknownMessage); return;
      }
      attempt.current = null; setPhase("idle"); setError("");
      savedCallback.current(context.request, context.request.version !== recorded.resultVersion || !["active", "paused"].includes(context.request.status));
    } catch (cause) {
      if (scope.current.id !== requestId || scope.current.generation !== generation) return;
      const status = cause instanceof ParentApiError ? cause.status : 0;
      if (ownedAccessLost) {
        attempt.current = null; setPhase("access_lost"); setError("Your private draft is hidden because access to this request changed. Sign in with its owner and load current saved information."); accessCallback.current?.(); return;
      }
      if (!attempt.current) setPhase("idle");
      else setPhase(status === 409 ? "conflict" : "unknown");
      setError(cause instanceof Error && !abort.signal.aborted ? cause.message : unknownMessage);
    } finally {
      clearTimeout(timer);
      if (scope.current.id === requestId && scope.current.generation === generation) { running.current = false; setReadCycle(value => value + 1); }
    }
  }, [requestId]);

  useEffect(() => {
    if (phase !== "unknown") return;
    const check = () => { if (document.visibilityState !== "hidden") void execute(); };
    const timer = automaticChecks.current < 6 ? setTimeout(() => { automaticChecks.current++; check(); }, 5000) : undefined;
    window.addEventListener("focus", check); window.addEventListener("online", check); window.addEventListener("pageshow", check);
    document.addEventListener("visibilitychange", check);
    return () => { clearTimeout(timer); window.removeEventListener("focus", check); window.removeEventListener("online", check); window.removeEventListener("pageshow", check); document.removeEventListener("visibilitychange", check); };
  }, [phase, execute, readCycle]);

  return { accessLost: phase === "access_lost" || phase === "reviewing_access", checking: phase === "checking" || phase === "reviewing" || phase === "reviewing_access", pending: phase === "pending" || phase === "checking" || phase === "reviewing" || phase === "reviewing_access", unresolved: phase === "unknown" || phase === "conflict" || phase === "checking" || phase === "reviewing", conflict: phase === "conflict" || phase === "reviewing",
    locked: phase !== "idle", error, save: (build: (expiresAt: string) => SupportUpdate) => execute(build),
    check: () => execute(), retry: () => execute(undefined, true),
    review: async (onReviewed: (request: SupportRequest) => void): Promise<void> => {
      if (running.current || phase === "unknown") return;
      running.current = true;
      const generation = scope.current.generation, accepted = attempt.current, wasAccessLost = phase === "access_lost";
      let ownedAccessLost = false;
      const abort = new AbortController(); controller.current = abort;
      setPhase(accepted ? "reviewing" : wasAccessLost ? "reviewing_access" : "pending");
      const timer = setTimeout(() => abort.abort(), 30_000);
      try {
        const key = accepted?.key ?? crypto.randomUUID();
        const context = await parentApi<Context>(`/requests/${requestId}?updateKey=${key}`, { signal: abort.signal });
        if (abort.signal.aborted || scope.current.id !== requestId || scope.current.generation !== generation) return;
        if (context.request?.id !== requestId || !context.update?.ownerId) throw new Error(unknownMessage);
        if (accepted && context.update.ownerId !== accepted.ownerId) { ownedAccessLost = true; throw new ParentApiError("This support request is unavailable, or its permission has changed.", 403); }
        if (accepted && (context.update.receipt || context.request.version === accepted.value.version && ["active", "paused"].includes(context.request.status))) {
          setPhase("unknown"); setError(unknownMessage); return;
        }
        onReviewed(context.request);
        attempt.current = null; setPhase("idle"); setError(""); return;
      } catch (cause) {
        if (scope.current.id === requestId && scope.current.generation === generation) {
          if (ownedAccessLost || currentReadDenied(cause)) {
            attempt.current = null; setPhase("access_lost"); setError("Your private draft is hidden because access to this request changed. Sign in with its owner and load current saved information."); accessCallback.current?.(); return;
          }
          setPhase(wasAccessLost ? "access_lost" : accepted ? "conflict" : "idle");
          setError(wasAccessLost ? "Your private draft is hidden because access to this request changed. Sign in with its owner and load current saved information." : cause instanceof Error ? cause.message : "The latest information is unavailable. Your draft is still here.");
        }
        return;
      } finally { clearTimeout(timer); if (scope.current.id === requestId && scope.current.generation === generation) running.current = false; }
    },
  };
}
