# WIC private information: engineering assessment

November 13, 2026. Applies to the new Pennsylvania WIC pre-application preparation path, alongside the [general review](../parent-privacy-regulatory-review.md). This records the implemented boundaries and unresolved actual operating facts. It does not approve real collection, determine legal compliance or activate a provider.

## Scope and minimal inventory

The source is the blank [official pre-application](https://pawic.com/OnlineApplication.aspx), checked November 13. It requests a callback to arrange specialist help; completing it does not establish an appointment, enrollment or benefits received. The checked contract expires November 20 at 18:57:45.283 UTC under the existing weekly source-review rule. No form was submitted or populated on the government service.

The private record supports contact name, date of birth, postal address, county, email and phone; application journey and morning/afternoon preference; relevant maternal name/date of birth/status/delivery date; and child names/dates of birth with stable internal person IDs. Only selected branches accept their corresponding information. Unknown values remain absent. Race, ethnicity, Medicaid identifiers, SSN/ITIN, credentials, signatures and clinical assessments are excluded. A genuine contact postal ZIP is an independently supplied address fact, not an automatic copy of household routing ZIP or a renewal of its original source date. Income and household size are not prerequisites for this verified pre-application.

The purpose is preparing the named Pennsylvania WIC request, not creating an unrestricted family profile. Each actual save requires the versioned notice and a declaration of authority for everyone named. The database binds actor, notice, exact revision, subjects and detail digest. This is recorded evidence of a parent's declaration, not independent proof of guardianship or another adult's authorization. The family experience must make that distinction understandable before capture.

## Actual data path and access

| Boundary | Information and control |
| --- | --- |
| Family browser → authenticated Next API | Private answers and declared subject authority, only after the separate WIC collection gate permits it. Same-origin writes, bounded payload and no-store replies. Browser memory can retain an unsaved draft until navigation; no browser persistent draft store is introduced. |
| Next hosting → Supabase/PostgREST/database | Raw private answers, ownership and immutable revision/provenance/consent evidence. Separate row policies and write RPC checks enforce current account, request, scope, purpose, notice and expiry. These are JSON records, **not separately envelope-encrypted application bytes**. Hosting/database administrators, configured logs and backups are distinct exposure boundaries requiring actual review. |
| Routine worker/chat/ordinary packet | No raw WIC answers are added. Existing need/ZIP/account linkage can itself disclose WIC interest; excluding raw answers does not establish that processors receive no health-related information. |
| Ordinary document upload/AI reading | WIC-only registration, Storage insertion, upload confirmation and broker raw-document access remain closed independently of the private-answer gate. Saved history/deletion stays available. Mixed requests retain the separately permitted other-need document path; it does not authorize WIC-private documents. |
| Owner comprehensive export | All owned WIC revisions and their evidence; private response. Routine support PDFs do not receive these values. |
| Agency/partner/email | No new private-answer transport or delivery permission is enabled. Provider acceptance, delegated entry, required personal acts, unknown-result recovery and receipt/status evidence are unresolved. |

School roles, another household, service role, ordinary worker, storage broker and retention worker are denied raw-table reads. Existing owner-request deletion cascades to these records. An ordinary worker cannot obtain them through an expanded generic fact or chat schema.

## Applicability disposition

The FTC rule defines personal health records using technical capacity for multiple sources and individual control. CaseLink's health-related journeys, uploaded documents and saved information make a whole-service assessment necessary; a disabled form or lack of a medical-provider contract does not resolve that analysis. **Engineering disposition: do not assume exemption; keep WIC collection closed pending a recorded actual-role and processor assessment.** This is an inference from the service design and [16 CFR Part 318](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-318), checked November 13 (eCFR displayed currency through November 10).

Unauthorized disclosure can matter as well as intrusion. General encryption or row-access controls do not establish that every copy meets the rule's secured-information exception. The actual incident procedure must address recipients, tracing/logs and processor copies. [FTC guidance](https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0).

HIPAA role depends on actual services and relationships; the current direct-to-parent arrangement does not prove either a covered role or an exemption for all future routes. No BAA or agency confidentiality permission was established by this work. [HHS health-app guidance](https://www.hhs.gov/hipaa/for-professionals/special-topics/health-apps/index.html). The November 7 reviewer waiver applies to its bounded SNAP pilot and is not silently extended to WIC.

## Retention, rights and activation evidence

The code inherits request cleanup: closed/cancelled records become eligible 90 days after their last update, subject to the existing document cleanup conditions, or through earlier eligible parent deletion. Every immutable WIC revision remains until the parent record is erased. Physical deletion depends on successful independently operated cleanup; this is not a guaranteed deletion deadline. Reads and new requests do not reset original field dates. This existing engineering default is **not an approved WIC retention decision**. Processor/backups and attempted government records need their own actual terms; no zero-retention claim follows from local deletion.

When only the WIC collection gate closes, owned history remains readable and new writes stop. Overall processing closure currently also closes normal owner reads/exports through the shared account gate, while the independently authorized parent-deletion path remains available. Before real intake, provide and verify the applicable rights/export route during closure rather than representing this as a completed rights experience.

Activation requires a recorded WIC scope/retention/notice disposition; actual hosting, database, logs, backups and any model exposure inventory; verified rights, monitored deletion/restore and incident operation; family observation of the consent/subject-authority experience; and accepted provider-route/personal-act/receipt evidence for any claimed execution. No fictional agency filing, new provider account or outside contact is authorized merely to obtain that evidence. The separate database gate defaults off independently of SNAP and must remain off until these conditions are met.
