"use client";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import type { SupportRequest } from "@/lib/parent/domain";
import type { SnapApplicationSnapshot } from "@/lib/parent/snap-application-snapshot";
import { snapCaptureContextSchema } from "@/lib/parent/snap-capture-context";
import { snapCaptureProgressSchema } from "@/lib/parent/snap-capture-progress";
import { snapPacketAuthorizationResultSchema, type SnapPacketAuthorizationResult } from "@/lib/parent/snap-packet-contract";
import { recoverSnapDirectCompletion } from "@/lib/parent/snap-direct-completion-transport";
import { loadSnapPacketReviewFile } from "@/lib/parent/snap-review-file";
import { boundedParentApi, ParentApiError } from "./api";
import { ParentLoading, ServiceError } from "./feedback";
import { isSnapFinalReviewAction } from "./support-activity";
import { SnapReviewPdf } from "./snap-review-pdf";
import styles from "./parent.module.css";
import { usePermissionWindow } from "./use-permission-window";

const captureReply = z.object({ ok: z.literal(true), capture: snapCaptureProgressSchema.nullable() }).strict();
const contextReply = z.object({ ok: z.literal(true), context: snapCaptureContextSchema }).strict();
const packetReply = z.object({ ok: z.literal(true), authorization: snapPacketAuthorizationResultSchema.nullable() }).strict();
const onDisplayReady = () => undefined; // Read-only display never enables Submit or another write.


