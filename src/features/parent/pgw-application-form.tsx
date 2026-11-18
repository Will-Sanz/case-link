"use client";
import Link from "next/link";
import { useLayoutEffect, useState } from "react";
import { PGW_ACCOUNT_AUTHORITY_STATEMENT, PGW_SUBJECT_AUTHORITY_STATEMENT, type PgwApplicationFields } from "@/lib/parent/pgw-application-fields";
import { pgwUnder18 } from "@/lib/parent/pgw-application-preparation";
import styles from "./parent.module.css";

export const PGW_HELP_URL = "https://www.pgworks.com/about-your-bill/financial-support-programs/crp";
export const PGW_INCOME_LABELS = {
  employment: "Employment", social_security: "Social Security", pension: "Pension", cash_benefits: "Cash benefits",
  unemployment: "Unemployment", disability: "Disability income", self_employment: "Self-employment", child_support: "Child support",
  spousal_support: "Spousal support", foster_care: "Foster care income", rental: "Rental income", other: "Other income",
} as const;
type Customer = NonNullable<PgwApplicationFields["customer"]>;
type Member = NonNullable<PgwApplicationFields["householdMembers"]>[number];
type IncomeKind = keyof typeof PGW_INCOME_LABELS;
const optional = (value: string) => value === "" ? undefined : value;
const boolean = (value: string) => value === "" ? undefined : value === "true";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

export function PgwApplicationNotice() {
  return <section className={styles.notice} aria-label="PGW private information notice"><div>
    <h3>Before you share private PGW CRP answers</h3>
    <p>These optional answers include your PGW account number, household names, other household members’ birth dates, addresses, contact details, income source lists, applicable no-income explanations, outside support and SNAP or housing assistance amounts. Share only information for this PGW preparation and people you have permission to help.</p>
    <p>Your browser sends these answers to CaseLink and its database provider, Supabase, for private storage in your account. Your request summary, AI conversations and routine automated updates do not include these private answers. Saving does not send them to PGW.</p>
    <p>Each saved version keeps its original dates. Correcting an answer does not erase earlier versions. Closed or cancelled requests become eligible for cleanup 90 days after their last update; actual removal depends on scheduled cleanup and any pending document cleanup. Active records stay subject to their recorded retention or deletion limits. You can request earlier deletion in Account. Provider, processor and backup retention have separate limits in the <Link className={styles.textLink} href="/support/privacy">privacy and data policy</Link>.</p>
    <p>Do not enter a Social Security number, driver’s license, student ID, passport, visa, ITIN, password, signature or payment information here. PGW does not require the customer of record’s government identifier or birth date. Other household members, including children, need a supported identifier through a separate protected step. Never put it in a name, explanation or chat.</p>
    <p>Unknown answers can stay blank. A saved draft does not apply for CRP, confirm enrollment, make a payment, agree to financial terms or protect against shutoff. Required income evidence and identifiers, the customer’s personal signature and any applicable outside supporter’s own completion and signature remain separate. Use <a className={styles.textLink} href={PGW_HELP_URL}>official PGW help</a> immediately.</p>
    <p>{PGW_SUBJECT_AUTHORITY_STATEMENT}</p><p>{PGW_ACCOUNT_AUTHORITY_STATEMENT}</p>
  </div></section>;
}

function Field({ id, label, value, onChange, type = "text", maximum = 80, multiline = false }: {
  id: string; label: string; value?: string; onChange: (value: string | undefined) => void;
  type?: "text" | "date" | "tel"; maximum?: number; multiline?: boolean;
}) {
  const shared = { id, className: styles.input, value: value ?? "", maxLength: maximum, autoComplete: "off", "aria-describedby": multiline ? `${id}-hint` : undefined, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(optional(multiline ? event.target.value.replace(/\r\n?|\n/g, " ") : event.target.value)) };
  return <div className={styles.field}><label htmlFor={id}>{label}</label>{multiline ? <textarea {...shared} rows={3}/> : <input {...shared} type={type}
    {...(type === "date" ? { max: today() } : {})} {...(type === "tel" ? { placeholder: "215-555-0101", pattern: "[0-9]{3}-[0-9]{3}-[0-9]{4}" } : {})}
    onBlur={type === "tel" ? event => onChange(optional(event.target.value.replace(/^\(?([0-9]{3})\)?[ .-]?([0-9]{3})[ .-]?([0-9]{4})$/, "$1-$2-$3"))) : undefined}/>}{multiline && <p id={`${id}-hint`} className={styles.hint}>Line breaks are saved as spaces.</p>}</div>;
}

