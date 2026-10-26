# CaseLink parent support MVP PRD

**Decision date:** October 25, 2026 (America/New_York)
**Status:** Current product requirements; implementation pending
**Primary user:** An adult parent or caregiver seeking support for their own household
**Initial service area:** Philadelphia, subject to verified partner coverage
**Companion:** [Phased implementation plan](parent-support-implementation-plan.md)

This PRD supersedes the school case-manager product scope in `intervention-planning-prd.md`, `v1-service-definition.md`, and `product-redesign-plan.md`. Those documents and the school release evidence remain historical references. This document specifies the intended parent product; it does not claim that parent accounts, document uploads, agent tools, referrals, or background follow-up are implemented or approved for live use.

The case-manager baseline is preserved on `codex/case-manager-baseline-2026-10-25`, commit `700bb46`. Parent-product work starts from that baseline on `main`. Documentation changes do not deploy the product, change hosted permissions, migrate family records, or authorize contact with a partner.

## 1. Product decision and promise

CaseLink helps parents access **food support and utility assistance** through a short intake, AI preparation, a reviewed handoff, and continued follow-up. The parent is the account owner and decision-maker. Partners help deliver services and complete agency processes.

> Tell us what your family needs. We will find the right support, prepare your request, and help you through the next steps.

The desired experience is **enter information once → click Find my support → AI prepares → confirm facts and sharing → supported handoff → follow-up → recorded outcome**. Parents should not have to manage agents, write prompts, interpret a resource directory, or supervise routine research.

The system handles the coordination it can reliably execute. Parents still complete required identity checks, signatures, interviews, and appointments. Agencies determine eligibility and awards. CaseLink must describe the exact next action and must not promise benefits, available funding, uninterrupted utilities, or application submission without evidence.

### Confirmed decisions and remaining assumptions

| Item | Decision or evidence | Remaining work |
| --- | --- | --- |
| Product scope | Food support and utility assistance, directly for parents | Validate the experience with families |
| Existing resources | The product owner confirmed on October 25 that resources listed in the project are partners | Agree each launch program's intake route, accepted information, coverage, capacity checks, and update process |
| AI driver | GPT-6.1 Sol, model ID `gpt-6.1-sol`; already the local default | Verify the deployed API project's access, configuration, cost, latency, and task quality |
| Geography | Philadelphia is the initial planning assumption, consistent with the supplied catalog and existing directory | Confirm supported ZIP codes per program before recruitment |
| Identity | Proposed MVP default: verified email code with a resumable account | Test email access with parents in Phase 0; if phone-first identity is required, select and verify that method before implementation; do not build two auth systems speculatively |
| Language | English and professionally reviewed Spanish core journeys are the proposed initial coverage | Confirm partner language support and translation reviewer before advertising either language |
| Revenue | Parents are the primary users | Pricing, sponsorship, and payer are unvalidated; payment is outside this MVP |

The supplied Parent University catalog is discovery evidence about family needs, rather than proof of product demand or willingness to pay. The [October 15 directory review](verification/2026-10-15-resource-source-review.json) is dated evidence, not a current capacity check. It did not identify a dedicated immediate-food provider from the exported names/descriptions; the launch team must verify that route with the partner network.

## 2. Goals, boundaries, and release definition (P-01)

### Product goals

1. Help a parent reach a useful, verified next action with minimal typing and reading.
2. Reuse confirmed household facts across food and utility requests without asking twice.
3. Prepare the correct handoff and carry it through acknowledgement, next steps, and an outcome.
4. Make pending work resumable after closing the page, a network failure, or an agency delay.
5. Preserve parent choice, factual accuracy, privacy, and clear responsibility throughout the journey.
6. Measure completed actions and actual access to support, along with the human effort needed.

### Required for the closed pilot

- One adult account owns one household; a household can have separate food and utility requests.
- A small, reviewed set of existing partner programs covers both journeys: one agreed food-benefits preparation/handoff path and one utility-assistance path must pass the launch rehearsal, alongside a verified immediate-food contact route. Detect other application/renewal/problem intents, but use a reviewed partner-assisted handoff until each additional automated path is verified.
- Both journeys support minimum intake, AI preparation, parent review, a working handoff, evidence-based progress, recovery, and a recorded outcome or unresolved closure.
- Utility bill/notice photos and supported PDFs can reduce typing, with manual entry available for every required field.
- An operator exception queue and an agreed partner receipt/update process provide the human completion path. Build a minimal authenticated partner referral view only if the selected secure transport requires one; a separate partner portal is not a launch requirement when an approved existing route supplies the same controls and evidence.
- Email account messages and opt-in support reminders use verified delivery infrastructure. SMS is a later addition unless Phase 0 establishes it as necessary for pilot access.
- A parent can download a readable preparation summary; PDF is an optional supporting artifact, not the definition of success.
- The verification and operational gates in Sections 16–18 are satisfied before real parent data or referrals are enabled.

### Outside this MVP

