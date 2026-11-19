"use client";
import Link from "next/link";
import { useLayoutEffect, useState } from "react";
import { PECO_ACCOUNT_AUTHORITY_STATEMENT, PECO_SUBJECT_AUTHORITY_STATEMENT, type PecoApplicationFields } from "@/lib/parent/peco-application-fields";
import styles from "./parent.module.css";

export const PECO_HELP_URL = "https://www.peco.com/my-account/customer-support/assistance-programs";
export const PECO_INCOME_LABELS = {
  employment: "Employment", unemployment: "Unemployment", pension: "Pension", workers_compensation: "Workers’ compensation",
  veterans: "Veterans benefits", cash_welfare: "Cash welfare", child_support: "Child support", spousal_support: "Spousal support",
  social_security: "Social Security benefits", rental: "Rental income", self_employment: "Self-employment", other: "Other income",
} as const;
type Person = NonNullable<PecoApplicationFields["applicant"]>;
type IncomeKind = keyof typeof PECO_INCOME_LABELS;
const optional = (value: string) => value === "" ? undefined : value;

export function PecoApplicationNotice() {
  return <section className={styles.notice} aria-label="PECO private information notice"><div>
    <h3>Before you share private PECO CAP answers</h3>
    <p>These optional answers include the PECO account number, names, birth dates, service address, phone numbers and a list of income sources for this household. Share only information for this PECO CAP preparation and people you have permission to help.</p>
    <p>Your browser sends these answers to CaseLink and its database provider, Supabase, for private storage in your account. Your request summary, AI conversations and routine automated updates do not include these private answers. Saving does not send them to PECO.</p>
    <p>Each saved version keeps its original dates. Correcting an answer does not erase earlier versions. Closed or cancelled requests become eligible for cleanup 90 days after their last update; actual removal depends on scheduled cleanup and any pending document cleanup. Active records stay subject to their recorded retention or deletion limits. You can request earlier deletion in Account. Provider, processor and backup retention have separate limits in the <Link className={styles.textLink} href="/support/privacy">privacy and data policy</Link>.</p>
    <p>Do not enter a Social Security number, ITIN, password, signature, income amount or payment information here. This preparation supports a ten-digit PECO account number. Leave unsupported or unknown answers blank and use <a className={styles.textLink} href={PECO_HELP_URL}>official PECO help</a> immediately.</p>
    <p>Household routing ZIP does not establish the PECO service address. A saved draft does not apply for CAP, establish eligibility, enroll anyone, change payments or protect against shutoff. CaseLink still needs verified required evidence, any required personal acts and an accepted submission connection before sending an application.</p>
    <p>{PECO_SUBJECT_AUTHORITY_STATEMENT}</p><p>{PECO_ACCOUNT_AUTHORITY_STATEMENT}</p>
  </div></section>;
}

function Field({ id, label, value, onChange, type = "text", maximum = 80, autoComplete }: {
  id: string; label: string; value?: string; onChange: (value: string | undefined) => void;
  type?: "text" | "date" | "tel"; maximum?: number; autoComplete?: string;
}) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  return <div className={styles.field}><label htmlFor={id}>{label}</label><input id={id} className={styles.input}
    type={type} value={value ?? ""} maxLength={maximum} autoComplete={autoComplete}
    {...(type === "date" ? { max: today } : {})}
    {...(type === "tel" ? { placeholder: "215-555-0101", pattern: "[0-9]{3}-[0-9]{3}-[0-9]{4}" } : {})}
    onChange={event => onChange(optional(event.target.value))}
    onBlur={type === "tel" ? event => onChange(optional(event.target.value.replace(/^\(?([0-9]{3})\)?[ .-]?([0-9]{3})[ .-]?([0-9]{4})$/, "$1-$2-$3"))) : undefined}/></div>;
}

