"use client";
import { createContext, Fragment, useContext, useLayoutEffect, useRef, type ReactNode } from "react";
import type { SnapApplicationFields } from "@/lib/parent/snap-application-fields";
import { displayDate } from "./api";
import styles from "./parent.module.css";

type Person = NonNullable<SnapApplicationFields["household"]>[number];
type Income = NonNullable<SnapApplicationFields["income"]>;
type Expenses = NonNullable<SnapApplicationFields["expenses"]>;
type FocusedQuestions = { paths: string[]; stalePaths: string[]; confirmedPaths: string[]; onConfirm: (path: string) => void };
type Props = { value: SnapApplicationFields; onChange: (value: SnapApplicationFields) => void; disabled?: boolean; questions?: FocusedQuestions };
const QuestionContext = createContext<FocusedQuestions | undefined>(undefined);
const matches = (path: string, paths?: string[]) => !paths || paths.some(other => other === path || other.startsWith(`${path}.`) || path.startsWith(`${other}.`));
function Question({ path, label, children }: { path: string; label: string; children: ReactNode }) {
  const questions = useContext(QuestionContext);
  if (!matches(path, questions?.paths)) return null;
  return <>{children}{questions?.stalePaths.includes(path) && <button type="button" className={styles.quiet}
    aria-label={`Still correct: ${label}`} aria-pressed={questions.confirmedPaths.includes(path)}
    onClick={() => questions.onConfirm(path)}>{questions.confirmedPaths.includes(path) ? "Marked still correct" : "Still correct"}</button>}</>;
}
const currentMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit" }).format(new Date());
const text = (value: string) => value === "" ? undefined : value;
const number = (value: string) => value === "" ? undefined : Number(value);
const boolean = (value: string) => value === "" ? undefined : value === "yes";
const booleanValue = (value: boolean | undefined) => value === undefined ? "" : value ? "yes" : "no";
const personName = (person?: Pick<Person, "firstName" | "lastName" | "middleInitial">) => [person?.firstName, person?.middleInitial, person?.lastName].filter(Boolean).join(" ");
const applicantName = (value: SnapApplicationFields) => ({
  firstName: value.applicant?.firstName ?? value.household?.[0]?.firstName,
  lastName: value.applicant?.lastName ?? value.household?.[0]?.lastName,
  middleInitial: value.applicant?.middleInitial ?? value.household?.[0]?.middleInitial,
});
const utilities = { telephone: "Telephone", water: "Water", garbage: "Garbage", installation: "Utility installation", electric: "Electric", oil: "Oil, coal, wood or kerosene", sewer: "Sewer", gas: "Gas", propane: "Propane", other: "Other utility" } as const;
const housing = { rent: "Rent", condoFees: "Condo fees", mortgage: "Mortgage", propertyFees: "Property fees", homeownersInsurance: "Homeowner’s insurance" } as const;
const medical = { dental: "Dental bills", doctor: "Doctor bills", equipment: "Medical equipment", premiums: "Health insurance or Medicare premiums", hospital: "Hospital bills", prescriptions: "Prescription medicines", homeAide: "Health aides", supplies: "Health-related supplies", transport: "Travel for medical care or prescriptions", other: "Other medical expense" } as const;
const screening = {
  lowCashAndIncome: "Does your household have $100 or less in available cash and bank accounts and expect to receive less than $150 in income this month?",
  migrantOrSeasonal: "Are you a migrant or seasonal farm worker?",
  belowShelterCosts: "Is your monthly gross income and cash on hand less than your rent/mortgage and utility costs for this month?",
} as const;
const histories = {
  fleeingOrProbation: "Are you or anyone in your household a fleeing felon or fleeing to avoid prosecution, custody or confinement in a correctional facility for an attempted felony, or violating a condition of probation or parole imposed under a federal or state law?",
  welfareFraud: "Has anyone been convicted of welfare fraud?",
  otherStateDisqualification: "Have you or anyone in your household been disqualified or agreed to be disqualified for food stamps or SNAP benefits in another state?",
} as const;
const expenseQuestions = {
  childSupport: "Does anyone in your home pay child support to a person who does not live with you?",
  mealsIncludedInRent: "Are meals included in your rent?",
  heat: "Do you pay for heat?",
  housingAssistance: "Does anyone in your home get housing assistance?",
  outsidePayer: "Is there anyone outside of your household who pays any of your expenses?",
  airConditioning: "Do you pay for central air or to run a room air conditioner?",
  care: "Does anyone pay for childcare or care for an adult with a disability so they can go to work, school or training?",
} as const;

