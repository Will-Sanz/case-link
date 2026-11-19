"use client";
import Link from "next/link";
import type { useSupportUpdate } from "./use-support-update";
import { useParentLocale } from "./parent-locale";
import styles from "./parent.module.css";

export function SupportUpdateRecovery({ recovery, onReview, reviewLabel = "Review current saved information" }: {
  recovery: ReturnType<typeof useSupportUpdate>; onReview: () => void; reviewLabel?: string;
}) {
  const { t, locale } = useParentLocale();
  if (recovery.accessLost) return <div className={styles.space}>
    <p lang={t(recovery.error) === recovery.error ? "" : locale} className={styles.error} role="alert">{t(recovery.error)}</p>
    <button type="button" className={styles.secondary} disabled={recovery.pending} onClick={onReview}>{t(recovery.pending ? "Loading current information…" : "Review current saved information")}</button>
    <Link href="/my-support" className={styles.textLink}>{t("My support")}</Link>
    <Link href="/support/help" className={styles.textLink}>{t("Help and manual options")}</Link>
  </div>;
  return <div className={styles.space}>
    {recovery.error && <p className={styles.error} role="alert"><span lang={t(recovery.error) === recovery.error ? "" : locale}>{t(recovery.error)}</span></p>}
    {recovery.unresolved && <>
      <p className={styles.hint}>{t("The accepted changes stay fixed while this save is uncertain. You can still inspect, pause or withdraw the current permission using this request’s controls.")}</p>
      <button type="button" className={styles.secondary} disabled={recovery.pending} onClick={recovery.check}>{t(recovery.pending ? "Checking saved result…" : "Check saved result")}</button>
      {!recovery.conflict && <button type="button" className={styles.secondary} disabled={recovery.pending} onClick={recovery.retry}>{t("Retry the exact accepted changes")}</button>}
      {recovery.conflict && <p className={styles.hint}>{t("Reviewing current information replaces this page’s unsaved draft. A recorded earlier update remains in its history.")}</p>}
      {recovery.conflict && <button type="button" className={styles.secondary} disabled={recovery.pending} onClick={onReview}>{t(reviewLabel)}</button>}
      <Link href="/support/help" className={styles.textLink}>{t("Help and manual options")}</Link>
    </>}
  </div>;
}
