"use client";
import { useParentLocale } from "./parent-locale";
import Link from "next/link";
import { ArrowRight, InfoCircle, WarningTriangle } from "iconoir-react";
import { ParentApiError } from "./api";
import styles from "./parent.module.css";

export function ServiceError({
  error,
  retry,
  returnTo = "/my-support",
}: {
  error: Error;
  retry?: () => void;
  returnTo?: string;
}) {
  const { t, locale } = useParentLocale();
  if (error instanceof ParentApiError && error.status === 401)
    return (
      <div lang={locale} className={styles.empty}>
        <div className={styles.emptyIcon}>
          <InfoCircle width={28} height={28} aria-hidden="true" />
        </div>
        <h2>{t("Let’s bring you back to your support")}</h2>
        <p>
          {t("Sign in to your CaseLink account to keep your household’s information private.")}</p>
        <Link
          className={styles.button}
          href={`/sign-in?next=${encodeURIComponent(returnTo)}`}
        >
          {t("Sign in to continue")}{" "}
          <ArrowRight width={18} height={18} aria-hidden="true" />
        </Link>
      </div>
    );
  return (
    <div lang={locale} className={styles.error} role="alert">
      <WarningTriangle width={23} height={23} aria-hidden="true" />
      <div>
        <strong>
          {t("We couldn’t finish this step")}
        </strong>
        <p lang={t(error.message) === error.message ? "en" : locale}>{t(error.message)}</p>
        <div className={`${styles.inline} ${styles.space}`}>
          {retry && (
            <button className={styles.secondary} onClick={retry}>
              {t("Try again")}</button>
          )}
          <Link className={styles.textLink} href="/support/help">
            {t("See direct support options")}</Link>
        </div>
      </div>
    </div>
  );
}

export function ParentLoading({
  label = "Loading your support",
}: {
  label?: string;
}) {
  const { t, locale } = useParentLocale();
  return (
    <div lang={t(label) === label ? "en" : locale} className={styles.loading} role="status" aria-label={t(label)}>
      <span className={styles.screenReader}>{t(label)}…</span>
      <div className={`${styles.skeleton} ${styles.skeletonTitle}`} />
      <div className={styles.skeleton} />
      <div className={styles.skeleton} />
      <div className={styles.skeleton} />
    </div>
  );
}
