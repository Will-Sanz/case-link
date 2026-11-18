"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { z } from "zod";
import {
  FAMILY_PROFILE_NOTICE_VERSION,
  familyProfileDetailsSchema,
  familyProfileLeaves,
  familyProfileReadSchema,
  type FamilyProfileDetails,
  type FamilyProfileRead,
  type FamilyProfileIncomeKind,
  type FamilyProfileSnapshot,
} from "@/lib/parent/family-profile";
import { boundedParentApi, displayDate, ParentApiError } from "./api";
import { ParentLoading, ServiceError } from "./feedback";
import { useParentResource } from "./use-parent-resource";
import { usePermissionWindow } from "./use-permission-window";
import styles from "./parent.module.css";

type Person = FamilyProfileDetails["primaryPerson"];
type Address = NonNullable<FamilyProfileDetails["homeAddress"]>;
type Draft = { ownerId: string; revision: number; details: FamilyProfileDetails; provenance: FamilyProfileSnapshot["provenance"] };
type Attempt = { ownerId: string; revision: number; key: string; body: string; action: "save" | "delete" };
const optional = (value: string) => value || undefined;
const currentCollection = (read: FamilyProfileRead | null) => read?.collection.collectionEnabled === true &&
  read.collection.noticeVersion === FAMILY_PROFILE_NOTICE_VERSION;
const freshBlank = (): FamilyProfileDetails => ({ primaryPerson: { id: crypto.randomUUID() } });
const profileReply = familyProfileReadSchema.safeExtend({ ok: z.literal(true) });
const mutationReply = z.object({ ok: z.literal(true), revision: z.number().int().nonnegative() }).strict();
const INCOME_LABELS: Record<FamilyProfileIncomeKind, string> = {
  employment: "Employment", self_employment: "Self-employment", unemployment: "Unemployment", pension: "Pension",
  workers_compensation: "Workers’ compensation", veterans: "Veterans benefits", cash_welfare: "Cash welfare", cash_benefits: "Cash benefits",
  child_support: "Child support", spousal_support: "Spousal support", social_security: "Social Security benefits", disability: "Disability benefits",
  foster_care: "Foster care payments", benefits: "Other benefits", outside_support: "Support from someone outside your household", rental: "Rental income", other: "Other income",
};

function ProfileField({ id, label, value, onChange, type = "text", maximum = 80, autoComplete, children }: {
  id: string; label: string; value?: string; onChange: (value: string | undefined) => void;
  type?: "text" | "email" | "tel" | "date"; maximum?: number; autoComplete?: string; children?: ReactNode;
}) {
  return <div className={styles.field}>
    <label htmlFor={id}>{label}</label>
    <input id={id} className={styles.input} type={type} value={value ?? ""} maxLength={maximum} autoComplete={autoComplete}
      {...(type === "date" ? { max: new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date()) } : {})}
      {...(type === "tel" ? { inputMode: "tel" as const, placeholder: "215-555-0101", pattern: "[0-9]{3}-[0-9]{3}-[0-9]{4}" } : {})}
      onChange={event => onChange(optional(event.target.value))}
      onBlur={type === "tel" ? event => onChange(optional(event.target.value.replace(/^\(?([0-9]{3})\)?[ .-]?([0-9]{3})[ .-]?([0-9]{4})$/, "$1-$2-$3"))) : undefined}/>
    {children}
  </div>;
}

function ProfileFreshness({ source, path, label, checked, onConfirm }: {
  source: FamilyProfileSnapshot["provenance"][string]; path: string; label: string; checked: boolean; onConfirm: (path: string, checked: boolean) => void;
}) {
  const current = usePermissionWindow(Date.parse(source.expiresAt));
  return <div className={styles.hint}>
    <p>You provided · {displayDate(source.confirmedAt)} · Reuse until {displayDate(source.expiresAt)}{!current ? " · Expired for reuse" : ""}.</p>
    {!current && <label className={styles.checkbox}><input type="checkbox" checked={checked} onChange={event => onConfirm(path, event.target.checked)}/>Confirm {label.toLowerCase()} is still current</label>}
  </div>;
}

