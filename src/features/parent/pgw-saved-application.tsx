"use client";
import { Fragment, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import type { SupportRequest } from "@/lib/parent/domain";
import { pgwApplicationFieldsValueSchema, type PgwApplicationFields } from "@/lib/parent/pgw-application-fields";
import { pgwApplicationSnapshotSchema } from "@/lib/parent/pgw-application-snapshot";
import { isUtilityPreparationMandate } from "@/lib/parent/utility-preparation-scope";
import { PGW_APPLICATION_NOTICE_VERSION, PGW_SUBJECT_AUTHORITY_STATEMENT, PGW_ACCOUNT_AUTHORITY_STATEMENT } from "@/lib/parent/pgw-application-fields";
import { boundedParentApi, canCollectPgwApplication, displayDate, ParentApiError, type ParentAuthorizationWindow } from "./api";
import { useParentResource } from "./use-parent-resource";
import { useSavedApplicationDraft } from "./use-saved-application-draft";
import { usePermissionWindow } from "./use-permission-window";
import { ParentLoading, ServiceError } from "./feedback";
import { PgwApplicationNotice, PgwApplicationFormFields, PGW_HELP_URL, PGW_INCOME_LABELS } from "./pgw-application-form";
import styles from "./parent.module.css";

const reply = z.object({ snapshot: pgwApplicationSnapshotSchema });
function PrivateAnswers({ value }: { value: PgwApplicationFields }) {
  const answer = (input?: boolean) => input === true ? "Yes" : input === false ? "No" : "Not provided / not sure";
  const amount = (cents?: number) => cents === undefined ? "Not provided" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
  const address = (input: PgwApplicationFields["address"]) => <dl className={styles.factList}>{Object.entries({ street: "Street address", city: "City", state: "State", zip: "ZIP" }).map(([key, label]) => <Fragment key={key}><dt>{label}</dt><dd>{input?.[key as keyof NonNullable<PgwApplicationFields["address"]>] ?? "Not provided"}</dd></Fragment>)}</dl>;
  const person = (input: PgwApplicationFields["customer"]) => <>
    <dl className={styles.factList}>{Object.entries({ firstName: "First name", lastName: "Last name" }).map(([key, label]) => <Fragment key={key}><dt>{label}</dt><dd>{input?.[key as "firstName" | "lastName"] ?? "Not provided"}</dd></Fragment>)}</dl>
    <p>Income source inventory: {input?.income?.state === "none" ? "No income sources" : input?.income?.state === "unknown" ? "Not sure" : input?.income?.state === "sources" ? input.income.sources.map(source => PGW_INCOME_LABELS[source.kind]).join(", ") : "Not provided"}</p>
    {input?.income?.noIncomeSituation && <p>Brief no-income situation: {input.income.noIncomeSituation}</p>}
  </>;
  return <details className={styles.disclosure}><summary>Read privately saved PGW CRP answers</summary>
    <p>CRP help needed: {value.journey === "new_enrollment" ? "New enrollment preparation" : value.journey === "recertification" ? "Recertification preparation" : value.journey === "reenrollment" ? "Return to CRP preparation" : value.journey === "pending" ? "Existing application follow-up" : value.journey === "unknown" ? "Not sure" : "Not provided"}</p>
    <p>Reported CRP enrollment: {value.currentCrpState === "enrolled" ? "Currently enrolled" : value.currentCrpState === "not_enrolled" ? "Not enrolled" : value.currentCrpState === "previously_enrolled" ? "Previously enrolled" : value.currentCrpState === "unknown" ? "Not sure" : "Not provided"}. This is your answer, not a PGW status check.</p>
    <p>PGW account number: {value.accountNumber ?? "Not provided"}</p><h3>Customer of record</h3>{person(value.customer)}
    <p>Customer under 18: {answer(value.customer?.under18)}. The customer’s government identifier and birth date are not collected here.</p>
    <h3>PGW service address and contact</h3>{address(value.address)}<p>Contact phone: {value.phone ?? "Not provided"}</p>
    {value.householdMembers?.map((member, index) => <div key={member.id}><h3>Household member {index + 1}</h3>{person(member)}<p>Date of birth: {member.dateOfBirth ? displayDate(member.dateOfBirth) : "Not provided"}. Relationship to customer: {member.relationship ?? "Not provided"}.</p></div>)}
    <p>Full household list: {value.householdComplete === true ? "Declared complete" : value.householdComplete === false ? "Not yet" : "Not provided"}.</p>
    <h3>Outside support</h3><p>Receives financial support from outside the household: {answer(value.outsideSupport?.receives)}</p>
    {value.outsideSupport?.supporter && <><p>Outside supporter: {value.outsideSupport.supporter.firstName ?? "Not provided"} {value.outsideSupport.supporter.lastName ?? ""}.</p>{address(value.outsideSupport.supporter.address)}<p>Phone: {value.outsideSupport.supporter.phone ?? "Not provided"}. Monthly support: {amount(value.outsideSupport.supporter.monthlyAmountCents)}.</p></>}
    <p>Reported no income for the entire household in the past 30 days: {answer(value.zeroIncomePast30Days)}</p>
    {value.livingExpenses && <dl className={styles.factList}>{Object.entries({ food: "How food is paid", housing: "How housing is paid", utilities: "How utilities are paid" }).map(([key, label]) => <Fragment key={key}><dt>{label}</dt><dd>{value.livingExpenses?.[key as keyof NonNullable<PgwApplicationFields["livingExpenses"]>] ?? "Not provided"}</dd></Fragment>)}</dl>}
    <p>Receives SNAP: {answer(value.snap?.receives)}. Monthly amount: {amount(value.snap?.monthlyAmountCents)}.</p><p>Receives housing subsidy: {answer(value.housingSubsidy?.receives)}. Monthly amount: {amount(value.housingSubsidy?.monthlyAmountCents)}.</p>
    <p>Required member identifiers and income evidence are separate protected items. These answers contain no personal signature or financial assent.</p>
  </details>;
}

export function PgwSavedApplication({ request, onChange }: { request: SupportRequest; onChange?: () => void }) {
  const [read, setRead] = useState(0);
  const saved = useParentResource<unknown>(`/requests/${request.id}/pgw-application?requestVersion=${request.version}&read=${read}`);
  const collection = useParentResource<ParentAuthorizationWindow>(`/authorization-window?pgwRequestVersion=${request.version}`);
  const form = useRef<HTMLFormElement>(null);
  const parsed = reply.safeParse(saved.data);
  const record = parsed.success && parsed.data.snapshot.request_id === request.id ? parsed.data.snapshot : null;
  const empty = saved.error instanceof ParentApiError && saved.error.status === 404;
  const expiry = Math.min(Date.parse(request.mandate.expiresAt), Date.parse(collection.data?.authorization?.pgwApplication?.expiresAt ?? ""));
  const withinWindow = usePermissionWindow(expiry);
  const available = withinWindow && canCollectPgwApplication(collection.data) && !collection.error &&
    request.intake.needs.length === 1 && request.intake.needs[0] === "gas" && request.intake.utilityProviders.length === 1 && request.intake.utilityProviders[0] === "pgw" && ["self", "authorized_caregiver"].includes(request.intake.accountAuthority) && ["active", "paused"].includes(request.status) &&
    isUtilityPreparationMandate(request.mandate, "pgw-crp");
  const current = !saved.loading && (!!record && record.request_version <= request.version && !saved.error || empty);
  const savedMessage = request.status === "paused" ? "Your PGW CRP answers are saved. Your request stays paused; nothing has been sent." : "Your private PGW CRP answers are saved as a new revision. Nothing has been sent; no CRP enrollment, financial agreement, payment change or shutoff protection is confirmed.";
  const editor = useSavedApplicationDraft<PgwApplicationFields>({ request, record, current, available, savedMessage,
    onSaved: () => { setRead(current => current + 1); onChange?.(); }, onAccessDenied: collection.reload });
  const { draft, error, message, blocked, uncertain, conflict, pending, permitted, editingCurrent } = editor;
  function edit() { editor.begin(record?.details ?? {}); }
  useLayoutEffect(() => { if (editingCurrent && permitted) form.current?.querySelector<HTMLElement>("input,select,button")?.focus(); }, [draft?.snapshotId, editingCurrent, permitted]);
  async function checkAccess() {
    await editor.checkAccess(async signal => {
      const latest = await boundedParentApi("/authorization-window", {}, signal, new Date(Date.now() + 30000).toISOString()) as ParentAuthorizationWindow;
      signal.throwIfAborted();
      if (!canCollectPgwApplication(latest)) throw new Error("Private PGW changes are unavailable. Your unsaved draft remains on this page.");
      collection.reload();
    });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    await editor.save(`/requests/${request.id}/pgw-application`, new Date(expiry).toISOString(), (value, expectedVersion) => {
      const details = pgwApplicationFieldsValueSchema.safeParse(value);
      if (!details.success) throw new ParentApiError("Check the PGW account, names, dates, contact details, income source lists, outside support and monthly amounts. Unknown answers can stay blank.", 400);
      return { expectedVersion, details: details.data, noticeVersion: PGW_APPLICATION_NOTICE_VERSION, subjectAuthorityDeclared: true, accountAuthorityDeclared: true };
    });
  }
  return <section id="pgw-application-review" className={styles.section} aria-labelledby="pgw-application-title">
    <h2 id="pgw-application-title">Your private PGW CRP answers</h2>
    <p>Saving answers prepares this request. It does not apply for CRP, establish enrollment, change payments or protect against shutoff.</p>
    <a className={styles.textLink} href={PGW_HELP_URL}>Open official PGW help</a>
    {saved.loading ? <ParentLoading label="Loading saved PGW answers"/> : saved.error && !empty ? <ServiceError error={saved.error} retry={() => setRead(current => current + 1)} returnTo={`/support/${request.id}`}/> : <>
      {record ? <><p className={styles.hint}>Saved revision {record.revision} · {displayDate(record.created_at, true)}. Original per-field dates remain unchanged when answers are reused.</p>
        <PrivateAnswers value={record.details}/></> : empty ? <p>No private PGW answers are saved for this request. Official help remains available.</p> : <p>The saved PGW evidence needs a service check before it can be used. Try loading it again.</p>}
      {draft && (!editingCurrent || conflict) && <div className={styles.notice}><div><p>The request changed. Your unsaved draft is still on this page. Loading saved answers replaces that draft.</p>
        <button type="button" className={styles.secondary} onClick={() => { editor.reset(); setRead(current => current + 1); onChange?.(); }}>Load latest saved PGW answers</button></div></div>}
      {draft && permitted && editingCurrent ? <form ref={form} className={styles.form} aria-label="Correct PGW application answers" onSubmit={submit}>
        <PgwApplicationNotice/>
        <PgwApplicationFormFields value={draft.value} disabled={pending || uncertain || conflict} idPrefix="saved-pgw" onChange={editor.change}/>
        <p>{PGW_SUBJECT_AUTHORITY_STATEMENT}</p><p>{PGW_ACCOUNT_AUTHORITY_STATEMENT}</p>
        <p className={styles.hint}>Choosing Save PGW changes makes these declarations for the people and exact account in this revision. It saves a partial draft when answers are missing. Your PGW request remains {request.status === "paused" ? "paused" : "subject to its current permission"}; no provider submission is authorized by this save.</p>
        {uncertain && <p className={styles.notice}>The save result is unconfirmed. Retry the same save before editing or creating another revision.</p>}
        <div className={styles.inline}><button className={styles.button} disabled={pending || conflict}>{pending ? "Saving PGW answers…" : uncertain ? "Retry the same PGW save" : "Save PGW changes"}</button>
          {!uncertain && <button type="button" className={styles.quiet} disabled={pending} onClick={editor.reset}>Cancel PGW editing</button>}</div>
      </form> : <>
        {current && permitted && !draft && <button type="button" className={styles.secondary} onClick={edit}>{record ? "Correct PGW answers" : "Add private PGW answers"}</button>}
        {!permitted && <p className={styles.hint}>Private PGW changes are closed or their current permission is unavailable. Saved answers remain readable where account access permits. {draft && "Your unsaved draft remains on this page; no new answers can be entered until access is restored."}</p>}
      </>}
    </>}
    {error && <ServiceError error={error} returnTo={`/support/${request.id}`}/>}
    {(!permitted || collection.error || blocked) && <button type="button" className={styles.secondary} disabled={pending} onClick={checkAccess}>Check PGW editing access again</button>}
    {message && <p className={styles.success} role="status">{message}</p>}
  </section>;
}
