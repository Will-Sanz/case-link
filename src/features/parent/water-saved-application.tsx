"use client";
import { Fragment, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import type { SupportRequest } from "@/lib/parent/domain";
import { waterApplicationFieldsValueSchema, assessWaterApplicationFields, type WaterApplicationFields } from "@/lib/parent/water-application-fields";
import { waterApplicationSnapshotSchema } from "@/lib/parent/water-application-snapshot";
import { isUtilityPreparationMandate } from "@/lib/parent/utility-preparation-scope";
import { WATER_APPLICATION_NOTICE_VERSION, WATER_SUBJECT_AUTHORITY_STATEMENT, WATER_ACCOUNT_AUTHORITY_STATEMENT } from "@/lib/parent/water-application-fields";
import { boundedParentApi, canCollectWaterApplication, displayDate, ParentApiError, type ParentAuthorizationWindow } from "./api";
import { useParentResource } from "./use-parent-resource";
import { useSavedApplicationDraft } from "./use-saved-application-draft";
import { usePermissionWindow } from "./use-permission-window";
import { ParentLoading, ServiceError } from "./feedback";
import { WaterApplicationNotice, WaterApplicationFormFields, WATER_HELP_URL, WATER_INCOME_LABELS } from "./water-application-form";
import styles from "./parent.module.css";

const reply = z.object({ snapshot: waterApplicationSnapshotSchema });
function PrivateAnswers({ value }: { value: WaterApplicationFields }) {
  const person = (input: WaterApplicationFields["applicant"]) => <>
    <dl className={styles.factList}><dt>Full name</dt><dd>{input?.name ?? "Not provided"}</dd><dt>Date of birth</dt><dd>{input?.dateOfBirth ? displayDate(input.dateOfBirth) : "Not provided"}</dd><dt>Reported gross monthly income</dt><dd>{input?.grossMonthlyIncome !== undefined ? `$${input.grossMonthlyIncome}` : "Not provided"}</dd></dl>
    <p>Income source inventory: {input?.income?.state === "none" ? "No income sources" : input?.income?.state === "unknown" ? "Not sure" : input?.income?.state === "sources" ? input.income.sources.map(source => WATER_INCOME_LABELS[source.kind]).join(", ") : "Not provided"}</p>
  </>;
  return <details className={styles.disclosure}><summary>Read privately saved water assistance answers</summary>
    <p>Help needed: {value.journey === "new_application" ? "New application preparation" : value.journey === "recertification" ? "Recertification preparation" : value.journey === "pending" ? "Follow-up on an existing application" : value.journey === "unknown" ? "Not sure" : "Not provided"}</p>
    <p>Your report of an existing City application: {value.existingApplication === "none_known" ? "None known" : value.existingApplication === "saved" ? "Saved" : value.existingApplication === "submitted" ? "Submitted" : value.existingApplication === "unknown" ? "Not sure" : "Not provided"}. City status and shutoff protection are unverified.</p>
    <p>Completion preference: {value.preferredChannel === "online" ? "Online" : value.preferredChannel === "paper" ? "Paper" : value.preferredChannel === "assisted" ? "With in-person help" : value.preferredChannel === "unknown" ? "Not sure" : "Not provided"}.</p>
    <h3>Applicant</h3>{person(value.applicant)}
    <dl className={styles.factList}>{Object.entries({ propertyAddress: "Property address", mailingAddress: "Mailing address", phone: "Daytime phone", email: "Email" }).map(([key, label]) => <Fragment key={key}><dt>{label}</dt><dd>{value[key as "propertyAddress" | "mailingAddress" | "phone" | "email"] ?? "Not provided"}</dd></Fragment>)}</dl>
    <p>Owner Occupied Payment Agreement: {value.oopa === "yes" ? "Yes" : value.oopa === "no" ? "No" : value.oopa === "unknown" ? "Not sure" : "Not provided"}.</p>
    {value.householdMembers?.map((member, index) => <div key={member.id}><h3>Household member {index + 1}</h3>{person(member)}<p>Relationship to applicant: {member.relationship ?? "Not provided"}</p></div>)}
    <p>Full household list: {value.householdComplete === true ? "Declared complete" : value.householdComplete === false ? "Not yet / not sure" : "Not provided"}.</p>
    <p>Child support: {value.childSupportReceived === "yes" ? "Yes" : value.childSupportReceived === "no" ? "No" : value.childSupportReceived === "unknown" ? "Not sure" : "Not provided"}{value.childSupportMonthlyAmount !== undefined ? ` · $${value.childSupportMonthlyAmount} monthly` : ""}.</p>
    <p>Outside financial support: {value.outsideIncomeSupport === "yes" ? "Yes" : value.outsideIncomeSupport === "no" ? "No" : value.outsideIncomeSupport === "unknown" ? "Not sure" : "Not provided"}.</p>
    {value.livingExpenses && <dl className={styles.factList}>{Object.entries({ food: "How the applicant pays for food", housing: "How the applicant pays for housing", utilities: "How the applicant pays for utilities" }).map(([key, label]) => <Fragment key={key}><dt>{label}</dt><dd>{value.livingExpenses?.[key as keyof NonNullable<WaterApplicationFields["livingExpenses"]>] ?? "Not provided"}</dd></Fragment>)}</dl>}
    {value.outsideSupporters?.map((supporter, index) => <div key={supporter.id}><h3>Outside supporter {index + 1}</h3><dl className={styles.factList}>{Object.entries({ name: "Name", address: "Address", phone: "Daytime phone", relationship: "Relationship", amount: "Support in dollars", frequency: "Frequency", frequencyDescription: "Other frequency", stillProviding: "Still providing support" }).map(([key, label]) => <Fragment key={key}><dt>{label}</dt><dd>{supporter[key as keyof typeof supporter] ?? "Not provided"}</dd></Fragment>)}</dl></div>)}
  </details>;
}

export function WaterSavedApplication({ request, onChange }: { request: SupportRequest; onChange?: () => void }) {
  const [read, setRead] = useState(0);
  const saved = useParentResource<unknown>(`/requests/${request.id}/water-application?requestVersion=${request.version}&read=${read}`);
  const collection = useParentResource<ParentAuthorizationWindow>(`/authorization-window?waterRequestVersion=${request.version}`);
  const form = useRef<HTMLFormElement>(null);
  const parsed = reply.safeParse(saved.data);
  const record = parsed.success && parsed.data.snapshot.request_id === request.id ? parsed.data.snapshot : null;
  const assessment = record ? assessWaterApplicationFields(record.details, new Date()) : null;
  const empty = saved.error instanceof ParentApiError && saved.error.status === 404;
  const expiry = Math.min(Date.parse(request.mandate.expiresAt), Date.parse(collection.data?.authorization?.waterApplication?.expiresAt ?? ""));
  const withinWindow = usePermissionWindow(expiry);
  const available = withinWindow && canCollectWaterApplication(collection.data) && !collection.error &&
    request.intake.needs.length === 1 && request.intake.needs[0] === "water" && request.intake.utilityProviders.length === 1 && request.intake.utilityProviders[0] === "pwd" && ["self", "authorized_caregiver"].includes(request.intake.accountAuthority) && ["active", "paused"].includes(request.status) &&
    isUtilityPreparationMandate(request.mandate, "pwd-tap");
  const current = !saved.loading && (!!record && record.request_version <= request.version && !saved.error || empty);
  const savedMessage = request.status === "paused" ? "Your water assistance answers are saved. Your request stays paused; nothing has been sent." : "Your private water assistance answers are saved as a new revision. Nothing has been sent; no City application, financial terms or shutoff protection is confirmed.";
  const editor = useSavedApplicationDraft<WaterApplicationFields>({ request, record, current, available, savedMessage,
    onSaved: () => { setRead(current => current + 1); onChange?.(); }, onAccessDenied: collection.reload });
  const { draft, error, message, blocked, uncertain, conflict, pending, permitted, editingCurrent } = editor;
  function edit() { editor.begin(record?.details ?? {}); }
  useLayoutEffect(() => { if (editingCurrent && permitted) form.current?.querySelector<HTMLElement>("input,select,button")?.focus(); }, [draft?.snapshotId, editingCurrent, permitted]);
  async function checkAccess() {
    await editor.checkAccess(async signal => {
      const latest = await boundedParentApi("/authorization-window", {}, signal, new Date(Date.now() + 30000).toISOString()) as ParentAuthorizationWindow;
      signal.throwIfAborted();
      if (!canCollectWaterApplication(latest)) throw new Error("Private water changes are unavailable. Your unsaved draft remains on this page.");
      collection.reload();
    });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    await editor.save(`/requests/${request.id}/water-application`, new Date(expiry).toISOString(), (value, expectedVersion) => {
      const details = waterApplicationFieldsValueSchema.safeParse(value);
      if (!details.success) throw new ParentApiError("Check the names, birth dates, addresses, contact information, exact dollar amounts and income source lists. Unknown answers can stay blank.", 400);
      return { expectedVersion, details: details.data, noticeVersion: WATER_APPLICATION_NOTICE_VERSION, subjectAuthorityDeclared: true, accountAuthorityDeclared: true };
    });
  }
  return <section id="water-application-review" className={styles.section} aria-labelledby="water-application-title">
    <h2 id="water-application-title">Your private water assistance answers</h2>
    <p>Saving prepares reference answers. It does not request or submit a City application, choose financial terms or establish shutoff protection.</p>
    <a className={styles.textLink} href={WATER_HELP_URL}>Open official water help</a>
    {saved.loading ? <ParentLoading label="Loading saved water answers"/> : saved.error && !empty ? <ServiceError error={saved.error} retry={() => setRead(current => current + 1)} returnTo={`/support/${request.id}`}/> : <>
      {record ? <><p className={styles.hint}>Saved revision {record.revision} · {displayDate(record.created_at, true)}. Original per-field dates remain unchanged when answers are reused.</p>
        <PrivateAnswers value={record.details}/>
        {assessment && <div className={styles.notice}><div><p>{assessment.missingFacts.length ? "Some preparation answers are still missing. You can keep a partial draft." : "The currently supported preparation answers are present. This is not a complete, issued City application."}</p>
          <p>CaseLink still needs the actual account-issued form, protected account access, validated proof, required personal acts and a verified submission connection. These are service dependencies; saving does not confirm City status or shutoff protection.</p>
          {(record.details.existingApplication === "saved" || record.details.existingApplication === "submitted" || record.details.journey === "pending") && <p>Your report requires recovery or follow-up before any new City application request. CaseLink has not verified that status.</p>}
        </div></div>}</> : empty ? <p>No private water answers are saved for this request. Official help remains available.</p> : <p>The saved water evidence needs a service check before it can be used. Try loading it again.</p>}
      {draft && (!editingCurrent || conflict) && <div className={styles.notice}><div><p>The request changed. Your unsaved draft is still on this page. Loading saved answers replaces that draft.</p>
        <button type="button" className={styles.secondary} onClick={() => { editor.reset(); setRead(current => current + 1); onChange?.(); }}>Load latest saved water answers</button></div></div>}
      {draft && permitted && editingCurrent ? <form ref={form} className={styles.form} aria-label="Correct water application answers" onSubmit={submit}>
        <WaterApplicationNotice/>
        <WaterApplicationFormFields value={draft.value} disabled={pending || uncertain || conflict} idPrefix="saved-water" onChange={editor.change}/>
        <p>{WATER_SUBJECT_AUTHORITY_STATEMENT}</p><p>{WATER_ACCOUNT_AUTHORITY_STATEMENT}</p>
        <p className={styles.hint}>Choosing Save water changes makes these declarations for the people and exact account in this revision. It saves a partial draft when answers are missing. Your water request remains {request.status === "paused" ? "paused" : "subject to its current permission"}; no provider submission is authorized by this save.</p>
        {uncertain && <p className={styles.notice}>The save result is unconfirmed. Retry the same save before editing or creating another revision.</p>}
        <div className={styles.inline}><button className={styles.button} disabled={pending || conflict}>{pending ? "Saving water answers…" : uncertain ? "Retry the same water save" : "Save water changes"}</button>
          {!uncertain && <button type="button" className={styles.quiet} disabled={pending} onClick={editor.reset}>Cancel water editing</button>}</div>
      </form> : <>
        {current && permitted && !draft && <button type="button" className={styles.secondary} onClick={edit}>{record ? "Correct water answers" : "Add private water answers"}</button>}
        {!permitted && <p className={styles.hint}>Private water changes are closed or their current permission is unavailable. Saved answers remain readable where account access permits. {draft && "Your unsaved draft remains on this page; no new answers can be entered until access is restored."}</p>}
      </>}
    </>}
    {error && <ServiceError error={error} returnTo={`/support/${request.id}`}/>}
    {(!permitted || collection.error || blocked) && <button type="button" className={styles.secondary} disabled={pending} onClick={checkAccess}>Check water editing access again</button>}
    {message && <p className={styles.success} role="status">{message}</p>}
  </section>;
}
