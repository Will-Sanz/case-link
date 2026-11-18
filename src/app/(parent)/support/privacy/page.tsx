import type { Metadata } from "next";
import { readParentLocale } from "@/lib/parent/locale-server";
import { publicInfoText } from "@/lib/parent/public-info-copy";
import Link from "next/link";
import styles from "@/features/parent/parent.module.css";
export async function generateMetadata(): Promise<Metadata> {
  const locale = await readParentLocale();
  return { title: publicInfoText(locale, "Privacy & data policy"), description: publicInfoText(locale, "How CaseLink uses household information, documents and AI, and how you control your support.") };
}
export default async function ParentPrivacyPage() {
  const locale = await readParentLocale();
  const t = (english: string) => publicInfoText(locale, english);
  return (
    <article lang={locale} className={`${styles.container} ${styles.legal}`}>
      <p>{t("Privacy & data policy")}</p>
      <h1>{t("Your information. Your control.")}</h1>
      <p>{t("Last updated November 13, 2026 · Parent service")}</p>
      <div className={styles.notice}>
        {t("Live personal-data processing is not open by default. Provider agreements, approved retention terms and operational privacy checks are required before a real-family pilot. Test environments must use synthetic information.")}</div>
      <p>
        {t("CaseLink helps adults find food support and utility assistance for their household. This notice explains the parent service. Existing school records keep their separate access rules and purpose; using the same sign-in does not transfer those records into your household.")}</p>
      <ul>
        <li>
          {t("We do not sell personal information or share it for advertising.")}</li>
        <li>{t("You choose the programs, information and actions you authorize.")}</li>
        <li>{t("Documents need separate consent before upload and processing.")}</li>
        <li>
          {t("You can correct information, stop future work and request deletion.")}</li>
      </ul>
      <h2>{t("What this service uses")}</h2>
      <p>
        {t("CaseLink’s parent service uses a verified email address, your chosen support needs, ZIP code, minimum household and routing details, your language and contact preferences, authorization and support history. Depending on the support you choose, this can include household size, whether a child is under five, pregnancy or postpartum information, income, utility details and supporting documents. Additional details are requested only when useful or required for a supported program.")}</p>
      <p>
        {t("We use these details to find relevant programs, prepare permitted work, follow up, show your progress and protect the service. You can choose “Not sure” where offered and use manual alternatives. We keep the information you provide separate from a program’s verified decision or receipt.")}</p>
      <p>
        {t("Do not put passwords, email codes, EBT PINs or unrequested identity documents in support requests or uploads. Enter your CaseLink password only in its sign-in form. Use only the protected personal-entry step offered for the named program for required identifiers and signatures; never put them in chat or ordinary support fields.")}</p>
      <h2>{t("Saved information across requests")}</h2>
      <p>
        {t("When you start another request, we can fill your current household ZIP code from an earlier request you own. Your new authorization covers its use for the named programs, and you can edit it before starting. We keep the original source and date; reuse does not make it newly confirmed or extend its expiry. Changed information stops superseded work. Withdrawal, deletion or expiry stops reuse and removes the reused current value. Previously attempted packets and receipts keep their separate history and retention rules.")}</p>
      <p>
        {t("This does not copy private SNAP application answers, identifiers, signatures or a program-specific household or income definition into another program. We ask only for information that is still needed for the selected support and covered by its notice and permission.")}</p>
      <h2 id="family-profile">{t("Your shared family profile")}</h2>
      <p>
        {t("When profile saving is available and you choose it, CaseLink stores the family basics you provide: contact details, home and mailing addresses, language, names, birth dates, relationships and known income-source types. You can leave questions unanswered and continue directly to support. Do not enter government identifiers, account access codes, passwords, pregnancy or medical details, citizenship answers or signatures here.")}</p>
      <p>
        {t("Your profile supplies compatible answers for support applications you choose and authorize. It does not give a program access to your profile or authorize a submission. Each confirmed answer is kept for up to 45 days; opening the profile or starting another request does not restart that time. You can update, download or clear your saved profile. Clearing or expiration stops future reuse. Copies in earlier application records follow their own stated purpose and retention rules. Corrections stop queued uses of superseded answers; already sent records stay in history.")}</p>
      <h2 id="snap-application">{t("Private SNAP application details")}</h2>
      <p>
        {t("When this collection purpose is enabled, the separate SNAP application fields request the ordinary answers needed for the reviewed Pennsylvania application: applicant name and postal address, optional phone contacts, language preferences, household members’ names and birth dates, relationship and student information, which people are applying and their citizenship answers, current-month income received or expected, applicable medical and other expense deductions and the form’s criminal-history and benefit-disqualification questions. Representative contact details are optional and do not designate CaseLink or an AI as an authorized representative. Optional race and voter-registration answers are not collected here.")}</p>
      <p>
        {t("Before these details are saved, the start authorization names Pennsylvania SNAP and explains the application purpose and information use. The answers are held in private, owned application revisions, separate from chat and ordinary support facts. Saving these answers does not send all of them to an AI service or submit an agency application. A future AI or delivery use must pass its actual purpose, information, processor and recipient controls. Required Social Security numbers, credentials and signature values are not accepted in these fields; genuine identifiers and certifications need a separately permitted protected process. The accepted submission route must establish its own personal act and receipt evidence.")}</p>
      <p>
        {t("CaseLink keeps these application revisions while the support request is active and for up to 90 days after closure, subject to eligible earlier deletion. Unchanged answers keep their original recorded dates; reading them, starting another request or changing an unrelated answer does not refresh them. Corrections create a new revision and stop queued uses of superseded information. Earlier delivered records remain attributed history. These are sensitive household and eligibility details; the existing storage, access, deletion and backup limitations below apply. Real-family processing remains closed until its recorded privacy and operational checks are complete.")}</p>
      <h3>{t("Protected SNAP personal steps")}</h3>
      <p>
        {t("When enabled, a separate permission names the people applying, the Pennsylvania SNAP application and the expiry before protected entry opens. Required Social Security numbers and your own signature drawings and dates are used to complete the private application. These entries stay out of AI, chat and ordinary household records. You can choose to provide an applicant’s Social Security number to the agency later; CaseLink does not invent one. Permission to collect these entries does not sign or send the application, or establish agency acceptance.")}</p>
      <p>
        {t("The approved CaseLink limit for the encrypted final SNAP PDF and its individual encryption key is at most 30 days from your original consent to this protected collection. Earlier permission or service-processing deadlines, withdrawal and deletion limits take precedence. Reading, recovering or following up on the application does not extend that deadline. This limit is separate from the ordinary application revisions above. An expiry date is not proof of completed deletion: scheduled PDF and key cleanup must be verified before live use. Processor copies, backups and records already delivered to a program have separate terms that must be resolved and explained before intake opens.")}</p>
      <h2>{t("What you authorize")}</h2>
      <p>
        {t("Your support authorization names the programs, purposes, allowed actions and information, duration and attempt limits. You can choose research and preparation only. Work outside those limits requires new permission; routine permitted work inside them does not require you to approve every step.")}</p>
      <p>
        {t("Preparation-only mode does not authorize external sharing, submissions or booking. Partnership with an organization does not by itself authorize an automated connection.")}</p>
      <h2 id="data-policy">{t("Data policy: storage, access & security")}</h2>
      <p>
        {t("CaseLink uses Supabase for account authentication, database and private file storage, and Vercel for the existing site. Hosting for the protected SNAP service has not been selected or activated. Access controls limit parent records to their household owner and specifically authorized service work. A school role or administrator role does not grant access to other parents’ household records. Any program access must be limited to the relevant referral and permission.")}</p>
      <p>
        {t("Security controls include authenticated sessions, database access rules, input checks, restricted document processing and server-side credential handling. We record limited activity and security information to operate and investigate the service. No system can promise complete security. Household details, uploaded content and AI prompts must not be copied into ordinary analytics, public links or notification previews.")}</p>
      <p>
        {t("Ask CaseLink uses the question you send, your saved account preferences and relevant information from the request you select with OpenAI to answer. This includes permitted household facts, recorded progress and next steps. It does not include raw identity numbers, passwords or uploaded application documents. Sending a question records your agreement to this use; it does not submit an application or change your service permission.")}</p>
      <h2 id="documents">{t("Bills, notices & AI processing")}</h2>
      <p>
        {t("You must agree to document storage and processing before uploading or taking a photo through CaseLink. Supported files are JPEG, PNG or readable PDFs up to 10 MB and five pages. An unprocessed CaseLink raw copy expires after seven days. Successful extraction shortens raw-file expiry to at most 24 hours after validation. Validated facts may remain after the original file is removed. Private-file deletion is performed by the monitored cleanup process; an expiry date alone is not proof of completed erasure.")}</p>
      <p>
        {t("Where enabled and approved, OpenAI’s Responses service receives minimized routing facts or selected provider, financial and date lines to help prepare support steps. Whole bills are parsed in a separate restricted environment. OpenAI API content is not used for training by default; standard abuse-monitoring retention can be up to 30 days, with stated exceptions, and encrypted prompt-cache state can persist up to 24 hours. Our store:false setting is not approval for Zero Data Retention. Facts must be checked and remain connected to their source. Uploaded content does not give an AI new permissions. Files are stored privately and should not be placed in public links, analytics or a browser storage vault.")}</p>
      <p>
        {t("Before live processing, the service must publish its approved processor, retention, deletion and disclosure terms. A test configuration is not a privacy certification. See")}{" "}
        <a
          className={styles.textLink}
          href="https://developers.openai.com/api/docs/guides/your-data"
          target="_blank"
          rel="noreferrer"
        >
          {t("OpenAI’s API data controls")}</a>{" "}
        {t("for its current terms. CaseLink’s AI service is separate from your personal ChatGPT account; you do not need a ChatGPT account to use CaseLink.")}</p>
      <h2>{t("Cookies, messages & technical information")}</h2>
      <p>
        {t("When you choose a screen language, a cookie remembers English or Spanish in this browser for up to 90 days. It contains no household facts and does not change your program contact language or service permission. Clearing this cookie removes that browser preference.")}</p>
      <p>
        {t("Necessary cookies keep you signed in and protect your session. Hosting, authentication and security services also process request times, IP addresses and related network information. We do not add advertising or cross-site tracking cookies, or use third-party advertising analytics.")}</p>
      <p>
        {t("If you choose email updates and the service is enabled, Resend delivers a general notice with a link to sign in. The message does not include your program, income, utility balance or support outcome. Email delivery still shares your email address and delivery metadata with the email provider. You can change optional update preferences in your account; sign-in and necessary security messages are separate.")}</p>
      <h2>{t("Sharing with programs")}</h2>
      <p>
        {t("Only specifically authorized information can be sent through a verified permitted program channel. Each attempt keeps its exact packet and recorded evidence. Prepared, sent, received, accepted, submitted, approved and support received have different meanings.")}</p>
      <p>
        {t("A program may keep delivered information under its own rules. Cancelling future CaseLink work cannot always recall something already delivered or withdraw an agency application.")}</p>
      <p>
        {t("Information may also be disclosed where legally required. Service providers receive only the information needed for approved functions, under the applicable terms. Recognition through OpenAI’s ChatGPT Futures program does not give OpenAI or a school access to your CaseLink account.")}</p>
      <h2>{t("Corrections, pause & cancellation")}</h2>
      <p>
        {t("Correct important information on your request page. Corrections stop queued uses of superseded facts and flag any already delivered packet that may need an update. Previously submitted versions stay in the recorded history.")}</p>
      <p>
        {t("You can pause or cancel future work in")}{" "}
        <Link className={styles.textLink} href="/my-support">
          {t("My support")}</Link>
        {t(". Signing out secures the device; it does not revoke an active service authorization.")}</p>
      <h2>{t("Download or delete")}</h2>
      <p>
        {t("Use")}{" "}
        <Link className={styles.textLink} href="/account">
          {t("Your account")}</Link>{" "}
        {t("to download your recorded parent-service information or request deletion. Deletion stops future parent-service work and blocks parent access, with private-file cleanup and eligible-record removal handled through the deletion process. It does not delete a reused CaseLink sign-in identity or school records held for a separate purpose. Contact us for a broader account or privacy request. The proposed CaseLink schedule keeps ordinary service records and nonprotected packets during active service and for 90 days after closure, subject to earlier eligible deletion. The protected SNAP PDF and key instead have the shorter limit described above. Selected minimal evidence hashes and deletion tombstones have a proposed 365-day expiry. These periods require an approved purpose; they are not a claim that a law requires them. Backups, processor copies and delivered program records follow separately approved terms. The final notice must describe those limits before intake opens.")}</p>
      <h2>{t("Shared devices & account access")}</h2>
      <p>
        {t("Use an email you control, keep your password and codes private, and sign out on shared devices. Where existing-account access is enabled, use your existing CaseLink email and password. First use of the parent service creates your own household space; it does not grant permission to use someone else’s records. Signing out of the parent service does not sign you out of a separate school workspace session.")}</p>
      <h2>{t("Children & caregivers")}</h2>
      <p>
        {t("Accounts are for adults and authorized caregivers. A child does not need an account. Provide information about a child only when you have the authority to do so and it is needed for the chosen support. Contact us if you believe a child has created an account or information was provided without appropriate authority.")}</p>
      <h2>{t("Questions, requests & policy changes")}</h2>
      <p>
        {t("William Sanz operates CaseLink as an individual, without a registered entity, and is responsible for privacy and incident requests. Contact him at")}{" "}
        <a className={styles.textLink} href="mailto:willsanz23@gmail.com">
          willsanz23@gmail.com
        </a>
        {t(". Use it for privacy questions, access or deletion requests, corrections you cannot make in the app, or security concerns. Do not attach bills, identity documents, passwords or codes to email. We may need to verify a request before releasing or deleting information.")}</p>
      <p>
        {t("Use the official program contacts in")}{" "}
        <Link className={styles.textLink} href="/support/help">
          {t("Help")}</Link>{" "}
        {t("for their privacy practices and alternatives to CaseLink. We date changes to this notice and seek new permission when a change expands your authorization. The monitored privacy response process and final processor and retention terms must be confirmed before real-family intake opens.")}</p>
    </article>
  );
}
