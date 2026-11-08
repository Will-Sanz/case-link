import Link from "next/link";
import { ArrowRight } from "iconoir-react";
import { UrgentHelp } from "./landing";
import styles from "./parent.module.css";

export function FoodServices() {
  return (
    <div className={styles.container}>
      <div className={styles.pageTop}>
        <div>
          <h1>Choose the food support you need.</h1>
          <p>
            Groceries or meals now, a new application, and help with existing
            benefits are different services. You choose where to start.
          </p>
        </div>
      </div>
      <div className={`${styles.surface} ${styles.serviceOptions}`}>
        <section className={styles.serviceOption} aria-labelledby="food-now-title">
          <div>
            <h2 id="food-now-title">Groceries or meals now</h2>
            <p>
              Find city-listed food sites without an account. Confirm hours,
              eligibility and availability before traveling; a listing is not a
              reservation.
            </p>
            <Link className={styles.textLink} href="/get-support?need=food_now">
              Ask CaseLink for food-access support
            </Link>
          </div>
          <a className={styles.secondary} href="https://www.phila.gov/food/">
            Find food now <ArrowRight width={18} height={18} aria-hidden="true" />
          </a>
        </section>
        <section className={styles.serviceOption} aria-labelledby="snap-new-title">
          <div>
            <h2 id="snap-new-title">Apply for SNAP</h2>
            <p>
              Pennsylvania SNAP · Department of Human Services. Start a new
              application for help paying for groceries. We show what is
              connected before you authorize work.
            </p>
          </div>
          <Link className={styles.button} href="/get-support?need=snap_new">
            Apply for SNAP <ArrowRight width={18} height={18} aria-hidden="true" />
          </Link>
        </section>
        <section className={styles.serviceOption} aria-labelledby="snap-existing-title">
          <div>
            <h2 id="snap-existing-title">Help with SNAP you already have</h2>
            <p>
              Keep an existing benefit or follow up on work already started.
              Checking a pending application does not start another application.
            </p>
            <div className={styles.serviceLinks}>
              <Link className={styles.textLink} href="/get-support?need=snap_renewal">Renew SNAP</Link>
              <Link className={styles.textLink} href="/get-support?need=snap_pending">Check a pending application</Link>
              <Link className={styles.textLink} href="/get-support?need=snap_problem">Help with a notice or benefit problem</Link>
            </div>
          </div>
        </section>
        <section className={styles.serviceOption} aria-labelledby="wic-title">
          <div>
            <h2 id="wic-title">WIC food and nutrition support</h2>
            <p>See the available paths for pregnancy, postpartum or a child under five.</p>
            <div className={styles.serviceLinks}>
              <Link className={styles.textLink} href="/get-support?need=wic_new">Apply for WIC</Link>
              <Link className={styles.textLink} href="/get-support?need=wic_continuing">Continue WIC support</Link>
            </div>
          </div>
        </section>
      </div>
      <p className={styles.space}>
        <Link className={styles.textLink} href="/get-support">
          Not sure, or need more than one kind of support? See all support options.
        </Link>
      </p>
      <UrgentHelp />
    </div>
  );
}