- Job applications, standalone budgeting, meal planning, parenting advice, attendance routines, test preparation, device repair, events, and school operations.
- Rent assistance, housing search, eviction case management, clinical advice, or legal representation. Existing partners can receive an appropriate human escalation, with consent.
- District analytics, a general case-management suite, multiple caregiver collaboration, child accounts, payments, or a public partner marketplace.
- Universal browser automation, arbitrary blank-form detection/filling, autonomous signatures, or automatic government application submission.
- Bank, EBT, or utility account credential storage; broad mailbox access; autonomous calls; unrestricted agent browsing or code execution.
- Reusing school records as parent-owned data or giving existing school administrators access to parent households by default.

### Pilot versus broader launch

The closed pilot is a supported service for approximately 15–20 consenting households, with a named operator and controlled partner routes. Each journey must have at least five pilot requests before making a journey-specific adoption claim. External response times may exceed the recruitment period; continue follow-up through a known outcome or explicitly unresolved closure.

Broader self-service launch requires the pilot review, acceptable support burden, dependable partner acknowledgement, approved data handling, and the release evidence. A working prototype or passing build is not that evidence.

## 3. Users, ownership, and access (P-02)

| Actor | Permitted work | Access boundary |
| --- | --- | --- |
| Parent/caregiver | Maintain their household; start requests; confirm extracted facts; approve sharing; receive updates; cancel and request deletion | Their household and its requests only |
| Partner worker | View a consented referral packet; acknowledge receipt; request information; record disposition | Specifically assigned referrals and approved fields; no general household, school, or unrelated partner access |
| Service operator | Resolve failed work, arrange human handoffs, maintain program records, support parents | Operational metadata by default; documented, time-limited, audited access to necessary content when support requires it |
| Platform administrator | Manage service configuration and role assignment | Administration does not imply routine access to household documents or narrative |
| AI coordinator/tools | Prepare or execute permitted work for the request | Server-scoped household/request context; the model cannot select another household or grant itself access |

Use server-controlled membership and role records. Never authorize from user-editable metadata. All reads, mutations, uploads, callbacks, exports, and worker actions enforce the same household/referral boundaries. A worker's privileged infrastructure credential is not blanket authority to read every household.

Single-parent ownership is the initial model. Recovery must not reveal whether an unrelated household exists. Parent accounts cannot use legacy staff invitations, administrator privileges, school assignment RPCs, or password-only session assumptions as shortcuts to authorization. Interactive operations require a current authenticated session. Background work uses a stored, scoped service authorization rather than the parent's browser token, and rechecks account status, ownership, cancellation, and relevant consent before resuming or sharing. Signing out does not cancel saved work; stopping work, revoking consent, account deletion, or disabling the account does.

## 4. Parent experience and intake (P-03)

### Public entry and first use

The public page explains the two supported needs, geography, AI involvement, parent control, and how to reach human help. The dominant action is **Get support**. Parents can view verified urgent contacts without creating an account. Do not store sensitive guest intake in browser persistence.

The authenticated product has three primary surfaces:

1. **Get support:** choose Food, Utilities, or both and complete a short adaptive intake.
2. **My support:** current requests, honest status, and the next action; no analytics dashboard or caseload list.
3. **Request detail:** prepared options, review, shared information, activity, documents, and outcome, shown as needed.

**My household** is a secondary settings surface for confirmed facts, safe contact preferences, consent, and deletion. A partner receives only the approved referral through its agreed route; when CaseLink hosts a referral view, it is limited to the assigned packet. An operator sees an exception queue with age, urgency, owner, and next follow-up.

### Intake requirements

| Information | When requested | Rule |
| --- | --- | --- |
| Need and urgency | First screen | Food today, upcoming need, shutoff notice, already disconnected, or ordinary bill help; missing detail does not hide urgent contacts |
| ZIP code and language | Common intake | Explain geography use; unsupported areas get an honest handoff |
| Household size and relevant age bands | When a program needs them | Avoid collecting children's names or full birth dates for initial matching |
| Approximate income and frequency | When it changes the route | Allow Not sure; separate an estimate from verified application information |
| Existing benefits or active applications | Food flow | Distinguish new application, renewal, missing information, and existing-benefit problems |
| Utility provider, bill/notice, and account-holder relationship | Utility flow | A photo can supply suggested values; manual entry and Not in my name remain valid paths |
| Contact and safe reminder preference | Account/save or handoff | Verify destination; sharing a phone or email requires a safe-message choice |
| Exact identity/application fields | Only for a selected supported handoff | Explain purpose and recipient; collect the minimum approved fields at that point |

Show one small group of questions at a time, save authenticated changes, and preserve work on retry. Reuse previously confirmed facts with a visible edit option. Do not require every potentially useful intake field before showing a route: ask a question only when it changes the recommendation or the next supported action, and collect exact handoff fields after route selection. If both needs are selected, create linked but independently progressing food and utility requests from shared intake.