function Answer({ id, label, value, onChange, yes = "Yes", no = "No" }: { id: string; label: string; value?: boolean; onChange: (value: boolean | undefined) => void; yes?: string; no?: string }) {
  return <div className={styles.field}><label htmlFor={id}>{label}</label><select id={id} className={styles.select} value={value === undefined ? "" : String(value)} onChange={event => onChange(boolean(event.target.value))}>
    <option value="">Unanswered / not sure</option><option value="true">{yes}</option><option value="false">{no}</option></select></div>;
}

function Amount({ id, label, value, onChange }: { id: string; label: string; value?: number; onChange: (value: number | undefined) => void }) {
  const format = (amount?: number) => amount === undefined || !Number.isFinite(amount) ? "" : String(amount / 100);
  const [raw, setRaw] = useState(() => format(value)), [previous, setPrevious] = useState(value);
  if (!Object.is(previous, value)) { setPrevious(value); setRaw(format(value)); }
  return <div className={styles.field}><label htmlFor={id}>{label}</label><input id={id} className={styles.input} type="text" inputMode="decimal" autoComplete="off" maxLength={14}
    pattern="[0-9]+([.][0-9]{1,2})?" value={raw} placeholder="0.00" onChange={event => {
      const text = event.target.value, [whole, fraction = ""] = text.split(".");
      const cents = text === "" ? undefined : /^[0-9]+(?:\.[0-9]{0,2})?$/.test(text) ? Number(whole) * 100 + Number(fraction.padEnd(2, "0")) : Number.NaN;
      setRaw(text); setPrevious(cents); onChange(cents);
    }}/><p className={styles.hint}>US dollars per month. Leave an unknown amount blank; do not round or guess.</p></div>;
}

function Address({ prefix, name, value, onChange }: { prefix: string; name: string; value?: PgwApplicationFields["address"]; onChange: (value: NonNullable<PgwApplicationFields["address"]>) => void }) {
  return <><Field id={`${prefix}-street`} label={`${name} street address`} value={value?.street} maximum={160} onChange={street => onChange({ ...value, street })}/>
    <div className={styles.row}>{([['city', 'city', 80], ['state', 'state', 40], ['zip', 'ZIP code', 5]] as const).map(([key, label, maximum]) => <Field key={key} id={`${prefix}-${key}`} label={`${name} ${label}`} value={value?.[key]} maximum={maximum} onChange={text => onChange({ ...value, [key]: text })}/>)}</div></>;
}

