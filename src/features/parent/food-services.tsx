"use client";
import { useParentLocale } from "./parent-locale";
import Link from "next/link";
import { ArrowRight } from "iconoir-react";
import { UrgentHelp } from "./landing";
import { FoodAssessment } from "./food-assessment";
import { FoodSites } from "./food-sites";
import type { ParentIntakeSignInOptions } from "./intake";
import type { FoodAssessmentHandoff } from "@/lib/parent/food-assessment";
import styles from "./parent.module.css";

export function FoodServices({ initial, onChoose, signInOptions, onOwnerChanged }: { initial?: FoodAssessmentHandoff; onChoose?: (value: FoodAssessmentHandoff) => void; signInOptions?: ParentIntakeSignInOptions; onOwnerChanged?: () => void }) {
  const { t, locale } = useParentLocale();
  return (
    <div lang={locale} className={`${styles.container} ${styles.foodServices}`}>
      <FoodAssessment initial={initial} onChoose={onChoose} onOwnerChanged={onOwnerChanged} descriptionOptions={onChoose ? { signInOptions } : undefined}/>
      <FoodSites />
      <details className={styles.disclosure}>
        <summary>{t("I already know which program I need")}</summary>
      <div className={styles.pageTop}>
        <div>
          <h2>{t("Choose the food support you need.")}</h2>
          <p>
            {t("Groceries or meals now, a new application, and help with existing benefits are different services. You choose where to start.")}</p>
        </div>
      </div>
      <div className={`${styles.surface} ${styles.serviceOptions}`}>
        <section className={styles.serviceOption} aria-labelledby="food-now-title">
          <div>
            <h2 id="food-now-title">{t("Groceries or meals now")}</h2>
            <p>
              {t("Find city-listed food sites without an account. Confirm hours, eligibility and availability before traveling; a listing is not a reservation.")}</p>
            <Link className={styles.textLink} href="/get-support?need=food_now">
              {t("Ask CaseLink for food-access support")}</Link>
          </div>
          <a className={styles.secondary} href="https://www.phila.gov/food/">
            {t("Open City food finder")}<ArrowRight width={18} height={18} aria-hidden="true" />
          </a>
        </section>
        <section className={styles.serviceOption} aria-labelledby="snap-new-title">
          <div>
            <h2 id="snap-new-title">{t("Apply for SNAP")}</h2>
            <p>
              {t("Pennsylvania SNAP · Department of Human Services. Start a new application for help paying for groceries. We show what is connected before you authorize work.")}</p>
          </div>
          <Link className={styles.button} href="/get-support?need=snap_new">
            {t("Apply for SNAP")}<ArrowRight width={18} height={18} aria-hidden="true" />
          </Link>
        </section>
        <section className={styles.serviceOption} aria-labelledby="snap-existing-title">
          <div>
            <h2 id="snap-existing-title">{t("Help with SNAP you already have")}</h2>
            <p>
              {t("Keep an existing benefit or follow up on work already started. Checking a pending application does not start another application.")}</p>
            <div className={styles.serviceLinks}>
              <Link className={styles.textLink} href="/get-support?need=snap_renewal">{t("Renew SNAP")}</Link>
              <Link className={styles.textLink} href="/get-support?need=snap_pending">{t("Check a pending application")}</Link>
              <Link className={styles.textLink} href="/get-support?need=snap_problem">{t("Help with a notice or benefit problem")}</Link>
            </div>
          </div>
        </section>
        <section className={styles.serviceOption} aria-labelledby="wic-title">
          <div>
            <h2 id="wic-title">{t("WIC food and nutrition support")}</h2>
            <p>{t("See the available paths for pregnancy, postpartum or a child under five.")}</p>
            <div className={styles.serviceLinks}>
              <Link className={styles.textLink} href="/get-support?need=wic_new">{t("Apply for WIC")}</Link>
              <Link className={styles.textLink} href="/get-support?need=wic_continuing">{t("Continue WIC support")}</Link>
            </div>
          </div>
        </section>
      </div>
      </details>
      <p className={styles.space}>
        <Link className={styles.textLink} href="/get-support?need=all">
          {t("Not sure, or need more than one kind of support? See all support options.")}</Link>
      </p>
      <UrgentHelp />
    </div>
  );
}
