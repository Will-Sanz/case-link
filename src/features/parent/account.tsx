"use client";
import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, LogOut, Lock } from "iconoir-react";
import type { ParentPreferences } from "@/lib/parent/domain";
import { parentApi } from "./api";
import { ParentLoading, ServiceError } from "./feedback";
import { useParentResource } from "./use-parent-resource";
import styles from "./parent.module.css";

type Account = { email: string; preferences: ParentPreferences };
const hourLabel = (hour: number) =>
  `${hour % 12 || 12}:00 ${hour < 12 ? "AM" : "PM"}`;
function AccountSettings({
  account,
  onChange,
}: {
  account: Account;
  onChange: () => void;
}) {
  const [preferences, setPreferences] = useState(account.preferences);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [deleted, setDeleted] = useState(false);
  const router = useRouter();
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");
    try {
      await parentApi("/account", {
        method: "POST",
        body: JSON.stringify({ action: "preferences", preferences }),
      });
      setMessage(
        "Your preferences are saved for future requests and notifications.",
      );
      onChange();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "We couldn’t save your preferences. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }
  async function signOut() {
    setPending(true);
    setError("");
    try {
      await parentApi("/auth", {
        method: "POST",
        body: JSON.stringify({ action: "sign_out" }),
      });
      router.replace("/sign-in");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "We couldn’t sign out. Please try again before leaving a shared device.",
      );
    } finally {
      setPending(false);
    }
  }
  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await parentApi("/account", {
        method: "POST",
        body: JSON.stringify({ action: "delete", confirmation }),
      });
      setDeleted(true);
      try {
        await parentApi("/auth", {
          method: "POST",
          body: JSON.stringify({ action: "sign_out" }),
        });
      } catch {
        setError(
          "Parent-support access is disabled, but we couldn’t confirm sign-out on this device. Close this browser before leaving a shared device.",
        );
      }
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "We couldn’t record your deletion request. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }
  if (deleted)
    return (
      <section className={styles.surface}>
        <h2>Your deletion request is recorded</h2>
        <p className={`${styles.subtle} ${styles.space}`}>
          Future parent-support work is stopped and parent access is disabled.
          Private files and eligible parent records enter the deletion process.
          Your existing CaseLink sign-in and school records are kept separate.
          Information already sent to a program may remain under that program’s
          retention rules.
        </p>
        <p className={`${styles.hint} ${styles.space}`}>
          Deletion does not withdraw an application already held by an agency.
          Contact that program directly for its options.
        </p>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <Link className={`${styles.button} ${styles.space}`} href="/">
          Return home
        </Link>
      </section>
    );
  return (
    <div className={styles.stack}>
      <section className={styles.surface}>
        <div className={styles.between}>
          <div>
            <h2>Your account</h2>
            <p className={`${styles.subtle} ${styles.small}`}>
              {account.email}
            </p>
          </div>
          <button
            className={styles.secondary}
            onClick={signOut}
            disabled={pending}
          >
            <LogOut width={18} height={18} aria-hidden="true" />
            Sign out
          </button>
        </div>
        <div className={`${styles.trustLine} ${styles.space}`}>
          <Lock width={21} height={21} aria-hidden="true" />
          <p>
            Signing out protects this device and keeps your support permission
            in place. My support shows any running, waiting or unavailable
            work. To stop future work, pause or cancel it in{" "}
            <Link className={styles.textLink} href="/my-support">
              My support
            </Link>
            .
          </p>
        </div>
      </section>
      <section className={styles.surface}>
        <h2>Updates & preferences</h2>
        <form className={`${styles.form} ${styles.space}`} onSubmit={save}>
          <div className={styles.field}>
            <label htmlFor="account-contact">Support updates</label>
            <select
              id="account-contact"
              className={styles.select}
              value={preferences.contactPreference}
              onChange={(e) =>
                setPreferences((current) => ({
                  ...current,
                  contactPreference: e.target
                    .value as ParentPreferences["contactPreference"],
                }))
              }
            >
              <option value="in_app">Only in My support</option>
              <option value="email">Email and My support</option>
            </select>
            <p className={styles.hint}>
              Sensitive details stay in your account. Email delivery is enabled
              only after its channel is verified.
            </p>
          </div>
          <div className={styles.field}>
            <label htmlFor="account-language">Preferred service language</label>
            <select
              id="account-language"
              className={styles.select}
              value={preferences.language}
              onChange={(e) =>
                setPreferences((current) => ({
                  ...current,
                  language: e.target.value as ParentPreferences["language"],
                }))
              }
            >
              <option value="en">English</option>
              <option value="es">Spanish / Español</option>
            </select>
            <p className={styles.hint}>
              This early-access interface is in English. Recording a Spanish
              preference helps route support; program language availability is
              confirmed separately.
            </p>
          </div>
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>
              Quiet hours for routine notifications
            </legend>
            <div className={styles.row}>
              <div className={styles.field}>
                <label htmlFor="quiet-start">Start</label>
                <select
                  id="quiet-start"
                  className={styles.select}
                  value={preferences.quietHoursStart}
                  onChange={(e) =>
                    setPreferences((current) => ({
                      ...current,
                      quietHoursStart: Number(e.target.value),
                    }))
                  }
                >
                  {Array.from({ length: 24 }, (_, hour) => (
                    <option key={hour} value={hour}>
                      {hourLabel(hour)}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label htmlFor="quiet-end">End</label>
                <select
                  id="quiet-end"
                  className={styles.select}
                  value={preferences.quietHoursEnd}
                  onChange={(e) =>
                    setPreferences((current) => ({
                      ...current,
                      quietHoursEnd: Number(e.target.value),
                    }))
                  }
                >
                  {Array.from({ length: 24 }, (_, hour) => (
                    <option key={hour} value={hour}>
                      {hourLabel(hour)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className={`${styles.hint} ${styles.space}`}>
              Times use Philadelphia local time. Important security messages may
              still be sent. Check My support directly for current progress.
            </p>
          </fieldset>
          <button className={styles.button} type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save preferences"}
          </button>
        </form>
      </section>
      <section className={styles.surface}>
        <h2>Your information & control</h2>
        <p className={`${styles.subtle} ${styles.small}`}>
          Download your account information and recorded support history.
          Individual request pages also include printable summaries.
        </p>
        <a
          className={`${styles.secondary} ${styles.space}`}
          href="/api/parent/account/export"
        >
          <Download width={18} height={18} aria-hidden="true" />
          Download my information
        </a>
        <div className={styles.disclosure}>
          <Link className={styles.textLink} href="/support/privacy">
            Read privacy, retention and sharing details
          </Link>
        </div>
        <details
          className={styles.disclosure}
          open={deleteOpen}
          onToggle={(event) => setDeleteOpen(event.currentTarget.open)}
        >
          <summary>Delete my parent-support data & stop future work</summary>
          <div>
            <p className={`${styles.small} ${styles.subtle}`}>
              This stops parent-support work, blocks parent access and records a
              deletion request. It keeps your existing CaseLink sign-in and
              school records. Minimal service evidence and information already
              delivered to a program have separate retention rules. Download
              anything you need first.
            </p>
            <form
              className={`${styles.form} ${styles.space}`}
              onSubmit={remove}
            >
              <div className={styles.field}>
                <label htmlFor="delete-confirmation">
                  Type DELETE to confirm
                </label>
                <input
                  id="delete-confirmation"
                  className={styles.input}
                  autoComplete="off"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  required
                  pattern="DELETE"
                />
              </div>
              <button
                className={styles.danger}
                type="submit"
                disabled={pending || confirmation !== "DELETE"}
              >
                {pending
                  ? "Recording deletion…"
                  : "Delete parent-support data & stop work"}
              </button>
              <button
                className={styles.quiet}
                type="button"
                onClick={() => {
                  setDeleteOpen(false);
                  setConfirmation("");
                }}
              >
                Keep my parent-support data
              </button>
            </form>
          </div>
        </details>
      </section>
      {message && (
        <p className={styles.success} role="status">
          {message}
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function ParentAccount() {
  const { data, error, loading, reload } = useParentResource<{
    account: Account;
  }>("/account");
  return (
    <div className={`${styles.container} ${styles.narrow}`}>
      <div className={styles.pageTop}>
        <div>
          <h1>Your account</h1>
          <p>
            Choose how to hear from us, protect your information, and stay in
            control.
          </p>
        </div>
      </div>
      {loading ? (
        <ParentLoading label="Loading your account" />
      ) : error ? (
        <ServiceError error={error} retry={reload} returnTo="/account" />
      ) : (
        data && <AccountSettings account={data.account} onChange={reload} />
      )}
    </div>
  );
}