The primary button **Find my support** starts a saved job. A repeated click returns the existing active job for the same request/revision. Show real stages such as Checking requirements or Preparing your request; do not animate fictitious completion percentages. Closing the page does not cancel saved work. The parent can explicitly stop further work.

## 5. Food support journeys (F-01, F-02)

### F-01: Immediate food access

1. Identify urgency and practical constraints, including travel, pickup times, language, and delivery needs where relevant.
2. Show a small number of reviewed partner options with their actual service area, contact route, requirements, and verification date.
3. Clearly distinguish published hours from confirmed current availability. Unknown capacity remains unknown.
4. Offer the supported next action: call, request a callback, prepare a referral, or arrange a verified pickup through an agreed tool.
5. Track whether the parent contacted the service, received an acknowledgement, and accessed food. Provide another reviewed route or human assistance after a failed route.

Urgent access is independent of benefits preparation. Do not delay showing help while generating a plan, collecting optional documents, or waiting for an AI answer. If no current food provider is confirmed, say so and present the verified human assistance route; do not invent an available pantry, pickup slot, or delivery.

### F-02: Benefits preparation and follow-up

Phase 0 selects the first automated benefits path with the launch partner, such as preparation for a new SNAP application. The journey below is the common contract; renewal, pending-information, existing-benefit, and WIC paths may initially use partner-assisted preparation and follow-up. Do not advertise a specialized application connector or automated renewal until that exact path passes its rehearsal and tests.

1. Determine whether the parent wants to apply, renew, complete a pending request, or resolve an existing-benefit problem.
2. Identify potentially relevant SNAP/WIC routes using maintained program facts. Explain relevance without deciding eligibility or rejecting a parent based on incomplete answers.
3. Keep the official apply option available; a preparation checklist must not become a gate that delays starting a SNAP application.
4. Assemble confirmed information, a source-backed preparation checklist, missing questions, and an understandable next step.
5. After review, send an agreed partner referral or hand the parent to the official process. Preserve the return path and their preparation summary.
6. Support required interviews/appointments and additional-information requests with reminders, explanations, and partner assistance.
7. Record submission evidence, agency decisions, and benefit access separately. If the route fails, explain the known reason and prepare a reviewed alternative or human handoff.

A WIC pre-application/request for an appointment is not an approved WIC enrollment. A referral to a benefits navigator is not a submitted SNAP application. Do not treat an existing SNAP application as a reason to start another one automatically.

## 6. Utility assistance journeys (U-01, U-02)

### U-01: Understand the bill and urgency

The parent selects a provider or uploads a bill/notice. Extract only the allowed fields: provider, relevant account reference, service address when needed, balance, bill date, due date, shutoff date, and account-holder relationship. Retain where each value came from and whether the parent confirmed it. Display masked account references after confirmation.

The parent must confirm amounts, dates, provider, and any intended identity fields before they enter an external packet. Ask the parent about account-holder relationship when it is not explicit; do not infer a relationship from a name match. Unreadable text, multiple amounts, ambiguous dates, an absent shutoff date, or conflicting pages generate a targeted question; the model must not choose silently. A due date is not a shutoff date. No-income and variable-income cases have explicit paths.

Already disconnected, imminent shutoff, or a safety/medical concern immediately exposes verified provider/human help alongside preparation. An application or referral must never be described as stopping shutoff without applicable provider evidence. Account not in the parent's name, unsupported providers, and disputed bills route to partner review rather than a fabricated application.

### U-02: Prepare and pursue assistance

Use provider-specific programs and approved partner routes. Phase 0 selects the first rehearsed utility path, such as UESF utility assistance or the existing water-assistance route. Additional providers/programs remain a reviewed human handoff until their own path is verified. Do not conflate the directory's water Customer Assistance Program with PECO CAP or another similarly named program.

Prepare the relevant information and checklist, obtain review/consent, complete the supported partner handoff or official parent-led application, and track acknowledgement and subsequent requests. Check for an existing active application where the program requires one application per household. Avoid accepting payment arrangements, changing service, or making financial commitments on the parent's behalf.

Record whether assistance was granted, an account action was confirmed, service was restored, the request was declined, or the outcome remains unknown. These are distinct outcomes; the model cannot infer them from a sent message or elapsed time.

## 7. Partner programs and source evidence (R-01)

An organization can be a confirmed partner while a particular program's live capacity or digital handoff remains unverified. Preserve that distinction. The existing directory is the starting partner network, not an automatic claim that every listed program fits both needs.

Each enabled launch pathway requires a program record with:

- Stable program and organization identity; service type and geography; provider-specific identifiers.
- Maintained eligibility guidance, required documents, application methods, languages, accessibility, operating hours, and urgency route, including explicit unknown values.
- Official source URL/document, effective date when available, fact-level last-reviewed date, reviewer, and version.
- Agreed partner recipient/transport, accepted fields/documents, permitted purpose, acknowledgement method, and update/escalation process.
- Named internal owner and partner contact stored in a restricted operational location.
- Capacity/funding status and its evidence, or Unknown; a website being reachable is not capacity evidence.
- Whether the route is enabled for research, preparation, referral, or application assistance. Disable external execution independently of directory visibility.