function PersonIncome({ person, prefix, name, adult, onChange }: { person: Customer | Member; prefix: string; name: string; adult: boolean; onChange: (value: Customer | Member) => void }) {
  return <><div className={styles.field}><label htmlFor={`${prefix}-income`}>{name} income sources</label><select id={`${prefix}-income`} className={styles.select} value={person.income?.state ?? ""} onChange={event => {
    const state = optional(event.target.value) as NonNullable<Customer["income"]>["state"] | undefined;
    onChange({ ...person, income: state ? { state, sources: state === "sources" ? person.income?.sources ?? [] : [], ...(state === "none" && adult && person.income?.state === "none" ? { noIncomeSituation: person.income.noIncomeSituation } : {}) } : undefined });
  }}><option value="">Unanswered</option><option value="unknown">Not sure</option><option value="none">No income sources</option><option value="sources">Has income sources</option></select></div>
    {person.income?.state === "sources" && <fieldset className={styles.fieldset}><legend className={styles.legend}>{name} source list</legend>
      <p className={styles.hint}>List each separate source, including separate jobs. PGW requests evidence for income received by any household member, including children. Add source types here; proof uses its separate protected step.</p>
      {person.income.sources.map((source, index) => <div className={styles.row} key={source.id}><div className={styles.field}><label htmlFor={`${prefix}-source-${source.id}`}>{name} income source {index + 1}</label>
        <select id={`${prefix}-source-${source.id}`} className={styles.select} value={source.kind} onChange={event => onChange({ ...person, income: { state: "sources", sources: person.income!.sources.map(item => item.id === source.id ? { ...item, kind: event.target.value as IncomeKind } : item) } })}>
          {Object.entries(PGW_INCOME_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></div>
        <button type="button" className={styles.quiet} onClick={() => { document.getElementById(`${prefix}-add-source`)?.focus(); onChange({ ...person, income: { state: "sources", sources: person.income!.sources.filter(item => item.id !== source.id) } }); }}>Remove {name.toLowerCase()} income source {index + 1}</button></div>)}
      <div className={styles.field}><label htmlFor={`${prefix}-add-source`}>Add {name.toLowerCase()} income source</label><select id={`${prefix}-add-source`} className={styles.select} value="" disabled={person.income.sources.length >= 30} onChange={event => {
        if (event.target.value) onChange({ ...person, income: { state: "sources", sources: [...person.income!.sources, { id: crypto.randomUUID(), kind: event.target.value as IncomeKind }] } });
      }}><option value="">Choose a source to add</option>{Object.entries(PGW_INCOME_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></div>
      {person.income.sources.length === 0 && <p className={styles.hint}>Add a source, choose “Not sure,” or leave income unanswered before saving.</p>}
    </fieldset>}
    {adult && person.income?.state === "none" && <Field id={`${prefix}-no-income`} label={`${name} brief no-income situation`} value={person.income.noIncomeSituation} maximum={400} multiline onChange={noIncomeSituation => onChange({ ...person, income: { state: "none", sources: [], noIncomeSituation } })}/>}
  </>;
}

export function PgwApplicationFormFields({ value, onChange, disabled = false, idPrefix = "pgw" }: {
  value: PgwApplicationFields; onChange: (value: PgwApplicationFields) => void; disabled?: boolean; idPrefix?: string;
}) {
  const [newPerson, setNewPerson] = useState<string | null>(null);
  useLayoutEffect(() => { if (newPerson) document.getElementById(`${idPrefix}-person-${newPerson}-first`)?.focus(); }, [newPerson, idPrefix]);
  const customer = value.customer ?? { id: "" };
  const changeCustomer = (patch: Partial<Customer>) => onChange({ ...value, customer: { ...customer, id: customer.id || crypto.randomUUID(), ...patch } });
  const supporter = value.outsideSupport?.supporter;
  const changeSupporter = (patch: Partial<NonNullable<NonNullable<PgwApplicationFields["outsideSupport"]>["supporter"]>>) => onChange({ ...value, outsideSupport: { receives: true, supporter: { ...supporter, id: supporter?.id ?? crypto.randomUUID(), ...patch } } });
  return <fieldset className={styles.fieldset} disabled={disabled}><legend className={styles.legend}>PGW CRP preparation answers</legend>
    <p className={styles.hint}>Answer applicable questions together. You can save a partial draft. Unknown, pending or returning-account answers do not become a new enrollment.</p>
    <div className={styles.row}><div className={styles.field}><label htmlFor={`${idPrefix}-journey`}>What PGW CRP help is needed?</label><select id={`${idPrefix}-journey`} className={styles.select} value={value.journey ?? ""} onChange={event => onChange({ ...value, journey: optional(event.target.value) as PgwApplicationFields["journey"] })}>
      <option value="">Unanswered</option><option value="unknown">Not sure</option><option value="new_enrollment">Prepare new CRP enrollment</option><option value="recertification">Prepare CRP recertification</option><option value="reenrollment">Prepare return to CRP</option><option value="pending">Follow up on an existing application</option></select></div>
      <div className={styles.field}><label htmlFor={`${idPrefix}-enrolled`}>What is this account’s CRP enrollment?</label><select id={`${idPrefix}-enrolled`} className={styles.select} value={value.currentCrpState ?? ""} onChange={event => onChange({ ...value, currentCrpState: optional(event.target.value) as PgwApplicationFields["currentCrpState"] })}>
        <option value="">Unanswered</option><option value="unknown">Not sure</option><option value="not_enrolled">Not enrolled</option><option value="enrolled">Currently enrolled</option><option value="previously_enrolled">Previously enrolled</option></select></div></div>
    <Field id={`${idPrefix}-account`} label="PGW account number" value={value.accountNumber} onChange={accountNumber => onChange({ ...value, accountNumber })}/>
    <fieldset className={styles.fieldset}><legend className={styles.legend}>Customer of record</legend><div className={styles.row}>
      <Field id={`${idPrefix}-customer-first`} label="Customer first name" value={customer.firstName} onChange={firstName => changeCustomer({ firstName })}/><Field id={`${idPrefix}-customer-last`} label="Customer last name" value={customer.lastName} onChange={lastName => changeCustomer({ lastName })}/></div>
      <Answer id={`${idPrefix}-customer-under18`} label="Is the customer of record under 18?" value={customer.under18} onChange={under18 => changeCustomer({ under18, ...(under18 !== false && customer.income?.state === "none" ? { income: { ...customer.income, noIncomeSituation: undefined } } : {}) })}/>
      <p className={styles.hint}>PGW does not require this customer’s birth date or government identifier.</p>
      <PersonIncome person={customer} prefix={`${idPrefix}-customer`} name="Customer" adult={customer.under18 === false} onChange={updated => changeCustomer({ ...updated, id: customer.id || crypto.randomUUID() })}/>
    </fieldset>
    <fieldset className={styles.fieldset}><legend className={styles.legend}>PGW service address and contact</legend><Address prefix={`${idPrefix}-service`} name="PGW service" value={value.address} onChange={address => onChange({ ...value, address })}/>
      <p className={styles.hint}>Use the actual service address. The routing ZIP is not copied here.</p><Field id={`${idPrefix}-phone`} label="PGW contact phone" type="tel" maximum={13} value={value.phone} onChange={phone => onChange({ ...value, phone })}/></fieldset>
    <fieldset className={styles.fieldset}><legend className={styles.legend}>Other household members</legend><p className={styles.hint}>List everyone else, including children. List each person’s actual income sources at any age. Their required identifier belongs only in the separate protected step.</p>
      {(value.householdMembers ?? []).map((person, index) => {
        const prefix = `${idPrefix}-person-${person.id}`, name = `Household member ${index + 1}`;
        const change = (updated: Member) => onChange({ ...value, householdMembers: value.householdMembers!.map(item => item.id === person.id ? { ...updated, id: person.id } : item) });
        return <fieldset className={styles.fieldset} key={person.id}><legend className={styles.legend}>{name}</legend><div className={styles.row}>
          <Field id={`${prefix}-first`} label={`${name} first name`} value={person.firstName} onChange={firstName => change({ ...person, firstName })}/><Field id={`${prefix}-last`} label={`${name} last name`} value={person.lastName} onChange={lastName => change({ ...person, lastName })}/></div>
          <Field id={`${prefix}-birth`} label={`${name} date of birth`} type="date" value={person.dateOfBirth} onChange={dateOfBirth => change({ ...person, dateOfBirth, ...(!dateOfBirth || pgwUnder18(dateOfBirth, today()) ? person.income?.state === "none" ? { income: { ...person.income, noIncomeSituation: undefined } } : {} : {}) })}/>
          <Field id={`${prefix}-relationship`} label={`${name} relationship to customer`} value={person.relationship} onChange={relationship => change({ ...person, relationship })}/>
          <PersonIncome person={person} prefix={prefix} name={name} adult={!!person.dateOfBirth && !pgwUnder18(person.dateOfBirth, today())} onChange={change}/>
          <button type="button" className={styles.quiet} onClick={() => { document.getElementById(`${idPrefix}-add-person`)?.focus(); onChange({ ...value, householdComplete: undefined, householdMembers: value.householdMembers!.filter(item => item.id !== person.id) }); }}>Remove household member {index + 1}</button></fieldset>;
      })}
      <button id={`${idPrefix}-add-person`} type="button" className={styles.secondary} disabled={(value.householdMembers?.length ?? 0) >= 99} onClick={() => { const id = crypto.randomUUID(); setNewPerson(id); onChange({ ...value, householdComplete: undefined, householdMembers: [...(value.householdMembers ?? []), { id }] }); }}>Add a household member</button>
      <Answer id={`${idPrefix}-complete`} label="Is this the full household list?" value={value.householdComplete} yes="Yes, the customer and everyone else are listed" no="Not yet" onChange={householdComplete => onChange({ ...value, householdComplete, ...(householdComplete ? { customer: value.customer ?? { id: crypto.randomUUID() }, householdMembers: value.householdMembers ?? [] } : {}) })}/>
    </fieldset>
    <fieldset className={styles.fieldset}><legend className={styles.legend}>Support from someone outside this household</legend><Answer id={`${idPrefix}-outside-support`} label="Does someone outside this household provide financial support?" value={value.outsideSupport?.receives} onChange={receives => onChange({ ...value, outsideSupport: receives === undefined ? undefined : { receives, ...(receives ? { supporter } : {}) } })}/>
      {value.outsideSupport?.receives && <><p className={styles.hint}>The outside supporter must complete and sign their own section. Saving their contact and support details does not make that declaration for them.</p><div className={styles.row}>
        <Field id={`${idPrefix}-supporter-first`} label="Outside supporter first name" value={supporter?.firstName} onChange={firstName => changeSupporter({ firstName })}/><Field id={`${idPrefix}-supporter-last`} label="Outside supporter last name" value={supporter?.lastName} onChange={lastName => changeSupporter({ lastName })}/></div>
        <Address prefix={`${idPrefix}-supporter`} name="Outside supporter" value={supporter?.address} onChange={address => changeSupporter({ address })}/><Field id={`${idPrefix}-supporter-phone`} label="Outside supporter phone" type="tel" maximum={13} value={supporter?.phone} onChange={phone => changeSupporter({ phone })}/>
        <Amount id={`${idPrefix}-supporter-amount`} label="Outside support monthly amount" value={supporter?.monthlyAmountCents} onChange={monthlyAmountCents => changeSupporter({ monthlyAmountCents })}/></>}
    </fieldset>
    <fieldset className={styles.fieldset}><legend className={styles.legend}>Past 30 days and other assistance</legend><p className={styles.hint}>For this household zero-income question, PGW counts outside financial support as income, but excludes SNAP, housing subsidy and PHA utility assistance. Do not infer zero income from an unanswered source list.</p>
      <Answer id={`${idPrefix}-zero-income`} label="Did the entire household have no income in the past 30 days?" value={value.zeroIncomePast30Days} onChange={zeroIncomePast30Days => onChange({ ...value, zeroIncomePast30Days, ...(zeroIncomePast30Days !== true ? { livingExpenses: undefined } : {}) })}/>
      {value.zeroIncomePast30Days && <><p className={styles.hint}>Explain how these expenses are met. A saved explanation is preparation; it does not sign PGW’s zero-income statement.</p>{([['food', 'How does the household pay for food?'], ['housing', 'How does the household pay for housing?'], ['utilities', 'How does the household pay for utilities?']] as const).map(([key, label]) => <Field key={key} id={`${idPrefix}-living-${key}`} label={label} value={value.livingExpenses?.[key]} multiline maximum={400} onChange={text => onChange({ ...value, livingExpenses: { ...value.livingExpenses, [key]: text } })}/>)}</>}
      {([['snap', 'SNAP'], ['housingSubsidy', 'housing subsidy']] as const).map(([key, name]) => <div key={key}><Answer id={`${idPrefix}-${key}-receives`} label={`Does the household receive ${name}?`} value={value[key]?.receives} onChange={receives => onChange({ ...value, [key]: receives === undefined ? undefined : { receives, ...(receives ? { monthlyAmountCents: value[key]?.monthlyAmountCents } : {}) } })}/>
        {value[key]?.receives && <Amount id={`${idPrefix}-${key}-amount`} label={`${name === 'SNAP' ? 'SNAP' : 'Housing subsidy'} monthly amount`} value={value[key]?.monthlyAmountCents} onChange={monthlyAmountCents => onChange({ ...value, [key]: { receives: true, monthlyAmountCents } })}/>}</div>)}
    </fieldset>
  </fieldset>;
}
