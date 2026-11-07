"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import type { SupportRequest } from "@/lib/parent/domain";
import type { SnapApplicationSnapshot } from "@/lib/parent/snap-application-snapshot";
import type { SnapCaptureContext } from "@/lib/parent/snap-capture-context";
import { snapDirectAcquisitionInputSchema, snapDirectAcquisitionResultSchema, type SnapDirectAcquisitionResult } from "@/lib/parent/snap-direct-acquisition-contract";
import { getProgram } from "@/lib/parent/programs";
import { boundedParentApi, displayDate } from "./api";
import styles from "./parent.module.css";
import { usePermissionWindow } from "./use-permission-window";

const replySchema = z.object({ ok: z.literal(true), acquisition: snapDirectAcquisitionResultSchema }).strict();
const sameSubjects = (a: readonly string[], b: readonly string[]) => [...a].sort().join() === [...b].sort().join();

/** Successful server metadata is required; this component cannot enable a closed collection purpose. */
export function SnapAcquisitionPermission({ request, snapshot, context, acquisition, onAuthorized }: {
  request: SupportRequest; snapshot: SnapApplicationSnapshot; context: SnapCaptureContext;
  acquisition: SnapDirectAcquisitionResult; onAuthorized: (value: SnapDirectAcquisitionResult) => void;
}) {
  const serialized = JSON.stringify({ id: request.id, version: request.version, status: request.status, needs: request.intake.needs, mandate: request.mandate, snapshot, context, acquisition });
  const scope = useMemo(() => {
    try {
      const value = snapDirectAcquisitionResultSchema.parse(acquisition), people = (snapshot.details.household ?? []).filter(person => person.requestingSnap);
      if (value.state !== "permission_needed" || request.status !== "active" || !request.intake.needs.includes("snap_new")
        || value.requestId !== request.id || value.requestVersion !== request.version || value.snapshotId !== snapshot.id
        || context.requestVersion !== request.version || context.snapshotId !== snapshot.id || value.snapshotHash !== context.snapshotHash
        || !sameSubjects(value.subjectIds, people.map(person => person.id)) || !sameSubjects(value.subjectIds, context.applyingSubjectIds)
        || !Object.entries(context.source).every(([key, item]) => value.source[key as keyof typeof value.source] === item && snapshot.source[key as keyof typeof snapshot.source] === item)
        || !request.mandate.recipientIds.includes("snap-pa") || !request.mandate.allowedActions.includes("prepare")
        || !request.mandate.allowedData.includes("household") || !request.mandate.allowedData.includes("income")
        || Date.parse(value.expiresAt) > Date.parse(request.mandate.expiresAt)) return null;
      return { value, people, deadline: value.expiresAt };
    } catch { return null; }
    // Identical background polls preserve the one-attempt barrier and the parent's choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized]);
  const [declaration, setDeclaration] = useState<typeof scope>(null), [declinedScope, setDeclinedScope] = useState<typeof scope>(null);
  const [attempt, setAttempt] = useState<{ scope: typeof scope; state: "pending" | "unknown" } | null>(null);
  const [expired, setExpired] = useState<typeof scope>(null);
  const work = useRef<AbortController | null>(null), reading = useRef<AbortController | null>(null), attempted = useRef<typeof scope>(null);
  useLayoutEffect(() => {
    const controller = new AbortController(); work.current = controller;
    return () => { controller.abort(); if (work.current === controller) work.current = null; };
  }, [scope]);
  const timeCurrent = usePermissionWindow(scope ? Date.parse(scope.deadline) : NaN);
  const current = !!scope && expired !== scope && timeCurrent;
  useEffect(() => {
    if (!scope) return;
    const timer = setTimeout(() => { work.current?.abort(); setExpired(scope); }, Math.max(0, Math.min(2147483647, Date.parse(scope.deadline) - Date.now())));
    return () => clearTimeout(timer);
  }, [scope]);
  const accepted = useCallback((input: unknown) => {
    if (!scope) throw new Error();
    const value = replySchema.parse(input).acquisition, original = scope.value;
    if (value.state !== "authorized" || value.ownerId !== original.ownerId || value.requestId !== original.requestId
      || value.requestVersion !== original.requestVersion || value.snapshotId !== original.snapshotId || value.snapshotHash !== original.snapshotHash
      || value.policyVersion !== original.policyVersion || value.retentionPolicyVersion !== original.retentionPolicyVersion
      || !sameSubjects(value.subjectIds, original.subjectIds) || !Object.entries(original.source).every(([key, item]) => value.source[key as keyof typeof value.source] === item)
      || Date.parse(value.consentedAt) > Date.now() || Date.parse(value.expiresAt) <= Date.now()
      || Date.parse(value.expiresAt) > Date.parse(original.expiresAt)) throw new Error();
    return value;
  }, [scope]);
  const reconcile = useCallback(async () => {
    const controller = work.current;
    if (!current || !scope || !controller || controller.signal.aborted || attempted.current !== scope || reading.current === controller) return;
    reading.current = controller;
    try {
      const query = new URLSearchParams({ expectedVersion: String(request.version), snapshotId: scope.value.snapshotId, snapshotHash: scope.value.snapshotHash });
      const value = accepted(await boundedParentApi(`/requests/${request.id}/snap-acquisition?${query}`, {}, controller.signal, scope.deadline));
      if (!controller.signal.aborted && work.current === controller) onAuthorized(value);
    } catch { /* An unconfirmed permission never enables protected entry or another POST. */ }
    finally { if (reading.current === controller) reading.current = null; }
  }, [current, scope, request.id, request.version, accepted, onAuthorized]);
  const unknown = attempt?.scope === scope && attempt.state === "unknown";
  useEffect(() => {
    if (!unknown || !current) return;
    const check = () => { void reconcile(); }, timer = setInterval(check, 5000);
    window.addEventListener("focus", check); window.addEventListener("pageshow", check);
    return () => { clearInterval(timer); window.removeEventListener("focus", check); window.removeEventListener("pageshow", check); };
  }, [unknown, current, reconcile]);
  const declared = declaration === scope, declined = declinedScope === scope;
  async function allow() {
    const controller = work.current;
    if (!current || !scope || !declared || declined || !controller || controller.signal.aborted || attempted.current === scope) return;
    attempted.current = scope; setAttempt({ scope, state: "pending" });
    try {
      const input = snapDirectAcquisitionInputSchema.parse({ expectedVersion: request.version, snapshotId: scope.value.snapshotId,
        snapshotHash: scope.value.snapshotHash, acquisitionId: crypto.randomUUID(), policyVersion: scope.value.policyVersion,
        retentionPolicyVersion: scope.value.retentionPolicyVersion, acceptedExpiresAt: scope.value.expiresAt, subjectIds: scope.value.subjectIds, authorityDeclared: true });
      const value = accepted(await boundedParentApi(`/requests/${request.id}/snap-acquisition`, { method: "POST", body: JSON.stringify(input) }, controller.signal, scope.deadline));
      if (!controller.signal.aborted && work.current === controller) onAuthorized(value);
    } catch {
      if (controller.signal.aborted || work.current !== controller) return;
      setAttempt({ scope, state: "unknown" }); void reconcile();
    }
  }
  if (!current || !scope) return <p className={styles.notice} role="status">Private personal-step permission is unavailable. Your saved answers are kept.</p>;
  const pending = attempt?.scope === scope && attempt.state === "pending";
  return <section className={styles.space} aria-labelledby="snap-private-permission-title">
    <h3 id="snap-private-permission-title">Allow private SNAP personal steps</h3>
    <p>The application needs Social Security numbers for the people applying, plus your own signatures and dates on form pages 1 and 5.</p>
    <p><strong>People applying:</strong> {scope.people.map(person => `${person.firstName} ${person.lastName}`).join(", ")}.</p>
    <p>CaseLink may use these entries to complete, privately store and show your Pennsylvania SNAP application, and deliver it only after your separate Submit choice and a verified service connection. Protected entries stay out of AI, chat and ordinary household records. This permission does not sign or send anything.</p>
    <p>Permission and the private form expire by <strong>{displayDate(scope.deadline, true)} Eastern time</strong>. Use “Cancel request &amp; withdraw permission” on this request to stop future work. Copies already delivered follow the recipient’s own rules.</p>
    <details><summary>Permission details</summary><p>Program: Pennsylvania SNAP · Form: PA 600 FS (SG) 9/19 · Policy: {scope.value.policyVersion} · Retention policy: {scope.value.retentionPolicyVersion}.</p></details>
    {declined ? <p className={styles.notice} role="status">Personal steps are paused. Your saved answers are kept. You can continue through Pennsylvania’s official service.</p> : <label className={`${styles.checkbox} ${styles.space}`}>
      <input type="checkbox" checked={declared} disabled={pending || unknown} onChange={event => setDeclaration(event.target.checked ? scope : null)}/>
      <span>I may provide the applying people’s information, and I allow this private use for their SNAP application.</span>
    </label>}
    <div className={`${styles.inline} ${styles.space}`}>
      {declined && <button type="button" className={styles.quiet} onClick={() => { setDeclinedScope(null); setDeclaration(null); }}>Review personal-step permission</button>}
      {!declined && <button type="button" className={styles.button} disabled={!declared || pending || unknown} onClick={allow}>{pending ? "Saving permission…" : "Allow and continue"}</button>}
      {!declined && <button type="button" className={styles.quiet} disabled={pending || unknown} onClick={() => setDeclinedScope(scope)}>Not now</button>}
      <a className={styles.textLink} href={getProgram("snap-pa")!.officialUrl}>Use the official SNAP service</a>
    </div>
    {unknown && <div className={styles.notice} role="status"><p>Permission is not confirmed yet. CaseLink is checking the saved result before opening personal steps. No application has been sent.</p><button type="button" className={styles.quiet} onClick={() => { void reconcile(); }}>Check saved permission</button></div>}
  </section>;
}