Program rules and handoff instructions are reviewed before pilot activation and after a source change or partner report. Proposed operating targets: weekly review of launch instructions and hours; recheck urgent contact/hours within 24 hours before representing them as recently checked. These checks do not assert live stock, funding, or appointments. An unavailable source or overdue review must produce an honest uncertainty state and human route.

AI may research approved official domains and propose record updates. A named resource owner reviews material changes before they alter external-action behavior. Search queries contain only non-identifying routing context. Never send parent names, account numbers, private bill text, or contact details to public search.

## 8. Agent behavior and authority (A-01, A-02)

### A-01: One coordinator with two playbooks

Use GPT-6.1 Sol (`gpt-6.1-sol`) through the Responses API as the initial coordinator. Start with medium reasoning effort and evaluate cost, latency, and usefulness on this workload. Preserve the requested model; any later model change requires a recorded evaluation and release decision.

The current app already has model routing, schema validation, usage limits, privacy checks, and source grounding. Reuse those protections while introducing the tool-capable execution path. One coordinator loads the food or utility playbook and calls narrowly defined tools. The MVP does not require independently deployed agents or a general agent platform.

| Tool capability | Automatic work | Required boundary |
| --- | --- | --- |
| Read household/request facts | Load the minimum permitted context | Server derives ownership from the live actor/request; ignore model-supplied ownership claims |
| Search program records and official public sources | Find and explain relevant routes | Approved domains, source provenance, no private search queries |
| Extract supported documents | Suggest allowed values from a consented upload | Restricted file processing; parent confirmation; missing fields remain unknown |
| Prepare a packet or summary | Draft structured content and a readable review | Schema and semantic validation; preserve confirmed parent edits |
| Save progress and arrange reminders | Record validated preparation; schedule consented messages | Scoped writes; version checks; contact consent and quiet hours |
| Send a partner referral | Execute an already approved packet through an enabled route | Exact approval, current authority, destination verification, duplicate prevention, and durable receipt |
| Read partner updates | Attach authenticated, scoped evidence and propose next steps | Verify actor/callback, referral scope, event uniqueness, and evidence strength |
| Escalate | Prepare an exception for a named human | Share only approved information; present urgency immediately to the parent |

Use structured outputs and tool schemas, bounded turns, request/tool budgets, and server validation. Calculate dates, parse supported fields, check ownership, and enforce consent using deterministic code. Independent public lookups can use asynchronous tools; the job runner remains responsible for execution and recovery. Never treat asynchronous model calls as a scheduler that survives for days.

Retrieved pages, uploaded documents, and partner prose are untrusted data. They cannot grant permissions, change recipients, override instructions, request secrets, or authorize additional tools. Tool errors remain visible; a failed AI call must not become a fabricated successful result or an invented generic referral.

### A-02: Parent review and external action

The first button authorizes research and preparation within the stated data-processing consent. It is not blanket permission to share information with partners.

Before a referral, show the parent the recipient/program, purpose, exact fields and documents, confirmed facts, unknowns, and requested action in plain language. Bind approval to the parent, request, packet version/hash, recipient, purpose, action, and expiry. A material edit, different recipient, expired approval, revoked consent, or changed document invalidates approval. Read-only research and drafting do not need repeated confirmation.

The executor rechecks approval and live authority immediately before a side effect. Atomically bind approval to one logical external operation and its stable idempotency key; safe retries continue that operation rather than consuming another approval or creating another referral. A consumed approval cannot authorize a different operation. If delivery has an unknown outcome, reconcile the original attempt before retrying; if the transport cannot establish a safe retry, create a human exception rather than sending again. Cancellation/revocation stops queued work and future sharing; explain when an in-flight or previously delivered packet cannot be recalled.

Government submissions, signatures, required attestations, account authentication, and financial commitments remain parent-led in the MVP. An approved partner may assist through its own authorized process. Adding a specific submission connector later requires separate route verification and testing; the model's computer-use capability does not establish provider permission or integration access.

## 9. Durable execution, states, and evidence (W-01, W-02)

### W-01: Work continues without an open browser

Persist a request before starting work. Use durable execution for research, preparation, waits, updates, bounded retries, and reminders. Save step results and stable identifiers, resume after crashes/deployments, and permit cancellation. Keep sensitive payloads in protected data storage rather than copying them into workflow histories, URLs, or traces.

Use the existing Next.js/Supabase/Responses stack. Vercel Workflow is the preferred candidate for durable orchestration, subject to a synthetic integration and data-handling spike. Reuse direct Responses calls inside steps; do not add a second AI gateway, agent framework, or queue unless the spike proves it necessary. Record the runtime decision in Phase 0.

