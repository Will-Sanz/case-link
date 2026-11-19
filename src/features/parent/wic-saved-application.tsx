"use client";
import { Fragment, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import type { SupportRequest } from "@/lib/parent/domain";
import { wicApplicationFieldsValueSchema, wicApplicationLeaves, type WicApplicationFields } from "@/lib/parent/wic-application-fields";
import { wicApplicationSnapshotSchema } from "@/lib/parent/wic-application-snapshot";
import { WIC_APPLICATION_NOTICE_VERSION, WIC_SUBJECT_AUTHORITY_STATEMENT } from "@/lib/parent/constants";
import { boundedParentApi, canCollectWicApplication, displayDate, ParentApiError, type ParentAuthorizationWindow } from "./api";
import { useParentResource } from "./use-parent-resource";
import { useSavedApplicationDraft } from "./use-saved-application-draft";
import { SavedFamilyProfileNotice, useSavedFamilyProfile } from "./use-saved-family-profile";
import { usePermissionWindow } from "./use-permission-window";
import { ParentLoading, ServiceError } from "./feedback";
import { WicApplicationNotice, WicApplicationFormFields } from "./wic-application-form";
import source from "../../../data/verified-forms/wic-pa-preapplication-2026-11-13.json";
import { useParentLocale } from "./parent-locale";
import styles from "./parent.module.css";
import wicStyles from "./wic.module.css";

const reply = z.object({ snapshot: wicApplicationSnapshotSchema,
  routingContext: z.object({ label: z.string(), zip: z.string().regex(/^[0-9]{5}$/).nullable() }) });
const contactLabels = { firstName: "First name", lastName: "Last name", dateOfBirth: "Date of birth", street: "Street address", city: "City", zip: "Contact postal ZIP", county: "County", email: "Email", phone: "Phone" };

function PrivateAnswers({ value }: { value: WicApplicationFields }) {
  const { t, locale } = useParentLocale();
  const person = (input: WicApplicationFields["contact"], childId?: string) => <dl className={styles.factList}>
    {Object.entries(contactLabels).map(([key, label]) => {
      const text = input?.[key as keyof NonNullable<typeof input>];
      return <Fragment key={key}><dt>{t(label)}</dt><dd>{text ? key === "dateOfBirth" ? displayDate(text, false, locale) : text : t("Not provided")}</dd></Fragment>;
    }).filter((_, index) => !childId || index < 3)}
  </dl>;
  return <details className={styles.disclosure}><summary>{t("Read privately saved WIC answers")}</summary>
    <p>{t("Application status: ")}{t(value.applicationType === "new" ? "New" : value.applicationType === "reapplying" ? "Re-applying" : value.applicationType === "transfer" ? "Transfer from another county or state" : "Not provided")}</p>
    <p>{t("Applying for: ")}{t(value.beneficiaries === "mother" ? "Mother" : value.beneficiaries === "children" ? "Children" : value.beneficiaries === "mother_and_children" ? "Mother and children" : "Not provided")}</p>
    <p>{t("Appointment preference: ")}{t(value.appointmentPreference === "morning" ? "Morning" : value.appointmentPreference === "afternoon" ? "Afternoon" : "Not provided")}{t(". No appointment is confirmed by this preference.")}</p>
    <h3>{t("Contact person")}</h3>{person(value.contact)}
    {value.mother && <><h3>{t("Mother")}</h3>{person(value.mother, "mother")}<p>{t("Status: ")}{t(value.mother.status === "pregnant" ? "Pregnant" : value.mother.status === "postpartum" ? "Had a baby in the last 6 months" : value.mother.status === "breastfeeding" ? "Breastfeeding an infant under 12 months" : "Not provided")}</p>
      {value.mother.expectedDeliveryDate && <p>{t("Expected delivery: ")}{displayDate(value.mother.expectedDeliveryDate, false, locale)}</p>}</>}
    {value.children?.map((child, index) => <div key={child.id}><h3>{t("Child ")}{index + 1}</h3>{person(child, child.id)}</div>)}
  </details>;
}

export function WicSavedApplication({ request, onChange }: { request: SupportRequest; onChange?: () => void }) {
  const { t, locale } = useParentLocale();
  const [read, setRead] = useState(0);
  const [confirmation, setConfirmation] = useState<{ scope: string; paths: string[] }>({ scope: "", paths: [] });
  const saved = useParentResource<unknown>(`/requests/${request.id}/wic-application?requestVersion=${request.version}&read=${read}`);
  const collection = useParentResource<ParentAuthorizationWindow>(`/authorization-window?wicRequestVersion=${request.version}`);
  const form = useRef<HTMLFormElement>(null);
  const parsed = reply.safeParse(saved.data);
  const record = parsed.success && parsed.data.snapshot.request_id === request.id ? parsed.data.snapshot : null;
  const empty = saved.error instanceof ParentApiError && saved.error.status === 404;
  const expiry = Math.min(Date.parse(request.mandate.expiresAt), Date.parse(collection.data?.authorization?.wicApplication?.expiresAt ?? ""));
  const withinWindow = usePermissionWindow(expiry);
  const available = withinWindow && canCollectWicApplication(collection.data) && !collection.error &&
    request.intake.needs.length === 1 && request.intake.needs[0] === "wic_new" && ["active", "paused"].includes(request.status) &&
    request.mandate.recipientIds.includes("wic-pa") && request.mandate.allowedActions.includes("prepare") && request.mandate.allowedData.includes("household");
  const current = !saved.loading && (!!record && record.request_version <= request.version && !saved.error || empty);
  const savedMessage = request.status === "paused" ? "Your WIC answers are saved. Your request stays paused; nothing has been sent." : "Your private WIC answers are saved as a new revision. Nothing has been sent and no appointment or enrollment is confirmed.";
  const editor = useSavedApplicationDraft<WicApplicationFields>({ request, record, current, available, savedMessage,
    onSaved: () => { setRead(current => current + 1); onChange?.(); }, onAccessDenied: collection.reload });
  const { draft, error, message, blocked, uncertain, conflict, pending, permitted, editingCurrent } = editor;
  const family = useSavedFamilyProfile({ request, program: "wic-pa", snapshotId: record?.id, permitted, onOwnerChanged: editor.reset });
  const confirmationScope = JSON.stringify([request.id, request.version, record?.id]);
  const originalLeaves = wicApplicationLeaves(record?.details ?? {}), draftLeaves = wicApplicationLeaves(draft?.value ?? {});
  const eligiblePaths = family.unavailablePaths.filter(path => typeof draftLeaves[path] === "string" && draftLeaves[path] === originalLeaves[path]);
  const confirmedPaths = confirmation.scope === confirmationScope ? confirmation.paths.filter(path => eligiblePaths.includes(path)) : [];
  function change(value: WicApplicationFields) {
    const next = wicApplicationLeaves(value);
    setConfirmation({ scope: confirmationScope, paths: confirmedPaths.filter(path => draftLeaves[path] === next[path]) });
    editor.change(value);
  }
  async function edit() { const value = await family.load(record?.details ?? {}); if (value) { setConfirmation({ scope: confirmationScope, paths: [] }); editor.begin(value); } }
  async function refreshFamily() { if (uncertain) return; if (draft) { const value = await family.load(draft.value); if (value) change(value); } else await edit(); }
  useLayoutEffect(() => { if (editingCurrent && permitted) (form.current?.querySelector<HTMLElement>("input,select,textarea") ?? form.current?.querySelector<HTMLElement>("button"))?.focus(); }, [draft?.snapshotId, editingCurrent, permitted]);
  async function checkAccess() {
    await editor.checkAccess(async signal => {
      const latest = await boundedParentApi("/authorization-window", {}, signal, new Date(Date.now() + 30000).toISOString()) as ParentAuthorizationWindow;
      signal.throwIfAborted();
      if (!canCollectWicApplication(latest)) throw new Error("Private WIC changes are unavailable. Your unsaved draft remains on this page.");
      collection.reload();
    });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    await editor.save(`/requests/${request.id}/wic-application`, new Date(expiry).toISOString(), async (value, expectedVersion, signal) => {
      const details = wicApplicationFieldsValueSchema.safeParse(value);
      if (!details.success) throw new ParentApiError("Check the WIC names, dates, address and contact answers. Unknown answers can stay blank.", 400);
      const familyProfileSource = await family.source(details.data, signal);
      return { expectedVersion, details: details.data, ...(familyProfileSource ? { familyProfileSource } : {}), noticeVersion: WIC_APPLICATION_NOTICE_VERSION, subjectAuthorityDeclared: true, ...(confirmedPaths.length ? { confirmedPaths } : {}) };
    });
  }
  return <section lang={locale} id="wic-application-review" className={`${styles.section} ${wicStyles.answers}`} aria-labelledby="wic-application-title">
    <h2 id="wic-application-title">{t("Your private WIC answers")}</h2>
    <p>{t("Saving answers prepares this request. It does not send a pre-application, confirm an appointment or establish enrollment.")}</p>
    <a className={styles.textLink} href={source.officialGuidanceUrl}>{t("Open official WIC help")}</a>
    {saved.loading ? <ParentLoading label={t("Loading saved WIC answers")}/> : saved.error && !empty ? <ServiceError error={saved.error} retry={() => setRead(current => current + 1)} returnTo={`/support/${request.id}`}/> : <>
      {record ? <><p className={styles.hint}>{t("Saved revision ")}{record.revision}{t(" · ")}{displayDate(record.created_at, true, locale)}{t(". Original per-field dates remain unchanged when answers are reused.")}</p>
        {parsed.success && <p className={styles.hint}>{t(parsed.data.routingContext.label)} {parsed.data.routingContext.zip ?? t("No current routing ZIP is available.")}</p>}
        <PrivateAnswers value={record.details}/></> : empty ? <p>{t("No private WIC answers are saved for this request. Official help remains available.")}</p> : <p>{t("The saved WIC evidence needs a service check before it can be used. Try loading it again.")}</p>}
      {draft && (!editingCurrent || conflict) && <div className={styles.notice}><div><p>{t("The request changed. Your unsaved draft is still on this page. Loading saved answers replaces that draft.")}</p>
        <button type="button" className={styles.secondary} onClick={() => { editor.reset(); setRead(current => current + 1); onChange?.(); }}>{t("Load latest saved WIC answers")}</button></div></div>}
      {draft && permitted && editingCurrent ? <form ref={form} className={styles.form} aria-label={t("Correct WIC application answers")} onSubmit={submit}>
        <WicApplicationNotice/>
        {family.notice && <div className={wicStyles.profileNotice}><SavedFamilyProfileNotice reuse={family} refresh={refreshFamily} disabled={pending || uncertain || conflict || family.loading || family.blocked}/></div>}
        <WicApplicationFormFields value={draft.value} disabled={pending || uncertain || conflict || family.loading || family.blocked} idPrefix="saved-wic" onChange={change}/>
        {eligiblePaths.length > 0 && <fieldset className={styles.fieldset} disabled={pending || uncertain || conflict || family.loading || family.blocked}>
          <legend className={styles.legend}>{t("Confirm only answers that are still correct")}</legend>
          <p className={styles.hint}>{t("These answers no longer have a current saved family source. Correct a changed answer above, or confirm an unchanged answer below. Saving records your declaration for this WIC request today. Other answers and your family profile stay unchanged.")}</p>
          {eligiblePaths.map(path => {
            const parts = path.split("."), child = parts[0] === "children" ? draft.value.children?.findIndex(person => person.id === parts[1]) : undefined;
            const label = `${child !== undefined ? `${t("Child")} ${child + 1}` : parts[0] === "contact" ? t("Contact") : t("Mother")} ${parts.at(-1) === "zip" ? t("postal ZIP") : contactLabels[parts.at(-1)! as keyof typeof contactLabels] ? t(contactLabels[parts.at(-1)! as keyof typeof contactLabels]).toLowerCase() : parts.at(-1)}`;
            return <label key={path} className={styles.checkbox}><input type="checkbox" checked={confirmedPaths.includes(path)} onChange={event => setConfirmation({ scope: confirmationScope, paths: event.target.checked ? [...confirmedPaths, path] : confirmedPaths.filter(current => current !== path) })}/><span>{t("Still correct for this WIC request today: ")}{label}<br/>{String(draftLeaves[path])}</span></label>;
          })}
        </fieldset>}
        {locale === "es" && <p>{t(WIC_SUBJECT_AUTHORITY_STATEMENT)} {t("CaseLink’s Spanish interface explanation does not replace the original declaration below.")}</p>}
        <p lang="en">{WIC_SUBJECT_AUTHORITY_STATEMENT}</p>
        <p className={styles.hint}>{t("Choosing Save WIC changes makes this declaration for the people in this revision. It saves a partial draft when answers are missing. Your WIC request remains ")}{t(request.status === "paused" ? "paused" : "subject to its current permission")}{t("; no provider submission is authorized by this save.")}</p>
        {uncertain && <p className={styles.notice}>{t("The save result is unconfirmed. Retry the same save before editing or creating another revision.")}</p>}
        <div className={styles.inline}><button className={styles.button} disabled={pending || conflict || family.loading || family.blocked}>{t(pending ? "Saving WIC answers…" : uncertain ? "Retry the same WIC save" : "Save WIC changes")}</button>
          {!uncertain && <button type="button" className={styles.quiet} disabled={pending} onClick={editor.reset}>{t("Cancel WIC editing")}</button>}</div>
      </form> : <>
        {current && permitted && !draft && <button type="button" className={styles.secondary} disabled={family.loading || family.blocked} onClick={edit}>{t(record ? "Correct WIC answers" : "Add private WIC answers")}</button>}
        {!permitted && <p className={styles.hint}>{t("Private WIC changes are closed or their current permission is unavailable. Saved answers remain readable where account access permits. ")}{draft && t("Your unsaved draft remains on this page; no new answers can be entered until access is restored.")}</p>}
      </>}
    </>}
    {family.blocked && <div className={wicStyles.profileNotice}><SavedFamilyProfileNotice reuse={family} refresh={refreshFamily} disabled={pending || uncertain || conflict}/></div>}
    {error && <ServiceError error={error} returnTo={`/support/${request.id}`}/>}
    {(!permitted || collection.error || blocked) && <button type="button" className={styles.secondary} disabled={pending} onClick={checkAccess}>{t("Check WIC editing access again")}</button>}
    {message && <p className={styles.success} role="status">{t(message)}</p>}
  </section>;
}
