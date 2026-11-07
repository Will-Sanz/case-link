"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { intakeSchema, mandateSchema, type SupportRequest } from "@/lib/parent/domain";
import { assessSnapApplicationSnapshot, snapApplicationSnapshotSchema, type SnapApplicationSnapshot } from "@/lib/parent/snap-application-snapshot";
import { snapCaptureContextSchema, type SnapCaptureContext } from "@/lib/parent/snap-capture-context";
import { snapCaptureProgressSchema } from "@/lib/parent/snap-capture-progress";
import { snapDirectAcquisitionResultSchema, type SnapDirectAcquisitionResult } from "@/lib/parent/snap-direct-acquisition-contract";
import { getProgram } from "@/lib/parent/programs";
import { boundedParentApi, ParentApiError } from "./api";
import { ParentLoading, ServiceError } from "./feedback";
import { SnapDirectPersonalEntry } from "./snap-direct-personal-entry";
import { SnapAcquisitionPermission } from "./snap-acquisition-permission";
import { SnapPreparedApplication } from "./snap-prepared-application";
import { isSnapFinalReviewAction } from "./support-activity";
import source from "../../../data/verified-forms/snap-pa600fs-2019.json";
import styles from "./parent.module.css";
import { usePermissionWindow } from "./use-permission-window";

const captureReply = z.object({ ok: z.literal(true), capture: snapCaptureProgressSchema.nullable() }).strict();
const contextReply = z.object({ ok: z.literal(true), context: snapCaptureContextSchema }).strict();
const acquisitionReply = z.object({ ok: z.literal(true), acquisition: snapDirectAcquisitionResultSchema }).strict();
const scopeSchema = z.object({
  id: z.uuid(), version: snapCaptureContextSchema.shape.requestVersion, status: z.enum(["active", "paused", "cancelled", "closed"]),
  needs: intakeSchema.shape.needs, mandate: mandateSchema, canonicalReview: z.boolean(), snapshot: snapApplicationSnapshotSchema,
}).strict();
const unavailable = "The current application permission could not be checked. Your saved answers are unchanged. Refresh before continuing with personal steps.";

