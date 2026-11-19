# WIC, utilities and family-information reuse

November 13, 2026, America/New_York. This records the owner's requested expansion, current source/code assessment and next implementation pieces. It is not evidence of implemented WIC/utility execution, expanded processing permission or a family launch.

**Subsequent implementation:** [cross-request ordinary routing](parent-cross-request-routing-reuse-2026-11-13.md), [WIC private preparation](parent-wic-private-preparation-2026-11-13.md), [PECO private preparation](parent-peco-private-preparation-2026-11-13.md) and [PECO packet binding](parent-peco-preparation-binding-2026-11-13.md) are implemented, independently reviewed and locally tested. Those dated checkpoints describe current software and exact verification. The assessment below preserves the preceding research state; it does not override those narrower checkpoints or enable WIC/utility execution.

The separate [WIC information/processor assessment](parent-wic-data-assessment-2026-11-13.md) records the minimal private inventory, actual raw-data boundaries, applicability reasoning, retention and activation dependencies. The default-off engineering implementation does not resolve those live operating facts.

## Owner direction and retained goal

The owner asked to extend the existing SNAP system to WIC and utilities end to end, with maximum useful reuse so families do not retype information. Continue one CaseLink app and service engine. Preserve SNAP, COMPASS, PECO, school isolation, branding and the complete staged release scope. WIC follows the existing government-program priority; PECO is the first utility implementation because it has proven preparation work. PGW/gas, water, urgent and combined journeys remain required, rather than being dropped from the utility goal.

Save and reuse relevant family-provided information within actual purpose, household/person/account authority, consent, freshness and retention. The request is an engineering direction, not consent on behalf of families, indefinite retention or permission to copy SNAP-only private information into another purpose. Routine compatible reuse should happen automatically under the informed mandate; a new routine review click is not a requirement.

## What exists and what does not

- `src/lib/parent/service.ts`, `worker-runtime.ts`, `execution.ts`, `policy.ts` and `forms.ts` implement the shared request/operation lifecycle, bounded permissions, current facts, exact artifacts, durable work, recovery and evidence distinctions.
- `current-intake-fields.ts` and the corresponding database projection reuse permitted ordinary intake within an owned request. They preserve source dates and exact-need restrictions. An applicable current fact is not newly confirmed merely because it is read.
- `src/features/parent/intake.tsx` begins a new request with blank household fields; account language/contact preferences are reused. There is no implemented cross-request family profile. `parent_households` is ownership linkage, not a complete reusable information store.
- The ordinary transport registry is empty. Protected SNAP delivery uses an explicit separate connection. WIC delivery is deliberately blocked in `programs.ts`; `domain.ts` rejects private WIC intake fields. Neither restriction should be removed as a provider toggle.
- PECO already has tested unsigned preparation and income-evidence assembly in `peco-cap-draft.ts` and `peco-cap-income.ts`. Its live information projection, accepted personal completion, delivery and outcome route remain separate work.
- The November 10 local SNAP work log (retained in the owner workspace) records actual owner-UI test Submit, free Sinch emulator completion and scheduled reconciliation of the same delivery. It does not establish real agency filing, registration, approval or support received. Finish those retained SNAP boundaries without making unrelated engineering wait for an agency's decision cycle.

## Verified WIC route — November 13