function PersonFields({ person, prefix, name, adultMember = false, onChange }: { person?: Person; prefix: string; name: string; adultMember?: boolean; onChange: (person: Person) => void }) {
  const change = (patch: Partial<Person>) => onChange({ ...person, id: person?.id ?? crypto.randomUUID(), ...patch });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const isAdult = (birth?: string) => !!birth && Number(today.slice(0, 4)) - Number(birth.slice(0, 4)) - (today.slice(5) < birth.slice(5) ? 1 : 0) >= 18;
  const showIncome = !adultMember || isAdult(person?.dateOfBirth);
  return <><div className={styles.row}>
    <Field id={`${prefix}-first`} label={`${name} first name`} value={person?.firstName} onChange={firstName => change({ firstName })}/>
    <Field id={`${prefix}-last`} label={`${name} last name`} value={person?.lastName} onChange={lastName => change({ lastName })}/>
    <Field id={`${prefix}-middle`} label={`${name} middle initial`} maximum={2} value={person?.middleInitial} onChange={middleInitial => change({ middleInitial })}/>
  </div><Field id={`${prefix}-birth`} label={`${name} date of birth`} type="date" value={person?.dateOfBirth} onChange={dateOfBirth => change({ dateOfBirth, ...(adultMember && !isAdult(dateOfBirth) ? { income: undefined } : {}) })}/>
    {showIncome ? <div className={styles.field}><label htmlFor={`${prefix}-income`}>{name} income sources</label>
      <select id={`${prefix}-income`} className={styles.select} value={person?.income?.state ?? ""} onChange={event => {
        const state = optional(event.target.value) as NonNullable<Person["income"]>["state"] | undefined;
        change({ income: state ? { state, sources: state === "sources" ? person?.income?.sources ?? [] : [] } : undefined });
      }}><option value="">Unanswered</option><option value="unknown">Not sure</option><option value="none">No income sources</option><option value="sources">Has income sources</option></select>
    </div> : <p className={styles.hint}>Income source questions are for household members age 18 or older. Leave an unknown birth date unanswered.</p>}
    {showIncome && person?.income?.state === "sources" && <fieldset className={styles.fieldset}><legend className={styles.legend}>{name} source list</legend>
      <p className={styles.hint}>List each separate source, including separate jobs. Add the type only; amounts and proof are not collected here.</p>
      {person.income.sources.map((source, index) => <div className={styles.row} key={source.id}>
        <div className={styles.field}><label htmlFor={`${prefix}-source-${source.id}`}>{name} income source {index + 1}</label>
          <select id={`${prefix}-source-${source.id}`} className={styles.select} value={source.kind} onChange={event => change({ income: { state: "sources", sources: person.income!.sources.map(item => item.id === source.id ? { ...item, kind: event.target.value as IncomeKind } : item) } })}>
            {Object.entries(PECO_INCOME_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
          </select></div>
        <button type="button" className={styles.quiet} onClick={() => { document.getElementById(`${prefix}-add-source`)?.focus(); change({ income: { state: "sources", sources: person.income!.sources.filter(item => item.id !== source.id) } }); }}>Remove {name.toLowerCase()} income source {index + 1}</button>
      </div>)}
      <div className={styles.field}><label htmlFor={`${prefix}-add-source`}>Add {name.toLowerCase()} income source</label>
        <select id={`${prefix}-add-source`} className={styles.select} value="" disabled={person.income.sources.length >= 30} onChange={event => {
          if (event.target.value) change({ income: { state: "sources", sources: [...person.income!.sources, { id: crypto.randomUUID(), kind: event.target.value as IncomeKind }] } });
        }}><option value="">Choose a source to add</option>{Object.entries(PECO_INCOME_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select>
      </div>
      {person.income.sources.length === 0 && <p className={styles.hint}>Add a source, choose “Not sure,” or leave income unanswered before saving.</p>}
    </fieldset>}
  </>;
}

export function PecoApplicationFormFields({ value, onChange, disabled = false, idPrefix = "peco" }: {
  value: PecoApplicationFields; onChange: (value: PecoApplicationFields) => void; disabled?: boolean; idPrefix?: string;
}) {
  const [newPerson, setNewPerson] = useState<string | null>(null);
  useLayoutEffect(() => { if (newPerson) document.getElementById(`${idPrefix}-person-${newPerson}-first`)?.focus(); }, [newPerson, idPrefix]);
  return <fieldset className={styles.fieldset} disabled={disabled}>
    <legend className={styles.legend}>PECO CAP preparation answers</legend>
    <p className={styles.hint}>Answer the applicable questions together. You can save a partial draft. Unknown enrollment or journey answers do not become a new application.</p>
    <div className={styles.row}>
      <div className={styles.field}><label htmlFor={`${idPrefix}-journey`}>What PECO CAP help is needed?</label><select id={`${idPrefix}-journey`} className={styles.select} value={value.journey ?? ""} onChange={event => onChange({ ...value, journey: optional(event.target.value) as PecoApplicationFields["journey"] })}>
        <option value="">Unanswered</option><option value="unknown">Not sure</option><option value="new_enrollment">Prepare a new CAP application</option><option value="renewal">Prepare a CAP renewal</option></select></div>
      <div className={styles.field}><label htmlFor={`${idPrefix}-enrolled`}>Is this account already enrolled in CAP?</label><select id={`${idPrefix}-enrolled`} className={styles.select} value={value.currentCapState ?? ""} onChange={event => onChange({ ...value, currentCapState: optional(event.target.value) as PecoApplicationFields["currentCapState"] })}>
        <option value="">Unanswered</option><option value="unknown">Not sure</option><option value="not_enrolled">No</option><option value="enrolled">Yes</option></select></div>
    </div>
    <div className={styles.field}><label htmlFor={`${idPrefix}-account`}>PECO account number</label><input id={`${idPrefix}-account`} className={styles.input} type="text" inputMode="numeric" pattern="[0-9]{10}" maxLength={10} autoComplete="off" value={value.accountNumber ?? ""} onChange={event => onChange({ ...value, accountNumber: optional(event.target.value) })}/>
      <p className={styles.hint}>Use the ten-digit number on the PECO bill, not a Social Security number. If your account uses another format, leave this blank and use official PECO help.</p></div>
    <fieldset className={styles.fieldset}><legend className={styles.legend}>Applicant</legend>
      <PersonFields person={value.applicant} prefix={`${idPrefix}-applicant`} name="Applicant" onChange={applicant => onChange({ ...value, applicant })}/>
    </fieldset>
    <fieldset className={styles.fieldset}><legend className={styles.legend}>PECO service address and contact</legend>
      <Field id={`${idPrefix}-street`} label="PECO service street address" value={value.address?.street} maximum={160} autoComplete="street-address" onChange={street => onChange({ ...value, address: { ...value.address, street } })}/>
      <Field id={`${idPrefix}-apartment`} label="PECO service apartment or unit" value={value.address?.apartment} onChange={apartment => onChange({ ...value, address: { ...value.address, apartment } })}/>
      <div className={styles.row}>
        <Field id={`${idPrefix}-city`} label="PECO service city" value={value.address?.city} autoComplete="address-level2" onChange={city => onChange({ ...value, address: { ...value.address, city } })}/>
        <div className={styles.field}><label htmlFor={`${idPrefix}-state`}>PECO service state</label><select id={`${idPrefix}-state`} className={styles.select} value={value.address?.state ?? ""} onChange={event => onChange({ ...value, address: { ...value.address, state: optional(event.target.value) as "PA" | undefined } })}><option value="">Unanswered</option><option value="PA">Pennsylvania</option></select></div>
        <Field id={`${idPrefix}-postal-zip`} label="PECO service ZIP code" value={value.address?.zip} maximum={5} autoComplete="postal-code" onChange={zip => onChange({ ...value, address: { ...value.address, zip } })}/>
      </div>
      <p className={styles.hint}>Use the actual service address; the household routing ZIP is not copied here.</p>
      <div className={styles.row}>
        <Field id={`${idPrefix}-home-phone`} label="Home phone number" type="tel" value={value.homePhone} maximum={13} autoComplete="tel-national" onChange={homePhone => onChange({ ...value, homePhone })}/>
        <Field id={`${idPrefix}-cell-phone`} label="Mobile phone number" type="tel" value={value.cellPhone} maximum={13} autoComplete="tel-national" onChange={cellPhone => onChange({ ...value, cellPhone })}/>
      </div>
      <div className={styles.field}><label htmlFor={`${idPrefix}-sms`}>PECO text update preference</label><select id={`${idPrefix}-sms`} className={styles.select} value={value.smsUpdates === undefined ? "" : String(value.smsUpdates)} onChange={event => onChange({ ...value, smsUpdates: event.target.value === "" ? undefined : event.target.value === "true" })}>
        <option value="">Unanswered</option><option value="true">Prefer text updates at the mobile number above</option><option value="false">Do not request text updates</option></select>
        <p className={styles.hint}>Saving records a preference only. It does not sign you up for PECO messages.</p></div>
    </fieldset>
    <fieldset className={styles.fieldset}><legend className={styles.legend}>Other household members</legend>
      <p className={styles.hint}>List everyone else living in the household, including children. For people age 18 or older, list known income source types. Do not guess a name, birth date or income source.</p>
      {(value.householdMembers ?? []).map((person, index) => <fieldset className={styles.fieldset} key={person.id}><legend className={styles.legend}>Household member {index + 1}</legend>
        <PersonFields person={person} prefix={`${idPrefix}-person-${person.id}`} name={`Household member ${index + 1}`} adultMember onChange={updated => onChange({ ...value, householdMembers: value.householdMembers!.map(item => item.id === person.id ? { ...person, ...updated, id: person.id } : item) })}/>
        <Field id={`${idPrefix}-person-${person.id}-relationship`} label={`Household member ${index + 1} relationship to applicant`} value={person.relationship} onChange={relationship => onChange({ ...value, householdMembers: value.householdMembers!.map(item => item.id === person.id ? { ...item, relationship } : item) })}/>
        <button type="button" className={styles.quiet} onClick={() => { document.getElementById(`${idPrefix}-add-person`)?.focus(); onChange({ ...value, householdComplete: undefined, householdMembers: value.householdMembers!.filter(item => item.id !== person.id) }); }}>Remove household member {index + 1}</button>
      </fieldset>)}
      <button id={`${idPrefix}-add-person`} type="button" className={styles.secondary} disabled={(value.householdMembers?.length ?? 0) >= 99} onClick={() => { const id = crypto.randomUUID(); setNewPerson(id); onChange({ ...value, householdComplete: undefined, householdMembers: [...(value.householdMembers ?? []), { id }] }); }}>Add a household member</button>
      <div className={styles.field}><label htmlFor={`${idPrefix}-complete`}>Is this the full household list?</label><select id={`${idPrefix}-complete`} className={styles.select} value={value.householdComplete === undefined ? "" : String(value.householdComplete)} onChange={event => {
        const householdComplete = event.target.value === "" ? undefined : event.target.value === "true";
        onChange({ ...value, householdComplete, ...(householdComplete ? { applicant: value.applicant ?? { id: crypto.randomUUID() }, householdMembers: value.householdMembers ?? [] } : {}) });
      }}><option value="">Unanswered</option><option value="false">Not yet / not sure</option><option value="true">Yes, the applicant and everyone else are listed</option></select></div>
    </fieldset>
  </fieldset>;
}