/** Closed server processing/method gates never mount personal inputs or a new permission form. */
export function SnapProtectedApplication({ request, snapshot, onChange }: {
  request: SupportRequest; snapshot: SnapApplicationSnapshot; onChange?: () => void;
}) {
  const [revision, setRevision] = useState(0);
  // Background activity polls cannot discard unsaved personal entries when their authority and facts are unchanged.
  const serialized = JSON.stringify({ id: request.id, version: request.version, status: request.status, needs: request.intake.needs,
    mandate: request.mandate, canonicalReview: request.required_actions.some(isSnapFinalReviewAction), snapshot });
  const binding = useMemo(() => {
    const parsed = scopeSchema.safeParse(JSON.parse(serialized)); return parsed.success ? parsed.data : null;
  }, [serialized]);
  const scope = useMemo(() => ({ binding, revision }), [binding, revision]);
  type View = { scope: typeof scope } & ({ kind: "prepared" } | { kind: "recovery" } | { kind: "unavailable" } | { kind: "error"; error: Error }
    | { kind: "entry" | "permission"; context: SnapCaptureContext; acquisition: SnapDirectAcquisitionResult });
  const [result, setResult] = useState<View | null>(null), work = useRef<AbortController | null>(null);
  let current = false;
  const deadline = binding ? Math.min(Date.parse(binding.mandate.expiresAt), Date.parse(source.verifiedUntil)) : NaN;
  const timeCurrent = usePermissionWindow(deadline);
  try {
    if (!binding) throw new Error();
    const { mandate } = binding, assessment = assessSnapApplicationSnapshot(binding.snapshot, new Date());
    current = binding.status === "active" && binding.needs.includes("snap_new") && !binding.canonicalReview
      && assessment.snapshot.request_id === binding.id && assessment.snapshot.request_version <= binding.version
      && assessment.readiness.nonProtectedDataReadyForReview && mandate.recipientIds.includes("snap-pa") && mandate.allowedActions.includes("prepare")
      && mandate.allowedData.includes("household") && mandate.allowedData.includes("income") && timeCurrent;
  } catch { /* No protected entry mounts from invalid or stale saved application metadata. */ }
  const expiresAt = Number.isFinite(deadline) ? new Date(deadline).toISOString() : "";
  if (result && (!current || result.scope !== scope)) setResult(null);
  useEffect(() => {
    const controller = new AbortController(); work.current = controller;
    if (!current || !binding) return () => controller.abort();
    const { id, version, snapshot: saved } = binding;
    let timer: ReturnType<typeof setTimeout>;
    const stop = () => { if (!controller.signal.aborted) { controller.abort(); setResult({ scope, kind: "error", error: new Error(unavailable) }); } };
    const until = (end: number) => { clearTimeout(timer); timer = setTimeout(stop, Math.max(0, Math.min(2147483647, end - Date.now()))); };
    until(deadline);
    const read = async (path: string) => {
      const value = await boundedParentApi(path, {}, controller.signal, expiresAt);
      controller.signal.throwIfAborted(); if (Date.now() >= deadline) throw new Error(); return value;
    };
    void (async () => {
      try {
        const capture = captureReply.parse(await read(`/requests/${id}/snap-application/capture?expectedVersion=${version}`)).capture;
        if (capture) {
          if (capture.requestVersion !== version) throw new Error();
          setResult({ scope, kind: "prepared" }); return;
        }
        const contextQuery = new URLSearchParams({ expectedVersion: String(version), snapshotId: saved.id });
        const context = contextReply.parse(await read(`/requests/${id}/snap-application/context?${contextQuery}`)).context;
        if (context.requestVersion !== version || context.snapshotId !== saved.id.toLowerCase()
          || !Object.entries(context.source).every(([key, value]) => saved.source[key as keyof typeof saved.source] === value)
          || [...context.applyingSubjectIds].sort().join() !== (saved.details.household ?? []).filter(person => person.requestingSnap).map(person => person.id.toLowerCase()).sort().join()) throw new Error();
        const query = new URLSearchParams({ expectedVersion: String(version), snapshotId: context.snapshotId, snapshotHash: context.snapshotHash });
        let acquisitionValue: unknown;
        try { acquisitionValue = await read(`/requests/${id}/snap-acquisition?${query}`); }
        catch (failure) {
          if (controller.signal.aborted) return;
          if (failure instanceof ParentApiError && failure.status === 403) { setResult({ scope, kind: "unavailable" }); return; }
          throw failure;
        }
        const acquisition = acquisitionReply.parse(acquisitionValue).acquisition;
        if (acquisition.requestId !== id || acquisition.requestVersion !== version || acquisition.snapshotId !== context.snapshotId
          || acquisition.snapshotHash !== context.snapshotHash || !Object.entries(context.source).every(([key, value]) => acquisition.source[key as keyof typeof acquisition.source] === value)
          || [...acquisition.subjectIds].sort().join() !== [...context.applyingSubjectIds].sort().join()
          || Date.parse(acquisition.expiresAt) <= Date.now() || acquisition.state === "authorized" && Date.parse(acquisition.consentedAt) > Date.now()) throw new Error();
        until(Math.min(deadline, Date.parse(acquisition.expiresAt)));
        setResult({ scope, kind: acquisition.state === "permission_needed" ? "permission" : "entry", context, acquisition });
      } catch (failure) {
        if (controller.signal.aborted) return;
        setResult(failure instanceof ParentApiError && failure.status === 403 ? { scope, kind: "prepared" }
          : { scope, kind: "error", error: failure instanceof ParentApiError && failure.status === 401
            ? new ParentApiError("Sign in to check this application’s personal steps.", 401) : new Error(unavailable) });
      }
    })();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [scope, binding, current, deadline, expiresAt]);
  const view = result?.scope === scope ? result : null;
  if (!current) return null;
  if (!view) return <ParentLoading label="Checking application personal steps"/>;
  if (view.kind === "prepared") return <SnapPreparedApplication request={request} snapshot={snapshot} onChange={onChange}/>;
  if (view.kind === "unavailable") return <section className={styles.space} aria-label="Personal steps unavailable">
    <p className={styles.hint}>Personal steps are unavailable through CaseLink right now. Your saved answers are unchanged. Check Activity &amp; receipts for any prepared drafts.</p>
    <div className={styles.inline}>
      <a className={styles.textLink} href="#application-receipts">View drafts and recorded activity</a>
      <button type="button" className={styles.quiet} onClick={() => setRevision(value => value + 1)}>Check current application</button>
    </div>
  </section>;
  if (view.kind === "error") return <ServiceError error={view.error} retry={() => setRevision(value => value + 1)} returnTo={`/support/${request.id}`}/>;
  if (view.kind === "permission") return <SnapAcquisitionPermission request={request} snapshot={snapshot} context={view.context} acquisition={view.acquisition}
    onAuthorized={acquisition => { if (!work.current?.signal.aborted) setResult({ scope, kind: "entry", context: view.context, acquisition }); }}/>;
  if (view.kind === "recovery") return <section className={styles.space} aria-label="Another way to complete personal steps">
    <h3>Another way to complete personal steps</h3>
    <p>Your personal steps still need to be completed. Your saved CaseLink answers are kept. You can use Pennsylvania’s official SNAP application service.</p>
    <div className={styles.inline}>
      <a className={styles.textLink} href={getProgram("snap-pa")!.officialUrl}>Open the official SNAP service</a>
      <button type="button" className={styles.quiet} onClick={() => setRevision(value => value + 1)}>Check current application</button>
    </div>
  </section>;
  return <SnapDirectPersonalEntry request={request} snapshot={snapshot} context={view.context} acquisition={view.acquisition} onChange={onChange}
    onRecovery={() => { work.current?.abort(); setResult({ scope, kind: "recovery" }); }}/>;
}