Each external operation has a stable idempotency key, bounded retry policy, timeout, and reconciliation path. Authenticate callbacks and reject replay. Source/packet version changes require replanning affected work, not silently replacing confirmed information. Concurrent parent edits and resumed jobs must detect stale revisions. A successful food request never closes an unrelated utility request.

Proposed request states: Draft, Working, Needs information, Ready for review, Waiting, Needs human help, Closed, Cancelled, and Recoverable failure. These are product states; final schema names may follow existing project conventions. State transitions require a valid actor and evidence. Pending time does not imply rejection or completion.

### W-02: Distinguish progress events from service outcomes

| Event or outcome | Minimum evidence | Parent-facing meaning |
| --- | --- | --- |
| Prepared | Validated saved packet | Ready to review; nothing has been sent |
| Referral sent | Transport acknowledgement tied to the approved packet | Sent to the partner; acceptance is still unknown |
| Partner received | Authenticated receipt acknowledgement or audited operator-confirmed receipt | The partner has received the packet; agreement to assist is still unknown |
| Partner accepted | Explicit authenticated partner acceptance or audited operator-confirmed acceptance | Partner has agreed to assist; this is not an agency application or an award |
| Agency application submitted | Agency confirmation or clearly attributed parent/partner report | An application was submitted; decision is pending |
| More information needed | Attributed partner/agency request | Specific next action and known deadline |
| Assistance approved | Attributed agency/partner decision or clearly labeled parent report | Assistance was approved; actual payment, food access, or service restoration is still unknown |
| Support received | Attributed evidence or clearly labeled parent report of food/benefits accessed, payment applied, or service restored | The particular service outcome has occurred; preserve which outcome and when |
| Declined/unresolved/withdrawn | Attributed reason or explicit parent/operator closure | Preserve the reason and offer an appropriate next route |

Maintain evidence origin, timestamp, verification status, and the affected request/referral. Display Parent reported when independent verification is absent. Distinguish a message sent from partner receipt, receipt from acceptance, approval from receipt of support, and each from closure. AI can explain or extract an update; it cannot manufacture authoritative evidence or promote a parent's estimate into an agency decision. Each started or waiting request has a named next-action owner and a follow-up date; reaching that date triggers a follow-up or exception, never an inferred decision. Drafts do not require a parent-entered deadline.

## 10. Documents and optional exports (D-01, E-01)

Initial inputs: JPEG/PNG photos and readable PDFs of utility bills, notices, or agency responses. Proposed limits are 10 MB and five pages per document. These are implementation targets, not current capabilities; verify them in the processing spike and expose actual supported limits accurately.

Validate actual file type, size, page count, and encryption state on the server. Use private storage, malware/file-processing controls, isolated bounded rendering, and short-lived authorized downloads. Do not execute active content or embedded instructions. Reject unsupported/encrypted/corrupt files with a manual-entry route. Do not cache documents in service workers, localStorage, IndexedDB, analytics, or public URLs.

Store extraction suggestions separately from parent-confirmed values. The parent can correct or discard a suggestion without losing their request. Raw files may include identifiers not needed for matching: isolate extraction, redact unnecessary values, and send only the approved minimum to subsequent reasoning tools. A separate consented provider-processing path is required before real uploads are enabled; do not remove the existing outbound identifier guard globally.

The parent may preview/download a preparation summary or approved handoff packet. Reuse the current PDF renderer and revision checks after adapting the content. Export only the selected, reviewed information; exclude internal notes, hidden analysis, unrelated requests, and unapproved contacts. Material changes invalidate the previous preview/approval. Preserve readable black-and-white printing, Unicode/language handling, page breaks, and exact confirmed amounts/dates.

No arbitrary uploaded blank-form mapping is required. A future known program template can be added only with a reviewed field map and source-to-field verification.

## 11. Privacy, consent, and separation from school data (D-02)

Parent support requires a new data purpose and trust boundary. De-identified school-pilot permissions and notices are not a parent-data consent mechanism. Use a separate parent-production environment/database and synthetic staging unless a documented isolation design is explicitly selected and tested. Existing school records stay in the legacy environment; parents do not inherit them and school staff do not inherit parent access.

Collect only information required for an active step. No SSN, EBT PIN, account password, or identity-document vault is part of this MVP. Where an official application requires such information, the parent provides it directly to that approved process. If an uploaded bill/response accidentally contains prohibited values, mask/restrict them and follow the documented handling/deletion procedure rather than persisting them as general request context.

Consent is separate for account/service processing, document extraction by named processing vendors, partner-specific sharing, and optional notifications. Explain how AI is used, how to correct a result, who receives data, how long it is retained, and how to request deletion. Parents can use manual entry and human help if they decline optional extraction. Refusing reminders does not block service access.

### Proposed retention defaults for the parent service

The privacy owner must approve and engineering must implement this schedule before real data is enabled. These are proposed parent-product defaults, not claims about existing provider settings.

