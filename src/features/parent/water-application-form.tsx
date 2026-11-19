"use client";
import Link from "next/link";
import { useLayoutEffect, useState } from "react";
import { WATER_APPLICATION_REFERENCE, WATER_SUBJECT_AUTHORITY_STATEMENT, WATER_ACCOUNT_AUTHORITY_STATEMENT, waterMoneySchema, type WaterApplicationFields } from "@/lib/parent/water-application-fields";
import styles from "./parent.module.css";

export const WATER_HELP_URL = WATER_APPLICATION_REFERENCE.guidanceUrl;
export const WATER_INCOME_LABELS = { employment: "Employment", self_employment: "Self-employment", benefits: "Benefits", pension: "Pension", child_support: "Child support", outside_support: "Outside financial support", rental: "Rental income", other: "Other income" } as const;
type Person = NonNullable<WaterApplicationFields["applicant"]>;
type Supporter = NonNullable<WaterApplicationFields["outsideSupporters"]>[number];
const optional = (value: string) => value === "" ? undefined : value;

export function WaterApplicationNotice() {
  return <section className={styles.notice} aria-label="Water private information notice"><div>
    <h3>Before you share private water assistance answers</h3>
    <p>These optional preparation answers include names, birth dates, addresses, contact information, income amounts and sources, child support, any outside supporter you name and applicable explanations of how the applicant pays living expenses. Share only information for this water assistance request and people you have permission to help.</p>
    <p>Your browser sends these answers to CaseLink and its database provider, Supabase, for private storage in your account. Request summaries, AI conversations and routine automated updates do not include these private answers. Saving does not send them to the City.</p>
    <p>Each saved version keeps its original dates. Corrections do not erase earlier versions. Closed or cancelled requests become eligible for cleanup 90 days after their last update; actual removal depends on scheduled cleanup and any pending document cleanup. Active records stay subject to their recorded retention or deletion limits. You can request earlier deletion in Account. Provider, processor and backup retention have separate limits in the <Link className={styles.textLink} href="/support/privacy">privacy and data policy</Link>.</p>
    <p>Do not enter a water access code, saved Application ID, Social Security number, tax ID, password, signature, medical information or details of abuse here. Access codes, application recovery and required proof use a separate protected channel when available.</p>
    <p>The public City form is marked “SAMPLE – Do Not Submit.” These answers prepare a private draft from that reference. An actual account-issued application, validated evidence, required personal acts and a verified submission connection are still needed. Saving does not request a City application, choose financial terms, submit an application or confirm shutoff protection. Household routing ZIP is not copied into your property address.</p>
    <p><a className={styles.textLink} href={WATER_HELP_URL}>Open official water assistance help</a> immediately, including for urgent shutoff help.</p>
    <p>{WATER_SUBJECT_AUTHORITY_STATEMENT}</p><p>{WATER_ACCOUNT_AUTHORITY_STATEMENT}</p>
  </div></section>;
}

function Field({ id, label, value, onChange, type = "text", maximum = 160, autoComplete, money = false, multiline = false }: {
  id: string; label: string; value?: string; onChange: (value: string | undefined) => void;
  type?: "text" | "date" | "tel" | "email"; maximum?: number; autoComplete?: string; money?: boolean; multiline?: boolean;
}) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  if (multiline) return <div className={styles.field}><label htmlFor={id}>{label}</label><textarea id={id} className={styles.input} rows={3} value={value ?? ""} maxLength={maximum} aria-describedby={`${id}-hint`}
    onChange={event => onChange(optional(event.target.value.replace(/[\r\n]+/g, " ")))}/><p id={`${id}-hint`} className={styles.hint}>Line breaks are saved as spaces. Include only the financial explanation; leave medical information and details of abuse out.</p></div>;
  return <div className={styles.field}><label htmlFor={id}>{label}</label><input id={id} className={styles.input} type={type}
    value={value ?? ""} maxLength={maximum} autoComplete={autoComplete} {...(money ? { inputMode: "decimal" as const } : {})}
    {...(type === "date" ? { max: today } : {})} {...(type === "tel" ? { placeholder: "215-555-0101", pattern: "[0-9]{3}-[0-9]{3}-[0-9]{4}" } : {})}
    onChange={event => onChange(optional(event.target.value))}
    onBlur={type === "tel" ? event => onChange(optional(event.target.value.replace(/^\(?([0-9]{3})\)?[ .-]?([0-9]{3})[ .-]?([0-9]{4})$/, "$1-$2-$3"))) : undefined}/></div>;
}

