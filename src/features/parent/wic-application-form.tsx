"use client";
import Link from "next/link";
import { useLayoutEffect, useState } from "react";
import type { WicApplicationFields } from "@/lib/parent/wic-application-fields";
import { WIC_SUBJECT_AUTHORITY_STATEMENT } from "@/lib/parent/constants";
import source from "../../../data/verified-forms/wic-pa-preapplication-2026-11-13.json";
import { useParentLocale } from "./parent-locale";
import styles from "./parent.module.css";
import wicStyles from "./wic.module.css";

export function WicApplicationNotice() {
  const { t, locale } = useParentLocale();
  return <section lang={locale} className={`${styles.notice} ${wicStyles.notice}`} aria-label={t("WIC private information notice")}>
    <div>
    <h3>{t("Before you share private WIC answers")}</h3>
    <p>{t("These optional answers can include contact details, names and birth dates, pregnancy, postpartum or breastfeeding status and an expected delivery date. Share only information for this WIC request and people you have permission to help.")}</p>
    <p>{t("Your browser sends these answers to CaseLink and its database provider, Supabase, for private storage in your account. Your request summary, AI conversations and routine automated updates do not include these private answers. Saving does not send them to WIC.")}</p>
    <p>{t("Each saved version keeps its original dates. Correcting an answer does not erase earlier versions. Closed or cancelled requests become eligible for cleanup 90 days after their last update; actual removal depends on scheduled cleanup and any pending document cleanup. Active records stay subject to their recorded retention or deletion limits. You can request earlier deletion in Account. Provider, processor and backup retention have separate limits in the ")}<Link className={styles.textLink} href="/support/privacy">{t("privacy and data policy")}</Link>{t(".")}</p>
    <p>{t("No passwords, Social Security numbers, signatures, income calculations, optional race/ethnicity or Medical Assistance answers belong in these fields. You can leave an answer blank or use ")}<a className={styles.textLink} href={source.officialGuidanceUrl}>{t("official WIC help")}</a>{t(" immediately.")}</p>
    <p>{t("Household routing ZIP is not proof of the contact’s postal address. CaseLink still needs an accepted submission connection and real appointment evidence. A pre-application requests later contact; it does not book an appointment or establish enrollment. WIC staff complete the required assessment.")}</p>
    {locale === "es" && <p>{t(WIC_SUBJECT_AUTHORITY_STATEMENT)} {t("CaseLink’s Spanish interface explanation does not replace the original declaration below.")}</p>}
    <p lang="en">{WIC_SUBJECT_AUTHORITY_STATEMENT}</p>
    </div>
  </section>;
}

type Person = NonNullable<WicApplicationFields["mother"]>;
const optional = (value: string) => value === "" ? undefined : value;
function Field({ id, label, value, onChange, type = "text", maximum = 50, autoComplete }: {
  id: string; label: string; value?: string; onChange: (value: string | undefined) => void;
  type?: "text" | "date" | "email" | "tel"; maximum?: number; autoComplete?: string;
}) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  return <div className={styles.field}><label htmlFor={id}>{label}</label><input id={id} className={styles.input}
    type={type} value={value ?? ""} maxLength={maximum} autoComplete={autoComplete}
    {...(type === "date" && !id.endsWith("delivery") ? { max: today } : {})}
    {...(type === "tel" ? { placeholder: "215-555-0101", pattern: "[0-9]{3}-[0-9]{3}-[0-9]{4}" } : {})}
    onChange={event => onChange(optional(event.target.value))}
    onBlur={type === "tel" ? event => onChange(optional(event.target.value.replace(/^\(?([0-9]{3})\)?[ .-]?([0-9]{3})[ .-]?([0-9]{4})$/, "$1-$2-$3"))) : undefined}/></div>;
}

