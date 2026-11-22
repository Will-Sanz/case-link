"use client";
import { useParentLocale } from "./parent-locale";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Lock } from "iconoir-react";
import styles from "./parent.module.css";

export function UrgentHelp() {
  const { t, locale } = useParentLocale();
  return (
    <aside lang={locale} className={styles.urgent} aria-label={t("Help you can reach now")}>
      <div>
        <h2>{t("Need help today?")}</h2>
        <p>
          {t("You can contact these services directly. No CaseLink account needed.")}</p>
      </div>
      <div className={styles.urgentLinks}>
        <a href="https://www.phila.gov/food/">
          {t("Find food in Philadelphia")}{" "}
          <ArrowRight width={16} height={16} aria-hidden="true" />
        </a>
        <Link href="/support/help#urgent">
          {t("Utility shutoff help")}{" "}
          <ArrowRight width={16} height={16} aria-hidden="true" />
        </Link>
      </div>
    </aside>
  );
}

export function ParentLanding() {
  const { t, locale } = useParentLocale();
  return (
    <div lang={locale}>
      <section className={styles.heroBand}>
        <div className={styles.hero}>
          <div className={styles.heroText}>
            <h1>
              {t("Food support for your family,")}<br />
              {t("made simpler.")}</h1>
            <p className={styles.heroCopy}>
              {t("Tell us what your family needs. We’ll help with the next steps.")}</p>
          </div>
          <div className={styles.heroActions}>
            <Link className={styles.button} href="/get-support">
              {t("Find support for my family")}{" "}
              <ArrowRight width={19} height={19} aria-hidden="true" />
            </Link>

            <div className={styles.heroLinks}>
              <Link href="/support/help#urgent">{t("Need help today? Find direct resources")}</Link>
              <Link href="/my-support">{t("Go to My support")}</Link>
            </div>
          </div>
        </div>
        <div className={styles.heroVisual}>
          <Image
            className={styles.heroImage}
            src="/marketing/caselink-parent-panorama.webp"
            width={2172}
            height={724}
            sizes="(max-width: 1600px) 100vw, 1600px"
            preload
            alt={t("Illustration of a family unpacking groceries and a parent checking a bill on his phone at home.")}
          />
        </div>
      </section>
      <section className={styles.explainSection}>
        <div className={styles.explainInner}>
          <div>
            <h2>{t("A clearer path through the paperwork.")}</h2>
            <p className={styles.lead}>
              {t("You shouldn’t have to become an expert in every form. Our service is being built to handle routine preparation and permitted follow-up, and ask for you when a step really needs you.")}</p>
            <div className={`${styles.trustLine} ${styles.space}`}>
              <Lock width={22} height={22} aria-hidden="true" />
              <div>
                <strong>{t("Your information. Your choice.")}</strong>{t("See who can receive information, set limits, and stop future work at any time.")}</div>
            </div>
          </div>
          <ol className={styles.steps}>
            <li>
              <div>
                <h3>{t("Tell us a little about your household")}</h3>
                <p>
                  {t("Choose the support you need and share a few details. “Not sure” is a useful answer, too.")}</p>
              </div>
            </li>
            <li>
              <div>
                <h3>{t("Choose what CaseLink can handle")}</h3>
                <p>
                  {t("See the named programs, information and limits before starting. Share a document only if it helps.")}</p>
              </div>
            </li>
            <li>
              <div>
                <h3>{t("Follow progress, without chasing it")}</h3>
                <p>
                  {t("See what was prepared, what was actually sent, and what happens next. Required signatures and personal decisions stay yours.")}</p>
              </div>
            </li>
          </ol>
        </div>
      </section>

    </div>
  );
}
