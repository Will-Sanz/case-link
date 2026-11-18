"use client";
import { ParentLanguageSelector, useParentLocale } from "./parent-locale";
import Link from "next/link";
import type { ReactNode } from "react";
import { CaseLinkWordmark } from "@/components/brand/caselink-mark";
import { ChatGptFuturesBanner } from "@/components/brand/chatgpt-futures-banner";
import styles from "./parent.module.css";
import { ParentNavigation } from "./parent-navigation";
import { FloatingAssistant } from "./floating-assistant";
import chatStyles from "./floating-assistant.module.css";

export function ParentShell({
  children,
  showRecognition = false,
  signedIn = false,
}: {
  children: ReactNode;
  showRecognition?: boolean;
  signedIn?: boolean;
}) {
  const { t } = useParentLocale();
  return (
    <div className={`${styles.shell} ${chatStyles.shell}`}>
      <a className={styles.skip} href="#main-content">
        {t("Skip to content")}</a>
      {showRecognition && <div lang="en"><ChatGptFuturesBanner /></div>}
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link className={styles.brand} href="/" aria-label={t("CaseLink home")}>
            <CaseLinkWordmark />
          </Link>
          <ParentNavigation signedIn={signedIn} />
        </div>
        <div className={styles.container}><ParentLanguageSelector /></div>
      </header>
      <main id="main-content" lang="en" tabIndex={-1} className={styles.main}>
        {children}
      </main>
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.footerBrand}>
            <Link href="/" aria-label={t("CaseLink home")}>
              <CaseLinkWordmark />
            </Link>
            <p>{t("Support for your family, with you in control.")}</p>
            <p>{t("Built in Philadelphia.")}</p>
          </div>
          <nav className={styles.footerLinks} aria-label={t("Footer")}>
            <Link href="/support/privacy#data-policy">{t("Data policy")}</Link>
            <Link href="/support/privacy">{t("Privacy policy")}</Link>
            <Link href="/support/terms">{t("Terms of service")}</Link>
            <Link href="/support/help">{t("Get help")}</Link>
            <a href="mailto:willsanz23@gmail.com">{t("Contact CaseLink")}</a>
          </nav>
        </div>
      </footer>
      <div lang="en"><FloatingAssistant signedIn={signedIn} /></div>
    </div>
  );
}