| Data class | Proposed limit | Required control |
| --- | --- | --- |
| Raw bill/notice uploads | Delete within 24 hours after confirmed extraction unless the selected route needs the original; unconfirmed uploads expire after 7 days | Automated cleanup and abandoned-upload cleanup. A needed original is explicitly designated for a parent-approved handoff, with a visible justified expiry; expiry invalidates any packet referencing it and triggers re-upload or manual recovery rather than sending a broken attachment |
| Confirmed household facts, requests, and shared packets | Active service plus 90 days after closure, or earlier verified deletion request | Parent correction/deletion; specific legal holds only; avoid indefinite household profiles |
| Consent, delivery, and security evidence | 365 days, minimized to necessary identifiers/hashes | Restricted access; exclude raw document/prose content; approved legal/privacy schedule |
| Application/usage logs | 30 days | Metadata allowlist, redaction tests, no prompts, documents, authentication tokens, contact values, or complete provider responses; aggregate usage/token counts are permitted |
| Backups | Expire within 30 days after source deletion | Restricted restore, deletion reapplication after restore, documented backup limits |
| AI/vendor-held data | Contractually reviewed per feature | `store: false` does not establish zero provider retention; verify actual service retention and regional processing |

Document access uses household/referral authorization on every download and short-lived links. Approval/consent and file lifecycles must be traceable. Account deletion stops jobs/reminders, revokes future partner access, removes eligible data, and explains separately retained minimal evidence or already delivered third-party copies.

## 12. Partner handoff and human recovery (H-01)

Select one primary secure transport for the first partner routes. Prefer an existing approved API or secure partner workflow when it supports the required consent, recipient restriction, receipt, and updates. Otherwise use a minimal authenticated referral view plus a content-free notification, subject to partner agreement. Choose one implementation for the pilot rather than building alternatives in parallel. Do not invent APIs, assume email attachment acceptance, or build a full partner CRM.

When CaseLink hosts the packet, a partner recipient authenticates and sees only the assigned packet. A notification link alone must not reveal household content. Support receipt acknowledgement, request information, accepted/declined, and outcome updates with reason and attribution through the selected route. Partner staff access must be revocable and updates auditable. A person at the service may record a verified phone response, with actor/time/source; that remains an operator-confirmed event. Automatic status polling is required only where the agreed transport supplies it; the pilot may use operator-confirmed partner updates with a documented follow-up owner and target.

Before activation, name an acknowledgement target, staffed hours, escalation owner, and fallback for each route. These are agreed operational targets, not AI-generated promises. If a partner does not respond, the system creates an owned exception and shows a truthful update. Urgent cases present the verified phone/human route immediately; they do not wait for an unstaffed queue or pretend to be monitored around the clock.

## 13. Notifications and returning use (N-01)

Use a verified destination, explicit opt-in, safe preview preference, quiet hours, and opt-out. Account/security messages are separate from optional support reminders. Proposed reminder window: 9 a.m.–7 p.m. America/New_York; urgent behavior and any override require an explicit parent preference and operational review.

Messages say that a support update is available and link to authenticated content; they do not include benefit status, household income, bill amounts, documents, or account references in a lock-screen preview. Batch redundant reminders, suppress on cancellation/closure/consent withdrawal, and track delivery failures separately from partner or agency progress.

Following an official-site handoff, ask for confirmation or the resulting receipt; do not infer completion from opening a link. Returning parents see the next action and preserved progress. A deadline can come from a confirmed document or an explicitly chosen follow-up date; the AI cannot invent an agency deadline.

## 14. Data and architecture outline

Use the smallest schema that expresses the required boundaries. The following are logical records, not an instruction to create a separate table for every row. Reuse existing structures only where their ownership, purpose, and lifecycle fit.

| Logical record | Essential information |
| --- | --- |
| Household/membership | Adult owner, confirmed minimal facts, verification/source dates, contact preferences |
| Support request | Household, Food/Utilities, urgency, intake revision, current state, owner of next action, timestamps |
| Program/route | Partner identity, verified facts/sources, rules version, accepted fields, enabled capabilities, contact/escalation configuration |
| Prepared packet | Request, immutable version, confirmed facts, missing fields, selected route, source references, document references |
| Consent/approval | Actor, purpose, exact recipient/action/packet version, expiry, revocation, bound logical operation |
| Referral/operation | Approved packet, stable operation/idempotency key, attempts, receipt, acknowledgement, unresolved-delivery state |
| Document/extraction | Private object reference, validated type, expiry, suggested and confirmed values, processing consent |
| Job/event/outcome | Request-scoped work state, durable step IDs, attributed progress evidence, outcome and reason |
| Notification/exception | Consent reference, destination reference, schedule, delivery state, escalation owner and resolution |

Retain Next.js, React, Supabase, server-side Responses, and current PDF libraries. New infrastructure is limited to verified durable execution, private document processing, and transactional support messaging. Credentials stay server-side in the narrow runtime that needs them. Workers use scoped application operations and current authorization; service-role credentials must not appear in the browser or ordinary web deployment.

