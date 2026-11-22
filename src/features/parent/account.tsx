"use client";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, Lock } from "iconoir-react";
import type { ParentPreferences } from "@/lib/parent/domain";
import { parentApi } from "./api";
import { ParentLoading, ServiceError } from "./feedback";
import { AccountDeletion, AccountDeletionAccess } from "./account-deletion";
import { FoodDescription } from "./food-description";
import { useParentResource } from "./use-parent-resource";
import { ParentLanguageSelector, useParentLocale } from "./parent-locale";
import styles from "./parent.module.css";

type Account = { id: string; email: string; preferences: ParentPreferences };
const hourLabel = (hour: number) =>
  `${hour % 12 || 12}:00 ${hour < 12 ? "AM" : "PM"}`;
function AccountSettings({
  account,
  onChange,
}: {
  account: Account;
  onChange: () => void;
}) {
  const { t, locale } = useParentLocale();
  const [preferences, setPreferences] = useState(account.preferences);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const errorMessage = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorMessage.current?.focus(); }, [error]);
  const [deleted, setDeleted] = useState(false);
  const [showDescriptions, setShowDescriptions] = useState(false);
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
  return (
    <div lang={locale} className={styles.stack}>
      {!deleted && <>
      <section className={styles.surface}>
        <div className={styles.between}>
          <div>
            <h2>{t("Your account")}</h2>
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
            {t("Sign out")}
          </button>
        </div>
        <div className={`${styles.trustLine} ${styles.space}`}>
          <Lock width={21} height={21} aria-hidden="true" />
          <p>
            {t("Signing out protects this device and keeps your support permission in place. My support shows any running, waiting or unavailable work. To stop future work, pause or cancel it in")}{" "}
            <Link className={styles.textLink} href="/my-support">
              {t("My support")}
            </Link>
            .
          </p>
        </div>
      </section>
      <section className={styles.surface}>
        <h2>{t("Your family information")}</h2>
        <p>{t("Save optional family basics once, then reuse fresh information in support requests you authorize. You can correct or remove it whenever you need.")}</p>
        <Link className={`${styles.textLink} ${styles.space}`} href="/family-profile">{t("Manage family information")}</Link>
      </section>
      <section className={styles.surface}>
        <h2>{t("Updates & preferences")}</h2>
        <form className={`${styles.form} ${styles.space}`} onSubmit={save}>
          <div className={styles.field}>
            <label htmlFor="account-contact">{t("Support updates")}</label>
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
              <option value="in_app">{t("Only in My support")}</option>
              <option value="email">{t("Email and My support")}</option>
            </select>
            <p className={styles.hint}>
              {t("Sensitive details stay in your account. Email delivery is enabled only after its channel is verified.")}
            </p>
          </div>
          <div className={styles.field}>
            <label htmlFor="account-language">{t("Preferred service language")}</label>
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
              <option value="en" lang="en">English</option>
              <option value="es" lang="es">Español</option>
            </select>
            <p className={styles.hint}>
              {t("Screen language is separate from your program contact preference. Each program’s language service is checked separately.")}
            </p>
          </div>
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>
              {t("Quiet hours for routine notifications")}
            </legend>
            <div className={styles.row}>
              <div className={styles.field}>
                <label htmlFor="quiet-start">{t("Start")}</label>
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
                      {locale === "es" ? hourLabel(hour).replace("AM", "a. m.").replace("PM", "p. m.") : hourLabel(hour)}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label htmlFor="quiet-end">{t("End")}</label>
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
                      {locale === "es" ? hourLabel(hour).replace("AM", "a. m.").replace("PM", "p. m.") : hourLabel(hour)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className={`${styles.hint} ${styles.space}`}>
              {t("Times use Philadelphia local time. Important security messages may still be sent. Check My support directly for current progress.")}
            </p>
          </fieldset>
          <button className={styles.button} type="submit" disabled={pending}>
            {t(pending ? "Saving…" : "Save preferences")}
          </button>
        </form>
      </section>
      </>}
      {!deleted && <details className={styles.disclosure} onToggle={event => setShowDescriptions(event.currentTarget.open)}>
        <summary>{t("Saved support descriptions")}</summary>
        {showDescriptions && <FoodDescription archiveOwner={account.id} />}
      </details>}
      <AccountDeletion key={account.id} ownerId={account.id} showExport onRecorded={() => setDeleted(true)} />
      {!deleted && message && (
        <p className={styles.success} role="status">
          {t(message)}
        </p>
      )}
      {!deleted && error && (
        <p ref={errorMessage} tabIndex={-1} lang={t(error) === error ? "en" : locale} className={styles.error} role="alert">
          {t(error)}
        </p>
      )}
    </div>
  );
}

function AccountResource() {
  const { data, error, loading, reload } = useParentResource<{
    account: Account;
  }>("/account");
  return loading ? <ParentLoading label="Loading your account" /> : error ? <><ServiceError error={error} retry={reload} returnTo="/account" /><AccountDeletionAccess /></> :
    data && <AccountSettings key={data.account.id} account={data.account} onChange={reload} />;
}

export function ParentAccount({ deletionOnly = false }: { deletionOnly?: boolean }) {
  const { t, locale } = useParentLocale();
  return (
    <div lang={locale} className={`${styles.container} ${styles.account}`}>
      <div className={styles.pageTop}><div>
        <h1>{t(deletionOnly ? "Delete parent-support data" : "Your account")}</h1>
        <p>{t("Choose how to hear from us, protect your information, and stay in control.")}</p>
      </div></div>
      {deletionOnly ? <AccountDeletionAccess /> : (
        <div className={styles.stack}>
          <section id="display-settings" className={`${styles.surface} ${styles.displaySettings}`} aria-labelledby="display-settings-title">
            <h2 id="display-settings-title">{t("Display preferences")}</h2>
            <ParentLanguageSelector settings />
          </section>
          <AccountResource />
        </div>
      )}
    </div>
  );
}
