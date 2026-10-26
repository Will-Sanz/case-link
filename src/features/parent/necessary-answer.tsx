"use client";
import { useState, type FormEvent } from "react";
import type { NecessaryAction, SupportRequest } from "@/lib/parent/domain";
import { ANSWER_FIELDS, factAnswerSchema } from "@/lib/parent/answers";
import { parentApi, ParentApiError } from "./api";
import styles from "./parent.module.css";

function currentAnswer(
  request: SupportRequest,
  action: NecessaryAction,
): string {
  if (
    ["income", "incomeAmount", "incomeFrequency"].includes(action.field ?? "")
  )
    return request.intake.incomeAmount === null
      ? ""
      : String(request.intake.incomeAmount);
  const fact = request.facts?.find(
    (item) => item.need === action.need && item.field === action.field,
  );
  if (typeof fact?.value === "string" || typeof fact?.value === "number")
    return String(fact.value);
  if (action.field === "zip") return request.intake.zip;
  if (action.field === "householdSize")
    return request.intake.householdSize === null
      ? ""
      : String(request.intake.householdSize);
  if (
    action.field === "accountAuthority" &&
    request.intake.accountAuthority !== "not_sure"
  )
    return request.intake.accountAuthority;
  if (
    action.field === "shutoffDate" &&
    request.intake.needs.filter((need) =>
      ["electricity", "gas", "water"].includes(need),
    ).length === 1
  )
    return request.intake.shutoffDate ?? "";
  return "";
}

export function NecessaryAnswer({
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
  const [value, setValue] = useState(() => currentAnswer(request, action));
  const [frequency, setFrequency] = useState(
    request.intake.incomeFrequency === "unknown"
      ? ""
      : request.intake.incomeFrequency,
  );
  const [baseVersion, setBaseVersion] = useState(request.version);
  const [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
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
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!value.trim()) {
      setError("Enter an answer. Zero is a valid amount.");
      return;
    }
    const answer = {
      need: action.need,
      field: income ? "income" : field,
      value: income
        ? { amount: Number(value), frequency }
        : numeric
          ? Number(value)
          : value,
      version: baseVersion,
    };
    if (!booking) {
      const parsed = factAnswerSchema.safeParse(answer);
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? "Check your answer.");
        return;
      }
    }
    setPending(true);
    try {
      const saved = await parentApi<{ request: SupportRequest }>(
        `/requests/${request.id}`,
        {
          method: "POST",
          body: JSON.stringify(
            booking
              ? {
                  action: "booking_preference",
                  preference: value,
                  version: baseVersion,
                }
              : { action: "answer_fact", ...answer },
          ),
        },
      );
      if (correction) setBaseVersion(saved.request.version);
      setMessage(
        request.status === "paused"
          ? "Your answer is saved. This request remains paused."
          : "Your answer is saved. Permitted work can continue.",
      );
      onChange();
    } catch (err) {
      setConflict(err instanceof ParentApiError && err.status === 409);
      setError(
        err instanceof Error
          ? err.message
          : "Your answer could not be saved. Try again.",
      );
    } finally {
      setPending(false);
    }
  }
  async function reviewLatest() {
    setPending(true);
    try {
      const latest = await parentApi<{ request: SupportRequest }>(
        `/requests/${request.id}`,
      );
      setBaseVersion(latest.request.version);
      setValue(currentAnswer(latest.request, action));
      setFrequency(
        latest.request.intake.incomeFrequency === "unknown"
          ? ""
          : latest.request.intake.incomeFrequency,
      );
      setError("");
      setConflict(false);
      setMessage(
        "The latest saved information is loaded. Review this question before answering again.",
      );
      onChange();
      document.getElementById(`answer-${action.id}`)?.focus();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "We couldn’t load the latest information. Try again.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.field}>
        <label htmlFor={`answer-${action.id}`}>
          {correction
            ? action.title
            : booking
              ? "Preferred appointment window"
              : income
                ? "Household income before taxes ($)"
                : field === "accountAuthority"
                  ? "How are you connected to the account?"
                  : "Your answer"}
        </label>
        {options ? (
          <select
            id={`answer-${action.id}`}
            className={styles.select}
            value={value}
            required
            onChange={(event) => setValue(event.target.value)}
          >
            <option value="">Choose your answer</option>
            {options.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
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
            required
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        )}
        {income && (
          <>
            <label htmlFor={`frequency-${action.id}`}>
              How often is this income received?
            </label>
            <select
              id={`frequency-${action.id}`}
              className={styles.select}
              value={frequency}
              onChange={(event) =>
                setFrequency(event.target.value as typeof frequency)
              }
              required
            >
              <option value="">Choose frequency</option>
              {[
                ["weekly", "Weekly"],
                ["biweekly", "Every two weeks"],
                ["twice_monthly", "Twice a month"],
                ["monthly", "Monthly"],
                ["yearly", "Yearly"],
              ].map(([key, label]) => (
                <option value={key} key={key}>
                  {label}
                </option>
              ))}
            </select>
          </>
        )}
        <p className={styles.hint}>
          {booking
            ? "This permits a routine booking in this window. A binding payment or other meaningful commitment still needs your choice."
            : "Enter a current fact you know. This does not sign a form or certify an agency declaration."}
        </p>
      </div>
      <button
        className={styles.button}
        disabled={pending || (!correction && request.status === "paused")}
      >
        {pending
          ? "Saving…"
          : correction
            ? "Save account answer"
            : "Save and continue"}
      </button>
      {message && (
        <p role="status" className={styles.success}>
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {conflict && (
        <button
          className={styles.secondary}
          type="button"
          disabled={pending}
          onClick={reviewLatest}
        >
          {pending ? "Loading latest information…" : "Review latest question"}
        </button>
      )}
    </form>
  );
}