The existing `CASELINK_INVITE_ONLY`, single-school posture, password-session checks, staff invitations, and deployment-boundary tests need explicit parent-mode replacements in a new environment. Do not disable those safeguards in the school deployment. Read the installed Next.js guidance before framework changes and current vendor documentation before integration work.

## 15. Usability, accessibility, and service targets (X-01, M-01)

Use plain parent language, short screens, one clear primary action, labeled optional fields, and visible recovery. Avoid terms such as intervention plan, caseload, model, prompt, tool call, or agent orchestration in the parent interface. Show why a question matters where it might feel intrusive.

Target WCAG 2.2 AA: keyboard operation, labels and associated errors, sensible focus and recovery, live progress announcements, contrast, screen-reader status, 200% zoom, and reflow at 320 CSS pixels. Test the full phone journey, slow connections, interrupted uploads, and shared-device sign-out. Language coverage includes account emails, errors, review/consent, partner limitations, and PDFs, not only marketing copy.

The following are initial pilot targets, not measured performance or public guarantees:

| Measure | Definition / proposed target |
| --- | --- |
| Intake usability | At least 80% of observed pilot parents complete minimum intake without operator help in 3 minutes or less, excluding verification delivery time |
| First useful result | p95 of synthetic representative preparation jobs within 60 seconds under the declared pilot load; urgent contacts are shown independently of AI |
| Job visibility | Saved work shows a current stage; stalled work is detected and offered recovery within the documented job deadline |
| Journey progress | Track the share of started requests reaching a completed external action within 7 days, by journey and route; review reasons rather than hiding failures |
| Service outcomes | Food accessed, application submitted, appointment completed, award/assistance received, declined, withdrawn, and unknown, with evidence origin |
| Parent effort | Questions asked, repeated information, correction rate, abandonment, and need for operator help |
| Service cost | Model/tool/messaging cost and operator minutes per request and per successful handoff; exclude private content from measurement |
| Trust | Zero observed unauthorized sharing, cross-household reads, fabricated program details, or false submission/award claims; any occurrence stops the affected rollout |

Count one started authenticated request per support journey; selecting both creates two requests and one household. Report denominators, pending duration, unknown outcomes, and manual support. No growth or outcome claims should be based only on preparation completion or a small pilot without disclosing the sample.

## 16. Verification and acceptance (V-01)

Every non-trivial logic change includes a runnable regression test. Extend the existing test harness; do not replace database authorization, accessibility, AI-quality, or PDF checks with compilation. Synthetic data is required for automated tests and provider experiments. Exercise the selected transport and advertised languages; do not build a callback endpoint, partner portal, or extra connector only to satisfy a hypothetical test row.

| Layer | Required evidence before the relevant phase ships |
| --- | --- |
| Unit | Intake branches, state/evidence rules, document field confirmation, date/amount handling, approval expiry/invalidation, cancellation, idempotency, notification suppression |
| Database/Auth | Real parent A/B and selected-route partner/referral isolation, legacy staff denial, admin/operator restrictions, interactive session checks and background revocation, ownership reassignment denial, direct RPC/storage access, concurrent writes, deletion and rollback |
| Integration | Tool scope and malformed outputs, durable waits/restarts, transport timeouts and reconciliation, signed/replayed callbacks if used, stale packet changes, approval bound to one operation across retries, duplicate external attempts, upload cleanup and expired packet attachments |
| End to end | Both complete parent journeys from signup to outcome; combined needs; close/reopen and sign-out while saved work continues; interrupted jobs/uploads; expired interactive session; correction/reapproval; partner receipt and acceptance; approval versus received support; failure and human handoff; opt-out and deletion |
| Accessibility | Automated scans plus keyboard/screen-reader critical paths; phone widths, zoom/reflow, translated labels/errors, status announcements and file alternatives |
| AI evaluations | At least 40 reviewed synthetic cases (20 per journey), including combined needs, uncertain income, source conflicts, unreadable notices, existing applications, urgent needs, Spanish cases, and unsupported services; require source fidelity, correct question/route, parent-edit preservation, honest unknowns, and no unauthorized action |
| Adversarial | Injected instructions in files/pages/messages, fake contacts, substituted recipients, private-data search attempts, malicious files, unauthorized IDs, misleading receipt text, callback forgery, replay, budget exhaustion, and cross-household tool calls |
| PDF/visual | Source-to-export values and rendered pages for long/multilingual content, amounts/dates, selected recipients, revisions, no internal data, and no clipped or stale content |
| Hosted operations | Exact candidate's Auth/message delivery, real approved partner rehearsal, provider receipts, restore/deletion replay, cancellation, alerts, budgets, and rollback evidence |

Release-blocking failures include any unauthorized disclosure, bypassed approval, invented contact/eligibility/availability, false submitted/approved claim, lost parent correction, duplicate referral under retry, or unowned urgent exception. AI evaluation also requires partner/domain review of usefulness; schema-valid JSON alone is insufficient. Version prompts, playbooks, program facts, model settings, and the evaluation corpus with each release.