function ProfileFields({ value, provenance, confirmedPaths, onConfirm, onChange, disabled }: {
  value: FamilyProfileDetails; provenance: Draft["provenance"]; confirmedPaths: string[];
  onConfirm: (path: string, checked: boolean) => void; onChange: (value: FamilyProfileDetails) => void; disabled: boolean;
}) {
  const [focusMember, setFocusMember] = useState<string | null>(null);
  useLayoutEffect(() => { if (focusMember) document.getElementById(`family-${focusMember}-firstName`)?.focus(); }, [focusMember]);
  const freshness = (path: string, label: string) => {
    const source = provenance[path];
    if (!source) return null;
    return <ProfileFreshness source={source} path={path} label={label} checked={confirmedPaths.includes(path)} onConfirm={onConfirm}/>;
  };
  const person = (item: Person, prefix: string, label: string, change: (person: Person) => void) => <>
    <div className={styles.row}>{([["firstName", "First name", "given-name"], ["lastName", "Last name", "family-name"], ["middleInitial", "Middle initial", "additional-name"]] as const).map(([field, name, autocomplete]) =>
      <ProfileField key={field} id={`family-${item.id}-${field}`} label={`${label} ${name.toLowerCase()}`} value={item[field]} maximum={field === "middleInitial" ? 2 : 80} autoComplete={label === "Your" ? autocomplete : "off"} onChange={text => change({ ...item, [field]: text })}>{freshness(`${prefix}.${field}`, `${label} ${name}`)}</ProfileField>)}</div>
    <ProfileField id={`family-${item.id}-birth`} label={`${label} date of birth`} type="date" value={item.dateOfBirth} autoComplete={label === "Your" ? "bday" : "off"} onChange={dateOfBirth => change({ ...item, dateOfBirth })}>{freshness(`${prefix}.dateOfBirth`, `${label} date of birth`)}</ProfileField>
    <details className={styles.disclosure}><summary>{label} income sources (optional)</summary>
      <p className={styles.hint}>Useful for food or utility help. Save the types only. Amounts, proof and program rules are checked separately when needed.</p>
      <div className={`${styles.field} ${styles.space}`}><label htmlFor={`family-${item.id}-income`}>{label} income source inventory</label>
        <select id={`family-${item.id}-income`} className={styles.select} value={item.income?.state ?? ""} onChange={event => change({ ...item, income: event.target.value ? { state: event.target.value as NonNullable<Person["income"]>["state"], sources: event.target.value === "sources" ? item.income?.sources ?? [] : [] } : undefined })}>
          <option value="">Unanswered</option><option value="unknown">Not sure</option><option value="none">No income sources</option><option value="sources">Has income sources</option>
        </select>
        {freshness(`${prefix}.income`, `${label} income source inventory`)}
      </div>
      {item.income?.state === "sources" && <>
        {item.income.sources.map((source, index) => <div className={`${styles.row} ${styles.space}`} key={source.id}><div className={styles.field}>
          <label htmlFor={`family-source-${source.id}`}>{label} income source {index + 1}</label><select id={`family-source-${source.id}`} className={styles.select} value={source.kind} onChange={event => change({ ...item, income: { state: "sources", sources: item.income!.sources.map(existing => existing.id === source.id ? { ...existing, kind: event.target.value as typeof source.kind } : existing) } })}>{Object.entries(INCOME_LABELS).map(([kind, name]) => <option key={kind} value={kind}>{name}</option>)}</select>
        </div><button type="button" className={styles.quiet} onClick={() => { document.getElementById(`family-${item.id}-add-income`)?.focus(); change({ ...item, income: { state: "sources", sources: item.income!.sources.filter(existing => existing.id !== source.id) } }); }}>Remove {label.toLowerCase()} income source {index + 1}</button></div>)}
        <div className={`${styles.field} ${styles.space}`}><label htmlFor={`family-${item.id}-add-income`}>Add {label.toLowerCase()} income source</label><select id={`family-${item.id}-add-income`} className={styles.select} value="" disabled={disabled || item.income.sources.length >= 30} onChange={event => { if (event.target.value) change({ ...item, income: { state: "sources", sources: [...item.income!.sources, { id: crypto.randomUUID(), kind: event.target.value as FamilyProfileIncomeKind }] } }); }}><option value="">Choose a source to add</option>{Object.entries(INCOME_LABELS).map(([kind, name]) => <option key={kind} value={kind}>{name}</option>)}</select></div>
        {!item.income.sources.length && <p className={styles.hint}>Add a source, choose Not sure, or leave this inventory unanswered before saving.</p>}
      </>}
    </details>
  </>;
  const address = (key: "homeAddress" | "mailingAddress", label: string) => <details className={styles.disclosure}>
    <summary>{label} (optional)</summary>
    <fieldset className={`${styles.fieldset} ${styles.space}`}><legend className={styles.screenReader}>{label}</legend>
    <div className={styles.form}>{([["street", "Street address", 160, "address-line1"], ["apartment", "Apartment or unit", 80, "address-line2"], ["city", "City", 80, "address-level2"], ["state", "State (two letters)", 2, "address-level1"], ["zip", "ZIP code", 5, "postal-code"], ["county", "County", 80, "off"]] as const).map(([field, name, maximum, autocomplete]) =>
      <ProfileField key={field} id={`family-${key}-${field}`} label={`${label} ${name.toLowerCase()}`} maximum={maximum} value={value[key]?.[field]} autoComplete={autocomplete === "off" ? "off" : `${key === "homeAddress" ? "section-home" : "section-mailing"} ${autocomplete}`} onChange={text => onChange({ ...value, [key]: { ...value[key], [field]: field === "state" ? text?.toUpperCase() : text } as Address })}>{freshness(`${key}.${field}`, `${label} ${name}`)}</ProfileField>)}</div>
    </fieldset>
  </details>;
  return <fieldset className={styles.fieldset} disabled={disabled}>
    <legend className={styles.screenReader}>Optional family information</legend>
    <div className={styles.form}>
      <fieldset className={styles.fieldset}><legend className={styles.legend}>Your details</legend><div className={styles.form}>{person(value.primaryPerson, "primaryPerson", "Your", primaryPerson => onChange({ ...value, primaryPerson }))}</div>
        <p className={styles.hint}>These are your contact details. They do not establish who holds a utility account or who is applying for a program.</p>
      </fieldset>
      <fieldset className={styles.fieldset}><legend className={styles.legend}>Contact & language</legend><div className={styles.form}>
        <ProfileField id="family-phone" label="Contact phone" type="tel" value={value.contact?.phone} autoComplete="tel" maximum={14} onChange={phone => onChange({ ...value, contact: { ...value.contact, phone } })}>{freshness("contact.phone", "Contact phone")}</ProfileField>
        <ProfileField id="family-email" label="Contact email" type="email" value={value.contact?.email} autoComplete="email" maximum={100} onChange={email => onChange({ ...value, contact: { ...value.contact, email } })}>{freshness("contact.email", "Contact email")}</ProfileField>
        <p className={styles.hint}>Saving a contact email does not change your sign-in email or enroll you in messages.</p>
        <div className={styles.field}><label htmlFor="family-language">Preferred service language</label><select id="family-language" className={styles.select} value={value.preferredLanguage ?? ""} onChange={event => onChange({ ...value, preferredLanguage: optional(event.target.value) as FamilyProfileDetails["preferredLanguage"], otherLanguage: event.target.value === "other" ? value.otherLanguage : undefined })}><option value="">Unanswered</option><option value="en">English</option><option value="es">Spanish / Español</option><option value="other">Another language</option></select>{freshness("preferredLanguage", "Preferred service language")}</div>
        {value.preferredLanguage === "other" && <ProfileField id="family-other-language" label="Language you prefer" value={value.otherLanguage} onChange={otherLanguage => onChange({ ...value, otherLanguage })}>{freshness("otherLanguage", "Language you prefer")}</ProfileField>}
      </div></fieldset>
      {address("homeAddress", "Home address")}
      <div className={styles.field}><label htmlFor="family-mailing-same">Is your mailing address the same as your home address?</label><select id="family-mailing-same" className={styles.select} value={value.mailingAddressSameAsHome === true ? "yes" : value.mailingAddressSameAsHome === false ? "no" : ""} onChange={event => onChange({ ...value, mailingAddressSameAsHome: event.target.value === "" ? undefined : event.target.value === "yes", ...(event.target.value === "yes" ? { mailingAddress: undefined } : {}) })}><option value="">Unanswered</option><option value="yes">Yes</option><option value="no">No</option></select>{freshness("mailingAddressSameAsHome", "Mailing address choice")}</div>
      {value.mailingAddressSameAsHome !== true && address("mailingAddress", "Mailing address")}
      <fieldset className={styles.fieldset}><legend className={styles.legend}>Other people living with you</legend>
        <p className={styles.hint}>Add only people who live in your household and whose information you have permission to provide. Each program checks its own household rules; saving this list does not declare a complete application household.</p>
        {(value.members ?? []).map((member, index) => <fieldset className={`${styles.fieldset} ${styles.section}`} key={member.id}><legend className={styles.legend}>Household member {index + 1}</legend><div className={styles.form}>
          {person(member, `members.${member.id}`, `Member ${index + 1}`, update => onChange({ ...value, members: value.members!.map(current => current.id === member.id ? { ...member, ...update } : current) }))}
          <ProfileField id={`family-${member.id}-relationship`} label={`Member ${index + 1} relationship to you`} value={member.relationship} onChange={relationship => onChange({ ...value, members: value.members!.map(current => current.id === member.id ? { ...current, relationship } : current) })}>{freshness(`members.${member.id}.relationship`, `Member ${index + 1} relationship`)}</ProfileField>
          <button type="button" className={styles.quiet} onClick={() => { document.getElementById("family-add-person")?.focus(); onChange({ ...value, members: value.members!.filter(current => current.id !== member.id) }); }}>Remove household member {index + 1}</button>
        </div></fieldset>)}
        <button id="family-add-person" type="button" className={`${styles.secondary} ${styles.space}`} disabled={disabled || (value.members?.length ?? 0) >= 29} onClick={() => { const id = crypto.randomUUID(); onChange({ ...value, members: [...value.members ?? [], { id }] }); setFocusMember(id); }}>Add a person living with you</button>
      </fieldset>
    </div>
  </fieldset>;
}

