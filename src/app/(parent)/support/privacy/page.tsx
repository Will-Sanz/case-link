import type { Metadata } from "next";
import Link from "next/link";
import styles from "@/features/parent/parent.module.css";
export const metadata: Metadata = { title: "Privacy & control" };
export default function ParentPrivacyPage() {
  return (
    <article className={`${styles.container} ${styles.legal}`}>
      <h1>
        Your information.
        <br />
        Your control.
      </h1>
      <p>Early-access notice · October 25, 2026</p>
      <div className={styles.notice}>
        Live personal-data processing is not open by default. Provider
        agreements, approved retention terms and a published privacy contact are
        required before a real-family pilot. Use synthetic information in a test
        environment.
      </div>
      <h2>What this service uses</h2>
      <p>
        CaseLink’s parent service uses a verified email address, your chosen
        support needs, minimum household and routing details, your preferences,
        authorization and support history. Income, utility details and
        supporting documents are requested only when useful or required for a
        supported program.
      </p>
      <p>
        Do not provide account passwords, email codes, EBT PINs or unrequested
        identity documents. Agency-only sensitive information belongs in the
        program’s protected direct-entry process.
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
        privacy certification.
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
        to download your recorded information or request deletion. Deletion
        stops future work and disables account access, with private-file cleanup
        and eligible-record removal handled through the deletion process. The
        proposed CaseLink schedule keeps service records and exact packets
        during active service and for 90 days after closure, subject to earlier
        eligible deletion. Selected minimal evidence hashes and deletion
        tombstones have a proposed 365-day expiry. These periods require an
        approved purpose; they are not a claim that a law requires them.
        Backups, processor copies and delivered program records follow
        separately approved terms. The final notice must describe those limits
        before intake opens.
      </p>
      <h2>Shared devices & account access</h2>
      <p>
        Use an email you control, keep codes private and sign out on shared
        devices. School staff accounts do not grant access to parent household
        records. Program access must be limited to the relevant referral and
        permission.
      </p>
      <h2>Questions before sharing</h2>
      <p>
        Use the official program contacts in{" "}
        <Link className={styles.textLink} href="/support/help">
          Help
        </Link>{" "}
        for their privacy practices and alternatives to CaseLink. A named
        CaseLink privacy contact and response process must be published before
        real-family intake opens.
      </p>
    </article>
  );
}
