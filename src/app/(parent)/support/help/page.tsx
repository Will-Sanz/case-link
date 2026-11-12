import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "iconoir-react";
import { PROGRAMS } from "@/lib/parent/programs";
import { parentEmailCodeEnabled } from "@/lib/parent/configuration";
import styles from "@/features/parent/parent.module.css";
import { FoodSites } from "@/features/parent/food-sites";
export const metadata: Metadata = {
  title: "Help & direct support",
  description:
    "Official food and utility support in Philadelphia, account recovery and answers about CaseLink.",
};
export default function HelpPage() {
  const existingAccounts =
    process.env.CASELINK_PARENT_ACCOUNT_MODE === "existing";
  const emailCodeAvailable = parentEmailCodeEnabled(process.env);
  const recoveryHref =
    process.env.CASELINK_ENVIRONMENT === "connected" &&
    process.env.CASELINK_PARENT_RECOVERY_SITE_URL
      ? `${process.env.CASELINK_PARENT_RECOVERY_SITE_URL}/forgot-password`
      : "/forgot-password";
  return (
    <div className={`${styles.container} ${styles.infoPage}`}>
      <header className={styles.infoIntro}>
      <h1>Help, without another hurdle.</h1>
      <p className={styles.lead}>
        You can use official programs directly at any time. You do not need to
        create a CaseLink account or upload a document first.
      </p>
      </header>
      <section id="urgent" className={styles.section}>
        <h2>Need food or utility help now?</h2>
        <p>
          For food today, use the City’s food and meal finder. Check the
          location’s current hours and access requirements before traveling.
        </p>
        <a className={styles.button} href="https://www.phila.gov/food/">
          Find food in Philadelphia{" "}
          <ArrowRight width={18} height={18} aria-hidden="true" />
        </a>
        <p className={styles.space}>
          For a shutoff notice or disconnected service, contact your utility’s
          official assistance channel directly. Tell them the notice date and
          whether service is already off. A CaseLink request or assistance
          application does not confirm a shutoff hold.
        </p>
        <ul>
          <li>
            <a
              className={styles.textLink}
              href="https://www.peco.com/my-account/customer-support/assistance-programs"
            >
              PECO assistance
            </a>
          </li>
          <li>
            <a
              className={styles.textLink}
              href="https://www.pgworks.com/about-your-bill/financial-support-programs"
            >
              PGW financial support
            </a>
          </li>
          <li>
            <a
              className={styles.textLink}
              href="https://www.phila.gov/services/payments-assistance-taxes/payment-plans-and-assistance-programs/senior-citizen-programs/apply-for-water-bill-customer-assistance/"
            >
              Philadelphia water assistance
            </a>
          </li>
        </ul>
        <p>
          Published program information does not establish available funding,
          appointments or a reservation. CaseLink does not currently offer a
          staffed emergency line.
        </p>
      </section>
      <div className={styles.section}>
        <FoodSites />
      </div>
      <section className={`${styles.section} ${styles.infoWide}`}>
        <h2>Official programs & partner options</h2>
        <ul className={`${styles.list} ${styles.programDirectory}`}>
          {PROGRAMS.map((program) => (
            <li className={styles.needRow} key={program.id}>
              <h3>
                <a className={styles.textLink} href={program.officialUrl}>
                  {program.name}
                </a>
              </h3>
              <p>{program.description}</p>
            </li>
          ))}
        </ul>
      </section>
      <section className={styles.section}>
        <h2>Can’t sign in?</h2>
        {existingAccounts && (
          <p>
            For an existing CaseLink school account, use your email and
            password. If you forgot it,{" "}
            <Link className={styles.textLink} href={recoveryHref}>
              reset your existing password
            </Link>
            .
            {emailCodeAvailable &&
              " Email-code sign-in is available for supported parent accounts; it does not replace a school account’s password check."}
          </p>
        )}
        {emailCodeAvailable && (
          <p>
            If you use email-code sign-in, choose “Use an email code instead.”
            Use the same email address as your account, check spam or junk mail,
            and use the newest code.
          </p>
        )}
        <p>
          Never share your password or codes. If you no longer have access to
          your email, CaseLink does not currently provide an automatic account
          transfer; contact the program directly for time-sensitive support.
        </p>
        <Link className={styles.secondary} href="/sign-in">
          Return to sign in
        </Link>
      </section>
      <section className={styles.section}>
        <h2>Something changed?</h2>
        <p>
          Open your request in{" "}
          <Link className={styles.textLink} href="/my-support">
            My support
          </Link>{" "}
          to correct household or bill information, add a document, pause work
          or cancel. For a new kind of support, start another request so its
          program permissions are clear.
        </p>
      </section>
      <section className={styles.section}>
        <h2>Want help from a person?</h2>
        <p>
          Use the program links above for benefits specialists and utility
          assistance. Do not wait for a CaseLink response when a program
          deadline is close.
        </p>
      </section>
      <section className={styles.section}>
        <h2>Privacy or account controls</h2>
        <p>
          <Link className={styles.textLink} href="/account">
            Your account
          </Link>{" "}
          has notification choices, information download and deletion controls.{" "}
          <Link className={styles.textLink} href="/support/privacy">
            Read the privacy notice
          </Link>{" "}
          for sharing, document processing and the limits of recalling
          information already sent.
        </p>
      </section>
    </div>
  );
}
