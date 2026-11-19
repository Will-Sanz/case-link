"use client";
import { useState, useRef, useLayoutEffect, type FormEvent } from "react";
import type { NecessaryAction, SupportRequest } from "@/lib/parent/domain";
import { ANSWER_FIELDS, factAnswerSchema } from "@/lib/parent/answers";
import { currentIntakeFields } from "@/lib/parent/current-intake-fields";
import { useSupportUpdate } from "./use-support-update";
import { SupportUpdateRecovery } from "./support-update-recovery";
import { useParentLocale } from "./parent-locale";
import styles from "./parent.module.css";

export type AnswerDraft = { value: string; frequency: string };

export function currentAnswer(
  request: SupportRequest,
  action: NecessaryAction,
  now = new Date(),
): AnswerDraft {
  const current = currentIntakeFields(request, now, action.need);
  let value = "";
  if (
    ["income", "incomeAmount", "incomeFrequency"].includes(action.field ?? "")
  ) {
    value = current.incomeAmount === undefined ? "" : String(current.incomeAmount);
  } else if (action.field === "zip") value = current.zip ?? "";
  else if (action.field === "householdSize")
    value = current.householdSize === undefined ? "" : String(current.householdSize);
  else {
    const fact = request.facts?.find(
      (item) => item.need === action.need && item.field === action.field,
    );
    if (typeof fact?.value === "string" || typeof fact?.value === "number")
      value = String(fact.value);
    else if (action.field === "accountAuthority" && request.intake.accountAuthority !== "not_sure")
      value = request.intake.accountAuthority;
    else if (action.field === "shutoffDate" && request.intake.needs.filter(
      (need) => ["electricity", "gas", "water"].includes(need),
    ).length === 1)
      value = request.intake.shutoffDate ?? "";
  }
  return { value, frequency: current.incomeFrequency ?? "" };
}

export function canonicalFactField(field?: string) {
  return field === "incomeAmount" || field === "incomeFrequency" ? "income" : field;
}

export function factualAnswer(action: NecessaryAction, draft: AnswerDraft) {
  const field = canonicalFactField(action.field);
  return {
    need: action.need,
    field,
    value: field === "income"
      ? { amount: Number(draft.value), frequency: draft.frequency }
      : ["householdSize", "amountDue", "totalBalance"].includes(field ?? "")
        ? Number(draft.value) : draft.value,
  };
}

export function factualAnswerError(field?: string): string {
  if (field === "zip") return "Enter a ZIP code with five digits.";
  if (field === "householdSize") return "Enter a whole number of people from 1 to 30.";
  if (["income", "incomeAmount", "incomeFrequency"].includes(field ?? "")) return "Enter an income amount from 0 to 1000000 and choose how often it is received.";
  if (field === "amountDue" || field === "totalBalance") return "Enter an amount from 0 to 1000000. Zero is a valid amount.";
  if (field === "dueDate" || field === "shutoffDate") return "Enter a real date.";
  return "Choose one of the listed options.";
}

