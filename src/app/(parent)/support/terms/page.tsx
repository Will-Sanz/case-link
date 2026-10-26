import type { Metadata } from "next";
import Link from "next/link";
import styles from "@/features/parent/parent.module.css";
export const metadata: Metadata = { title: "Parent service terms" };
export default function ParentTermsPage() {
  return (
    <article className={`${styles.container} ${styles.legal}`}>
      <h1>
        Clear expectations
        <br />
        for support.
      </h1>
      <p>Early-access terms · October 25, 2026</p>
      <div className={styles.notice}>
        CaseLink is in early access. Live assistance and real-family intake
        require the recorded service, permission and privacy checks. These terms
        do not enable an unavailable program connection.
      </div>
      <h2>Who this service is for</h2>
      <p>
        The parent service is for adults seeking food support or utility
        assistance for their household, and caregivers with the necessary
        authority. Philadelphia is the initial service area; each program has
        its own coverage, requirements and availability.
      </p>
      <h2>What CaseLink can do</h2>
      <p>
        Within an informed, bounded authorization, CaseLink can research,
        prepare and carry out supported steps through verified permitted
        channels. Your request shows its actual capability limits. A preparation
        summary, referral or appointment request is not proof of an application,
        approval or assistance received.
      </p>
      <h2>What stays yours</h2>
      <p>
        Provide accurate information to the best of your knowledge and correct
        it when circumstances change. Required identity checks, personal
        attestations, signatures, interviews and meaningful financial decisions
        stay with you or the authorized professional. CaseLink does not sign as
        you, make agency eligibility decisions or accept binding financial
        arrangements under a general service authorization.
      </p>
      <h2>No guaranteed award or availability</h2>
      <p>
        Programs and agencies decide eligibility and assistance. Funding, food
        availability, appointments and processing times can change. CaseLink
        cannot guarantee an award, a shutoff hold, restored service or a
        particular response time. Use official program channels for
        time-sensitive needs.
      </p>
      <h2>Your permission has limits</h2>
      <p>
        The start authorization specifies named programs, information, actions,
        duration and attempts. In-scope work can continue after you close the
        page or sign out. You may pause or cancel future work. New recipients,
        purposes or expanded permissions require your authorization.
      </p>
      <h2>Your information</h2>
      <p>
        Read the{" "}
        <Link className={styles.textLink} href="/support/privacy">
          privacy and control notice
        </Link>{" "}
        before sharing. Documents require their own processing consent. Never
        share passwords, sign-in codes or EBT PINs through a support request.
      </p>
      <h2>Direct access & help</h2>
      <p>
        You may apply directly or use a qualified person at any time. CaseLink
        does not replace required program specialists, legal advice or emergency
        services.{" "}
        <Link className={styles.textLink} href="/support/help">
          Help
        </Link>{" "}
        keeps official options accessible without an account.
      </p>
      <h2>Before live service</h2>
      <p>
        Approved final service terms, the service operator’s contact details,
        support coverage and privacy terms must be published and verified before
        real families are invited. Current test use must remain synthetic.
      </p>
    </article>
  );
}