export function WicApplicationFormFields({ value, onChange, disabled = false, idPrefix = "wic" }: {
  value: WicApplicationFields; onChange: (value: WicApplicationFields) => void; disabled?: boolean; idPrefix?: string;
}) {
  const { t, locale } = useParentLocale();
  const [sameContact, setSameContact] = useState(false);
  const [newChild, setNewChild] = useState<string | null>(null);
  useLayoutEffect(() => { if (newChild) document.getElementById(`${idPrefix}-child-${newChild}-first`)?.focus(); }, [newChild, idPrefix]);
  const hasMother = value.beneficiaries === "mother" || value.beneficiaries === "mother_and_children";
  const hasChildren = value.beneficiaries === "children" || value.beneficiaries === "mother_and_children";
  const personFields = (person: Person | undefined, prefix: string, name: string, change: (person: Person) => void) => <>
    <div className={styles.row}>
      <Field id={`${prefix}-first`} label={name.startsWith("Child ") && locale === "es" ? `${t("First name")} (${t("Child")} ${name.slice(6)})` : t(`${name} first name`)} value={person?.firstName} onChange={firstName => change({ ...person, firstName })}/>
      <Field id={`${prefix}-last`} label={name.startsWith("Child ") && locale === "es" ? `${t("Last name")} (${t("Child")} ${name.slice(6)})` : t(`${name} last name`)} value={person?.lastName} onChange={lastName => change({ ...person, lastName })}/>
    </div>
    <Field id={`${prefix}-birth`} label={name.startsWith("Child ") && locale === "es" ? `${t("Date of birth")} (${t("Child")} ${name.slice(6)})` : t(`${name} date of birth`)} type="date" value={person?.dateOfBirth} onChange={dateOfBirth => change({ ...person, dateOfBirth })}/>
  </>;
  function changeContact(contact: NonNullable<WicApplicationFields["contact"]>) {
    onChange({ ...value, contact, ...(sameContact && hasMother ? { mother: { ...value.mother,
      firstName: contact.firstName, lastName: contact.lastName, dateOfBirth: contact.dateOfBirth } } : {}) });
  }
  return <fieldset lang={locale} className={styles.fieldset} disabled={disabled}>
    <legend className={styles.legend}>{t("WIC pre-application answers")}</legend>
    <p className={styles.hint}>{t("Answer the applicable questions together. Blank or “Not sure” stays unanswered; you can save a partial draft. Saving these answers does not mean the pre-application is complete or sent.")}</p>
    <div className={styles.row}>
      <div className={styles.field}><label htmlFor={`${idPrefix}-type`}>{t("WIC application status")}</label><select id={`${idPrefix}-type`} className={styles.select} value={value.applicationType ?? ""}
        onChange={event => onChange({ ...value, applicationType: optional(event.target.value) as WicApplicationFields["applicationType"] })}>
        <option value="">{t("Not sure / unanswered")}</option><option value="new">{t("New")}</option><option value="reapplying">{t("Re-applying")}</option><option value="transfer">{t("Transfer from another county or state")}</option>
      </select></div>
      <div className={styles.field}><label htmlFor={`${idPrefix}-who`}>{t("Who is applying for WIC?")}</label><select id={`${idPrefix}-who`} className={styles.select} value={value.beneficiaries ?? ""}
        onChange={event => { const beneficiaries = optional(event.target.value) as WicApplicationFields["beneficiaries"]; setSameContact(false);
          onChange({ ...value, beneficiaries, ...(!["mother", "mother_and_children"].includes(beneficiaries ?? "") ? { mother: undefined } : {}),
            ...(!["children", "mother_and_children"].includes(beneficiaries ?? "") ? { children: undefined } : {}) }); }}>
        <option value="">{t("Not sure / unanswered")}</option><option value="mother">{t("Mother")}</option><option value="children">{t("Child or children")}</option><option value="mother_and_children">{t("Mother and children")}</option>
      </select></div>
    </div>
    <fieldset className={styles.fieldset}><legend className={styles.legend}>{t("Contact person")}</legend>
      {personFields(value.contact, `${idPrefix}-contact`, "Contact", person => changeContact({ ...value.contact, ...person }))}
      <Field id={`${idPrefix}-street`} label={t("Contact street address")} value={value.contact?.street} maximum={100} autoComplete="street-address" onChange={street => changeContact({ ...value.contact, street })}/>
      <div className={styles.row}>
        <Field id={`${idPrefix}-city`} label={t("Contact city")} value={value.contact?.city} autoComplete="address-level2" onChange={city => changeContact({ ...value.contact, city })}/>
        <div className={styles.field}><label htmlFor={`${idPrefix}-county`}>{t("Contact county")}</label><select id={`${idPrefix}-county`} className={styles.select} value={value.contact?.county ?? ""} onChange={event => changeContact({ ...value.contact, county: optional(event.target.value) as "Philadelphia" | undefined })}>
          <option value="">{t("Not sure / unanswered")}</option><option value="Philadelphia">{t("Philadelphia")}</option></select></div>
      </div>
      <Field id={`${idPrefix}-postal-zip`} label={t("Contact postal ZIP code")} value={value.contact?.zip} maximum={5} autoComplete="postal-code" onChange={zip => changeContact({ ...value.contact, zip })}/>
      <p className={styles.hint}>{t("This preparation currently supports Philadelphia. Give the contact’s actual postal ZIP; we do not copy or infer it from the household routing ZIP.")}</p>
      <div className={styles.row}>
        <Field id={`${idPrefix}-email`} label={t("Contact email address")} type="email" value={value.contact?.email} maximum={100} autoComplete="email" onChange={email => changeContact({ ...value.contact, email })}/>
        <Field id={`${idPrefix}-phone`} label={t("Contact phone number")} type="tel" value={value.contact?.phone} maximum={13} autoComplete="tel-national" onChange={phone => changeContact({ ...value.contact, phone })}/>
      </div>
      <div className={styles.field}><label htmlFor={`${idPrefix}-appointment`}>{t("Preferred time for a WIC appointment")}</label><select id={`${idPrefix}-appointment`} className={styles.select} value={value.appointmentPreference ?? ""} onChange={event => onChange({ ...value, appointmentPreference: optional(event.target.value) as WicApplicationFields["appointmentPreference"] })}>
        <option value="">{t("Not sure / unanswered")}</option><option value="morning">{t("Morning")}</option><option value="afternoon">{t("Afternoon")}</option></select>
        <p className={styles.hint}>{t("This is a preference, not a confirmed appointment.")}</p></div>
    </fieldset>
    {hasMother && <fieldset className={styles.fieldset}><legend className={styles.legend}>{t("Mother’s information")}</legend>
      <label className={styles.checkbox}><input type="checkbox" checked={sameContact} onChange={event => {
        setSameContact(event.target.checked);
        if (event.target.checked) onChange({ ...value, mother: { ...value.mother, firstName: value.contact?.firstName, lastName: value.contact?.lastName, dateOfBirth: value.contact?.dateOfBirth } });
      }}/><span>{t("The mother is the contact person. Use her contact name and birth date here.")}</span></label>
      {personFields(value.mother, `${idPrefix}-mother`, "Mother", mother => { setSameContact(false); onChange({ ...value, mother }); })}
      <div className={styles.field}><label htmlFor={`${idPrefix}-status`}>{t("Mother’s WIC status")}</label><select id={`${idPrefix}-status`} className={styles.select} value={value.mother?.status ?? ""} onChange={event => {
        const status = optional(event.target.value) as Person["status"];
        onChange({ ...value, mother: { ...value.mother, status, ...(status !== "pregnant" ? { expectedDeliveryDate: undefined } : {}) } });
      }}><option value="">{t("Not sure / unanswered")}</option><option value="pregnant">{t("Pregnant")}</option><option value="postpartum">{t("Had a baby in the last 6 months")}</option><option value="breastfeeding">{t("Breastfeeding an infant under 12 months")}</option></select></div>
      {value.mother?.status === "pregnant" && <Field id={`${idPrefix}-delivery`} label={t("Expected delivery date")} type="date" value={value.mother.expectedDeliveryDate} onChange={expectedDeliveryDate => onChange({ ...value, mother: { ...value.mother, expectedDeliveryDate } })}/>}
    </fieldset>}
    {hasChildren && <fieldset className={styles.fieldset}><legend className={styles.legend}>{t("Children applying for WIC")}</legend>
      {(value.children ?? []).map((child, index) => <fieldset className={styles.fieldset} key={child.id}><legend className={styles.legend}>{t("Child ")}{index + 1}</legend>
        {personFields(child, `${idPrefix}-child-${child.id}`, `Child ${index + 1}`, person => onChange({ ...value, children: value.children!.map(item => item.id === child.id ? { ...person, id: child.id } : item) }))}
        <button type="button" className={styles.quiet} onClick={() => { document.getElementById(`${idPrefix}-add-child`)?.focus(); onChange({ ...value, children: value.children!.filter(item => item.id !== child.id) }); }}>{t("Remove child ")}{index + 1}</button>
      </fieldset>)}
      <button id={`${idPrefix}-add-child`} type="button" className={styles.secondary} disabled={(value.children?.length ?? 0) >= 30} onClick={() => { const id = crypto.randomUUID(); setNewChild(id); onChange({ ...value, children: [...(value.children ?? []), { id }] }); }}>{t("Add a child")}</button>
      <p className={styles.hint}>{t("Add each child who is applying. Do not guess a name or copy a contact’s surname.")}</p>
    </fieldset>}
  </fieldset>;
}