The [PA service page](https://www.pa.gov/services/health/request-a-pre-application-appointment-with-a-wic-specialist) links the [actual pre-application](https://pawic.com/OnlineApplication.aspx). The blank form was inspected read-only. It contains contact/address/county, email/phone/contact birth date, morning/afternoon preference, new/reapplying/transfer, and mother/child selections. Conditional sections request maternal status/due date and relevant person details. No household data was entered and no request was sent; actual backend validation remains untested.

The displayed successful-send language promises contact to schedule and verify. Therefore the first external outcome is **appointment/callback request received**, if receipt is actually proved; it is not a booked appointment or enrollment. No stable receipt reference, duplicate reconciliation, delegated CaseLink execution authority or supported status API was established. An uncertain send must stay unknown until reconciled, without blind resend.

The [WIC Family Portal](https://wic.health.pa.gov/familyportal) describes appointments/change requests, documents, family information and benefit balance. [Registration](https://wic.health.pa.gov/familyportal/Identity/Account/Register-Step-1) requires WIC family/person identifiers, birth date, email and personal Keystone steps. Authentication and the actual supported delegated connection must be established; credentials do not belong in chat or ordinary facts. Continuing work must not silently start a duplicate new application.

[NORTH](https://www.northwic.org/) identifies its Philadelphia WIC operation and offices. Older City email advice does not prove a current secure automated submission route. Required WIC assessment remains with WIC specialists. The [official income page](https://www.pa.gov/agencies/health/programs/maternal-health-and-infant-care/wic/income) still displays July 2025–June 2026 dates; do not use that expired table as a current eligibility rule.

Before WIC collection, complete the specific data/processor/retention and health-record assessment required by the PRD and [privacy review](../parent-privacy-regulatory-review.md). The bounded SNAP reviewer waiver is not a WIC waiver. [FTC guidance](https://www.ftc.gov/business-guidance/resources/health-breach-notification-rule-basics-business) informs that assessment; neither this research nor synthetic tests determine legal classification or certify compliance.

## Verified utility routes — November 13

| Route | Current official evidence | Unproved operational boundary |
| --- | --- | --- |
| PECO CAP, first utility implementation | [Official 2026 form](https://www.peco.com/cdn/assets/v3/assets/blt1b5616c79bacadb4/blt9d4fc50508d00567/69f41a34626de91f304d9b8f/PECO_CAP_Application_2026_v2.pdf?branch=prod_alias): account/contact/address, household details and adult gross-income evidence; optional SSN/ITIN, applicant certification/signature, online/email/fax/mail. Status by mail unless optional SMS is selected. | Accepted genuine personal completion, permitted configured transport, exact form bytes/version, receipt/account matching and ongoing status. Public channel publication alone is not a verified CaseLink execution contract. |
| Philadelphia water assistance | [City instructions](https://www.phila.gov/services/payments-assistance-taxes/payment-plans-and-assistance-programs/senior-citizen-programs/apply-for-water-bill-customer-assistance/) and [actual portal](https://cap.phila.gov/apply/): online/mail/assisted route; no application by email. Saved application recovery uses an application ID, water access code and ZIP. | Actual authorized session, declarations, submission/recovery, duplicate prevention, receipt/status and any account protection. Error-dialog templates in page markup do not establish an outage. |
| PGW CRP | [Current program page](https://www.pgworks.com/about-your-bill/financial-support-programs/crp) links the [current four-page application](https://www.pgworks.com/uploads/media/CRPApplicationEng.pdf). Customer-of-record SSN/ID/birth date are not required; other household members have ID alternatives. Form includes customer responsibilities; recertification is every two years. | Protected required member fields, genuine certification, exact current form/bytes, permitted transport and status. Do not reuse the obsolete PDF returned by some searches or treat financial assent as routine paperwork. |

Current source text was checked; this assessment does not rehash downloaded utility PDFs against installed fixtures. Exact-byte/version/render verification is required in the relevant implementation piece. Omit optional identifiers. Any binding financial commitment needs its own informed family decision.

## Focused implementation order and acceptance

Each piece needs independent correctness/privacy/security/accessibility/regression review and a separate simplicity/deletion pass before dependent implementation. These are engineering milestones, not new family requirements or launch claims.

1. **Purpose-compatible reusable information.** Inventory each actual field against source/person/account, purpose, permission, relevant period and original expiry. First prove ordinary routing reuse across owned requests; existing language/contact defaults remain. Do not silently equate SNAP, WIC and utility household definitions or income periods. Preserve source references and dates, conflicts, parent corrections, source withdrawal/deletion and original retention. Add the applicable explanation to the ordinary mandate rather than a repeated permission ceremony. Expand beyond routing only as the verified route and protected purpose permit it.
2. **WIC information and appointment lifecycle.** Implement exact conditional intake and source-to-field mapping with fictional data, necessary acknowledgments, no unrelated utility/SNAP questions, source-grounded appointment instructions and truthful callback/requested/booked/enrolled states. Reuse only covered facts; keep collection and external delivery disabled until their actual boundaries pass. Prove actual form receipt/unknown delivery handling, confirmed appointment, changes, specialist handoff, return use and attributed enrollment/support follow-up.
3. **PECO information/personal-act/packet pieces.** Extend the existing draft and income-evidence work with protected purpose-bound family/person/source projection. Batch only indispensable missing facts and reuse eligible existing evidence. Verify the accepted certification and exact assembled bytes before separately enabling a permitted delivery and account-status/follow-up route.
4. **PGW, water, urgency and combined needs.** Apply the proven shared flow to their distinct fields, protected entry, declarations, channels, receipt/status semantics and necessary financial choices. Keep outcomes separate under one household view. Urgent official help must remain available without optional preparation or account creation. Never claim a shutoff hold from a draft or unverified request; show protection only with actual applicable provider evidence.

The first reuse piece must fix the complete boundary: the existing inserted-intake trigger stamps values as newly supplied, and request retention is tied to the target request. Naive copied prefill would refresh source dates and potentially extend retention. Server-validated lineage, source/version rechecks, pending-use invalidation and original deletion/expiry must work together before shipping. No speculative general profile/connector platform is needed.

Tests must cover ownership and school-role denial, unsupported purposes, changed consent/grants, original dates/expiry, incompatible household/income definitions, source conflict/correction/deletion, stale or inaccessible evidence, wrong-account matching, duplicate/unknown delivery, cancellation/restart and immutable submitted history. Include full route integration, relevant browser/accessibility/language and rendered-PDF checks plus measured AI evaluations and family observation required by the PRD. Controlled tests prove software behavior only; real provider and outcome claims require their own authorized evidence.

## What the owner needs to supply, and when

No form research, field transcription, new server choice, repeat SNAP approval or manual routine processing is needed from the owner to begin the engineering pieces.

Before activating new data collection, present the exact WIC/utility information inventory, notice/purpose, processor exposure, retention and deployment changes for the applicable actual decision. Prepare the assessment and controls first; do not ask the owner for a blanket waiver or assume the old pilot scope expanded.

For real-route proof, a legitimate consenting family or agency-approved test case and any genuinely required account/delegation connection are still needed. The last owner record says no case was arranged. Do not require a special partner account merely because there is no public API. If a provider requires an organization agreement or credential connection, identify the exact requirement and prepare the setup before asking for the indispensable owner step. Use a secure connection for secrets, never chat. Paid sending/provisioning and live activation retain their actual approvals; no purchase/contact/submission is authorized by this assessment.

Family-owned acts remain with the family: informed mandate, indispensable unresolved facts, actual identity/authentication/certification, meaningful financial decisions and WIC specialist participation. AI prepares everything else and resumes automatically when the required act is complete. The owner does not sign or invent those acts for a family.

## Autonomy checkpoint

**Outcome proved here:** current code reuse gaps and public route contracts were assessed; no code, migration, live configuration, family record or provider submission changed. This is research/planning, not completed autonomous family support.

**Family work removed here:** none yet. The target is no repeat typing of compatible current facts, one informed mandate per actual scope, grouped necessary missing facts, background execution and owned follow-up. Proposed remaining prompts must each map to a real missing fact, new purpose/permission, required personal act or meaningful choice. Internal reviews and controlled receivers do not become permanent family steps.

**Routine work still done by people:** current engineering/research and unimplemented provider/status connections. Do not exclude those gaps from autonomy measures or hide routine operator submission/status checks. The next smallest implementation is provenance-preserving ordinary information reuse, independently reviewed before dependent WIC/PECO integration.

**Verification limits:** read-only local-code and current official-source research only. No new tests, current host-health/cleanup check, live applicant entry, provider contact, accepted delegation, real transport or actual appointment/agency/account outcome was performed.

Independent review found no remaining must-fix issues in the code/purpose/retention claims and separately cleared the simplicity/deletion pass. WIC and utility researchers checked the route descriptions against their inspected current sources. Utility review corrected the shutoff wording to allow protection supported by actual provider evidence. All 59 relative links across this record and its two referring documents resolve; the referring-document diff whitespace check passes. These are documentation checks, not product tests.
