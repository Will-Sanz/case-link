"use client";
import { useState, useImperativeHandle, type FormEvent, type Ref } from "react";
import type { ServiceMandate, SupportRequest } from "@/lib/parent/domain";
import { getProgramsForNeeds } from "@/lib/parent/programs";
import { useSupportUpdate } from "./use-support-update";
import { SupportUpdateRecovery } from "./support-update-recovery";
import { useParentLocale } from "./parent-locale";
import styles from "./parent.module.css";

export const PERMISSION_DATA_LABELS = {
  household: "Household and routing details",
  income: "Income details",
  utility: "Utility account facts",
  documents: "Consented documents and extracted facts",
} satisfies Record<ServiceMandate["allowedData"][number], string>;

export type PermissionEditorHandle = { open: () => void };
function focusFirstField(form: HTMLFormElement | null) {
  form?.querySelector<HTMLInputElement>("input")?.focus();
}
export function PermissionEditor(props: { request: SupportRequest; onChange: () => void; ref?: Ref<PermissionEditorHandle> }) {
  return <PermissionEditorContent key={props.request.id} {...props}/>;
}
function PermissionEditorContent({
  request,
  onChange,
  ref,
}: {
  request: SupportRequest;
  onChange: () => void;
  ref?: Ref<PermissionEditorHandle>;
}) {
  const { t, locale } = useParentLocale();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(request.mandate);
  const [version, setVersion] = useState(request.version);
  const [accepted, setAccepted] = useState(false);

  const [message, setMessage] = useState("");
  const recovery = useSupportUpdate(request.id, (_saved, superseded) => {
    setEditing(false);
    setMessage(superseded ? "Your update was recorded. Newer changes are now in effect; check the current saved information."
      : "Your updated permission is saved. Future work uses these limits.");
    onChange();
  }, onChange);
  const pending = recovery.pending;
  function open() {
    if (recovery.locked) { setEditing(true); return; }
    setDraft(request.mandate);
    setVersion(request.version);
    setAccepted(false);
    setMessage("");
    setEditing(true);
  }
  useImperativeHandle(ref, () => ({ open }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!accepted || recovery.locked) return;
    await recovery.save((expiresAt) => ({ action: "replace_mandate", version,
      mandate: { ...draft, expiresAt, maxRecipients: draft.recipientIds.length } }));
  }
  async function reviewLatest() {
    await recovery.review(latest => { setDraft(latest.mandate); setVersion(latest.version); setAccepted(false); onChange(); });
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
  if (recovery.accessLost) return <div lang={locale} className={styles.supportControls}><SupportUpdateRecovery recovery={recovery} onReview={reviewLatest}/></div>;
  return (
    <div lang={locale} className={`${styles.space} ${styles.hidePrint} ${styles.supportControls}`}>
      {!editing ? (
        <button className={styles.secondary} onClick={open}>
          {t("Change or renew permission")}</button>
      ) : (
        <form className={styles.form} onSubmit={submit} ref={focusFirstField}>
          <h3>{t("Permission for up to 30 days")}</h3>
          <p className={styles.small}>
            {t("Choose exactly who can receive information and what CaseLink can use. Removing permission stops new uses; information already delivered may remain with its recipient.")}</p>
          <fieldset className={styles.fieldset} disabled={recovery.locked}>
            <legend className={styles.legend}>{t("Named programs")}</legend>
            <div className={styles.choices}>
              {getProgramsForNeeds(request.intake.needs).map((program) => (
                <label className={styles.choice} key={program.id}>
                  <input
                    type="checkbox"
                    checked={draft.recipientIds.includes(program.id)}
                    onChange={() => toggleRecipient(program.id)}
                  />
                  <span lang={t(program.name) === program.name ? "" : locale}>{t(program.name)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className={styles.fieldset} disabled={recovery.locked}>
            <legend className={styles.legend}>
              {t("Information CaseLink may use")}</legend>
            <div className={styles.choices}>
              {Object.entries(PERMISSION_DATA_LABELS).map(([id, label]) => (
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
                  <span>{t(label)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className={styles.fieldset} disabled={recovery.locked}>
            <legend className={styles.legend}>
              {t("Actions within these limits")}</legend>
            <div className={styles.choices}>
              <label className={styles.choice}>
                <input
                  name="permission-mode"
                  type="radio"
                  checked={draft.mode === "full"}
                  onChange={() => changeMode("full")}
                />
                <span>
                  <strong>{t("Prepare and carry out permitted steps")}</strong>
                  <small>
                    {t("Share allowed information, submit supported applications, coordinate appointments and follow up. Required personal acts remain yours.")}</small>
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
                  <strong>{t("Prepare only")}</strong>
                  <small>
                    {t("Research and prepare without sharing information or submitting anything.")}</small>
                </span>
              </label>
            </div>
          </fieldset>
          <p className={styles.hint}>
            {t("Up to {n} attempts among these named programs. External actions require a verified permitted connection. Signatures, identity checks, agency declarations and binding financial commitments still need the appropriate personal step.").replace("{n}", String(draft.maxAttempts))}
          </p>
          <label className={styles.choice}>
            <input
              type="checkbox"
              checked={accepted}
              disabled={recovery.locked}
              onChange={(event) => setAccepted(event.target.checked)}
              required
            />
            <span>
              {t("I authorize these programs, actions and information for up to 30 days. I can pause or withdraw future work.")}</span>
          </label>
          <button
            className={styles.button}
            disabled={
              recovery.locked ||
              !accepted ||
              !draft.recipientIds.length ||
              !draft.allowedData.length
            }
          >
            {t(pending ? recovery.checking ? "Checking saved result…" : "Saving…" : "Save updated permission")}
          </button>
          <button
            className={styles.quiet}
            type="button"
            disabled={pending}
            onClick={() => setEditing(false)}
          >
            {t(recovery.unresolved ? "Close editor; this save is still being checked" : "Keep existing permission")}</button>
        </form>
      )}
      {message && (
        <p role="status" className={styles.success}>
          {t(message)}
        </p>
      )}
      <SupportUpdateRecovery recovery={recovery} onReview={reviewLatest}/>
    </div>
  );
}