function Answer({ id, label, value, onChange }: { id: string; label: string; value?: "yes" | "no" | "unknown"; onChange: (value: "yes" | "no" | "unknown" | undefined) => void }) {
  return <div className={styles.field}><label htmlFor={id}>{label}</label><select id={id} className={styles.select} value={value ?? ""} onChange={event => onChange(optional(event.target.value) as typeof value)}>
    <option value="">Unanswered</option><option value="unknown">Not sure</option><option value="yes">Yes</option><option value="no">No</option>
  </select></div>;
}

function PersonFields({ person, prefix, name, otherMember = false, onChange }: { person?: Person; prefix: string; name: string; otherMember?: boolean; onChange: (value: Person) => void }) {
  const change = (patch: Partial<Person>) => onChange({ ...person, id: person?.id ?? crypto.randomUUID(), ...patch });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const under18 = (birth?: string) => !!birth && Number(today.slice(0, 4)) - Number(birth.slice(0, 4)) - (today.slice(5) < birth.slice(5) ? 1 : 0) < 18;
  const minor = otherMember && under18(person?.dateOfBirth);
  const showIncome = !otherMember || !!person?.dateOfBirth && !minor;
  return <><div className={styles.row}>
    <Field id={`${prefix}-name`} label={`${name} full name`} value={person?.name} onChange={name => change({ name })}/>
    <Field id={`${prefix}-birth`} label={`${name} date of birth`} type="date" value={person?.dateOfBirth} onChange={dateOfBirth => change({ dateOfBirth })}/>
  </div>
    {showIncome ? <>
      <Field id={`${prefix}-gross`} label={`${name} gross monthly income in dollars`} value={person?.grossMonthlyIncome} maximum={10} money onChange={grossMonthlyIncome => change({ grossMonthlyIncome })}/>
      <p className={styles.hint}>Use the pre-tax monthly amount, including zero only when that is your answer. Do not enter a net-pay amount or guess an unknown amount.</p>
      <div className={styles.field}><label htmlFor={`${prefix}-income`}>{name} income sources</label><select id={`${prefix}-income`} className={styles.select} value={person?.income?.state ?? ""} onChange={event => {
        const state = optional(event.target.value) as NonNullable<Person["income"]>["state"] | undefined;
        change({ income: state ? { state, sources: state === "sources" ? person?.income?.sources ?? [] : [] } : undefined });
      }}><option value="">Unanswered</option><option value="unknown">Not sure</option><option value="none">No income sources</option><option value="sources">Has income sources</option></select></div>
      {person?.income?.state === "sources" && <fieldset className={styles.fieldset}><legend className={styles.legend}>{name} source list</legend>
        <p className={styles.hint}>List each separate source, including separate jobs. This list does not validate income proof.</p>
        {person.income.sources.map((source, index) => <div className={styles.row} key={source.id}><div className={styles.field}><label htmlFor={`${prefix}-source-${source.id}`}>{name} income source {index + 1}</label>
          <select id={`${prefix}-source-${source.id}`} className={styles.select} value={source.kind} onChange={event => change({ income: { state: "sources", sources: person.income!.sources.map(item => item.id === source.id ? { ...item, kind: event.target.value as keyof typeof WATER_INCOME_LABELS } : item) } })}>
            {Object.entries(WATER_INCOME_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
          </select></div><button type="button" className={styles.quiet} onClick={() => { document.getElementById(`${prefix}-add-source`)?.focus(); change({ income: { state: "sources", sources: person.income!.sources.filter(item => item.id !== source.id) } }); }}>Remove {name.toLowerCase()} income source {index + 1}</button></div>)}
        <div className={styles.field}><label htmlFor={`${prefix}-add-source`}>Add {name.toLowerCase()} income source</label><select id={`${prefix}-add-source`} className={styles.select} value="" disabled={person.income.sources.length >= 30} onChange={event => {
          if (event.target.value) change({ income: { state: "sources", sources: [...person.income!.sources, { id: crypto.randomUUID(), kind: event.target.value as keyof typeof WATER_INCOME_LABELS }] } });
        }}><option value="">Choose a source to add</option>{Object.entries(WATER_INCOME_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></div>
        {person.income.sources.length === 0 && <p className={styles.hint}>Add a source, choose “Not sure,” or leave the inventory unanswered before saving.</p>}
      </fieldset>}
    </> : <p className={styles.hint}>{minor ? "The public SAMPLE instructs 0 for other household members under 18. CaseLink does not ask their income here or change earlier answers into a verified City application." : "Add a known birth date to show applicable income questions, or leave the date unanswered."}</p>}
  </>;
}

export function WaterApplicationFormFields({ value, onChange, disabled = false, idPrefix = "water" }: { value: WaterApplicationFields; onChange: (value: WaterApplicationFields) => void; disabled?: boolean; idPrefix?: string }) {
  const [newPerson, setNewPerson] = useState<string | null>(null), [newSupporter, setNewSupporter] = useState<string | null>(null);
  useLayoutEffect(() => { if (newPerson) document.getElementById(`${idPrefix}-person-${newPerson}-name`)?.focus(); }, [newPerson, idPrefix]);
  useLayoutEffect(() => { if (newSupporter) document.getElementById(`${idPrefix}-supporter-${newSupporter}-name`)?.focus(); }, [newSupporter, idPrefix]);
  const updateSupporter = (id: string, patch: Partial<Supporter>) => onChange({ ...value, outsideSupporters: value.outsideSupporters!.map(person => person.id === id ? { ...person, ...patch } : person) });
  const applicantAmount = waterMoneySchema.safeParse(value.applicant?.grossMonthlyIncome), applicantZero = applicantAmount.success && applicantAmount.data === "0.00";
  return <fieldset className={styles.fieldset} disabled={disabled}><legend className={styles.legend}>Water assistance preparation answers</legend>
    <p className={styles.hint}>Answer known questions together. Blanks and Not sure can stay in a partial draft. A saved or submitted City application needs recovery or follow-up; it does not become a new application.</p>
    <div className={styles.row}><div className={styles.field}><label htmlFor={`${idPrefix}-journey`}>What water assistance help is needed?</label><select id={`${idPrefix}-journey`} className={styles.select} value={value.journey ?? ""} onChange={event => onChange({ ...value, journey: optional(event.target.value) as WaterApplicationFields["journey"] })}>
      <option value="">Unanswered</option><option value="unknown">Not sure</option><option value="new_application">Prepare a new application</option><option value="recertification">Prepare a recertification</option><option value="pending">Follow up on an existing application</option></select></div>
      <div className={styles.field}><label htmlFor={`${idPrefix}-existing`}>Have you already started or sent a City water assistance application?</label><select id={`${idPrefix}-existing`} className={styles.select} value={value.existingApplication ?? ""} onChange={event => onChange({ ...value, existingApplication: optional(event.target.value) as WaterApplicationFields["existingApplication"] })}>
        <option value="">Unanswered</option><option value="unknown">Not sure</option><option value="none_known">No known existing application</option><option value="saved">I saved an application</option><option value="submitted">I submitted an application</option></select><p className={styles.hint}>This records your report. City status and shutoff protection remain unverified.</p></div></div>
    <div className={styles.field}><label htmlFor={`${idPrefix}-channel`}>Preferred way to complete the City application, if you have a preference</label><select id={`${idPrefix}-channel`} className={styles.select} value={value.preferredChannel ?? ""} onChange={event => onChange({ ...value, preferredChannel: optional(event.target.value) as WaterApplicationFields["preferredChannel"] })}>
      <option value="">No preference provided</option><option value="unknown">Not sure</option><option value="online">Online</option><option value="paper">Paper</option><option value="assisted">With in-person help</option></select><p className={styles.hint}>This is a preference, not an application request or a confirmed appointment.</p></div>
    <fieldset className={styles.fieldset}><legend className={styles.legend}>Applicant</legend><PersonFields person={value.applicant} prefix={`${idPrefix}-applicant`} name="Applicant" onChange={applicant => {
      const amount = waterMoneySchema.safeParse(applicant.grossMonthlyIncome);
      onChange({ ...value, applicant, ...(applicant.grossMonthlyIncome === undefined || amount.success && amount.data !== "0.00" ? { livingExpenses: undefined } : {}) });
    }}/></fieldset>
    <fieldset className={styles.fieldset}><legend className={styles.legend}>Property address and contact</legend>
      <Field id={`${idPrefix}-property`} label="Water property address" value={value.propertyAddress} maximum={200} autoComplete="street-address" onChange={propertyAddress => onChange({ ...value, propertyAddress })}/>
      <Field id={`${idPrefix}-mailing`} label="Mailing address, if different" value={value.mailingAddress} maximum={200} onChange={mailingAddress => onChange({ ...value, mailingAddress })}/>
      <div className={styles.row}><Field id={`${idPrefix}-phone`} label="Daytime phone number" type="tel" maximum={13} value={value.phone} onChange={phone => onChange({ ...value, phone })}/>
        <Field id={`${idPrefix}-email`} label="Email for application updates" type="email" maximum={100} value={value.email} onChange={email => onChange({ ...value, email })}/></div>
      <Answer id={`${idPrefix}-oopa`} label="Have you been approved for an Owner Occupied Payment Agreement (OOPA)?" value={value.oopa} onChange={oopa => onChange({ ...value, oopa })}/>
    </fieldset>
    <fieldset className={styles.fieldset}><legend className={styles.legend}>Other household members</legend><p className={styles.hint}>List everyone else living with the applicant, including children. Do not include the applicant again or guess anyone’s details.</p>
      {(value.householdMembers ?? []).map((person, index) => <fieldset className={styles.fieldset} key={person.id}><legend className={styles.legend}>Household member {index + 1}</legend>
        <PersonFields person={person} prefix={`${idPrefix}-person-${person.id}`} name={`Household member ${index + 1}`} otherMember onChange={updated => onChange({ ...value, householdMembers: value.householdMembers!.map(item => item.id === person.id ? { ...item, ...updated, id: person.id } : item) })}/>
        <Field id={`${idPrefix}-person-${person.id}-relationship`} label={`Household member ${index + 1} relationship to applicant`} maximum={80} value={person.relationship} onChange={relationship => onChange({ ...value, householdMembers: value.householdMembers!.map(item => item.id === person.id ? { ...item, relationship } : item) })}/>
        <button type="button" className={styles.quiet} onClick={() => { document.getElementById(`${idPrefix}-add-person`)?.focus(); onChange({ ...value, householdComplete: undefined, householdMembers: value.householdMembers!.filter(item => item.id !== person.id) }); }}>Remove household member {index + 1}</button>
      </fieldset>)}
      <button id={`${idPrefix}-add-person`} type="button" className={styles.secondary} disabled={(value.householdMembers?.length ?? 0) >= 99} onClick={() => { const id = crypto.randomUUID(); setNewPerson(id); onChange({ ...value, householdComplete: undefined, householdMembers: [...(value.householdMembers ?? []), { id }] }); }}>Add a household member</button>
      <div className={styles.field}><label htmlFor={`${idPrefix}-complete`}>Is this the full household list?</label><select id={`${idPrefix}-complete`} className={styles.select} value={value.householdComplete === undefined ? "" : String(value.householdComplete)} onChange={event => {
        const householdComplete = event.target.value === "" ? undefined : event.target.value === "true";
        onChange({ ...value, householdComplete, ...(householdComplete ? { applicant: value.applicant ?? { id: crypto.randomUUID() }, householdMembers: value.householdMembers ?? [] } : {}) });
      }}><option value="">Unanswered</option><option value="false">Not yet / not sure</option><option value="true">Yes, the applicant and everyone else are listed</option></select></div>
    </fieldset>
    <fieldset className={styles.fieldset}><legend className={styles.legend}>Child support and outside financial support</legend>
      <Answer id={`${idPrefix}-child-support`} label="Does someone in the household receive child support?" value={value.childSupportReceived} onChange={childSupportReceived => onChange({ ...value, childSupportReceived, ...(childSupportReceived !== "yes" ? { childSupportMonthlyAmount: undefined } : {}) })}/>
      {value.childSupportReceived === "yes" && <Field id={`${idPrefix}-child-amount`} label="Monthly child support in dollars" value={value.childSupportMonthlyAmount} maximum={10} money onChange={childSupportMonthlyAmount => onChange({ ...value, childSupportMonthlyAmount })}/>}
      <Answer id={`${idPrefix}-outside`} label="Does anyone in the household receive financial support from someone outside the household?" value={value.outsideIncomeSupport} onChange={outsideIncomeSupport => onChange({ ...value, outsideIncomeSupport, ...(outsideIncomeSupport !== "yes" ? { outsideSupporters: undefined } : {}), ...(outsideIncomeSupport !== "no" ? { livingExpenses: undefined } : {}) })}/>
      {value.outsideIncomeSupport === "yes" && <><p className={styles.hint}>List known support, including support listed above. Saving does not contact a supporter, make their declaration or sign an attachment.</p>
        {(value.outsideSupporters ?? []).map((person, index) => <fieldset className={styles.fieldset} key={person.id}><legend className={styles.legend}>Outside supporter {index + 1}</legend>
          <Field id={`${idPrefix}-supporter-${person.id}-name`} label={`Outside supporter ${index + 1} full name`} value={person.name} onChange={name => updateSupporter(person.id, { name })}/>
          <Field id={`${idPrefix}-supporter-${person.id}-address`} label={`Outside supporter ${index + 1} address`} maximum={200} value={person.address} onChange={address => updateSupporter(person.id, { address })}/>
          <div className={styles.row}><Field id={`${idPrefix}-supporter-${person.id}-phone`} label={`Outside supporter ${index + 1} daytime phone`} type="tel" maximum={13} value={person.phone} onChange={phone => updateSupporter(person.id, { phone })}/>
            <Field id={`${idPrefix}-supporter-${person.id}-relationship`} label={`Outside supporter ${index + 1} relationship`} maximum={80} value={person.relationship} onChange={relationship => updateSupporter(person.id, { relationship })}/></div>
          <div className={styles.row}><Field id={`${idPrefix}-supporter-${person.id}-amount`} label={`Outside supporter ${index + 1} support in dollars`} maximum={10} money value={person.amount} onChange={amount => updateSupporter(person.id, { amount })}/>
            <div className={styles.field}><label htmlFor={`${idPrefix}-supporter-${person.id}-frequency`}>Outside supporter {index + 1} support frequency</label><select id={`${idPrefix}-supporter-${person.id}-frequency`} className={styles.select} value={person.frequency ?? ""} onChange={event => updateSupporter(person.id, { frequency: optional(event.target.value) as Supporter["frequency"], frequencyDescription: undefined })}>
              <option value="">Unanswered</option><option value="weekly">Weekly</option><option value="biweekly">Every two weeks</option><option value="twice_monthly">Twice a month</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option><option value="other">Another frequency</option></select></div></div>
          {person.frequency === "other" && <Field id={`${idPrefix}-supporter-${person.id}-other`} label={`Outside supporter ${index + 1} other frequency`} maximum={40} value={person.frequencyDescription} onChange={frequencyDescription => updateSupporter(person.id, { frequencyDescription })}/>}
          <Answer id={`${idPrefix}-supporter-${person.id}-current`} label={`Is outside supporter ${index + 1} still providing this support?`} value={person.stillProviding} onChange={stillProviding => updateSupporter(person.id, { stillProviding })}/>
          <button type="button" className={styles.quiet} onClick={() => { document.getElementById(`${idPrefix}-add-supporter`)?.focus(); onChange({ ...value, outsideSupporters: value.outsideSupporters!.filter(item => item.id !== person.id) }); }}>Remove outside supporter {index + 1}</button>
        </fieldset>)}
        <button id={`${idPrefix}-add-supporter`} type="button" className={styles.secondary} disabled={(value.outsideSupporters?.length ?? 0) >= 30} onClick={() => { const id = crypto.randomUUID(); setNewSupporter(id); onChange({ ...value, outsideSupporters: [...(value.outsideSupporters ?? []), { id }] }); }}>Add an outside supporter</button>
      </>}
    </fieldset>
    {applicantZero && value.outsideIncomeSupport === "no" && <fieldset className={styles.fieldset}><legend className={styles.legend}>Applicant zero-income preparation</legend>
      <p className={styles.hint}>You entered 0 for the applicant’s gross income and no outside financial support for the household. The public SAMPLE’s Attachment B asks how the applicant pays these expenses. Unknown explanations can stay blank. This does not declare no income for every household member, sign or certify a City attachment.</p>
      {([['food', 'How does the applicant pay for food?'], ['housing', 'How does the applicant pay for housing?'], ['utilities', 'How does the applicant pay for utility service?']] as const).map(([key, label]) => <Field key={key} id={`${idPrefix}-living-${key}`} label={label} value={value.livingExpenses?.[key]} maximum={400} multiline onChange={text => onChange({ ...value, livingExpenses: { ...value.livingExpenses, [key]: text } })}/>)}
    </fieldset>}
  </fieldset>;
}
