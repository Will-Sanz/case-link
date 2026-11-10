import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Lock, ShoppingBag } from "iconoir-react";
import styles from "./parent.module.css";

export function UrgentHelp() {
  return (
    <aside className={styles.urgent} aria-label="Help you can reach now">
      <div>
        <h2>Need help today?</h2>
        <p>
          You can contact these services directly. No CaseLink account needed.
        </p>
      </div>
      <div className={styles.urgentLinks}>
        <a href="https://www.phila.gov/food/">
          Find food in Philadelphia{" "}
          <ArrowRight width={16} height={16} aria-hidden="true" />
        </a>
        <Link href="/support/help#urgent">
          Utility shutoff help{" "}
          <ArrowRight width={16} height={16} aria-hidden="true" />
        </Link>
      </div>
    </aside>
  );
}

export function ParentLanding() {
  return (
    <>
      <section className={styles.heroBand}>
        <div className={styles.hero}>
          <div className={styles.heroText}>
            <h1>
              Food support for your family,
              <br />
              made simpler.
            </h1>
            <p className={styles.heroCopy}>
              Tell us what your family needs. We’ll help with the next steps.
            </p>
          </div>
          <div className={styles.heroActions}>
            <Link className={styles.button} href="/get-support">
              Find support for my family{" "}
              <ArrowRight width={19} height={19} aria-hidden="true" />
            </Link>

            <Link className={styles.heroDirectHelp} href="/support/help#urgent">
              Need help today? Find direct resources{" "}
              <ArrowRight width={16} height={16} aria-hidden="true" />
            </Link>
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
            alt="Illustration of a family unpacking groceries and a parent checking a bill on his phone at home."
          />
        </div>
      </section>
      <section className={styles.services} aria-label="Choose your support">
        <Link className={styles.serviceChoice} href="/get-support?need=food">
          <span className={styles.serviceIcon}>
            <ShoppingBag width={31} height={31} aria-hidden="true" />
          </span>
          <div>
            <strong>Food & benefits</strong>
            <span>Food today, SNAP and WIC. Find a place to start.</span>
          </div>
          <ArrowRight width={21} height={21} aria-hidden="true" />
        </Link>
      </section>
      <div className={styles.landingUrgent}>
        <Link href="/support/help#urgent">
          Need immediate help? See urgent resources{" "}
          <ArrowRight width={18} height={18} aria-hidden="true" />
        </Link>
      </div>
      <section className={styles.explainSection}>
        <div className={styles.explainInner}>
          <div>
            <h2>A clearer path through the paperwork.</h2>
            <p className={styles.lead}>
              You shouldn’t have to become an expert in every form. Our service
              is being built to handle routine preparation and permitted
              follow-up, and ask for you when a step really needs you.
            </p>
            <div className={`${styles.trustLine} ${styles.space}`}>
              <Lock width={22} height={22} aria-hidden="true" />
              <div>
                <strong>Your information. Your choice.</strong>See who can
                receive information, set limits, and stop future work at any
                time.
              </div>
            </div>
          </div>
          <ol className={styles.steps}>
            <li>
              <div>
                <h3>Tell us a little about your household</h3>
                <p>
                  Choose the support you need and share a few details. “Not
                  sure” is a useful answer, too.
                </p>
              </div>
            </li>
            <li>
              <div>
                <h3>Choose what CaseLink can handle</h3>
                <p>
                  See the named programs, information and limits before
                  starting. Share a document only if it helps.
                </p>
              </div>
            </li>
            <li>
              <div>
                <h3>Follow progress, without chasing it</h3>
                <p>
                  See what was prepared, what was actually sent, and what
                  happens next. Required signatures and personal decisions stay
                  yours.
                </p>
              </div>
            </li>
          </ol>
        </div>
      </section>

    </>
  );
}