export function SnapPreparedApplication({ request, snapshot, onChange }: {
  request: SupportRequest; snapshot: SnapApplicationSnapshot; onChange?: () => void;
}) {
  const id = useId(), [revision, setRevision] = useState(0);
  const canonicalReview = request.required_actions.some(isSnapFinalReviewAction);
  const mandateCurrent = usePermissionWindow(Date.parse(request.mandate.expiresAt));
  const current = request.status === "active" && request.intake.needs.includes("snap_new") && !canonicalReview
    && snapshot.request_id === request.id && snapshot.request_version <= request.version && mandateCurrent;
  const scope = useMemo(() => ({ requestId: request.id, version: request.version, mandate: request.mandate, snapshot, current, revision }), [request.id, request.version, request.mandate, snapshot, current, revision]);
  const [replacing, setReplacing] = useState<typeof scope | null>(null), pending = replacing === scope;
  type View = { scope: typeof scope; kind: "empty" | "selected" | "unknown" | "changed" | "stored" | "replaced" | "hidden";
    locator: string | null; canReplace: boolean; file?: { blob: Blob; url: string }; error?: Error };
  const [result, setResult] = useState<View | null>(null);
  const work = useRef<AbortController | null>(null), correction = useRef<AbortController | null>(null), closeFile = useRef<() => void>(() => {});
  // A deadline ends the bounded correction and refreshes its uncertain status; a new scope discards it.
  useLayoutEffect(() => () => { correction.current?.abort(); }, [request.id, request.version, request.status, request.intake.needs, request.mandate, snapshot, canonicalReview, revision]);
  const reload = () => setRevision(value => value + 1);
  useEffect(() => {
    const refresh = () => { if (!correction.current || correction.current.signal.aborted) setRevision(value => value + 1); };
    window.addEventListener("focus", refresh); window.addEventListener("pageshow", refresh);
    return () => { window.removeEventListener("focus", refresh); window.removeEventListener("pageshow", refresh); };
  }, []);
  if (result && result.scope !== scope) setResult(null);
  useEffect(() => {
    if (!current) return;
    const controller = new AbortController(); work.current = controller;
    let url: string | undefined, locator: string | null = null, contextChecked = false;
    const clearFile = () => { if (url) { URL.revokeObjectURL(url); url = undefined; } };
    closeFile.current = clearFile;
    const live = () => !controller.signal.aborted;
    let timer: ReturnType<typeof setTimeout>;
    const expire = () => { if (!live()) return; controller.abort(); clearFile(); setResult({ scope, kind: "changed", locator, canReplace: contextChecked,
      error: new Error("Access to the saved application has changed. Check the current request before continuing.") }); };
    const until = (expiry: string) => { clearTimeout(timer); timer = setTimeout(expire,
      Math.max(0, Math.min(2147483647, Date.parse(request.mandate.expiresAt) - Date.now(), Date.parse(expiry) - Date.now()))); };
    until(request.mandate.expiresAt);
    const read = (path: string) => boundedParentApi(path, {}, controller.signal, request.mandate.expiresAt);
    const show = (kind: View["kind"], error?: Error) => { if (live()) setResult({ scope, kind, locator, canReplace: contextChecked, error }); };
    void (async () => {
      try {
        const capture = captureReply.parse(await read(`/requests/${request.id}/snap-application/capture?expectedVersion=${request.version}`)).capture;
        if (!live()) return;
        if (capture && capture.requestVersion !== request.version) throw new Error();
        locator = capture?.packetId ?? null;
        const contextQuery = new URLSearchParams({ expectedVersion: String(request.version), snapshotId: snapshot.id });
        const context = contextReply.parse(await read(`/requests/${request.id}/snap-application/context?${contextQuery}`)).context;
        if (!live()) return;
        if (context.requestVersion !== request.version || context.snapshotId !== snapshot.id
          || JSON.stringify(context.source) !== JSON.stringify(snapCaptureContextSchema.shape.source.parse(snapshot.source))) throw new Error();
        contextChecked = true;
        const query = new URLSearchParams({ expectedVersion: String(request.version), snapshotId: snapshot.id, snapshotHash: context.snapshotHash });
        const validate = (value: unknown): SnapPacketAuthorizationResult | null => {
          const authorization = packetReply.parse(value).authorization;
          if (!authorization) return null;
          const intent = authorization.intent;
          if (intent.requestId !== request.id || intent.requestVersion !== request.version || intent.snapshotId !== snapshot.id || intent.snapshotHash !== context.snapshotHash
            || Date.parse(authorization.consentedAt) > Date.now() || Date.parse(authorization.authorizationExpiresAt) <= Date.now()
            || [...authorization.subjectIds].sort().join() !== [...context.applyingSubjectIds].sort().join()) throw new Error();
          return authorization;
        };
        let authorization = validate(await read(`/requests/${request.id}/snap-direct-packet?${query}`));
        if (!live()) return;
        if (!authorization) { show(locator ? "selected" : "empty"); return; }
        if (locator && locator !== authorization.intent.packetId) { show("selected"); return; }
        locator = authorization.intent.packetId;
        until(authorization.authorizationExpiresAt);
        if (authorization.state !== "stored") {
          const intent = authorization.intent;
          const recovered = await recoverSnapDirectCompletion({ ownerId: intent.ownerId, requestId: request.id, expectedVersion: request.version,
            packetId: intent.packetId, snapshotId: snapshot.id, snapshotHash: context.snapshotHash }, authorization, { signal: controller.signal });
          if (!live()) return;
          if (recovered.packetId !== intent.packetId) throw new Error();
          if (recovered.state !== "stored") { show("unknown"); return; }
          query.set("packetId", intent.packetId);
          const latest = validate(await read(`/requests/${request.id}/snap-direct-packet?${query}`));
          if (!live()) return;
          if (!latest || latest.state !== "stored" || JSON.stringify(latest.intent) !== JSON.stringify(intent)
            || latest.authorizationExpiresAt !== authorization.authorizationExpiresAt || latest.consentedAt !== authorization.consentedAt) throw new Error();
          authorization = latest;
        }
        const bytes = await loadSnapPacketReviewFile(authorization, controller.signal);
        try {
          if (!live()) return;
          const blob = new Blob([bytes], { type: "application/pdf" }); url = URL.createObjectURL(blob);
          setResult({ scope, kind: "stored", locator, canReplace: true, file: { blob, url } });
        } finally { bytes.fill(0); }
      } catch (failure) {
        if (!live()) return;
        clearFile();
        if (failure instanceof ParentApiError && failure.status === 403 && !locator) { show("hidden"); return; }
        const error = failure instanceof ParentApiError && failure.status === 401 ? new ParentApiError("Sign in to check your saved application.", 401)
          : new Error(failure instanceof ParentApiError && [403, 409].includes(failure.status)
            ? "Access to the saved application has changed. Check the current request before continuing."
            : "The saved application could not be checked. Refresh its status before making a change.");
        show("changed", error);
      }
    })();
    return () => { controller.abort(); clearTimeout(timer); clearFile(); };
  }, [scope, current, request.id, request.version, request.mandate.expiresAt, snapshot]);

  const view = result?.scope === scope ? result : null;
  async function replacePages() {
    if (!current || !view?.locator || !view.canReplace || pending) return;
    const previousPacketId = view.locator, controller = new AbortController();
    work.current?.abort(); closeFile.current(); correction.current = controller; setReplacing(scope);
    setResult({ scope, kind: "unknown", locator: previousPacketId, canReplace: false });
    let replaced = false;
    try {
      const value = z.object({ ok: z.literal(true), requestVersion: z.number().int() }).strict().parse(await boundedParentApi(`/requests/${request.id}/snap-application/capture`, {
        method: "POST", body: JSON.stringify({ expectedVersion: request.version, previousPacketId }),
      }, controller.signal, request.mandate.expiresAt));
      if (controller.signal.aborted) return;
      if (value.requestVersion !== request.version + 1) throw new Error();
      replaced = true;
      setResult({ scope, kind: "replaced", locator: null, canReplace: false }); onChange?.();
    } catch {
      if (!controller.signal.aborted) { setResult({ scope, kind: "changed", locator: null, canReplace: false,
        error: new Error("The page change needs checking. Refresh the current request before replacing pages again.") }); onChange?.(); }
    } finally { if (!replaced && correction.current === controller) correction.current = null; if (!controller.signal.aborted) setReplacing(null); }
  }
  if (!current || view?.kind === "hidden") return null;
  return <section className={styles.space} aria-labelledby={id}>
    <h3 id={id}>Your prepared application</h3>
    {!view || pending ? <ParentLoading label={pending ? "Changing page version" : "Checking your saved application"}/> : <>
      {view.kind === "stored" && view.file ? <>
        <p className={styles.hint}>Viewing these saved pages does not submit an application. Check <a className={styles.textLink} href="#application-receipts">Activity &amp; receipts</a> for delivery records.</p>
        <SnapReviewPdf source={view.file.blob} onReady={onDisplayReady}/>
        <a className={styles.quiet} href={view.file.url} target="_blank" rel="noopener noreferrer">Open exact saved PDF full size</a>
      </> : view.kind === "selected" ? <p className={styles.hint}>Your request has an application record. Check <a className={styles.textLink} href="#application-receipts">Activity &amp; receipts</a> for its current status.</p>
        : view.kind === "replaced" ? <p className={styles.success} role="status">The earlier personal pages are no longer current. Your saved application answers are unchanged.</p>
          : !view.error && <p className={styles.hint}>{view.kind === "empty"
            ? "A prepared application could not be confirmed here. Earlier work and delivery records remain in Activity & receipts."
            : "Storage of these pages is not confirmed. Check the same saved application before making another change."}</p>}
      {view.error && <ServiceError error={view.error} retry={() => { onChange?.(); reload(); }} returnTo={`/support/${request.id}`}/>}
      {view.kind !== "replaced" && <div className={`${styles.inline} ${styles.space}`}>
        {!view.error && <button type="button" className={styles.quiet} onClick={reload}>Check saved application</button>}
        {view.locator && view.canReplace && !(view.error instanceof ParentApiError && view.error.status === 401) &&
          <button type="button" className={styles.quiet} disabled={request.version >= 2147483647} onClick={replacePages}>Replace personal pages</button>}
      </div>}
    </>}
  </section>;
}
