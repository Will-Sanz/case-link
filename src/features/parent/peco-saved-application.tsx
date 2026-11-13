"use client";
import { Fragment, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import type { SupportRequest } from "@/lib/parent/domain";
import { pecoApplicationFieldsValueSchema, type PecoApplicationFields } from "@/lib/parent/peco-application-fields";
import { pecoApplicationSnapshotSchema } from "@/lib/parent/peco-application-snapshot";
import { PECO_APPLICATION_NOTICE_VERSION, PECO_SUBJECT_AUTHORITY_STATEMENT, PECO_ACCOUNT_AUTHORITY_STATEMENT } from "@/lib/parent/peco-application-fields";
import { boundedParentApi, canCollectPecoApplication, displayDate, ParentApiError, type ParentAuthorizationWindow } from "./api";
import { useParentResource } from "./use-parent-resource";
import { usePermissionWindow } from "./use-permission-window";
import { ParentLoading, ServiceError } from "./feedback";
import { PecoApplicationNotice, PecoApplicationFormFields, PECO_HELP_URL, PECO_INCOME_LABELS } from "./peco-application-form";
import styles from "./parent.module.css";

const reply = z.object({ snapshot: pecoApplicationSnapshotSchema });
type Draft = { value: PecoApplicationFields; version: number; snapshotId: string | null };
type Attempt = { key: string; body: string };
function PrivateAnswers({ value }: { value: PecoApplicationFields }) {
  const person = (input: PecoApplicationFields["applicant"]) => <>
    <dl className={styles.factList}>{Object.entries({ firstName: "First name", lastName: "Last name", middleInitial: "Middle initial", dateOfBirth: "Date of birth" }).map(([key, label]) => {
      const text = input?.[key as "firstName" | "lastName" | "middleInitial" | "dateOfBirth"];
      return <Fragment key={key}><dt>{label}</dt><dd>{text ? key === "dateOfBirth" ? displayDate(text) : text : "Not provided"}</dd></Fragment>;
    })}</dl>
    <p>Income source inventory: {input?.income?.state === "none" ? "No income sources" : input?.income?.state === "unknown" ? "Not sure" : input?.income?.state === "sources" ? input.income.sources.map(source => PECO_INCOME_LABELS[source.kind]).join(", ") : "Not provided"}</p>
  </>;
  return <details className={styles.disclosure}><summary>Read privately saved PECO CAP answers</summary>
    <p>CAP help needed: {value.journey === "new_enrollment" ? "New application preparation" : value.journey === "renewal" ? "Renewal preparation" : value.journey === "unknown" ? "Not sure" : "Not provided"}</p>
    <p>Currently enrolled in CAP: {value.currentCapState === "enrolled" ? "Yes" : value.currentCapState === "not_enrolled" ? "No" : value.currentCapState === "unknown" ? "Not sure" : "Not provided"}</p>
    <p>PECO account number: {value.accountNumber ?? "Not provided"}</p>
    <h3>Applicant</h3>{person(value.applicant)}
    <h3>PECO service address and contact</h3>
    <dl className={styles.factList}>{Object.entries({ street: "Street address", apartment: "Apartment or unit", city: "City", state: "State", zip: "Service ZIP" }).map(([key, label]) => <Fragment key={key}><dt>{label}</dt><dd>{value.address?.[key as keyof NonNullable<PecoApplicationFields["address"]>] ?? "Not provided"}</dd></Fragment>)}</dl>
    <p>Home phone: {value.homePhone ?? "Not provided"}. Mobile phone: {value.cellPhone ?? "Not provided"}.</p>
    <p>PECO text update preference: {value.smsUpdates === true ? "Prefer texts" : value.smsUpdates === false ? "Do not request texts" : "Not provided"}. Saving does not enroll you in messages.</p>
    {value.householdMembers?.map((member, index) => <div key={member.id}><h3>Household member {index + 1}</h3>{person(member)}<p>Relationship to applicant: {member.relationship ?? "Not provided"}</p></div>)}
    <p>Full household list: {value.householdComplete === true ? "Declared complete" : value.householdComplete === false ? "Not yet / not sure" : "Not provided"}.</p>
  </details>;
}

export function PecoSavedApplication({ request, onChange }: { request: SupportRequest; onChange?: () => void }) {
  const [read, setRead] = useState(0);
  const saved = useParentResource<unknown>(`/requests/${request.id}/peco-application?requestVersion=${request.version}&read=${read}`);
  const collection = useParentResource<ParentAuthorizationWindow>(`/authorization-window?pecoRequestVersion=${request.version}`);
  const [draft, setDraft] = useState<Draft | null>(null), [attempt, setAttempt] = useState<Attempt | null>(null);
  const [error, setError] = useState<Error | null>(null), [message, setMessage] = useState("");
  const [blocked, setBlocked] = useState(false), [uncertain, setUncertain] = useState(false), [conflict, setConflict] = useState(false);
  const [pendingScope, setPendingScope] = useState<string | null>(null);
  const work = useRef<AbortController | null>(null), running = useRef<AbortController | null>(null), form = useRef<HTMLFormElement>(null);
  const parsed = reply.safeParse(saved.data);
  const record = parsed.success && parsed.data.snapshot.request_id === request.id ? parsed.data.snapshot : null;
  const empty = saved.error instanceof ParentApiError && saved.error.status === 404;
  const expiry = Math.min(Date.parse(request.mandate.expiresAt), Date.parse(collection.data?.authorization?.pecoApplication?.expiresAt ?? ""));
  const withinWindow = usePermissionWindow(expiry);
  const permitted = withinWindow && canCollectPecoApplication(collection.data) && !collection.error && !blocked &&
    request.intake.needs.length === 1 && request.intake.needs[0] === "electricity" && request.intake.utilityProviders.length === 1 && request.intake.utilityProviders[0] === "peco" && ["self", "authorized_caregiver"].includes(request.intake.accountAuthority) && ["active", "paused"].includes(request.status) &&
    request.mandate.mode === "prepare_only" && request.mandate.recipientIds.length === 1 && request.mandate.recipientIds[0] === "peco-cap" &&
    request.mandate.allowedActions.includes("prepare") && request.mandate.allowedData.length === 3 && ["household", "income", "utility"].every(kind => request.mandate.allowedData.includes(kind as "household" | "income" | "utility"));
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
      if (!canCollectPecoApplication(latest)) throw new Error("Private PECO changes are unavailable. Your unsaved draft remains on this page.");
      setBlocked(false); collection.reload();
    } catch (failure) { if (!controller.signal.aborted && work.current === controller) { setBlocked(true); setError(failure instanceof Error ? failure : new Error("PECO access could not be checked.")); } }
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
        const details = pecoApplicationFieldsValueSchema.safeParse(draft.value);
        if (!details.success) throw new ParentApiError("Check the PECO account, names, dates, service address, phone numbers and income source lists. Unknown answers can stay blank.", 400);
        exact = { key: crypto.randomUUID(), body: JSON.stringify({ expectedVersion: draft.version, details: details.data,
          noticeVersion: PECO_APPLICATION_NOTICE_VERSION, subjectAuthorityDeclared: true, accountAuthorityDeclared: true }) };
        setAttempt(exact);
      }
      const result = await boundedParentApi(`/requests/${request.id}/peco-application`, { method: "POST", headers: { "Idempotency-Key": exact.key }, body: exact.body }, controller.signal, new Date(expiry).toISOString());
      if (controller.signal.aborted || work.current !== controller) return;
      if (!z.object({ snapshotId: z.uuid() }).safeParse(result).success) throw new ParentApiError("The saved revision is unconfirmed. Retry the same save before changing answers.", 0);
      setDraft(null); setAttempt(null); setUncertain(false);
      setMessage(request.status === "paused" ? "Your PECO CAP answers are saved. Your request stays paused; nothing has been sent." : "Your private PECO CAP answers are saved as a new revision. Nothing has been sent; no CAP enrollment, payment change or shutoff protection is confirmed.");
      setRead(current => current + 1); onChange?.();
    } catch (failure) {
      if (controller.signal.aborted || work.current !== controller) return;
      setError(failure instanceof Error ? failure : new Error("PECO answers could not be saved. Your draft remains on this page."));
      const status = failure instanceof ParentApiError ? failure.status : 0;
      const saveStillUnknown = uncertain || status < 400 || status >= 500 || status === 401 || status === 403;
      setUncertain(saveStillUnknown); setConflict(status === 409);
      if (status === 401 || status === 403) { setBlocked(true); collection.reload(); }
      if (!saveStillUnknown && status >= 400 && status < 500 && status !== 409) setAttempt(null);
    } finally { if (running.current === controller) running.current = null; if (!controller.signal.aborted && work.current === controller) setPendingScope(null); }
  }
  return <section id="peco-application-review" className={styles.section} aria-labelledby="peco-application-title">
    <h2 id="peco-application-title">Your private PECO CAP answers</h2>
    <p>Saving answers prepares this request. It does not apply for CAP, establish enrollment, change payments or protect against shutoff.</p>
    <a className={styles.textLink} href={PECO_HELP_URL}>Open official PECO help</a>
    {saved.loading ? <ParentLoading label="Loading saved PECO answers"/> : saved.error && !empty ? <ServiceError error={saved.error} retry={() => setRead(current => current + 1)} returnTo={`/support/${request.id}`}/> : <>
      {record ? <><p className={styles.hint}>Saved revision {record.revision} · {displayDate(record.created_at, true)}. Original per-field dates remain unchanged when answers are reused.</p>
        <PrivateAnswers value={record.details}/></> : empty ? <p>No private PECO answers are saved for this request. Official help remains available.</p> : <p>The saved PECO evidence needs a service check before it can be used. Try loading it again.</p>}
      {draft && (!editingCurrent || conflict) && <div className={styles.notice}><div><p>The request changed. Your unsaved draft is still on this page. Loading saved answers replaces that draft.</p>
        <button type="button" className={styles.secondary} onClick={() => { setDraft(null); setAttempt(null); setConflict(false); setUncertain(false); setError(null); setRead(current => current + 1); onChange?.(); }}>Load latest saved PECO answers</button></div></div>}
      {draft && permitted && editingCurrent ? <form ref={form} className={styles.form} aria-label="Correct PECO application answers" onSubmit={submit}>
        <PecoApplicationNotice/>
        <PecoApplicationFormFields value={draft.value} disabled={pending || uncertain || conflict} idPrefix="saved-peco" onChange={value => { setDraft({ ...draft, value }); setAttempt(null); setError(null); }}/>
        <p>{PECO_SUBJECT_AUTHORITY_STATEMENT}</p><p>{PECO_ACCOUNT_AUTHORITY_STATEMENT}</p>
        <p className={styles.hint}>Choosing Save PECO changes makes these declarations for the people and exact account in this revision. It saves a partial draft when answers are missing. Your PECO request remains {request.status === "paused" ? "paused" : "subject to its current permission"}; no provider submission is authorized by this save.</p>
        {uncertain && <p className={styles.notice}>The save result is unconfirmed. Retry the same save before editing or creating another revision.</p>}
        <div className={styles.inline}><button className={styles.button} disabled={pending || conflict}>{pending ? "Saving PECO answers…" : uncertain ? "Retry the same PECO save" : "Save PECO changes"}</button>
          {!uncertain && <button type="button" className={styles.quiet} disabled={pending} onClick={() => { setDraft(null); setAttempt(null); setError(null); }}>Cancel PECO editing</button>}</div>
      </form> : <>
        {current && permitted && !draft && <button type="button" className={styles.secondary} onClick={edit}>{record ? "Correct PECO answers" : "Add private PECO answers"}</button>}
        {!permitted && <p className={styles.hint}>Private PECO changes are closed or their current permission is unavailable. Saved answers remain readable where account access permits. {draft && "Your unsaved draft remains on this page; no new answers can be entered until access is restored."}</p>}
      </>}
    </>}
    {error && <ServiceError error={error} returnTo={`/support/${request.id}`}/>}
    {(!permitted || collection.error || blocked) && <button type="button" className={styles.secondary} disabled={pending} onClick={checkAccess}>Check PECO editing access again</button>}
    {message && <p className={styles.success} role="status">{message}</p>}
  </section>;
}
