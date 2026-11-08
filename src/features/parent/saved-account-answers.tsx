"use client";
import { Fragment, useState } from "react";
import {
  NEED_LABELS,
  type SupportNeed,
  type SupportRequest,
} from "@/lib/parent/domain";
import { NecessaryAnswer } from "./necessary-answer";
import { displayDate } from "./api";
import styles from "./parent.module.css";

const fields = {
  utilityProvider: "Utility provider",
  accountAuthority: "Your authority for this account",
  amountDue: "Amount due ($)",
  totalBalance: "Total account balance ($)",
  dueDate: "Payment due date",
  shutoffDate: "Shutoff date on notice",
};
const valueLabels: Record<string, string> = {
  peco: "PECO",
  pgw: "Philadelphia Gas Works",
  pwd: "Philadelphia Water Department",
  other: "Another provider",
  self: "You hold the account",
  authorized_caregiver: "You have permission to act for the account holder",
};
function readableAnswer(field: string, value: unknown): string {
  if (
    (field === "amountDue" || field === "totalBalance") &&
    typeof value === "number" &&
    Number.isFinite(value)
  )
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value);
  if (typeof value !== "string") return "Not provided";
  if (field === "dueDate" || field === "shutoffDate") return displayDate(value);
  return Object.hasOwn(valueLabels, value) ? valueLabels[value] : value;
}

function AccountAnswers({
  request,
  need,
  onChange,
}: {
  request: SupportRequest;
  need: SupportNeed;
  onChange: () => void;
}) {
  const [field, setField] = useState<keyof typeof fields>("amountDue");
  const facts = (request.facts ?? []).filter(
    (fact) => fact.need === need && Object.hasOwn(fields, fact.field),
  );
  return (
    <section
      className={styles.section}
      aria-label={`${NEED_LABELS[need]} saved answers`}
    >
      <h3>{NEED_LABELS[need]} details</h3>
      {facts.length ? (
        <dl className={`${styles.factList} ${styles.space}`}>
          {facts.map((fact) => (
            <Fragment key={fact.field}>
              <dt>{fields[fact.field as keyof typeof fields]}</dt>
              <dd>
                {readableAnswer(fact.field, fact.value)}
                <small>You provided · {displayDate(fact.confirmedAt)}</small>
              </dd>
            </Fragment>
          ))}
        </dl>
      ) : (
        <p className={`${styles.hint} ${styles.space}`}>
          No separate account answers saved yet. You can provide or correct a
          current fact here.
        </p>
      )}
      <div className={`${styles.field} ${styles.space}`}>
        <label htmlFor={`saved-field-${need}`}>Account detail to update</label>
        <select
          id={`saved-field-${need}`}
          className={styles.select}
          value={field}
          onChange={(event) =>
            setField(event.target.value as keyof typeof fields)
          }
        >
          {Object.entries(fields).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        {field === "utilityProvider" && (
          <p className={styles.hint}>
            Changing provider clears previous account-specific answers for this
            utility. We’ll check the new provider before using a bill or taking
            another step.
          </p>
        )}
      </div>
      <NecessaryAnswer
        key={`${need}-${field}`}
        correction
        request={request}
        action={{
          id: `saved-${need}-${field}`,
          need,
          field,
          reason: "missing_fact",
          title: fields[field],
          explanation: "Correct a current account fact.",
        }}
        onChange={onChange}
      />
    </section>
  );
}

export function SavedAccountAnswers({
  request,
  onChange,
}: {
  request: SupportRequest;
  onChange: () => void;
}) {
  const utilities = request.intake.needs.filter((need) =>
    ["electricity", "gas", "water"].includes(need),
  );
  if (!utilities.length) return null;
  return (
    <details className={styles.disclosure}>
      <summary>Review or correct account answers</summary>
      <p className={`${styles.hint} ${styles.space}`}>
        These are facts you supplied for each utility. Corrections stop queued
        uses of superseded facts. Already submitted history stays intact; a
        paused request stays paused.
      </p>
      {utilities.map((need) => (
        <AccountAnswers
          key={need}
          need={need}
          request={request}
          onChange={onChange}
        />
      ))}
    </details>
  );
}
