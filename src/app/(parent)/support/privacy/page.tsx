import type { Metadata } from "next";
import Link from "next/link";
import styles from "@/features/parent/parent.module.css";
export const metadata: Metadata = {
  title: "Privacy & data policy",
  description:
    "How CaseLink uses household information, documents and AI, and how you control your support.",
};
export default function ParentPrivacyPage() {
  return (
    <article className={`${styles.container} ${styles.legal}`}>
      <p>Privacy & data policy</p>
      <h1>Your information. Your control.</h1>
      <p>Last updated November 3, 2026 · Parent service</p>
      <div className={styles.notice}>
        Live personal-data processing is not open by default. Provider
        agreements, approved retention terms and operational privacy checks are
        required before a real-family pilot. Test environments must use
        synthetic information.
      </div>
      <p>
        CaseLink helps adults find food support and utility assistance for their
        household. This notice explains the parent service. Existing school
        records keep their separate access rules and purpose; using the same
        sign-in does not transfer those records into your household.
      </p>
      <ul>
        <li>
          We do not sell personal information or share it for advertising.
        </li>
        <li>You choose the programs, information and actions you authorize.</li>
        <li>Documents need separate consent before upload and processing.</li>
        <li>
          You can correct information, stop future work and request deletion.
        </li>
      </ul>
      <h2>What this service uses</h2>
      <p>
        CaseLink’s parent service uses a verified email address, your chosen
        support needs, ZIP code, minimum household and routing details, your
        language and contact preferences, authorization and support history.
        Depending on the support you choose, this can include household size,
        whether a child is under five, pregnancy or postpartum information,
        income, utility details and supporting documents. Additional details are
        requested only when useful or required for a supported program.
      </p>
      <p>
        We use these details to find relevant programs, prepare permitted work,
        follow up, show your progress and protect the service. You can choose
        “Not sure” where offered and use manual alternatives. We keep the
        information you provide separate from a program’s verified decision or
        receipt.
      </p>
      <p>
        Do not put passwords, email codes, EBT PINs or unrequested identity
        documents in support requests or uploads. Enter your CaseLink password
        only in its sign-in form. Agency-only sensitive information belongs in
        the program’s protected direct-entry process.
      </p>
      <h2 id="snap-application">Private SNAP application details</h2>
      <p>
        When this collection purpose is enabled, the separate SNAP application
        fields request the ordinary answers needed for the reviewed Pennsylvania
        application: applicant name and postal address, optional phone contacts,
        language preferences, household members’ names and birth dates,
        relationship and student information, which people are applying and
        their citizenship answers, current-month income received or expected,
        applicable medical and other expense deductions and the form’s
        criminal-history and benefit-disqualification questions.
        Representative contact details are optional and do not designate
        CaseLink or an AI as an authorized representative. Optional race and
        voter-registration answers are not collected here.
      </p>
      <p>
        Before these details are saved, the start authorization names
        Pennsylvania SNAP and explains the application purpose and information
        use. The answers are held in private, owned application revisions,
        separate from chat and ordinary support facts. Saving these answers does
        not send all of them to an AI service or submit an agency application.
        A future AI or delivery use must pass its actual purpose, information,
        processor and recipient controls. Required Social Security numbers,
        credentials and signature values are not accepted in these fields;
        genuine identifiers and certifications need the protected official-program
        process. The accepted submission route must establish its own personal
        act and receipt evidence.
      </p>
      <p>
        CaseLink keeps these application revisions while the support request is
        active and for up to 90 days after closure, subject to eligible earlier
        deletion. Unchanged answers keep their original recorded dates; reading
        them, starting another request or changing an unrelated answer does not
        refresh them. Corrections create a new revision and stop queued uses of
        superseded information. Earlier delivered records remain attributed
        history. These are sensitive household and eligibility details; the
        existing storage, access, deletion and backup limitations below apply.
        Real-family processing remains closed until its recorded privacy and
        operational checks are complete.
      </p>
      <h2>What you authorize</h2>
      <p>
        Your support authorization names the programs, purposes, allowed actions
        and information, duration and attempt limits. You can choose research
        and preparation only. Work outside those limits requires new permission;
        routine permitted work inside them does not require you to approve every
        step.
      </p>
      <p>
        Preparation-only mode does not authorize external sharing, submissions
        or booking. Partnership with an organization does not by itself
        authorize an automated connection.
      </p>
      <h2 id="data-policy">Data policy: storage, access & security</h2>
      <p>
        CaseLink uses Supabase for account authentication, database and private
        file storage, and Vercel for application hosting. Access controls limit
        parent records to their household owner and specifically authorized
        service work. A school role or administrator role does not grant access
        to other parents’ household records. Any program access must be limited
        to the relevant referral and permission.
      </p>
      <p>
        Security controls include authenticated sessions, database access rules,
        input checks, restricted document processing and server-side credential
        handling. We record limited activity and security information to operate
        and investigate the service. No system can promise complete security.
        Household details, uploaded content and AI prompts must not be copied
        into ordinary analytics, public links or notification previews.
      </p>
      <h2 id="documents">Bills, notices & AI processing</h2>
      <p>
        You must agree to document storage and processing before uploading or
        taking a photo through CaseLink. Supported files are JPEG, PNG or
        readable PDFs up to 10 MB and five pages. An unprocessed CaseLink raw
        copy expires after seven days. Successful extraction shortens raw-file
        expiry to at most 24 hours after validation. Validated facts may remain
        after the original file is removed. Private-file deletion is performed
        by the monitored cleanup process; an expiry date alone is not proof of
        completed erasure.
      </p>
      <p>
        Where enabled and approved, OpenAI’s Responses service receives
        minimized routing facts or selected provider, financial and date lines
        to help prepare support steps. Whole bills are parsed in a separate
        restricted environment. OpenAI API content is not used for training by
        default; standard abuse-monitoring retention can be up to 30 days, with
        stated exceptions, and encrypted prompt-cache state can persist up to 24
        hours. Our store:false setting is not approval for Zero Data Retention.
        Facts must be checked and remain connected to their source. Uploaded
        content does not give an AI new permissions. Files are stored privately
        and should not be placed in public links, analytics or a browser storage
        vault.
      </p>
      <p>
        Before live processing, the service must publish its approved processor,
        retention, deletion and disclosure terms. A test configuration is not a
        privacy certification. See{" "}
        <a
          className={styles.textLink}
          href="https://developers.openai.com/api/docs/guides/your-data"
          target="_blank"
          rel="noreferrer"
        >
          OpenAI’s API data controls
        </a>{" "}
        for its current terms. CaseLink’s AI service is separate from your
        personal ChatGPT account; you do not need a ChatGPT account to use
        CaseLink.
      </p>
      <h2>Cookies, messages & technical information</h2>
      <p>
        Necessary cookies keep you signed in and protect your session. Hosting,
        authentication and security services also process request times, IP
        addresses and related network information. We do not add advertising or
        cross-site tracking cookies, or use third-party advertising analytics.
      </p>
      <p>
        If you choose email updates and the service is enabled, Resend delivers
        a general notice with a link to sign in. The message does not include
        your program, income, utility balance or support outcome. Email delivery
        still shares your email address and delivery metadata with the email
        provider. You can change optional update preferences in your account;
        sign-in and necessary security messages are separate.
      </p>
      <h2>Sharing with programs</h2>
      <p>
        Only specifically authorized information can be sent through a verified
        permitted program channel. Each attempt keeps its exact packet and
        recorded evidence. Prepared, sent, received, accepted, submitted,
        approved and support received have different meanings.
      </p>
      <p>
        A program may keep delivered information under its own rules. Cancelling
        future CaseLink work cannot always recall something already delivered or
        withdraw an agency application.
      </p>
      <p>
        Information may also be disclosed where legally required. Service
        providers receive only the information needed for approved functions,
        under the applicable terms. Recognition through OpenAI’s ChatGPT Futures
        program does not give OpenAI or a school access to your CaseLink
        account.
      </p>
      <h2>Corrections, pause & cancellation</h2>
      <p>
        Correct important information on your request page. Corrections stop
        queued uses of superseded facts and flag any already delivered packet
        that may need an update. Previously submitted versions stay in the
        recorded history.
      </p>
      <p>
        You can pause or cancel future work in{" "}
        <Link className={styles.textLink} href="/my-support">
          My support
        </Link>
        . Signing out secures the device; it does not revoke an active service
        authorization.
      </p>
      <h2>Download or delete</h2>
      <p>
        Use{" "}
        <Link className={styles.textLink} href="/account">
          Your account
        </Link>{" "}
        to download your recorded parent-service information or request
        deletion. Deletion stops future parent-service work and blocks parent
        access, with private-file cleanup and eligible-record removal handled
        through the deletion process. It does not delete a reused CaseLink
        sign-in identity or school records held for a separate purpose. Contact
        us for a broader account or privacy request. The proposed CaseLink
        schedule keeps service records and exact packets during active service
        and for 90 days after closure, subject to earlier eligible deletion.
        Selected minimal evidence hashes and deletion tombstones have a proposed
        365-day expiry. These periods require an approved purpose; they are not
        a claim that a law requires them. Backups, processor copies and
        delivered program records follow separately approved terms. The final
        notice must describe those limits before intake opens.
      </p>
      <h2>Shared devices & account access</h2>
      <p>
        Use an email you control, keep your password and codes private, and sign
        out on shared devices. Where existing-account access is enabled, use
        your existing CaseLink email and password. First use of the parent
        service creates your own household space; it does not grant permission
        to use someone else’s records. Signing out of the parent service does
        not sign you out of a separate school workspace session.
      </p>
      <h2>Children & caregivers</h2>
      <p>
        Accounts are for adults and authorized caregivers. A child does not need
        an account. Provide information about a child only when you have the
        authority to do so and it is needed for the chosen support. Contact us
        if you believe a child has created an account or information was
        provided without appropriate authority.
      </p>
      <h2>Questions, requests & policy changes</h2>
      <p>
        The contact published on our original site remains{" "}
        <a className={styles.textLink} href="mailto:willsanz23@gmail.com">
          willsanz23@gmail.com
        </a>
        . Use it for privacy questions, access or deletion requests, corrections
        you cannot make in the app, or security concerns. Do not attach bills,
        identity documents, passwords or codes to email. We may need to verify a
        request before releasing or deleting information.
      </p>
      <p>
        Use the official program contacts in{" "}
        <Link className={styles.textLink} href="/support/help">
          Help
        </Link>{" "}
        for their privacy practices and alternatives to CaseLink. We date
        changes to this notice and seek new permission when a change expands
        your authorization. The service operator, monitored privacy response
        process and final processor and retention terms must be confirmed before
        real-family intake opens.
      </p>
    </article>
  );
}