export function NecessaryAnswerFields({
  action, draft, onChange, correction = false, disabled = false, required = true,
}: {
  action: NecessaryAction;
  draft: AnswerDraft;
  onChange: (draft: AnswerDraft) => void;
  correction?: boolean;
  disabled?: boolean;
  required?: boolean;
}) {
  const { t, locale } = useParentLocale();
  const { value, frequency } = draft;
  const field = action.field;
  const booking = field === "bookingPreference";
  if (
    !booking &&
    !ANSWER_FIELDS.includes(field as (typeof ANSWER_FIELDS)[number])
  )
    return null;
  const income =
    field === "income" ||
    field === "incomeAmount" ||
    field === "incomeFrequency";
  const numeric =
    income ||
    ["householdSize", "amountDue", "totalBalance"].includes(field ?? "");
  const date = field === "dueDate" || field === "shutoffDate";
  const options = booking
    ? [
        ["weekday_morning", "Weekday mornings"],
        ["weekday_afternoon", "Weekday afternoons"],
        ["any_weekday", "Any weekday"],
      ]
    : field === "accountAuthority"
      ? [
          ["self", "I’m the utility account holder"],
          [
            "authorized_caregiver",
            "I have permission to act for the utility account holder",
          ],
        ]
      : field === "utilityProvider"
        ? [
            ["peco", "PECO"],
            ["pgw", "Philadelphia Gas Works"],
            ["pwd", "Philadelphia Water Department"],
            ["other", "Another provider"],
          ]
        : null;
  const frequencies = [
    ["weekly", "Weekly"], ["biweekly", "Every two weeks"], ["twice_monthly", "Twice a month"],
    ["monthly", "Monthly"], ["yearly", "Yearly"],
  ];
  const selectedLabel = options?.find(([key]) => key === value)?.[1];
  const frequencyLabel = frequencies.find(([key]) => key === frequency)?.[1];
  return (
      <div lang={locale} className={styles.field}>
        <label lang={correction && t(action.title) === action.title ? "" : undefined} htmlFor={`answer-${action.id}`}>
          {t(correction
            ? action.title
            : booking
              ? "Preferred appointment window"
              : income
                ? "Household income before taxes ($)"
                : field === "accountAuthority"
                  ? "How are you connected to the account?"
                  : "Your answer")}
        </label>
        {options ? (
          <select
            id={`answer-${action.id}`}
            className={styles.select}
            value={value}
            required={required}
            aria-describedby={selectedLabel ? `choice-${action.id}` : undefined}
            disabled={disabled}
            onChange={(event) => onChange({ value: event.target.value, frequency })}
          >
            <option value="">{t("Choose your answer")}</option>
            {options.map(([key, label]) => (
              <option key={key} value={key} lang={t(label) === label ? "" : locale}>
                {t(label)}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={`answer-${action.id}`}
            className={styles.input}
            type={date ? "date" : numeric ? "number" : "text"}
            inputMode={
              numeric ? "decimal" : field === "zip" ? "numeric" : undefined
            }
            step={field === "householdSize" ? 1 : "0.01"}
            min={field === "householdSize" ? 1 : numeric ? 0 : undefined}
            max={field === "householdSize" ? 30 : numeric ? 1000000 : undefined}
            maxLength={field === "zip" ? 5 : 100}
            required={required}
            disabled={disabled}
            value={value}
            onChange={(event) => onChange({ value: event.target.value, frequency })}
          />
        )}
        {selectedLabel && <p className={styles.hint} id={`choice-${action.id}`} lang={t(selectedLabel) === selectedLabel ? "" : locale}>{t(selectedLabel)}</p>}
        {income && (
          <>
            <label htmlFor={`frequency-${action.id}`}>
              {t("How often is this income received?")}</label>
            <select
              id={`frequency-${action.id}`}
              className={styles.select}
              value={frequency}
              onChange={(event) => onChange({ value, frequency: event.target.value })}
              required={required}
              disabled={disabled}
              aria-describedby={frequencyLabel ? `frequency-choice-${action.id}` : undefined}
            >
              <option value="">{t("Choose frequency")}</option>
              {frequencies.map(([key, label]) => (
                <option value={key} key={key}>
                  {t(label)}
                </option>
              ))}
            </select>
            {frequencyLabel && <p className={styles.hint} id={`frequency-choice-${action.id}`}>{t(frequencyLabel)}</p>}
          </>
        )}
        <p className={styles.hint}>
          {t(booking
            ? "This permits a routine booking in this window. A binding payment or other meaningful commitment still needs your choice."
            : "Enter a current fact you know. This does not sign a form or certify an agency declaration.")}
        </p>
      </div>
  );
}

export function NecessaryAnswer(props: { action: NecessaryAction; request: SupportRequest; onChange: () => void; correction?: boolean }) {
  return <NecessaryAnswerContent key={`${props.request.id}:${props.action.id}`} {...props}/>;
}
function NecessaryAnswerContent({
  action,
  request,
  onChange,
  correction = false,
}: {
  action: NecessaryAction;
  request: SupportRequest;
  onChange: () => void;
  correction?: boolean;
}) {
  const { t, locale } = useParentLocale();
  const [{ value, frequency }, setAnswer] = useState(() => currentAnswer(request, action));
  const [baseVersion, setBaseVersion] = useState(request.version);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const recovery = useSupportUpdate(request.id, (saved, superseded) => {
    setBaseVersion(saved.version);
    setMessage(superseded ? "Your update was recorded. Newer changes are now in effect; check the current saved information."
      : saved.status === "paused" ? "Your answer is saved. This request remains paused." : "Your answer is saved. Permitted work can continue.");
    onChange();
  }, onChange);
  const pending = recovery.pending, focusNext = useRef(false);
  useLayoutEffect(() => {
    if (!focusNext.current || pending) return;
    focusNext.current = false;
    const input = document.getElementById(`answer-${action.id}`);
    (input && !input.matches(":disabled") ? input : document.getElementById("your-next-steps"))?.focus();
  }, [pending, baseVersion, action.id]);
  const field = action.field;
  const booking = field === "bookingPreference";
  if (!booking && !ANSWER_FIELDS.includes(field as (typeof ANSWER_FIELDS)[number])) return null;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (recovery.locked || !["active", "paused"].includes(request.status) || (!correction && request.status === "paused")) return;
    setError("");
    setMessage("");
    if (!value.trim()) {
      setError("Enter an answer. Zero is a valid amount.");
      return;
    }
    const answer = { ...factualAnswer(action, { value, frequency }), version: baseVersion };
    if (!booking) {
      const parsed = factAnswerSchema.safeParse(answer);
      if (!parsed.success) {
        setError(factualAnswerError(field));
        return;
      }
    }
    await recovery.save(() => booking
      ? { action: "booking_preference", preference: value as SupportRequest["mandate"]["bookingPreference"], version: baseVersion }
      : { action: "answer_fact", ...factAnswerSchema.parse(answer) });
  }
  async function reviewLatest() {
    await recovery.review(latest => {
      focusNext.current = true; setAnswer(currentAnswer(latest, action)); setBaseVersion(latest.version); setError("");
      setMessage("The latest saved information is loaded. Check your answer before saving."); onChange();
    });
  }
  if (recovery.accessLost) return <div lang={locale} className={styles.supportControls}><SupportUpdateRecovery recovery={recovery} onReview={reviewLatest}/></div>;
  return (
    <form lang={locale} className={`${styles.form} ${styles.supportControls}`} onSubmit={submit}>
      <NecessaryAnswerFields action={action} draft={{ value, frequency }} onChange={setAnswer}
        correction={correction} disabled={recovery.locked || !["active", "paused"].includes(request.status) || (!correction && request.status === "paused")} />
      <button
        className={styles.button}
        disabled={recovery.locked || !["active", "paused"].includes(request.status) || (!correction && request.status === "paused")}
      >
        {t(pending
          ? recovery.checking ? "Checking saved result…" : "Saving…"
          : correction
            ? "Save account answer"
            : "Save and continue")}
      </button>
      {message && (
        <p role="status" className={styles.success}>
          {t(message)}
        </p>
      )}
      {error && (
        <p lang={t(error) === error ? "" : locale} role="alert" className={styles.error}>
          {t(error)}
        </p>
      )}
      <SupportUpdateRecovery recovery={recovery} onReview={reviewLatest} reviewLabel="Review latest question"/>
    </form>
  );
}
