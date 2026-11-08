import type { Metadata } from "next";
import Link from "next/link";
import styles from "@/features/parent/parent.module.css";
export const metadata: Metadata = {
  title: "Terms of service",
  description:
    "Clear expectations for using CaseLink’s parent food and utility support service.",
};
export default function ParentTermsPage() {
  return (
    <article className={`${styles.container} ${styles.legal}`}>
      <p>Terms of service</p>
      <h1>Clear expectations for support.</h1>
      <p>Last updated October 25, 2026 · Parent service</p>
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
      <p>
        Use CaseLink lawfully and only for information you have authority to
        provide. Do not impersonate another person, access another household,
        disrupt the service or try to bypass its safeguards. These terms cover
        parent support; a school’s separate service arrangements and records
        rules continue to apply to its workspace.
      </p>
      <h2>Your account</h2>
      <p>
        Where enabled, your existing CaseLink email and password work for the
        parent service. Email-code access is also available for supported
        account creation and recovery. Keep credentials private and use an email
        you control. A shared sign-in does not copy school records or grant
        access to anyone else’s household. Tell us if you believe your account
        has been misused.
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
      <p>
        AI can make mistakes. CaseLink checks supported information and
        execution permissions, but its assistance is not legal, medical or
        financial advice. Correct important facts when you notice an error; use
        a qualified professional or the official program for decisions that
        require one. We will not ask you to approve every routine action already
        covered by your authorization.
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
      <h2>Availability, safety & ending use</h2>
      <p>
        Service features can change or be interrupted. We may restrict access to
        address misuse or security concerns. You can stop using the service,
        cancel future work or request parent-service deletion. Parent deletion
        does not delete a reused sign-in identity or separately held school
        records. Keep copies of records you need and use official alternatives
        for urgent needs. Mandatory consumer rights remain in place.
      </p>
      <h2>CaseLink & OpenAI</h2>
      <p>
        CaseLink is a separate service using OpenAI technology where enabled.
        The original site’s ChatGPT Futures recognition and grant acknowledgment
        describe that program participation; they do not mean that OpenAI
        operates CaseLink or guarantees assistance. CaseLink’s name and logo
        identify this service. OpenAI and ChatGPT names and marks belong to
        OpenAI.
      </p>
      <h2>Contact & changes</h2>
      <p>
        For questions about these terms, contact{" "}
        <a className={styles.textLink} href="mailto:willsanz23@gmail.com">
          willsanz23@gmail.com
        </a>
        . Do not send sensitive documents or credentials by email. We date
        updates to these terms and obtain new authorization when the work you
        permit expands. The final service operator details, support coverage and
        approved terms must be confirmed before real-family intake opens.
        Current test use must remain synthetic.
      </p>
    </article>
  );
}