function Input({ path, label, value, onChange, type = "text", maxLength, autoComplete }: {
  path: string; label: string; value: string | number | undefined; onChange: (value: string) => void;
  type?: "text" | "date" | "number" | "tel" | "month"; maxLength?: number; autoComplete?: string;
}) {
  return <Question path={path} label={label}><div className={styles.field}><label htmlFor={`snap-${path}`}>{label}</label><input
    id={`snap-${path}`} data-snap-path={path} className={styles.input} type={type} value={value ?? ""}
    onChange={event => onChange(event.target.value)} maxLength={maxLength} autoComplete={autoComplete}
    {...(type === "number" ? { min: 0, max: 1000000, step: "any" } : {})}
  /></div></Question>;
}
function Select({ path, label, value, onChange, options }: {
  path: string; label: string; value: string | undefined; onChange: (value: string) => void; options: readonly (readonly [string, string])[];
}) {
  return <Question path={path} label={label}><div className={styles.field}><label htmlFor={`snap-${path}`}>{label}</label><select id={`snap-${path}`} data-snap-path={path}
    className={styles.select} value={value ?? ""} onChange={event => onChange(event.target.value)}>
    <option value="">Not sure / unanswered</option>{options.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
  </select></div></Question>;
}
function YesNo({ path, label, value, onChange }: { path: string; label: string; value: boolean | undefined; onChange: (value: boolean | undefined) => void }) {
  return <Select path={path} label={label} value={booleanValue(value)} onChange={answer => onChange(boolean(answer))} options={[["yes", "Yes"], ["no", "No"]]} />;
}
function Group({ title, children, paths }: { title: string; children: ReactNode; paths?: string[] }) {
  const questions = useContext(QuestionContext);
  if (paths && !paths.some(path => matches(path, questions?.paths))) return null;
  return <fieldset className={`${styles.fieldset} ${styles.stack}`}><legend className={styles.legend}>{title}</legend>{children}</fieldset>;
}

export function SnapApplicationFormFields({ value, onChange, disabled = false, questions }: Props) {
  const people = value.household ?? [];
  const self = people[0];
  const focusAfterCommit = useRef<string | null>(null);
  useLayoutEffect(() => {
    const id = focusAfterCommit.current;
    if (!id) return;
    const control = document.getElementById(id);
    if (!control) return;
    focusAfterCommit.current = null;
    control.focus();
  }, [value]);
  function update(next: SnapApplicationFields) { onChange(next); }
  function selfRow(): Person {
    return self ?? { id: crypto.randomUUID(), relationship: "SELF", ...value.applicant };
  }
  function changeApplicant(field: "firstName" | "lastName" | "middleInitial", answer: string) {
    const applicant = { ...applicantName(value), [field]: text(answer) };
    const household = [{ ...selfRow(), ...applicant, relationship: "SELF" }, ...people.slice(1)];
    update({ ...value, applicant, household, householdSize: household.length });
  }
  function changePerson(index: number, patch: Partial<Person>) {
    const household = people.length ? [...people] : [selfRow()];
    household[index] = { ...household[index], ...patch };
    if (patch.requestingSnap !== undefined && patch.requestingSnap !== true) household[index].citizen = undefined;
    if (Object.hasOwn(patch, "requestingSnap") && patch.requestingSnap === undefined) household[index].citizen = undefined;
    update({ ...value, household, householdSize: household.length });
  }
  function changeIncome(patch: Partial<Income>) {
    update({ ...value, income: { ...value.income, month: value.income?.month ?? currentMonth(), ...patch } });
  }
  function changeEntry(index: number, patch: Partial<NonNullable<Income["entries"]>[number]>) {
    const entries = [...(value.income?.entries ?? [])]; entries[index] = { ...entries[index], ...patch }; changeIncome({ entries });
  }
  function changeExpense<K extends keyof Expenses>(field: K, answer: Expenses[K]) {
    const expenses = { ...value.expenses, [field]: answer };
    const children = { childSupport: ["courtOrdered"], housingAssistance: ["housingAssistanceKind", "utilityAllowance"], outsidePayer: ["outsideExpenses", "outsideAmount", "outsideFrequency", "outsidePayee"], care: ["careMonthlyAmount", "careRecipient"] } as const;
    if (field in children && answer === false) for (const key of children[field as keyof typeof children]) delete expenses[key];
    update({ ...value, expenses });
  }
  function toggleUtility(key: keyof typeof utilities) {
    const selected = value.expenses?.utilities ?? [];
    const next = selected.includes(key) ? selected.filter(item => item !== key) : [...selected, key];
    update({ ...value, expenses: { ...value.expenses, utilities: next, ...(!next.includes("other") ? { otherUtility: undefined } : {}) } });
  }
  function toggleHousing(key: keyof typeof housing) {
    const selected = value.expenseClaims?.housing ?? [], checked = selected.includes(key);
    update({ ...value, expenseClaims: { ...value.expenseClaims, housing: checked ? selected.filter(item => item !== key) : [...selected, key] },
      expenses: { ...value.expenses, ...(checked ? { [key]: undefined } : {}) } });
  }
  function toggleMedical(key: keyof typeof medical) {
    const selected = value.expenses?.medical ?? [], next = selected.includes(key) ? selected.filter(item => item !== key) : [...selected, key];
    update({ ...value, expenses: { ...value.expenses, medical: next, ...(!next.includes("other") ? { otherMedical: undefined } : {}) } });
  }
  return <QuestionContext.Provider value={questions}><fieldset className={`${styles.fieldset} ${styles.form}`} disabled={disabled} aria-label="SNAP application details">
    <Group title="Applicant and contact details" paths={["applicant", "address", "zip", "county", "phone", "otherPhone", "bestTimeToCall", "language", "otherLanguage", "interpreter", "interpreterLanguage"]}>
      <div className={styles.row}>
        <Input path="applicant.firstName" label="Your first name" value={value.applicant?.firstName ?? self?.firstName} onChange={answer => changeApplicant("firstName", answer)} maxLength={80} autoComplete="given-name" />
        <Input path="applicant.lastName" label="Your last name" value={value.applicant?.lastName ?? self?.lastName} onChange={answer => changeApplicant("lastName", answer)} maxLength={80} autoComplete="family-name" />
      </div>
      <Input path="applicant.middleInitial" label="Your middle initial, if any" value={value.applicant?.middleInitial ?? self?.middleInitial} onChange={answer => changeApplicant("middleInitial", answer)} maxLength={2} />
      <Input path="address.street" label="Your address" value={value.address?.street} onChange={answer => update({ ...value, address: { ...value.address, street: text(answer) } })} maxLength={180} autoComplete="street-address" />
      <div className={styles.row}>
        <Input path="address.city" label="City" value={value.address?.city} onChange={answer => update({ ...value, address: { ...value.address, city: text(answer) } })} maxLength={80} autoComplete="address-level2" />
        <Input path="address.state" label="State" value={value.address?.state} onChange={answer => update({ ...value, address: { ...value.address, state: text(answer.toUpperCase()) } })} maxLength={2} autoComplete="address-level1" />
        <Input path="zip" label="ZIP code" value={value.zip} onChange={answer => update({ ...value, zip: text(answer) })} maxLength={5} autoComplete="postal-code" />
        <Input path="county" label="County" value={value.county} onChange={answer => update({ ...value, county: text(answer) })} maxLength={80} />
      </div>
      <p className={styles.hint}>No permanent address? Leave uncertain details blank. CaseLink must resolve an accepted mailing option; do not enter an invented address.</p>
      <div className={styles.row}>
        <Input path="phone" label="Home phone, if available" value={value.phone} onChange={answer => update({ ...value, phone: text(answer) })} type="tel" maxLength={30} autoComplete="tel" />
        <Input path="otherPhone" label="Other phone, if available" value={value.otherPhone} onChange={answer => update({ ...value, otherPhone: text(answer) })} type="tel" maxLength={30} />
      </div>
      {(matches("phone", questions?.paths) || matches("otherPhone", questions?.paths)) && <p className={styles.hint}>A telephone is optional. Leave it blank if none is available.</p>}
      <Input path="bestTimeToCall" label="Best time to call, if you have a preference" value={value.bestTimeToCall} onChange={answer => update({ ...value, bestTimeToCall: text(answer) })} maxLength={70} />
      <Select path="language" label="Preferred application language" value={value.language} options={[["en", "English"], ["es", "Spanish / Español"], ["other", "Other language"]]} onChange={answer => update({ ...value, language: (text(answer) as SnapApplicationFields["language"]), ...(answer !== "other" ? { otherLanguage: undefined } : {}) })} />
      {value.language === "other" && <Input path="otherLanguage" label="Other preferred language" value={value.otherLanguage} onChange={answer => update({ ...value, otherLanguage: text(answer) })} maxLength={80} />}
      <YesNo path="interpreter" label="Do you need an interpreter?" value={value.interpreter} onChange={answer => update({ ...value, interpreter: answer, ...(answer !== true ? { interpreterLanguage: undefined } : {}) })} />
      {value.interpreter && <Input path="interpreterLanguage" label="Interpreter language" value={value.interpreterLanguage} onChange={answer => update({ ...value, interpreterLanguage: text(answer) })} maxLength={80} />}
    </Group>
    <Group title="Everyone in your home" paths={["household"]}>
      <p className={styles.hint}>List everyone who lives in your home. Choose who is applying; citizenship is requested only for those applicants.</p>
      {(people.length ? people : [{} as Person]).map((person, index) => <Group key={index === 0 ? "self" : person.id} title={`${index === 0 ? "You" : `Person ${index + 1}`}${questions && personName(person) ? `: ${personName(person)}` : ""}`} paths={[`household.${person.id ?? "self"}`]}>
        {index > 0 && <div className={styles.row}>
          <Input path={`household.${person.id}.firstName`} label={`Person ${index + 1} first name`} value={person.firstName} onChange={answer => changePerson(index, { firstName: text(answer) })} maxLength={80} />
          <Input path={`household.${person.id}.lastName`} label={`Person ${index + 1} last name`} value={person.lastName} onChange={answer => changePerson(index, { lastName: text(answer) })} maxLength={80} />
          <Input path={`household.${person.id}.middleInitial`} label={`Person ${index + 1} middle initial, if any`} value={person.middleInitial} onChange={answer => changePerson(index, { middleInitial: text(answer) })} maxLength={2} />
          <Input path={`household.${person.id}.relationship`} label={`Person ${index + 1} relationship to you`} value={person.relationship} onChange={answer => changePerson(index, { relationship: text(answer) })} maxLength={40} />
        </div>}
        <div className={styles.row}>
          <Input path={`household.${person.id ?? "self"}.dateOfBirth`} label={index === 0 ? "Your date of birth" : `Person ${index + 1} date of birth`} value={person.dateOfBirth} onChange={answer => changePerson(index, { dateOfBirth: text(answer) })} type="date" />
          <Select path={`household.${person.id ?? "self"}.sex`} label={index === 0 ? "Your sex, as requested on the form" : `Person ${index + 1} sex, as requested on the form`} value={person.sex} options={[["male", "Male"], ["female", "Female"]]} onChange={answer => changePerson(index, { sex: text(answer) as Person["sex"] })} />
        </div>
        <YesNo path={`household.${person.id ?? "self"}.student`} label={index === 0 ? "Are you a student?" : `Is person ${index + 1} a student?`} value={person.student} onChange={answer => changePerson(index, { student: answer })} />
        <YesNo path={`household.${person.id ?? "self"}.requestingSnap`} label={index === 0 ? "Are you applying for SNAP?" : `Is person ${index + 1} applying for SNAP?`} value={person.requestingSnap} onChange={answer => changePerson(index, { requestingSnap: answer })} />
        {person.requestingSnap && <YesNo path={`household.${person.id}.citizen`} label={index === 0 ? "Are you a U.S. citizen?" : `Is person ${index + 1} a U.S. citizen?`} value={person.citizen} onChange={answer => changePerson(index, { citizen: answer })} />}
        {person.requestingSnap && person.citizen === false && <p className={styles.hint}>The official program requires noncitizen applicant documentation. Do not enter document numbers here.</p>}
        {index > 0 && !questions && <button type="button" className={styles.quiet} onClick={() => {
          const household = people.filter((_, row) => row !== index);
          focusAfterCommit.current = "snap-add-person";
          update({ ...value, household, householdSize: household.length, income: value.income && { ...value.income, entries: value.income.entries?.map(entry => entry.personId === person.id ? { ...entry, personId: undefined } : entry) } });
        }}>Remove person {index + 1}</button>}
      </Group>)}
      {(!questions || questions.paths.includes("household")) && <button type="button" id="snap-add-person" className={styles.secondary} disabled={people.length >= 30} onClick={() => {
        const person = { id: crypto.randomUUID() };
        const household = [...(people.length ? people : [selfRow()]), person];
        focusAfterCommit.current = `snap-household.${person.id}.firstName`;
        update({ ...value, household, householdSize: household.length });
      }}>Add another person</button>}
    </Group>
    <Group title="Income received or expected this month" paths={["income"]}>
      <p className={styles.hint}>List each person’s actual or expected payment for the calendar month. Do not combine different people or sources into a guessed household amount.</p>
      {questions && value.income && value.income.month !== currentMonth() ? <>
        <p className={styles.hint}>Your saved income answers are for {value.income.month ?? "an unrecorded month"}. They stay in history. Enter this month’s actual and expected income separately.</p>
        <button type="button" className={styles.secondary} onClick={() => { focusAfterCommit.current = "snap-income.hasIncome";update({ ...value, income: { month: currentMonth() } }); }}>Enter this month’s income</button>
      </> : <>
      <YesNo path="income.hasIncome" label="Does anyone have income received or expected this month?" value={value.income?.hasIncome} onChange={answer => changeIncome({ hasIncome: answer, ...(answer === false ? { entries: undefined } : {}) })} />
      {value.income && <p className={styles.hint}>Recorded income month: {value.income.month ?? "Not recorded"}. Changing this period does not change payment dates or turn expected income into received income.</p>}
      {value.income && value.income.month !== currentMonth() && <button type="button" className={styles.secondary} id="snap-income.month" data-snap-path="income.month" onClick={() => { focusAfterCommit.current = "snap-income.hasIncome";update({ ...value, income: { month: currentMonth() } }); }}>Enter this month’s income</button>}
      {(value.income?.hasIncome === true || !!value.income?.entries?.length) && <>
        {value.income?.entries?.map((entry, index) => <Group key={entry.id} title={`Income payment ${index + 1}${questions && entry.source ? `: ${entry.source}` : ""}`} paths={[`income.entries.${entry.id}`]}>
          <Select path={`income.entries.${entry.id}.personId`} label={`Person receiving payment ${index + 1}`} value={entry.personId} options={people.map((person, i) => [person.id, personName(person) || (i === 0 ? "You" : `Person ${i + 1}`)])} onChange={answer => changeEntry(index, { personId: text(answer) })} />
          <Input path={`income.entries.${entry.id}.source`} label={`Payment ${index + 1} type or source`} value={entry.source} onChange={answer => changeEntry(index, { source: text(answer) })} maxLength={100} />
          <div className={styles.row}>
            <Input path={`income.entries.${entry.id}.amount`} label={`Payment ${index + 1} amount before taxes ($)`} value={entry.amount} onChange={answer => changeEntry(index, { amount: number(answer) })} type="number" />
            <Input path={`income.entries.${entry.id}.frequency`} label={`How often payment ${index + 1} is received`} value={entry.frequency} onChange={answer => changeEntry(index, { frequency: text(answer) })} maxLength={60} />
          </div>
          <Select path={`income.entries.${entry.id}.status`} label={`Payment ${index + 1} received or expected?`} value={entry.status} options={[["received", "Already received"], ["expected", "Expected, not yet received"]]} onChange={answer => changeEntry(index, { status: text(answer) as "received" | "expected" | undefined })} />
          <Input path={`income.entries.${entry.id}.date`} label={`Payment ${index + 1} actual or expected date`} value={entry.date} onChange={answer => changeEntry(index, { date: text(answer) })} type="date" />
          {!questions && <button type="button" className={styles.quiet} onClick={() => {
            const entries = value.income?.entries?.filter((_, row) => row !== index);
            focusAfterCommit.current = value.income?.hasIncome === true || entries?.length ? "snap-add-income" : "snap-income.hasIncome";
            changeIncome({ entries });
          }}>Remove payment {index + 1}</button>}
        </Group>)}
        {(!questions || questions.paths.some(path => path === "income" || path === "income.entries")) && <button type="button" id="snap-add-income" className={styles.secondary} disabled={(value.income?.entries?.length ?? 0) >= 100} onClick={() => {
          const entry = { id: crypto.randomUUID() };
          focusAfterCommit.current = `snap-income.entries.${entry.id}.personId`;
          changeIncome({ entries: [...(value.income?.entries ?? []), entry] });
        }}>Add an income payment</button>}
      </>}
      </>}
    </Group>
    <Group title="Expedited SNAP questions" paths={["screening"]}>
      <p className={styles.hint}>These are the questions on the reviewed application. They do not establish eligibility or promise a processing date.</p>
      {(Object.keys(screening) as (keyof typeof screening)[]).map(field => <YesNo key={field} path={`screening.${field}`} label={screening[field]} value={value.screening?.[field]} onChange={answer => update({ ...value, screening: { ...value.screening, [field]: answer } })} />)}
    </Group>
    <Group title="Application history questions" paths={["history"]}>
      {(Object.keys(histories) as (keyof typeof histories)[]).map(field => {
        const answer = value.history?.[field], path = `history.${field}`;
        return <Group key={field} paths={[path]} title={field === "fleeingOrProbation" ? "Criminal history inquiry" : field === "welfareFraud" ? "Welfare fraud" : "SNAP disqualification in another state"}>
          <YesNo path={`${path}.answer`} label={histories[field]} value={answer?.answer} onChange={choice => update({ ...value, history: { ...value.history, [field]: choice === false ? { answer: choice } : { ...answer, answer: choice } } })} />
          {answer?.answer && <>
            <Input path={`${path}.names`} label={field === "fleeingOrProbation" ? "Names for the criminal history answer" : field === "welfareFraud" ? "Names for the welfare fraud answer" : "Names for the other-state disqualification answer"} value={answer.names} onChange={names => update({ ...value, history: { ...value.history, [field]: { ...answer, names: text(names) } } })} maxLength={200} />
            {field !== "otherStateDisqualification" && <div className={styles.row}>
              <Input path={`${path}.date`} label={field === "fleeingOrProbation" ? "Date for the criminal history answer" : "Date for the welfare fraud answer"} value={"date" in answer ? answer.date : undefined} onChange={date => update({ ...value, history: { ...value.history, [field]: { ...answer, date: text(date) } } })} type="date" />
              <Input path={`${path}.state`} label={field === "fleeingOrProbation" ? "State for the criminal history answer" : "State for the welfare fraud answer"} value={"state" in answer ? answer.state : undefined} onChange={state => update({ ...value, history: { ...value.history, [field]: { ...answer, state: text(state) } } })} maxLength={40} />
            </div>}
          </>}
        </Group>;
      })}
    </Group>
    <Group title="Household expenses and deductions" paths={["expenses", "expenseClaims"]}>
      <p className={styles.hint}>Reported expenses may help calculate a deduction. Do not skip a useful deduction by accident; the agency may request proof.</p>
      <Select path="expenseClaims.household" label="Would you like to report household expenses for deductions?" value={value.expenseClaims?.household} options={[["claim", "Yes, report applicable expenses"], ["do_not_claim", "I choose not to seek these household deductions"]]} onChange={answer => update({ ...value, expenseClaims: { ...value.expenseClaims, household: text(answer) as "claim" | "do_not_claim" | undefined, ...(answer === "do_not_claim" ? { housing: undefined } : {}) }, ...(answer === "do_not_claim" ? { expenses: { medical: value.expenses?.medical, otherMedical: value.expenses?.otherMedical } } : {}) })} />
      {value.expenseClaims?.household === "claim" && <>
        {(Object.keys(expenseQuestions) as (keyof typeof expenseQuestions)[]).map(field => <Fragment key={field}>
          <YesNo path={`expenses.${field}`} label={expenseQuestions[field]} value={value.expenses?.[field]} onChange={answer => changeExpense(field, answer)} />
          {field === "childSupport" && value.expenses?.childSupport && <YesNo path="expenses.courtOrdered" label="Is the child support court ordered?" value={value.expenses.courtOrdered} onChange={answer => changeExpense("courtOrdered", answer)} />}
          {field === "housingAssistance" && value.expenses?.housingAssistance && <>
            <Input path="expenses.housingAssistanceKind" label="What kind of housing assistance?" value={value.expenses.housingAssistanceKind} onChange={answer => changeExpense("housingAssistanceKind", text(answer))} maxLength={160} />
            <YesNo path="expenses.utilityAllowance" label="Do you get a utility allowance?" value={value.expenses.utilityAllowance} onChange={answer => changeExpense("utilityAllowance", answer)} />
          </>}
          {field === "outsidePayer" && value.expenses?.outsidePayer && <>
            <Input path="expenses.outsideExpenses" label="Which expenses does someone outside the household pay?" value={value.expenses.outsideExpenses} onChange={answer => changeExpense("outsideExpenses", text(answer))} maxLength={160} />
            <Input path="expenses.outsideAmount" label="Amount paid toward those expenses ($)" value={value.expenses.outsideAmount} onChange={answer => changeExpense("outsideAmount", number(answer))} type="number" />
            <Input path="expenses.outsideFrequency" label="How often are those expenses paid?" value={value.expenses.outsideFrequency} onChange={answer => changeExpense("outsideFrequency", text(answer))} maxLength={60} />
            <Input path="expenses.outsidePayee" label="To whom are those expenses paid?" value={value.expenses.outsidePayee} onChange={answer => changeExpense("outsidePayee", text(answer))} maxLength={160} />
          </>}
          {field === "care" && value.expenses?.care && <>
            <Input path="expenses.careMonthlyAmount" label="Childcare or adult care amount per month ($)" value={value.expenses.careMonthlyAmount} onChange={answer => changeExpense("careMonthlyAmount", number(answer))} type="number" />
            <Input path="expenses.careRecipient" label="Who receives care?" value={value.expenses.careRecipient} onChange={answer => changeExpense("careRecipient", text(answer))} maxLength={160} />
          </>}
        </Fragment>)}
        <Group title="Utilities paid each month, even partly" paths={["expenses.utilities", "expenses.otherUtility"]}>
          <Question path="expenses.utilities" label="Utilities paid each month, even partly">
          {(Object.keys(utilities) as (keyof typeof utilities)[]).map(key => <label className={styles.checkbox} key={key}><input type="checkbox" checked={value.expenses?.utilities?.includes(key) ?? false} onChange={() => toggleUtility(key)} />{utilities[key]}</label>)}
          <label className={styles.checkbox}><input type="checkbox" checked={value.expenses?.utilities?.length === 0} onChange={event => update({ ...value, expenses: { ...value.expenses, utilities: event.target.checked ? [] : undefined, otherUtility: undefined } })} />None of these utilities</label>
          </Question>
          {value.expenses?.utilities?.includes("other") && <Input path="expenses.otherUtility" label="Other utility expense" value={value.expenses.otherUtility} onChange={answer => changeExpense("otherUtility", text(answer))} maxLength={160} />}
        </Group>
        <Group title="Monthly housing costs you pay" paths={["expenseClaims.housing", ...Object.keys(housing).map(key => `expenses.${key}`)]}>
          <Question path="expenseClaims.housing" label="Monthly housing costs you pay">
          {(Object.keys(housing) as (keyof typeof housing)[]).map(key =>
            <label className={styles.checkbox} key={key}><input type="checkbox" checked={value.expenseClaims?.housing?.includes(key) ?? false} onChange={() => toggleHousing(key)} />{housing[key]}</label>
          )}
          <label className={styles.checkbox}><input type="checkbox" checked={value.expenseClaims?.housing?.length === 0} onChange={event => update({ ...value, expenseClaims: { ...value.expenseClaims, housing: event.target.checked ? [] : undefined }, expenses: { ...value.expenses, rent: undefined, condoFees: undefined, mortgage: undefined, propertyFees: undefined, homeownersInsurance: undefined } })} />None of these housing costs</label>
          </Question>
          {value.expenseClaims?.housing?.map(key => <Input key={key} path={`expenses.${key}`} label={`${housing[key]} per month ($)`} value={value.expenses?.[key]} onChange={answer => changeExpense(key, number(answer))} type="number" />)}
        </Group>
      </>}
      <Select path="expenseClaims.medical" label="Medical expense deduction" value={value.expenseClaims?.medical} options={[["claim", "Report medical expenses for a member who is 60 or older, or disabled"], ["not_applicable", "This does not apply to my household"], ["do_not_claim", "I choose not to seek a medical deduction"]]} onChange={answer => update({ ...value, expenseClaims: { ...value.expenseClaims, medical: text(answer) as "claim" | "not_applicable" | "do_not_claim" | undefined }, ...(["not_applicable", "do_not_claim"].includes(answer) ? { expenses: { ...value.expenses, medical: undefined, otherMedical: undefined } } : {}) })} />
      {value.expenseClaims?.medical === "claim" && <Group title="Medical expenses paid by your household" paths={["expenses.medical", "expenses.otherMedical"]}>
        <Question path="expenses.medical" label="Medical expenses paid by your household">
        {(Object.keys(medical) as (keyof typeof medical)[]).map(key => <label className={styles.checkbox} key={key}><input type="checkbox" checked={value.expenses?.medical?.includes(key) ?? false} onChange={() => toggleMedical(key)} />{medical[key]}</label>)}
        </Question>
        {value.expenses?.medical?.includes("other") && <Input path="expenses.otherMedical" label="Describe the other medical expense" value={value.expenses.otherMedical} onChange={answer => changeExpense("otherMedical", text(answer))} maxLength={160} />}
      </Group>}
    </Group>
    <Group title="Authorized representative, only if you choose one" paths={["authorizedRepresentative"]}>
      {!questions && <label className={styles.checkbox}><input type="checkbox" checked={!!value.authorizedRepresentative} onChange={event => update({ ...value, authorizedRepresentative: event.target.checked ? {} : undefined })} />I want to provide details of a real authorized representative</label>}
      <p className={styles.hint}>These contact details do not appoint a representative. Any genuine designation and required signature remain separate.</p>
      {value.authorizedRepresentative && <>
        <Input path="authorizedRepresentative.name" label="Representative name" value={value.authorizedRepresentative.name} onChange={answer => update({ ...value, authorizedRepresentative: { ...value.authorizedRepresentative, name: text(answer) } })} maxLength={160} />
        {([['street','Representative street address'],['city','Representative city'],['state','Representative state'],['zip','Representative ZIP code']] as const).map(([field,label]) => <Input key={field} path={`authorizedRepresentative.address.${field}`} label={label} value={value.authorizedRepresentative?.address?.[field]} onChange={answer => update({ ...value, authorizedRepresentative: { ...value.authorizedRepresentative, address: { ...value.authorizedRepresentative?.address, [field]: text(field === "state" ? answer.toUpperCase() : answer) } } })} maxLength={field === "street" ? 180 : field === "city" ? 80 : field === "state" ? 2 : 5} />)}
        <Input path="authorizedRepresentative.phone" label="Representative phone" value={value.authorizedRepresentative.phone} onChange={answer => update({ ...value, authorizedRepresentative: { ...value.authorizedRepresentative, phone: text(answer) } })} type="tel" maxLength={30} />
      </>}
    </Group>
  </fieldset></QuestionContext.Provider>;
}

function readable(value: string | number | boolean | undefined) {
  return value === undefined || value === "" ? "Not provided" : typeof value === "boolean" ? value ? "Yes" : "No" : String(value);
}
function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return <dl className={styles.factList}>{rows.map(([label, value], index) => <Fragment key={`${label}-${index}`}><dt>{label}</dt><dd>{value}</dd></Fragment>)}</dl>;
}
export function SnapApplicationSummary({ value, onChangeAddress }: { value: SnapApplicationFields; onChangeAddress?: () => void }) {
  const people = value.household ?? [], expenses = value.expenses;
  return <div className={styles.form}>
    <section aria-label="Applicant and contact summary"><h3>Applicant and contact</h3><Facts rows={[
      ["Applicant", personName(applicantName(value)) || "Not provided"],
      ["Address", <Fragment key="address"><div>{[value.address?.street, value.address?.city, value.address?.state, value.zip].filter(Boolean).join(", ") || "Not provided"}</div>{onChangeAddress && <button type="button" className={styles.quiet} onClick={onChangeAddress}>Change address</button>}</Fragment>],
      ["County", readable(value.county)], ["Home phone", value.phone ?? "Not supplied (optional)"], ["Other phone", value.otherPhone ?? "Not supplied (optional)"],
      ["Best time to call", value.bestTimeToCall ?? "No preference supplied"],
      ["Preferred application language", value.language === "en" ? "English" : value.language === "es" ? "Spanish" : value.language === "other" ? value.otherLanguage ?? "Other language not provided" : "Not provided"],
      ["Interpreter needed", readable(value.interpreter)], ...(value.interpreter ? [["Interpreter language", readable(value.interpreterLanguage)] as [string, ReactNode]] : []),
    ]} /></section>
    <section aria-label="Household summary"><h3>Everyone in your home</h3><p>{people.length ? `${people.length} ${people.length === 1 ? "person" : "people"} listed` : "No household members listed"}</p>
      {people.map((person,index) => <div key={person.id}><h4>{index === 0 ? "You" : `Person ${index + 1}: ${personName(person) || "Name not provided"}`}</h4><Facts rows={[
        ["Date of birth", person.dateOfBirth ? displayDate(person.dateOfBirth) : "Not provided"], ["Sex on the form", person.sex === "male" ? "Male" : person.sex === "female" ? "Female" : "Not provided"],
        ["Student", readable(person.student)], ["Relationship", index === 0 ? "Self" : readable(person.relationship)], ["Applying for SNAP", readable(person.requestingSnap)],
        ...(person.requestingSnap ? [["U.S. citizen", readable(person.citizen)] as [string, ReactNode]] : []),
      ]} /></div>)}
    </section>
    <section aria-label="Income summary"><h3>Income and recorded month</h3><Facts rows={[["Calendar month", readable(value.income?.month)], ["Income received or expected", readable(value.income?.hasIncome)]]} />
      {!value.income?.entries?.length && <p>{value.income?.hasIncome === false ? "No income reported for this month." : "No income payments listed."}</p>}
      {value.income?.entries?.map((entry,index) => <div key={entry.id}><h4>Income payment {index + 1}</h4><Facts rows={[
        ["Person", personName(people.find(person => person.id === entry.personId)) || "Not provided"], ["Type or source", readable(entry.source)],
        ["Amount before taxes", entry.amount === undefined ? "Not provided" : `$${entry.amount}`], ["How often", readable(entry.frequency)],
        ["Received or expected", entry.status === "received" ? "Already received" : entry.status === "expected" ? "Expected, not yet received" : "Not provided"],
        [entry.status === "expected" ? "Expected date" : entry.status === "received" ? "Actual received date" : "Payment date (status not provided)", entry.date ? displayDate(entry.date) : "Not provided"],
      ]} /></div>)}
    </section>
    <section aria-label="Expedited answers summary"><h3>Expedited questions</h3><Facts rows={(Object.keys(screening) as (keyof typeof screening)[]).map(field => [screening[field], readable(value.screening?.[field])])} /></section>
    <section aria-label="Application history summary"><h3>Application history</h3><Facts rows={(Object.keys(histories) as (keyof typeof histories)[]).map(field => {
      const answer = value.history?.[field];
      return [histories[field], <Fragment key={field}>{readable(answer?.answer)}{answer?.answer && <div>Names: {readable(answer.names)}{field !== "otherStateDisqualification" && <div>Date: {("date" in answer && answer.date) ? displayDate(answer.date) : "Not provided"} · State: {("state" in answer && answer.state) ? answer.state : "Not provided"}</div>}</div>}</Fragment>];
    })} /></section>
    <section aria-label="Expense summary"><h3>Expenses and deductions</h3><Facts rows={[
      ["Household deductions", value.expenseClaims?.household === "claim" ? "Report applicable expenses" : value.expenseClaims?.household === "do_not_claim" ? "You chose not to seek these deductions" : "No choice supplied"],
      ["Medical deduction", value.expenseClaims?.medical === "claim" ? "Report applicable medical expenses" : value.expenseClaims?.medical === "not_applicable" ? "Does not apply to the household" : value.expenseClaims?.medical === "do_not_claim" ? "You chose not to seek this deduction" : "No choice supplied"],
    ]} />
      {value.expenseClaims?.household === "claim" && <Facts rows={[
        ...(Object.keys(expenseQuestions) as (keyof typeof expenseQuestions)[]).map(field => [expenseQuestions[field], readable(expenses?.[field])] as [string, ReactNode]),
        ...(expenses?.childSupport ? [["Court ordered", readable(expenses.courtOrdered)] as [string, ReactNode]] : []),
        ...(expenses?.housingAssistance ? [["Kind of housing assistance", readable(expenses.housingAssistanceKind)], ["Utility allowance", readable(expenses.utilityAllowance)]] as [string, ReactNode][] : []),
        ...(expenses?.outsidePayer ? [["Expenses paid by someone outside the household", readable(expenses.outsideExpenses)], ["Amount", expenses.outsideAmount === undefined ? "Not provided" : `$${expenses.outsideAmount}`], ["How often", readable(expenses.outsideFrequency)], ["To whom", readable(expenses.outsidePayee)]] as [string, ReactNode][] : []),
        ...(expenses?.care ? [["Monthly care amount", expenses.careMonthlyAmount === undefined ? "Not provided" : `$${expenses.careMonthlyAmount}`], ["Care recipient", readable(expenses.careRecipient)]] as [string, ReactNode][] : []),
        ["Utilities", expenses?.utilities === undefined ? "Not provided" : expenses.utilities.map(key => utilities[key]).join(", ") || "None of the listed utilities"],
        ...(expenses?.utilities?.includes("other") ? [["Other utility expense", readable(expenses.otherUtility)] as [string, ReactNode]] : []),
        ["Housing costs", value.expenseClaims.housing === undefined ? "Not provided" : value.expenseClaims.housing.map(key => `${housing[key]}: ${expenses?.[key] === undefined ? "amount not provided" : `$${expenses[key]}`} per month`).join("; ") || "None of the listed housing costs"],
      ]} />}
      {value.expenseClaims?.medical === "claim" && <Facts rows={[["Medical expenses", expenses?.medical?.map(key => medical[key]).join(", ") || "Not provided"], ...(expenses?.medical?.includes("other") ? [["Other medical expense", readable(expenses.otherMedical)] as [string, ReactNode]] : [])]} />}
    </section>
    {value.authorizedRepresentative && <section aria-label="Representative summary"><h3>Representative contact details</h3><p className={styles.hint}>Contact details do not establish a signed designation.</p><Facts rows={[
      ["Name", readable(value.authorizedRepresentative.name)], ["Address", [value.authorizedRepresentative.address?.street, value.authorizedRepresentative.address?.city, value.authorizedRepresentative.address?.state, value.authorizedRepresentative.address?.zip].filter(Boolean).join(", ") || "Not provided"], ["Phone", readable(value.authorizedRepresentative.phone)],
    ]} /></section>}
  </div>;
}