export function FamilyProfile({ returnTo = "/my-support" }: { returnTo?: string }) {
  const [read, setRead] = useState(0);
  const saved = useParentResource<unknown>(`/family-profile?read=${read}`);
  const parsed = useMemo(() => profileReply.safeParse(saved.data), [saved.data]), current = !saved.error && parsed.success ? parsed.data : null;
  const [draft, setDraft] = useState<Draft | null>(null), [attempt, setAttempt] = useState<Attempt | null>(null);
  const [consent, setConsent] = useState(false), [confirmedPaths, setConfirmedPaths] = useState<string[]>([]);
  const [pending, setPending] = useState(false), [conflict, setConflict] = useState(false), [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<Error | null>(null), [message, setMessage] = useState("");
  const [observed, setObserved] = useState<{ data: unknown; error: Error | null }>({ data: null, error: null });
  const running = useRef<AbortController | null>(null), form = useRef<HTMLFormElement>(null);
  const deadline = current?.collection.expiresAt ? Date.parse(current.collection.expiresAt) : NaN;
  const permitted = usePermissionWindow(deadline) && currentCollection(current);
  const wipe = useCallback(() => {
    running.current?.abort(); running.current = null;
    form.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input,select").forEach(input => { input.value = ""; if (input instanceof HTMLInputElement) input.checked = false; });
    setDraft(null); setAttempt(null); setConsent(false); setConfirmedPaths([]); setPending(false); setError(null); setMessage(""); setConfirmDelete(false); setConflict(false);
  }, [setDraft, setAttempt, setConsent, setConfirmedPaths, setPending, setError, setMessage, setConfirmDelete, setConflict]);
  useEffect(() => {
    const refresh = () => { running.current?.abort(); running.current = null; setPending(false); setRead(value => value + 1); };
    const hide = () => { wipe(); setRead(value => value + 1); };
    const show = (event: PageTransitionEvent) => { if (event.persisted) refresh(); };
    window.addEventListener("pagehide", hide); window.addEventListener("pageshow", show); window.addEventListener("focus", refresh);
    return () => { running.current?.abort(); window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", show); window.removeEventListener("focus", refresh); };
  }, [wipe]);
  if (observed.data !== saved.data || observed.error !== saved.error) {
    setObserved({ data: saved.data, error: saved.error });
    if (saved.error instanceof ParentApiError && [401, 403].includes(saved.error.status)) {
      setDraft(null); setAttempt(null); setConsent(false); setConfirmedPaths([]); setPending(false); setError(null); setMessage(""); setConfirmDelete(false); setConflict(false);
    } else if (current) {
      if (!draft || draft.ownerId !== current.ownerId) {
        setDraft({ ownerId: current.ownerId, revision: current.revision, details: structuredClone(current.profile?.details ?? freshBlank()), provenance: structuredClone(current.profile?.provenance ?? {}) });
        setAttempt(null); setConsent(false); setConfirmedPaths([]); setPending(false); setConfirmDelete(false); setConflict(false); if (draft) setMessage("");
        setError(draft ? new Error("Your signed-in account changed. The previous account’s unsaved information was cleared.") : null);
      } else if (attempt?.action === "save" && current.profile?.idempotencyKey === attempt.key && current.ownerId === attempt.ownerId &&
        JSON.stringify(current.profile.details) === JSON.stringify(JSON.parse(attempt.body).details)) {
        setDraft({ ownerId: current.ownerId, revision: current.revision, details: structuredClone(current.profile.details), provenance: structuredClone(current.profile.provenance) });
        setAttempt(null); setConsent(false); setConfirmedPaths([]); setConflict(false); setError(null); setMessage("Your family information is saved. You can finish it later or continue to support.");
      } else if (attempt?.action === "delete" && !current.profile && current.lastMutationKey === attempt.key && current.ownerId === attempt.ownerId) {
        setDraft({ ownerId: current.ownerId, revision: current.revision, details: freshBlank(), provenance: {} }); setAttempt(null); setConsent(false); setConfirmedPaths([]); setConflict(false); setError(null); setConfirmDelete(false);
        setMessage("Your saved family information was removed. Existing support requests keep their own recorded history.");
      } else if (draft.revision !== current.revision) setConflict(true);
    }
  }
  const [wasPermitted, setWasPermitted] = useState(permitted);
  if (wasPermitted !== permitted) { setWasPermitted(permitted); if (!permitted) { setPending(false); setConsent(false); } }
  useLayoutEffect(() => {
    if (!permitted || saved.error || current?.ownerId !== draft?.ownerId) { running.current?.abort(); running.current = null; }
  }, [permitted, saved.error, current?.ownerId, draft?.ownerId]);
  async function send(action: "save" | "delete", event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!current || !draft || draft.ownerId !== current.ownerId || pending || running.current && !running.current.signal.aborted || conflict || action === "save" && (!permitted || !consent && !attempt)) return;
    let exact = attempt;
    if (!exact) {
      const details = familyProfileDetailsSchema.safeParse(draft.details);
      if (action === "save" && !details.success) { setError(new Error(details.error.issues[0]?.message ?? "Check your answers before saving.")); return; }
      const leaves = details.success ? familyProfileLeaves(details.data) : {};
      exact = { ownerId: current.ownerId, revision: draft.revision, action, key: crypto.randomUUID(), body: JSON.stringify(action === "save"
        ? { expectedOwnerId: current.ownerId, expectedRevision: draft.revision, details: details.success ? details.data : draft.details, noticeVersion: FAMILY_PROFILE_NOTICE_VERSION, consentAccepted: true, subjectAuthorityDeclared: true, confirmedPaths: confirmedPaths.filter(path => Object.hasOwn(leaves, path)) }
        : { expectedOwnerId: current.ownerId, expectedRevision: draft.revision }) };
      setAttempt(exact);
    }
    if (exact.action !== action || exact.ownerId !== current.ownerId) return;
    const controller = new AbortController(); running.current = controller; setPending(true); setError(null); setMessage("");
    try {
      const result = await boundedParentApi("/family-profile", { method: action === "save" ? "POST" : "DELETE", headers: { "Idempotency-Key": exact.key }, body: exact.body }, controller.signal,
        action === "save" ? current.collection.expiresAt! : new Date(Date.now() + 30_000).toISOString());
      if (controller.signal.aborted || running.current !== controller) return;
      const acknowledged = mutationReply.safeParse(result);
      if (!acknowledged.success || acknowledged.data.revision < exact.revision) throw new ParentApiError("The result is unconfirmed. Check saved information or retry the same change.", 0);
      setAttempt(null); setConsent(false); setConfirmedPaths([]); setConfirmDelete(false); setDraft(null);
      setMessage(action === "save" ? "Your family information is saved. You can finish it later or continue to support." : "Your saved family information was removed. Existing support requests keep their own recorded history.");
      setRead(value => value + 1);
    } catch (failure) {
      if (controller.signal.aborted || running.current !== controller) return;
      const status = failure instanceof ParentApiError ? failure.status : 0;
      setError(failure instanceof Error ? failure : new Error("We couldn’t confirm that change. Check the saved information and retry the same change."));
      setConflict(status === 409);
      if (status === 401 || status === 403) { wipe(); setError(failure instanceof Error ? failure : new Error("Check your account access.")); setRead(value => value + 1); }
      else if (status >= 400 && status < 500 && status !== 409) setAttempt(null);
      else setRead(value => value + 1);
    } finally { if (running.current === controller) { running.current = null; setPending(false); } }
  }
  const visible = current && draft?.ownerId === current.ownerId;
  return <div className={styles.container}>
    <div className={styles.pageTop}><div><h1>Your family information</h1><p>Save family basics once. CaseLink checks fresh saved information before asking again.</p></div></div>
    <div className={`${styles.inline} ${styles.space}`}><Link className={styles.textLink} href={returnTo}>Skip for now and continue to support</Link><Link className={styles.textLink} href="/get-support?need=food_now">Find urgent food help</Link></div>
    {saved.loading ? <ParentLoading label="Loading your family information"/> : saved.error ? <ServiceError error={saved.error} retry={() => setRead(value => value + 1)} returnTo="/family-profile"/>
      : !current ? <p className={styles.notice}>Your saved family information needs a service check before it can be opened. <button type="button" className={styles.quiet} onClick={() => setRead(value => value + 1)}>Try loading family information again</button></p>
      : visible && <section className={`${styles.surface} ${styles.section}`}>
        <h2>{current.profile ? "Saved family basics" : "Start with what you know"}</h2>
        <p className={styles.hint}>Everything here is optional. Leave unknown answers blank and save a partial profile. Never enter a government ID, account number, password, pregnancy or medical information here.</p>
        {current.profile && <p className={styles.hint}>Each answer keeps its original confirmation and expiry dates. Opening this page never extends them.</p>}
        {!permitted && <div className={`${styles.notice} ${styles.space}`}><div><p>Saving family information is unavailable in this environment or its current permission has ended. You can continue directly to support. Saved information remains readable where account access allows.</p><button type="button" className={styles.secondary} onClick={() => setRead(value => value + 1)}>Check saving access again</button></div></div>}
        <form ref={form} aria-label="Save family information" className={`${styles.form} ${styles.space}`} onSubmit={event => send("save", event)}>
          <ProfileFields value={draft.details} provenance={draft.provenance} confirmedPaths={confirmedPaths} disabled={!permitted || pending || !!attempt || conflict} onConfirm={(path, checked) => setConfirmedPaths(paths => checked ? [...paths, path] : paths.filter(value => value !== path))} onChange={details => { setDraft({ ...draft, details }); setError(null); }}/>
          {permitted && <>
            <section className={styles.notice} aria-label="Family information storage and reuse notice"><div><h3>Before you save</h3>
              <p>CaseLink and its database provider, Supabase, store these family basics privately in your account for up to {current.collection.retentionDays} days from each answer’s confirmation. We reuse fresh answers only for named programs under the separate support permission you choose. This save does not authorize sharing, an application, a signature or a payment.</p>
              <p>You have permission to provide the information for yourself and each person listed, including children and other adults. You can change or remove this profile. Removing it does not erase information already recorded for a support request. Processor and backup limits are in the <Link className={styles.textLink} href="/support/privacy">privacy and data policy</Link>.</p>
            </div></section>
            <label className={styles.checkbox}><input type="checkbox" checked={consent} disabled={pending || !!attempt || conflict} onChange={event => setConsent(event.target.checked)}/>I have permission to provide these family details and agree to their private storage and reuse as described above.</label>
            <div className={styles.inline}><button className={styles.button} type="submit" disabled={pending || conflict || !consent && !attempt || attempt?.action === "delete"}>{pending && attempt?.action === "save" ? "Saving family information…" : attempt?.action === "save" ? "Retry the same family save" : "Save and finish later"}</button><Link className={styles.textLink} href={returnTo}>Continue to support</Link></div>
          </>}
        </form>
        {attempt && !pending && !conflict && <div className={`${styles.notice} ${styles.space}`}><p>The result is unconfirmed. Your exact change is kept only on this page. Check saved information or retry the same change before editing again.</p><button type="button" className={styles.secondary} onClick={() => setRead(value => value + 1)}>Check saved family information</button>{attempt.action === "delete" && <button type="button" className={styles.secondary} onClick={() => send("delete")}>Retry the same removal</button>}</div>}
        {conflict && <div className={`${styles.notice} ${styles.space}`}><p>Your saved family information changed. Your unsaved draft is still here. Load the latest information before replacing it.</p><button type="button" className={styles.secondary} onClick={() => { setDraft(null); setAttempt(null); setConsent(false); setConfirmedPaths([]); setConflict(false); setError(null); setRead(value => value + 1); }}>Load latest family information</button></div>}
        {!!current.profile && !pending && !attempt && <details className={`${styles.disclosure} ${styles.section}`} open={confirmDelete} onToggle={event => setConfirmDelete(event.currentTarget.open)}><summary>Remove saved family information</summary><p>This removes this reusable profile. Existing requests and their recorded permissions, applications and receipts stay separate. Use Your account to request deletion of all parent-support data.</p><button type="button" className={`${styles.secondary} ${styles.space}`} onClick={() => send("delete")}>Confirm removal of saved family information</button></details>}
      </section>}
    {error && <div className={styles.space}><ServiceError error={error} returnTo="/family-profile"/></div>}
    {message && <p className={`${styles.success} ${styles.space}`} role="status">{message}</p>}
  </div>;
}

export function FamilyProfileWelcome() {
  const saved = useParentResource<unknown>("/family-profile");
  const parsed = useMemo(() => profileReply.safeParse(saved.data), [saved.data]), current = !saved.error && parsed.success ? parsed.data : null;
  const available = usePermissionWindow(current?.collection.expiresAt ? Date.parse(current.collection.expiresAt) : NaN) && currentCollection(current);
  if (!available || current?.profile) return null;
  return <section className={`${styles.notice} ${styles.space}`} aria-label="Save family information"><div><h2>Tell us once, use it again</h2><p>Save optional family basics so future requests can start with what you already shared. You can save part now and finish later.</p><Link className={styles.textLink} href="/family-profile">Save family basics</Link><p className={styles.hint}>You can also get support directly. A family profile is optional.</p></div></section>;
}
