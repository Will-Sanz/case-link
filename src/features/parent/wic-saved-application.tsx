"use client";
import { Fragment, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import type { SupportRequest } from "@/lib/parent/domain";
import { wicApplicationFieldsValueSchema, type WicApplicationFields } from "@/lib/parent/wic-application-fields";
import { wicApplicationSnapshotSchema } from "@/lib/parent/wic-application-snapshot";
import { WIC_APPLICATION_NOTICE_VERSION, WIC_SUBJECT_AUTHORITY_STATEMENT } from "@/lib/parent/constants";
import { boundedParentApi, canCollectWicApplication, displayDate, ParentApiError, type ParentAuthorizationWindow } from "./api";
import { useParentResource } from "./use-parent-resource";
import { usePermissionWindow } from "./use-permission-window";
import { ParentLoading, ServiceError } from "./feedback";
import { WicApplicationNotice, WicApplicationFormFields } from "./wic-application-form";
import source from "../../../data/verified-forms/wic-pa-preapplication-2026-11-13.json";
import styles from "./parent.module.css";

const reply = z.object({ snapshot: wicApplicationSnapshotSchema,
  routingContext: z.object({ label: z.string(), zip: z.string().regex(/^[0-9]{5}$/).nullable() }) });
type Draft = { value: WicApplicationFields; version: number; snapshotId: string | null };
type Attempt = { key: string; body: string };
const contactLabels = { firstName: "First name", lastName: "Last name", dateOfBirth: "Date of birth", street: "Street address", city: "City", zip: "Contact postal ZIP", county: "County", email: "Email", phone: "Phone" };

function PrivateAnswers({ value }: { value: WicApplicationFields }) {
  const person = (input: WicApplicationFields["contact"], childId?: string) => <dl className={styles.factList}>
    {Object.entries(contactLabels).map(([key, label]) => {
      const text = input?.[key as keyof NonNullable<typeof input>];
      return <Fragment key={key}><dt>{label}</dt><dd>{text ? key === "dateOfBirth" ? displayDate(text) : text : "Not provided"}</dd></Fragment>;
    }).filter((_, index) => !childId || index < 3)}
  </dl>;
  return <details className={styles.disclosure}><summary>Read privately saved WIC answers</summary>
    <p>Application status: {value.applicationType === "new" ? "New" : value.applicationType === "reapplying" ? "Re-applying" : value.applicationType === "transfer" ? "Transfer from another county or state" : "Not provided"}</p>
    <p>Applying for: {value.beneficiaries === "mother" ? "Mother" : value.beneficiaries === "children" ? "Children" : value.beneficiaries === "mother_and_children" ? "Mother and children" : "Not provided"}</p>
    <p>Appointment preference: {value.appointmentPreference ?? "Not provided"}. No appointment is confirmed by this preference.</p>
    <h3>Contact person</h3>{person(value.contact)}
    {value.mother && <><h3>Mother</h3>{person(value.mother, "mother")}<p>Status: {value.mother.status === "pregnant" ? "Pregnant" : value.mother.status === "postpartum" ? "Had a baby in the last 6 months" : value.mother.status === "breastfeeding" ? "Breastfeeding an infant under 12 months" : "Not provided"}</p>
      {value.mother.expectedDeliveryDate && <p>Expected delivery: {displayDate(value.mother.expectedDeliveryDate)}</p>}</>}
    {value.children?.map((child, index) => <div key={child.id}><h3>Child {index + 1}</h3>{person(child, child.id)}</div>)}
  </details>;
}

export function WicSavedApplication({ request, onChange }: { request: SupportRequest; onChange?: () => void }) {
  const [read, setRead] = useState(0);
  const saved = useParentResource<unknown>(`/requests/${request.id}/wic-application?requestVersion=${request.version}&read=${read}`);
  const collection = useParentResource<ParentAuthorizationWindow>(`/authorization-window?wicRequestVersion=${request.version}`);
  const [draft, setDraft] = useState<Draft | null>(null), [attempt, setAttempt] = useState<Attempt | null>(null);
  const [error, setError] = useState<Error | null>(null), [message, setMessage] = useState("");
  const [blocked, setBlocked] = useState(false), [uncertain, setUncertain] = useState(false), [conflict, setConflict] = useState(false);
  const [pendingScope, setPendingScope] = useState<string | null>(null);
  const work = useRef<AbortController | null>(null), running = useRef<AbortController | null>(null), form = useRef<HTMLFormElement>(null);
  const parsed = reply.safeParse(saved.data);
  const record = parsed.success && parsed.data.snapshot.request_id === request.id ? parsed.data.snapshot : null;
  const empty = saved.error instanceof ParentApiError && saved.error.status === 404;
  const expiry = Math.min(Date.parse(request.mandate.expiresAt), Date.parse(collection.data?.authorization?.wicApplication?.expiresAt ?? ""));
  const withinWindow = usePermissionWindow(expiry);
  const permitted = withinWindow && canCollectWicApplication(collection.data) && !collection.error && !blocked &&
    request.intake.needs.length === 1 && request.intake.needs[0] === "wic_new" && ["active", "paused"].includes(request.status) &&
    request.mandate.recipientIds.includes("wic-pa") && request.mandate.allowedActions.includes("prepare") && request.mandate.allowedData.includes("household");
  const current = !saved.loading && (!!record && record.request_version <= request.version && !saved.error || empty);
  const editingCurrent = !!draft && current && draft.version === request.version && draft.snapshotId === (record?.id ?? null);
  const scope = JSON.stringify({ id: request.id, version: request.version, status: request.status, mandate: request.mandate, record: record?.id, permitted });
  const [previousScope, setPreviousScope] = useState(scope);
  if (previousScope !== scope) {
    setPreviousScope(scope);
    if (attempt) setUncertain(true);
  }
  const pending = pendingScope === scope;
  useLayoutEffect(() => {
    const controller = new AbortController(); work.current = controller;
    return () => { controller.abort(); if (work.current === controller) work.current = null; };
  }, [scope]);
  function edit() {
    if (!current || !permitted) return;
    setDraft({ value: structuredClone(record?.details ?? {}), version: request.version, snapshotId: record?.id ?? null });
    setAttempt(null); setUncertain(false); setConflict(false); setError(null); setMessage("");
  }
  useLayoutEffect(() => { if (editingCurrent && permitted) form.current?.querySelector<HTMLElement>("input,select,button")?.focus(); }, [draft?.snapshotId, editingCurrent, permitted]);
  async function checkAccess() {
    const controller = work.current;
    if (!controller || controller.signal.aborted || running.current === controller) return;
    running.current = controller; setPendingScope(scope); setError(null);
    try {
      const latest = await boundedParentApi("/authorization-window", {}, controller.signal, new Date(Date.now() + 30000).toISOString()) as ParentAuthorizationWindow;
      if (controller.signal.aborted || work.current !== controller) return;
      if (!canCollectWicApplication(latest)) throw new Error("Private WIC changes are unavailable. Your unsaved draft remains on this page.");
      setBlocked(false); collection.reload();
    } catch (failure) { if (!controller.signal.aborted && work.current === controller) { setBlocked(true); setError(failure instanceof Error ? failure : new Error("WIC access could not be checked.")); } }
    finally { if (running.current === controller) running.current = null; if (!controller.signal.aborted && work.current === controller) setPendingScope(null); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const controller = work.current;
    if (!draft || !editingCurrent || !permitted || conflict || pending || !controller || controller.signal.aborted || running.current === controller) return;
    running.current = controller; setPendingScope(scope); setError(null); setMessage("");
    try {
      let exact = attempt;
      if (!exact) {
        const details = wicApplicationFieldsValueSchema.safeParse(draft.value);
        if (!details.success) throw new ParentApiError("Check the WIC names, dates, address and contact answers. Unknown answers can stay blank.", 400);
        exact = { key: crypto.randomUUID(), body: JSON.stringify({ expectedVersion: draft.version, details: details.data,
          noticeVersion: WIC_APPLICATION_NOTICE_VERSION, subjectAuthorityDeclared: true }) };
        setAttempt(exact);
      }
      const result = await boundedParentApi(`/requests/${request.id}/wic-application`, { method: "POST", headers: { "Idempotency-Key": exact.key }, body: exact.body }, controller.signal, new Date(expiry).toISOString());
      if (controller.signal.aborted || work.current !== controller) return;
      if (!z.object({ snapshotId: z.uuid() }).safeParse(result).success) throw new ParentApiError("The saved revision is unconfirmed. Retry the same save before changing answers.", 0);
      setDraft(null); setAttempt(null); setUncertain(false);
      setMessage(request.status === "paused" ? "Your WIC answers are saved. Your request stays paused; nothing has been sent." : "Your private WIC answers are saved as a new revision. Nothing has been sent and no appointment or enrollment is confirmed.");
      setRead(current => current + 1); onChange?.();
    } catch (failure) {
      if (controller.signal.aborted || work.current !== controller) return;
      setError(failure instanceof Error ? failure : new Error("WIC answers could not be saved. Your draft remains on this page."));
      const status = failure instanceof ParentApiError ? failure.status : 0;
      const saveStillUnknown = uncertain || status < 400 || status >= 500 || status === 401 || status === 403;
      setUncertain(saveStillUnknown); setConflict(status === 409);
      if (status === 401 || status === 403) { setBlocked(true); collection.reload(); }
      if (!saveStillUnknown && status >= 400 && status < 500 && status !== 409) setAttempt(null);
    } finally { if (running.current === controller) running.current = null; if (!controller.signal.aborted && work.current === controller) setPendingScope(null); }
  }
  return <section id="wic-application-review" className={styles.section} aria-labelledby="wic-application-title">
    <h2 id="wic-application-title">Your private WIC answers</h2>
    <p>Saving answers prepares this request. It does not send a pre-application, confirm an appointment or establish enrollment.</p>
    <a className={styles.textLink} href={source.officialGuidanceUrl}>Open official WIC help</a>
    {saved.loading ? <ParentLoading label="Loading saved WIC answers"/> : saved.error && !empty ? <ServiceError error={saved.error} retry={() => setRead(current => current + 1)} returnTo={`/support/${request.id}`}/> : <>
      {record ? <><p className={styles.hint}>Saved revision {record.revision} · {displayDate(record.created_at, true)}. Original per-field dates remain unchanged when answers are reused.</p>
        {parsed.success && <p className={styles.hint}>{parsed.data.routingContext.label} {parsed.data.routingContext.zip ?? "No current routing ZIP is available."}</p>}
        <PrivateAnswers value={record.details}/></> : empty ? <p>No private WIC answers are saved for this request. Official help remains available.</p> : <p>The saved WIC evidence needs a service check before it can be used. Try loading it again.</p>}
      {draft && (!editingCurrent || conflict) && <div className={styles.notice}><div><p>The request changed. Your unsaved draft is still on this page. Loading saved answers replaces that draft.</p>
        <button type="button" className={styles.secondary} onClick={() => { setDraft(null); setAttempt(null); setConflict(false); setUncertain(false); setError(null); setRead(current => current + 1); onChange?.(); }}>Load latest saved WIC answers</button></div></div>}
      {draft && permitted && editingCurrent ? <form ref={form} className={styles.form} aria-label="Correct WIC application answers" onSubmit={submit}>
        <WicApplicationNotice/>
        <WicApplicationFormFields value={draft.value} disabled={pending || uncertain || conflict} idPrefix="saved-wic" onChange={value => { setDraft({ ...draft, value }); setAttempt(null); setError(null); }}/>
        <p>{WIC_SUBJECT_AUTHORITY_STATEMENT}</p>
        <p className={styles.hint}>Choosing Save WIC changes makes this declaration for the people in this revision. It saves a partial draft when answers are missing. Your WIC request remains {request.status === "paused" ? "paused" : "subject to its current permission"}; no provider submission is authorized by this save.</p>
        {uncertain && <p className={styles.notice}>The save result is unconfirmed. Retry the same save before editing or creating another revision.</p>}
        <div className={styles.inline}><button className={styles.button} disabled={pending || conflict}>{pending ? "Saving WIC answers…" : uncertain ? "Retry the same WIC save" : "Save WIC changes"}</button>
          {!uncertain && <button type="button" className={styles.quiet} disabled={pending} onClick={() => { setDraft(null); setAttempt(null); setError(null); }}>Cancel WIC editing</button>}</div>
      </form> : <>
        {current && permitted && !draft && <button type="button" className={styles.secondary} onClick={edit}>{record ? "Correct WIC answers" : "Add private WIC answers"}</button>}
        {!permitted && <p className={styles.hint}>Private WIC changes are closed or their current permission is unavailable. Saved answers remain readable where account access permits. {draft && "Your unsaved draft remains on this page; no new answers can be entered until access is restored."}</p>}
      </>}
    </>}
    {error && <ServiceError error={error} returnTo={`/support/${request.id}`}/>}
    {(!permitted || collection.error || blocked) && <button type="button" className={styles.secondary} disabled={pending} onClick={checkAccess}>Check WIC editing access again</button>}
    {message && <p className={styles.success} role="status">{message}</p>}
  </section>;
}
