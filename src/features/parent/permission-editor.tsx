"use client";
import { useState, useImperativeHandle, type FormEvent, type Ref } from "react";
import type { ServiceMandate, SupportRequest } from "@/lib/parent/domain";
import { getProgramsForNeeds } from "@/lib/parent/programs";
import { parentApi } from "./api";
import styles from "./parent.module.css";

export type PermissionEditorHandle = { open: () => void };
function focusFirstField(form: HTMLFormElement | null) {
  form?.querySelector<HTMLInputElement>("input")?.focus();
}
export function PermissionEditor({
  request,
  onChange,
  ref,
}: {
  request: SupportRequest;
  onChange: () => void;
  ref?: Ref<PermissionEditorHandle>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(request.mandate);
  const [version, setVersion] = useState(request.version);
  const [accepted, setAccepted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  function open() {
    setDraft(request.mandate);
    setVersion(request.version);
    setAccepted(false);
    setError("");
    setMessage("");
    setEditing(true);
  }
  useImperativeHandle(ref, () => ({ open }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!accepted) return;
    setPending(true);
    setError("");
    try {
      await parentApi(`/requests/${request.id}`, {
        method: "POST",
        body: JSON.stringify({
          action: "replace_mandate",
          version,
          mandate: {
            ...draft,
            expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
            maxRecipients: draft.recipientIds.length,
          },
        }),
      });
      setEditing(false);
      setMessage(
        "Your updated permission is saved. Future work uses these limits.",
      );
      onChange();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Your permission could not be saved. Try again.",
      );
    } finally {
      setPending(false);
    }
  }
  const toggleRecipient = (id: string) => {
    setDraft((value) => ({
      ...value,
      recipientIds: value.recipientIds.includes(id)
        ? value.recipientIds.filter((item) => item !== id)
        : [...value.recipientIds, id],
    }));
    setAccepted(false);
  };
  const toggleData = (id: ServiceMandate["allowedData"][number]) => {
    setDraft((value) => ({
      ...value,
      allowedData: value.allowedData.includes(id)
        ? value.allowedData.filter((item) => item !== id)
        : [...value.allowedData, id],
    }));
    setAccepted(false);
  };
  const changeMode = (mode: ServiceMandate["mode"]) => {
    setDraft((value) => ({
      ...value,
      mode,
      allowedActions:
        mode === "prepare_only"
          ? ["research", "prepare"]
          : ["research", "prepare", "share", "submit", "schedule", "follow_up"],
    }));
    setAccepted(false);
  };
  return (
    <div className={`${styles.space} ${styles.hidePrint}`}>
      {!editing ? (
        <button className={styles.secondary} onClick={open}>
          Change or renew permission
        </button>
      ) : (
        <form className={styles.form} onSubmit={submit} ref={focusFirstField}>
          <h3>Permission for the next 30 days</h3>
          <p className={styles.small}>
            Choose exactly who can receive information and what CaseLink can
            use. Removing permission stops new uses; information already
            delivered may remain with its recipient.
          </p>
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Named programs</legend>
            <div className={styles.choices}>
              {getProgramsForNeeds(request.intake.needs).map((program) => (
                <label className={styles.choice} key={program.id}>
                  <input
                    type="checkbox"
                    checked={draft.recipientIds.includes(program.id)}
                    onChange={() => toggleRecipient(program.id)}
                  />
                  <span>{program.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>
              Information CaseLink may use
            </legend>
            <div className={styles.choices}>
              {[
                ["household", "Household and routing details"],
                ["income", "Income details"],
                ["utility", "Utility account facts"],
                ["documents", "Consented documents and extracted facts"],
              ].map(([id, label]) => (
                <label className={styles.choice} key={id}>
                  <input
                    type="checkbox"
                    checked={draft.allowedData.includes(
                      id as ServiceMandate["allowedData"][number],
                    )}
                    onChange={() =>
                      toggleData(id as ServiceMandate["allowedData"][number])
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>
              Actions within these limits
            </legend>
            <div className={styles.choices}>
              <label className={styles.choice}>
                <input
                  name="permission-mode"
                  type="radio"
                  checked={draft.mode === "full"}
                  onChange={() => changeMode("full")}
                />
                <span>
                  <strong>Prepare and carry out permitted steps</strong>
                  <small>
                    Share allowed information, submit supported applications,
                    coordinate appointments and follow up. Required personal
                    acts remain yours.
                  </small>
                </span>
              </label>
              <label className={styles.choice}>
                <input
                  name="permission-mode"
                  type="radio"
                  checked={draft.mode === "prepare_only"}
                  onChange={() => changeMode("prepare_only")}
                />
                <span>
                  <strong>Prepare only</strong>
                  <small>
                    Research and prepare without sharing information or
                    submitting anything.
                  </small>
                </span>
              </label>
            </div>
          </fieldset>
          <p className={styles.hint}>
            Up to {draft.maxAttempts} attempts among these named programs.
            External actions require a verified permitted connection.
            Signatures, identity checks, agency declarations and binding
            financial commitments still need the appropriate personal step.
          </p>
          <label className={styles.choice}>
            <input
              type="checkbox"
              checked={accepted}
              onChange={(event) => setAccepted(event.target.checked)}
              required
            />
            <span>
              I authorize these programs, actions and information for 30 days. I
              can pause or withdraw future work.
            </span>
          </label>
          <button
            className={styles.button}
            disabled={
              pending ||
              !accepted ||
              !draft.recipientIds.length ||
              !draft.allowedData.length
            }
          >
            {pending ? "Saving…" : "Save updated permission"}
          </button>
          <button
            className={styles.quiet}
            type="button"
            disabled={pending}
            onClick={() => setEditing(false)}
          >
            Keep existing permission
          </button>
        </form>
      )}
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
    </div>
  );
}
