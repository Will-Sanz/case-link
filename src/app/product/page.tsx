import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, Lock } from "iconoir-react";
import { PublicSiteShell } from "@/components/layout/public-site-shell";
import { ProductPageContent } from "@/features/marketing/product-page-content";
import { getSessionUser } from "@/lib/auth/session";
import { ParentShell } from "@/features/parent/parent-shell";
import { UrgentHelp } from "@/features/parent/landing";
import styles from "@/features/parent/parent.module.css";
export const metadata: Metadata = {
  title: "How CaseLink works",
  description:
    "Understand CaseLink’s parent-focused food and utility support, permission limits, required personal steps and honest progress.",
};
export const dynamic = "force-dynamic";
export default async function ProductPage() {
  if (process.env.CASELINK_PRODUCT === "school") {
    let user = null;
    try {
      user = await getSessionUser();
    } catch {
      /* Preserve public school access when authentication is unavailable. */
    }
    return (
      <PublicSiteShell authenticated={Boolean(user)}>
        <ProductPageContent />
      </PublicSiteShell>
    );
  }
  return (
    <ParentShell>
      <div className={`${styles.container} ${styles.narrow}`}>
        <div className={styles.pageTop}>
          <div>
            <h1>
              Less chasing.
              <br />A clearer way forward.
            </h1>
            <p className={styles.lead}>
              Food and utility assistance can involve several programs and a lot
              of repeated information. CaseLink brings your needs and next steps
              into one place.
            </p>
          </div>
        </div>
        <div className={styles.notice}>
          <Lock width={22} height={22} aria-hidden="true" />
          <p>
            We’re in early access. Live actions are enabled only after their
            privacy, provider and service checks. Preparation is distinct from
            an application or approval.
          </p>
        </div>
        <section className={styles.section}>
          <h2>Tell us once. Set clear limits.</h2>
          <p className={styles.lead}>
            Choose food, SNAP, WIC, electricity, gas or water support. Share
            minimum household details, then see the named programs and actions
            before you authorize anything.
          </p>
        </section>
        <section className={styles.section}>
          <h2>We handle the work we’re allowed to handle.</h2>
          <ul className={`${styles.list} ${styles.space}`}>
            {[
              "Research relevant programs and prepare useful next steps.",
              "Use clear, validated information you already supplied without asking you to repeat it.",
              "Carry out sharing, submissions, appointments and follow-up only through verified permitted channels.",
              "Keep separate progress for every need, so one result doesn’t hide unfinished work.",
            ].map((line) => (
              <li className={styles.checklistItem} key={line}>
                <Check width={20} height={20} aria-hidden="true" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className={styles.section}>
          <h2>Some steps still need you.</h2>
          <p className={styles.lead}>
            A program may need your signature, identity check, interview or a
            personal decision. CaseLink prepares what it can and explains the
            exact step. It never signs as you, decides eligibility or accepts a
            payment plan for you.
          </p>
        </section>
        <section className={styles.section}>
          <h2>See what really happened.</h2>
          <p className={styles.lead}>
            A prepared packet is different from a submission. An approval is
            different from support actually received. Your support history makes
            those distinctions clear, and keeps the source of updates visible.
          </p>
          <div className={`${styles.inline} ${styles.space}`}>
            <Link className={styles.button} href="/get-support">
              Find support for my family{" "}
              <ArrowRight width={18} height={18} aria-hidden="true" />
            </Link>
            <Link className={styles.quiet} href="/support/privacy">
              Your privacy & control
            </Link>
          </div>
        </section>
        <div className={styles.section}>
          <UrgentHelp />
        </div>
      </div>
    </ParentShell>
  );
}