## 17. Launch and operational gates (O-01)

The service owner, engineering owner, privacy/security owner, resource owner, and partner contact must be named in a restricted release record. One person can fill multiple internal roles; none can be left implicit. Before real parent intake:

- Both journey routes have reviewed facts, an agreed transport, accepted fields, staffed acknowledgement/escalation, and a rehearsed fallback.
- Immediate-food coverage and urgent utility routes have been confirmed; the UI accurately describes staffing hours and availability uncertainty.
- Parent identity, membership, private documents, consent, scoped partner access, and live revocation have passed real Auth/RLS/storage tests.
- The proposed retention/deletion schedule, vendor processing, disclosures, and consent are approved and implemented. Legal/privacy review determines applicable duties; do not assume the prior school policy applies or that a generic compliance label proves approval.
- A separate parent environment, synthetic staging, backups/restore, protected secrets, workflow-data handling, messaging, budgets, failure alerts, and on-call ownership are verified.
- Both end-to-end journeys and the full relevant verification matrix pass on the exact release candidate; rollback does not expose legacy school records or reverse destructive migrations.
- Public copy and legal pages describe deployed capabilities truthfully. Support received, partner accepted, agency submitted, and parent reported remain distinct.
- Pilot recruitment, consent/support script, measurement definitions, and stop conditions are ready. A pilot decision is recorded separately from general launch.

Operational alerts cover stuck jobs, overdue partner acknowledgement, unknown delivery outcomes, notification failure, document cleanup failures, source staleness, unusual authorization denial, and spend. Alert payloads contain opaque IDs and safe metadata. A repeated failure creates an owned exception; it does not silently retry forever.

## 18. Decisions to close during Phase 0

| Decision | Accountable role | Launch consequence |
| --- | --- | --- |
| Exact food/utility routes and immediate-food coverage | Service/resource owner with partner | No route activation without an agreed, verified path |
| Accepted packet, transport, acknowledgement and escalation target | Partner and engineering owner | No live referral sending until the complete handoff is rehearsed |
| Parent email access versus phone-first identity | Product/engineering owner | Select the initial verified channel before changing auth policies |
| Data purpose, vendor handling, retention, deletion and safe contact | Privacy/security owner | Synthetic-only processing until the controls and disclosures are ready |
| Parent/legacy separation and durable runtime | Engineering owner | Prove isolation, scoped worker authority, restart/retry behavior, and sensitive-data handling |
| English/Spanish coverage and reviewer | Product/resource owner | Advertise only tested, supported language coverage |
| Pilot targets, operator coverage and affordable service cost | Service owner | Set the staffing and cost boundary before recruitment |

These decisions do not require a new product strategy: the two workflows, parent ownership, Sol 6.1 driver, and existing partner network are already selected. Implementation can proceed on independent synthetic work while external operational details are resolved.

## 19. Sources and implementation baseline

Official sources reviewed for the October 25 planning conversation; recheck program facts when enabling a route. The sources support process boundaries, not a promise of live capacity or account-specific eligibility.

- [Pennsylvania SNAP applications and status](https://www.pa.gov/services/dhs/apply-for-the-supplemental-nutrition-assistance-program-snap): official application/status paths and agency eligibility determination.
- [Pennsylvania WIC appointment request](https://www.pa.gov/services/health/request-a-pre-application-appointment-with-a-wic-specialist): pre-application and specialist process.
- [UESF benefits access](https://uesfacts.org/i-need-help-with/benefits/) and [utility grants](https://uesfacts.org/our-programs/utility-grant-program/): partner service categories; capacity and individual eligibility need confirmation.
- [Philadelphia water assistance](https://www.phila.gov/services/payments-assistance-taxes/payment-plans-and-assistance-programs/senior-citizen-programs/apply-for-water-bill-customer-assistance/): program-specific application routes, document requirements, partner assistance, and no application materials by email.
- [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol): model/tool capabilities and Responses API requirement for tool calling.
- [OpenAI asynchronous tools](https://developers.openai.com/api/docs/guides/async-tool-calling), [search controls](https://developers.openai.com/api/docs/guides/tools-web-search#domain-filtering), and [computer-use environment controls](https://developers.openai.com/api/docs/guides/tools-computer-use-integration#restrict-the-environment).
- [Supabase private storage](https://supabase.com/docs/guides/storage/buckets/fundamentals) and [product security](https://supabase.com/docs/guides/security/product-security): access enforcement and private file handling.
- [Vercel Workflow concepts](https://vercel.com/docs/workflows/concepts): durable execution candidate; exact integration/version and data handling remain a Phase 0 spike.

Local inspection found staff-only signup, staff roles/password-session guards, browser-driven generation advancement, text-only AI request contracts, identifiers blocked before outbound AI, a school-oriented partner directory, and existing reviewed-plan/takeaway PDF infrastructure. These are migration inputs, not evidence that parent capabilities already work. The [implementation plan](parent-support-implementation-plan.md) maps them to phases and acceptance evidence.
