# CaseLink parent support MVP PRD

**Decision/revision date:** October 25, 2026 (America/New_York)
**Status:** Current requirements; implementation pending; autonomy and family-ready scope revision
**Primary user:** An adult parent or caregiver seeking food support and utility assistance for their household
**Initial service area:** Philadelphia, with program-specific coverage verified before launch
**Companion:** [Phased implementation plan](parent-support-implementation-plan.md)

This PRD supersedes earlier school-product requirements and the earlier preparation-first parent draft. The latest product-owner direction is to maximize useful AI independence from one informed start, involve people only when necessary, and deliver a polished product families can use across both support areas. The earlier one-benefits-path/one-utility-path restriction is an internal delivery slice, not the finished release scope.

These are requirements, not implemented capabilities or provider permissions. The existing code remains the staff-oriented application. Documentation does not enable real parent processing, contact partners, submit applications, or deploy changes. The school baseline remains on `codex/case-manager-baseline-2026-10-25` at `700bb46`; parent work proceeds on `main` without moving school records into parent ownership.

## 1. Product promise and definition of independence

> Tell us what your family needs. Let CaseLink find the best available support, handle the work it can, and keep you informed until there is an outcome.

After verified account setup and minimum intake, **one informed Start getting support action authorizes a bounded service**, including permitted research, document interpretation, program selection, preparation, sharing, submissions, scheduling, status checks, follow-up and alternative routes. A family can inspect the work and change preferences without having to approve every routine step.

The default journey is **describe the need / add available documents → authorize CaseLink → AI chooses and pursues supported routes → receive useful updates → participate only at a real decision or required personal step → record the outcome**. One click is the start of coordinated work, not a promise of instant agency approval or zero required participation.

An agent makes routine judgment calls from evidence and the parent's stated preferences. It can prioritize urgent work, choose among compatible programs, resolve consistent document facts, select an authorized partner, assemble a packet, execute an allowed action, respond with already authorized information, follow up, and change course after a failed route. It must not guess personal facts, conceal uncertainty, make an agency eligibility decision, or promise funding or service restoration.

A necessary human step is specific: the agent prepares everything else, explains why that person is needed, asks for the minimum action, and resumes automatically afterward. A human partner's legally required service role is distinct from a CaseLink operator manually doing routine work that should have been automated.

### Confirmed decisions and planning assumptions

| Item | Current direction | Remaining evidence |
| --- | --- | --- |
| Product | Direct-to-parent food support and utility assistance with maximum useful autonomy and a polished family-ready release | Parent usability, service completion and autonomy measurements |
| Partner network | The owner confirmed existing listed resources are partners | Per-program permissions, capacity uncertainty, transport and update contracts; partnership is not integration access |
| AI | GPT-6.1 Sol, `gpt-6.1-sol`, already the local default; Responses API for tools | Deployed access/settings, evaluations, latency and cost |
| Geography | Philadelphia first | Exact program/ZIP coverage and honest unsupported-area recovery |
| Identity | Proposed low-friction default: verified email code; test phone-first access with families | Select and support the actual launch channel(s), including recovery, before changing auth |
| Language | Proposed English and reviewed Spanish experience | Test all advertised language content, notices, help and partner coverage |
| Revenue | Parents are the users; sponsorship/payment model remains open | Pricing is separate from this service scope |

The Parent University catalog and [dated directory review](verification/2026-10-15-resource-source-review.json) inform discovery. Neither proves current capacity, demand or willingness to pay. Verify an actual immediate-food route; that earlier review did not identify a dedicated pantry from the exported names/descriptions.

## 2. Finished scope and release definition (P-01, C-01)

### Goals

1. Move from a family need to actual support or an honestly unresolved outcome with the least necessary family effort.
2. Reuse supplied facts and documents across relevant programs while honoring purpose, recipient and data permissions.
3. Let AI own routine coordination and supported execution, including follow-up and recovery; escalate genuine exceptions.
4. Provide a calm, complete, accessible product with dependable account, document, communication and return-use experiences.
5. Make autonomy, human intervention, service outcomes, errors and operating cost measurable by journey and route.

### Required coverage of the finished product (C-01)

| Need | Family journeys that must work | Completion contract |
| --- | --- | --- |
| Immediate food | Need food now/soon; practical pickup, travel, language and delivery constraints | Find verified options; arrange supported referral/pickup/contact; follow through to access or a staffed alternative |
| SNAP | New application, renewal, pending/missing information, routine existing-benefit notices/problems | Understand the intent; prepare and execute permitted steps; track interview/document requirements and outcome; qualified assistance for contested rights/eligibility |
| WIC | Relevant new enrollment, continuing/renewal support, appointment and document coordination | Prepare/request/book when permitted; support required specialist participation; distinguish appointment request from enrollment and receipt |
| Electricity | Bill affordability, arrears, assistance applications, threatened shutoff and disconnection | Supported provider/program routes, required evidence, permitted application/status work, urgent provider/partner assistance and verified account outcome |
| Gas | Bill affordability, arrears, seasonal assistance, threatened shutoff and disconnection | Provider-specific grants/affordability routes and the same complete follow-through contract |
| Water | Bill affordability, hardship/assistance application, threatened shutoff and disconnection | Correct water programs and submission routes; document/status assistance and account outcome |
| Combined needs | Food and one or more utility issues | Shared facts, compatible parallel work, separate approvals where required, independent outcomes, one understandable family view |

Create a capability matrix for the actual programs/providers in this coverage: automated actions, required personal steps, partner role, source/permission evidence, status channel and fallback. Families must have a real completion route for every advertised journey; some steps are legitimately provider- or parent-assisted. Do not call every action autonomous, or treat a link/referral as the finished service. A specialty dispute may need a qualified person while AI continues permitted preparation and coordination.

Select programs from the existing network by verified fit and practical coverage, rather than an arbitrary count. Complete broad service coverage through reusable tools and supported channels; do not require a bespoke API for every organization. An early vertical slice can cover one route while remaining internal. It cannot be presented as the finished family-ready product.

### Product boundaries

Food support and utility assistance remain the two product domains. Employment, standalone budgeting/meal planning, rent/housing search, school operations, clinical diagnosis, legal representation, payment processing, child accounts and district analytics are outside this release. Existing qualified partners can handle an appropriate escalation with permitted sharing.

Known-form completion, permitted application submission and tested browser assistance are in the product scope where an enabled route supports them. Unrestricted browsing, bypassing provider controls, signing as the parent, impersonation, unsupported claims of representative authority, and financial commitments without specific approval are prohibited. Agencies and authorized specialists retain their own decisions and required roles.

### Release versus pilot

The finished release includes all family-facing essentials and C-01 coverage, not just preparation or handoff. Use a closed 15–20-household supported pilot to learn and verify readiness; it does not shrink the finished scope. Each advertised capability needs relevant synthetic/partner rehearsals and representative pilot evidence. Small samples cannot establish universal outcomes or rare-event safety. Broader launch requires the complete coverage/readiness gates and an explicit release decision.

## 3. People, ownership and service authority (P-02)

| Actor | Responsibility | Access boundary |
| --- | --- | --- |
| Parent/caregiver | State needs/preferences, grant or limit the service mandate, supply indispensable facts and complete required personal acts | Own household, requests, mandate and activity; correct, pause, resume and delete |
| AI coordinator and tools | Make supported routine judgments, execute within the mandate, verify outcomes, resolve recoverable blockers and coordinate exceptions | Request-scoped server authority; cannot grant its own permissions or use unrelated household data |
| Partner worker | Deliver or assist with the program; provide genuine receipt/status/decision evidence | Assigned purpose and permitted packet fields through the agreed route |
| Service operator | Resolve genuine execution exceptions and provide owned support | Metadata by default; necessary content access is scoped, time-limited and audited |
| Platform administrator | Configure service and trusted memberships | No routine household-content access merely from an administrative title |

Authorize through server-controlled records, not editable metadata. Enforce household/referral boundaries on web actions, storage, exports, worker tools and updates. Parent identities must not inherit school staff/RPC access; school administrators must not inherit parent households. Account ownership alone does not authorize acting for another adult, an unrelated account holder or everyone living at the address. Establish the caregiver/account-holder relationship and any route-required representative permission using the least-friction evidence that route accepts; do not collect or share another person's sensitive information without the required authority.

Interactive actions require an authenticated current session. Background work uses a bounded service grant rather than a parent browser/refresh token, and checks active account/membership, purpose, mandate, cancellation and applicable action approval at execution. Closing the page, ordinary sign-out or session expiry does not cancel granted work. Explicit stop, consent withdrawal, account deletion/offboarding, a security hold or grant expiry prevents further affected actions. Stopping one request does not silently stop or authorize unrelated work.

## 4. End-to-end parent experience (P-03)

### Entry and intake

The public experience accurately explains the service, geography, AI role, control and human help. Verified urgent contacts are available without account creation or waiting for generation. Get support is the primary action. Sensitive guest intake is not persisted in the browser.

Account setup and recovery must fit the actual families' access patterns. The minimum intake asks only what changes the next action: need/urgency, ZIP/language, relevant household size/age bands, approximate income/frequency, current assistance/applications and utility provider/account context. Allow Not sure. Optional document capture can replace typing. Exact application fields are collected only for a relevant purpose. Do not require invented goals or parent-selected task dates.

Reuse parent-supplied and validated facts while they remain applicable. Track source, relevant household/person/account, effective period and last confirmation; stale income, household circumstances or old bill balances cannot silently become current application facts. Ask a missing question only after checking permitted existing information and sources; ask once and reuse the answer within its valid context. For both needs, maintain separate requests/outcomes under one household view. Verified immediate help remains available while jobs run.

### The informed start

Before Start getting support, use non-sensitive routing checks to show a short plain-language authorization summary, expandable detail and editable choices: needs pursued, individually named potentially relevant recipients/programs, data/documents allowed, types of actions, timing/preferences, duration and limits. Listing a program does not establish eligibility. Name the proposed recipients without making families choose the technical route or read the entire directory; AI selects among the authorized options. No hidden prechecked permission to share with unknown organizations. A parent may select preparation-only or narrower sharing, with an honest explanation of additional steps; the primary experience is the complete authorized service.

The same start action records the displayed mandate/version and starts saved work; do not add a redundant confirmation screen. Obtain understandable document-processing permission before the first upload/AI extraction, including when it helps fill intake before the service starts. Preparation may precede the service mandate only within that separate processing permission, with no program submission, partner sharing or other service side effect. Test that families understand what the start permits, where information can go, when they will be asked and how to stop it; fix comprehension problems in the explanation rather than adding routine approval clicks. Show actual milestones such as Checking options, Preparing applications, Request sent or Waiting for a response. Do not fabricate percentages or imply an external action completed because a model finished writing. Parents can leave; useful updates and jobs continue within their authorization.

### Returning and exception experience

Primary surfaces are **Get support**, **My support**, and **Request detail**. Household settings contain facts, safe contact preferences, authorization, documents and privacy controls. The family sees what AI has done, what is underway, any expected next contact and the next accountable actor. Detailed sources/activity are available without dominating the default screen.

A necessary-action card states the reason, why AI could not complete it, exactly what is needed, any actual deadline and one clear action. The agent pre-fills supported information and resumes afterward. Examples: supply one missing income fact, enter a one-time login code directly, sign an agency declaration, or choose between options with a real financial tradeoff. Do not send a parent into a generic chat to discover what is missing.

An unsupported channel still gets owned coordination and a useful recovery path. Human help is available by choice at any point. Lack of response is shown honestly and triggers authorized follow-up; the request does not vanish or auto-complete.

## 5. Food journeys (F-01, F-02)

### F-01: Immediate food

AI prioritizes urgent need, checks verified hours/access requirements and practical constraints, chooses useful available routes, and arranges permitted contact, referral, pickup or delivery where supported. It may try another authorized option after a closed/unresponsive route without asking the parent to restart. Published hours, current capacity and a confirmed reservation are distinct facts. Missing capacity is Unknown, not available or closed.

Show urgent verified contacts immediately. Do not postpone food access behind benefits paperwork, optional uploads or account setup. Track actual contact, acknowledgement, arrangements and food accessed. Where an urgent need cannot be met through reliable tools, alert the owned partner/service exception and keep the family informed; never imply unattended queues are staffed around the clock.

### F-02: SNAP/WIC and continuing assistance

AI distinguishes new enrollment, renewal, missing information, pending status and routine existing-benefit problems. It evaluates apparent program fit using current facts, chooses compatible routes within preferences, prepares known forms and documents, executes permitted submissions or partner assistance, tracks required interviews/appointments, answers routine information requests with authorized facts, and follows through to an attributed decision and receipt of support.

Support SNAP and relevant WIC journeys in the coverage matrix. Maintain program-specific requirements; WIC specialist participation is not replaced by an AI assessment. Do not invent eligibility, reject a parent from incomplete facts, restart an existing application automatically, or describe a WIC appointment request as approved enrollment. Resolve routine problems autonomously when facts and policy permit; disputed eligibility, appeals or legally consequential interpretation goes to qualified assistance with preparation already completed.

The official application option stays accessible. Preparation/checklists never delay the ability to start an application. When a provider requires a parent signature/attestation, identity step or interview, pause that part, prepare it, and continue independent authorized work. Submission is automatic only when the provider's channel, delegation and required personal acts allow it and server policy verifies the mandate.

## 6. Utility journeys (U-01, U-02)

### U-01: Read the bill, understand urgency and reuse facts

Accept manual input and supported bills/notices. Extract provider, allowed account reference, address where required, amount components, bill/due/shutoff dates and relevant context with field provenance. Match the account to authorized household information; do not infer an account-holder relationship solely from a name match.

The system can use unambiguous source-backed facts that pass semantic/cross-field checks within the mandate; it need not ask the parent to retype or approve each value. A model's self-reported confidence alone is insufficient. Resolve consistent facts using authoritative sources and preserved parent corrections. Calculations use tested deterministic rules with explicit units, income frequency and applicable period; a document total cannot be substituted for a different requested amount. Ask only when consequential facts conflict, evidence is unreadable/unavailable, a personal assertion is indispensable or a route requires confirmation. Show an editable summary of important facts without making routine review a mandatory stop.

A due date is not a shutoff date. Distinguish total balance from amount due and ambiguous date formats. No-income, variable-income, third-party account-holder and shared-household cases require explicit supported handling rather than a silent rejection. Immediate safety/medical concerns or disconnection expose the verified provider/emergency/qualified-human route at once while permitted preparation continues.

### U-02: Pursue help across electricity, gas and water

AI identifies provider-specific affordability, arrears, crisis/grant and seasonal options, checks active applications and compatibility, selects the best supported route(s), prepares known forms, sends allowed applications/referrals, supplies authorized missing documents, monitors available status and adapts after failure. Use the existing partner network and verified PECO/electricity, PGW/gas and Philadelphia water pathways needed by C-01; do not conflate water CAP with PECO CAP.

Parallel work is allowed where compatible and authorized. Prevent duplicate applications per the actual program rules and avoid uncontrolled mass outreach. Parent preferences, attempts and recipient limits constrain route changes. Account disputes, representation requirements or unsafe uncertainty receive a qualified owned exception; ordinary provider lookup, paperwork and follow-up remain AI work.

An application is not proof of a shutoff hold. Confirm account actions, grant decisions, payment application and restored service separately. AI may explain/compare a payment arrangement, but a binding repayment plan, fee, service change or other financial obligation needs specific informed parent approval. No autonomous payment or promise to pay is included in the standing mandate.

## 7. Program capabilities, permissions and fresh evidence (R-01)

Every advertised program has stable organization/program/provider identity, service area, relevant rules/documents/languages/accessibility, official sources/effective dates, verification owner/date/version, and known uncertainty. Partner membership, public website accessibility, eligibility guidance, live capacity and automation permission are separate facts.

Record capabilities at action level: research, preparation, referral, appointment request/booking, application submission, document supplementation, status retrieval, follow-up and outcome evidence. For each capability record the permitted channel, individually approved recipient, accepted fields/documents, authority/delegation evidence, required personal steps, status/receipt channel, limits and failure route. Modes include unattended permitted API/partner work, isolated browser-assisted work, prepared parent-required step and qualified partner action. An unavailable API does not automatically make the whole journey manual.

AI can check official sources, detect changed requirements and propose new routes. It may refresh ordinary factual information under the validated source/change policy. Material changes to provider permissions, destination, mandatory data, personal legal acts or execution rules need service-owner verification before route enablement. A model cannot authorize a new domain or recipient by discovering it. New recipients outside the family's mandate require that family's consent.

Proposed operating targets: review enabled instructions/hours weekly and after a reported/source change; recheck urgent contact details within 24 hours before calling them recently checked. Live funding, food stock and appointments require their own evidence. Overdue review or an unavailable source reduces certainty; AI tries an authorized verified alternative before escalating only the unresolved work.

Public search queries contain routing information only, never private names, contacts, account numbers or raw documents. Private operational agreements and contacts remain outside public Git.

## 8. Agent judgment, delegation and necessary intervention (A-01, A-02)

### A-01: Sol owns routine judgment and follow-through

Use `gpt-6.1-sol` through Responses for tool use. Start with medium reasoning effort and evaluate on complete journeys. Keep the server-side model routing, budgets, validation, safe errors, provenance and test harness. One coordinating agent with food and utility playbooks can call specialized research, document, execution and follow-up workers when that improves quality/latency. Add specialist agents by measured need; families never choose models or supervise delegation.

| Decision or work | Default behavior | Escalation threshold |
| --- | --- | --- |
| Prioritize urgent and compatible work | Choose sequence/parallelism from need, verified deadlines, program compatibility and preferences | Conflicting personal priorities or consequences outside the mandate |
| Select programs and recipients | Rank by verified apparent fit, urgency, practical accessibility and effort; pursue authorized useful routes | Required recipient/purpose outside the mandate, unresolved decisive eligibility facts or competing financial commitments |
| Interpret documents and reuse facts | Extract, reconcile consistent evidence, calculate validated values and retain provenance | Consequential ambiguity or a personal assertion that cannot be sourced |
| Prepare forms/requests | Complete supported fields and attachments, validate requirements, preserve corrections | Unsupported required field, prohibited data or required personal attestation |
| Execute submissions, referrals and scheduling | Use enabled provider-permitted channels within the mandate and stated availability/preferences | Provider-mandated personal act, identity/authentication, specific financial choice or out-of-scope action |
| Handle notices and missing information | Interpret supported notice types; send already authorized facts/docs; set evidence-based reminders | Legal/clinical judgment, conflicting facts, sensitive new data or an irreversible decision |
| Follow up and recover | Check real status, reconcile retries, adapt route, arrange permitted callbacks, continue to outcome | Unknown delivery that cannot safely reconcile, exhausted limits or a genuine specialist/safety need |

Record consequential decision basis: source/parent facts, options considered, selected action, applicable mandate/rule and result. Expose a plain-language activity summary, not internal chain-of-thought. Agent discretion is evidence-based; it cannot fabricate facts, decide official eligibility, redefine authorization, or interpret provider silence as a decision.

Use schemas and semantic checks at the tool boundary. Ordinary code enforces permission, purpose, destinations, dates, amounts, budgets, duplication and state/evidence rules. Async independent tools reduce waiting; durable execution owns long-term work. An automated policy check can allow an authorized action; no second human or model approval loop is mandatory for every call. Retrieved pages, documents and partner prose are untrusted data and cannot change instructions or tool authority.

### A-02: One informed, bounded, revocable service mandate

The parent's start authorization is a standing mandate, with a narrow preparation-only option if they prefer. Record household/request(s), purpose, individually named recipients/program set, permitted action types, exact data categories and allowed document uses, booking/contact preferences, disclosure/attempt limits, validity/expiry and revocation method. Explain clearly that the service can send permitted information and complete permitted applications; do not disguise sharing consent as a preparation button. Set concrete limits in Phase 0 and show them to the parent. The mandate never includes unknown future recipients, arbitrary new purposes, signatures/impersonation or binding financial decisions.

At each side effect the server evaluates the current mandate and provider permission against the exact operation, recipient, purpose, packet/version, data and available evidence. Within-scope packet changes, supplementation, retries, follow-ups and authorized route changes proceed without a new parent approval. Keep immutable per-operation packets and authorization decisions for audit; one mandate may authorize multiple distinct valid operations, each with its own stable idempotency key. A separate action-specific approval can authorize an exception without silently broadening the entire mandate.

Pause only affected work for an indispensable missing/conflicting fact, expired/insufficient authority, a new recipient/purpose/data use beyond consent, required personal authentication/verification/attestation, or a meaningful financial/personal choice. First try permitted sources/tools and prepare all independent work. Batch related questions where useful. The family can always choose direct control or human assistance.

Human or qualified-partner review is required for substantive disputed rights/eligibility or clinical assessment, unresolvable safety/identity concerns, or an operation whose permission/reliability cannot be established. Do not route every unfamiliar notice to an operator when its ordinary meaning and permitted next action can be established. A stop records the reason, evidence, intended resolver, prepared next step and resumption event.

Recheck authority immediately before execution, including resumed jobs. Revocation prevents queued/retried future actions; reconcile in-flight actions and explain delivered information cannot always be recalled. Unknown delivery is reconciled before retry; lack of a safe reconciliation path creates an owned exception rather than duplicate submission.

## 9. Durable execution, events and outcomes (W-01, W-02)

### W-01: Continue autonomously over time

Persist requests and mandates before dispatch. Research, documents, preparation, execution, waits, follow-up, cancellation, limits and recovery run without an open browser. Save bounded step results/opaque references; keep private content out of routine workflow histories and traces. Normal sign-out/session expiry is independent of the active service grant. Provider-required authenticated browser participation has its own explicit pause/handover.

Retain Next.js/Supabase/Responses. Vercel Workflow remains the preferred durable-runtime candidate, subject to a synthetic integration/data-handling spike. Keep direct Responses calls where suitable; use an SDK or focused worker when it removes real orchestration/connector complexity. API background generation is not a weeks-long scheduler. Use bounded tool turns, cost/attempt limits, timeouts, per-route kill switches and reconciliation.

Concurrent edits, source changes, multiple programs, callbacks and resumed jobs enforce version/current-authority rules. A consequential parent correction invalidates queued uses of the superseded fact; reconcile already executed work and prepare a permitted correction instead of silently overwriting submission history. Independent useful work continues when one route pauses. Respect parent corrections and no duplicate applications. Routine recovery tries another permitted strategy before escalating, without infinite retries or mass referrals. Automated status checks use actual supported endpoints/approved browser sessions; there is no invented polling API.

Request states include Draft, Working, Waiting, Action needed from parent, Specialist needed, Closed, Cancelled and Recoverable failure. Ready for review exists only when a specific review is actually required or parent-chosen. Every active/waiting request has a next actor, source-backed deadline or internal follow-up time and a trigger. Internal follow-up times are agent-selected scheduling choices, clearly separate from agency deadlines.

### W-02: Evidence is the source of progress truth

| Event/outcome | Evidence | Meaning |
| --- | --- | --- |
| Prepared | Validated saved packet | Content exists; no external delivery implied |
| Sent | Transport acknowledgement for exact operation | Channel accepted delivery; partner receipt/acceptance still separate |
| Partner received | Authenticated receipt or attributed verified report | Packet received, not necessarily accepted for service |
| Partner accepted | Explicit partner acceptance or attributed report | Agreed to assist; not an agency submission or award |
| Application submitted | Agency receipt or clearly attributed parent/partner report | Submitted; decision pending |
| More information/appointment needed | Attributed provider request/booking evidence | Actual next requirement/time, not a guessed deadline or appointment |
| Assistance approved | Attributed agency/partner decision or labeled report | Approval; funds/food/restoration may still be pending |
| Support received | Attributed payment, access, benefits use or restoration evidence/report | The particular service outcome occurred; preserve what and when |
| Declined/unresolved/withdrawn | Attributed reason or explicit closure | Retain reason and pursue permitted alternative when appropriate |

Label Parent reported or Operator confirmed where independent verification is absent. AI can interpret evidence, not manufacture it. Outcome tracking is separate per program and need; one success never silently closes remaining food/utility work. Silence/elapsed time does not mean rejection, award or receipt. Unresolved closure requires recorded exhausted/unsafe routes or limits and an honest notice with an available re-entry/help path; a parent's silence alone does not resolve the need or close independent active programs.

## 10. Documents, forms and useful exports (D-01, E-01)

Support mobile camera/upload and manual input for bills, notices, benefit responses and required supporting documents within the approved data inventory. Initial technical target: JPEG/PNG and readable PDFs, 10 MB/five pages per document; confirm usable limits during implementation. Parent-visible capture quality guidance, rotation/crop support where useful, progress, retry and accessible alternatives are part of the finished product.

Validate actual type/size/pages/encryption; isolate rendering and scan/process files safely. Do not execute embedded content. Reject unsafe/unsupported files without losing the request. Private storage, authorized short-lived download, request-level purpose and expiry apply; no public URL, analytics attachment, service-worker cache, localStorage or IndexedDB vault.

Track original source, page/field reference, extracted value, applicable date/period, validation and parent correction separately. Clear validated facts can be used under the mandate without a mandatory review stop; consequential uncertain fields remain unresolved until sourced or answered. Sensitive fields required only by the agency use a protected direct-entry/provider path where supported, excluding them from model context and ordinary storage/logs. Do not collect passwords, EBT PINs or an indefinite identity-document vault. Document-specific consent/vendor controls must exist before real uploads; preserve legacy outbound identifier guards on school paths.

Known forms and provider-supported online forms are in scope for AI completion. Use current versions, evidence-backed mappings and tested field/attachment validation; render/check generated forms before execution. Browser-based discovery can assist a supported route, but new untested form variants require controlled verification before external use. Never invent a signature, attestation, unsupported answer or hidden field value.

Families can inspect/download a readable progress/preparation summary and relevant submitted packet/receipt. Use the same source data and immutable executed version; a separate AI summary must not change amounts, dates, recipient or commitments. Show draft/current/executed states honestly. Verify print, pagination, translated text, special characters and no internal/unrelated household content. A new packet inside the mandate needs fresh validation, not automatically another parent confirmation.

## 11. Privacy, consent and legacy isolation (D-02)

The parent service has a new purpose and data boundary. Use separate parent production and synthetic staging by default; keep the school deployment/records isolated. Existing school approvals, staff roles and de-identified policy do not supply parent consent or authorize disabling guards.

The data inventory permits only fields/documents needed by a supported active action. Keep government identifiers and authentication secrets outside model context and ordinary request records; where a provider requires them, use direct parent entry or a separately reviewed secure delegated channel. Adding such a channel requires specific permission, threat-model/testing and retention controls; no generic credential collection is implied by one click.

Explain account/service processing, AI/vendor document handling, the standing sharing/action mandate and optional notification permissions. The parent can inspect recipients/action/data limits, narrow or revoke the grant and request correction/deletion. Changes within the existing mandate proceed automatically; expanded scope requires new consent. Optional extraction/reminders can be declined without denying access to information or human help.

### Proposed retention defaults, to implement and verify before real data

| Data | Proposed limit | Control |
| --- | --- | --- |
| Raw uploads | Delete within 24 hours after validated extraction unless needed by an authorized active handoff; unprocessed uploads expire after 7 days | Purpose-specific visible expiry; retained original limited to actual handoff; recover an authorized copy or ask for re-upload if expiry blocks required work |
| Household facts/requests/packets | Active service plus 90 days after closure, or earlier verified deletion | Correction/deletion, justified holds only, no indefinite profile |
| Mandates/action authorizations/delivery/security evidence | 365 days, minimized identifiers/hashes | Restricted audit access, no raw prose/document copies in security events |
| Application/usage logs | 30 days | Content-free allowlisted metadata; aggregate token/cost counts allowed; no secrets/private text/full provider responses |
| Backups | Expire within 30 days of source deletion | Protected restore and reapplication of deletion/revocation |
| AI/vendor data | Feature-specific contract/retention review | `store: false` does not establish zero retention; verify regions, hosted tools and tracing separately |

Account deletion stops jobs/messages, revokes future sharing/access and deletes eligible content, while clearly explaining minimal retained evidence and already delivered third-party copies. Expired/deleted attachments cannot be silently omitted or resurrected from unauthorized storage. A safe available copy within the mandate can be reused without unnecessary parent reapproval; changed facts/purpose or an out-of-scope document use requires the appropriate check.

## 12. Supported execution and qualified help (H-01)

Prefer provider-permitted APIs, existing secure partner workflows and structured channels for independent execution. Add browser-assisted work for tested allowlisted domains/actions in isolated sessions when APIs do not cover the step. Record capability, permission, identity/attestation requirements, data handling, version limits, receipts and recovery per route; never assume a public portal grants automation permission.

For browser work, preserve human involvement in authenticated, destructive, purchase or hard-to-reverse flows as required by tool/provider policy. The parent handles login/MFA/identity and personal declarations directly through a secure handover; keep credentials from the model. Supported filling/navigation and non-sensitive work can proceed within tested policy. A standing mandate is not a universal exemption from a required browser confirmation. Provider-authorized unattended API/partner execution is a different capability and can proceed within its verified delegation rules.

Implement enough supported transports to deliver C-01, rather than arbitrarily forcing every partner into one portal. Reuse transports where possible. A minimal authenticated referral view is built when a partner workflow needs it; otherwise use the agreed secure channel. Content-free notifications alone never disclose household documents. Authenticated callbacks, allowed status retrieval or attributed partner responses provide updates. No fake integration is built to satisfy a hypothetical test.

AI requests status, asks authorized partners for missing requirements, supplies allowed data, schedules within stated preferences and changes to a compatible authorized route when needed. Legal/clinical/safety decisions and unresolvable execution problems get an owned qualified exception. Record staffed hours, acknowledgement/escalation targets and named resolver; no implied 24/7 human coverage. The parent is interrupted only if their action is required, while operators/partners handle their own responsibilities.

## 13. Communication, notices and returning use (N-01)

Deliver complete account/security messages and opt-in support updates in advertised languages using the selected verified email/phone channels. Use safe preview preferences, quiet hours, batching, opt-out and actual delivery tracking. Proposed reminder window is 9 a.m.–7 p.m. America/New_York; any permitted urgent exception is explicit in preferences and operating policy.

AI can send routine permitted follow-ups to named partners, interpret supported responses, request status and respond with existing authorized facts. Family updates emphasize meaningful progress or a real necessary action, with calm waiting expectations. Do not ask for confirmation merely because a message was prepared or a route returned an ordinary answer.

Private amounts, income, benefit status, account references and documents stay out of lock-screen previews. Notification failure is not a service outcome. After a parent-required external step, reconcile a real receipt/status through available allowed tools before asking the family to report completion. Opening a link never proves submission. Suppress affected messages/work after expiry, stop, withdrawal or closure.

## 14. Data and architecture outline

Use logical records with the smallest adequate schema; reuse only where purpose/ownership/lifecycle fit. Do not rename every legacy type or build a general agent platform as a prerequisite.

| Record | Essential data |
| --- | --- |
| Household/membership | Adult owner, sourced facts, corrections, safe contact/preferences |
| Support request | Needs, urgency, intent, state, next actor/trigger, independent program outcomes |
| Program/capability | Sources/rules/version, provider/recipient, allowed actions/channels, delegation proof, required personal steps, status/fallback |
| Service mandate | Actor, household/request purpose, named recipient/program set, actions/data/docs, preferences/limits, duration/expiry/revocation |
| Decision and operation authorization | Proposed action/packet/version, sources, mandate/action approval, policy result and reason, stable operation key |
| Packet/form/submission | Immutable attempted/executed version, evidence-backed fields/documents, validation, receipt and reconciliation state |
| Document/fact | Private source reference/expiry, extracted/validated/corrected fields, allowed use and processing permission |
| Durable job/event/outcome | Work progress, scoped execution grant, retries, waits, source/actor-attributed result |
| Intervention/notification | Reason category, intended resolver, prepared action, actual human work, delivery and resumption |

Retain Next.js, React, Supabase, server-side Responses and current PDF libraries. Add durable execution, protected document handling, required communication and route adapters. Scoped workers use current authority; private credentials never enter public clients or the ordinary web deployment. Validate any supported delegated provider credentials in an appropriately isolated server runtime.

Parent signup and environments need explicit replacements for current invite-only school posture/password guards, with matching CI/configuration/operations changes. Preserve school safeguards. Read installed Next.js guides before framework changes and current official integration docs before using vendor APIs.

## 15. Family-ready quality and autonomy measures (X-01, X-02, M-01)

### X-01: Accessible, low-effort use

Use short plain-language screens and purposeful progressive disclosure. Families should not encounter intervention plans, prompts, model selectors, tool logs or orchestration controls. Provide actual examples, safe optionality and understandable source/uncertainty explanations. Human help is discoverable by choice.

Target WCAG 2.2 AA and test keyboard, screen-reader critical paths, errors/focus, live status, contrast, 200% zoom and reflow at 320 CSS pixels. Complete the advertised language experience across marketing, account/recovery, forms, mandate, notices, partner limits, help and printable artifacts. Use reviewed translations for consequential content.

### X-02: Polished product acceptance

The release includes truthful public pages, low-friction account/recovery, complete mobile capture/upload/manual paths, consistent navigation/type/spacing, all loading/empty/waiting/error/success states, meaningful progress updates, useful printable packets/receipts, privacy/preferences/history/help, cancellation/deletion and reliable return links. No placeholder controls, demonstration-only outcomes or operator-only workaround is presented as a finished family flow.

Review actual screens on small phones, typical laptops, slow/interrupted networks and shared devices using realistic long/multilingual content. Test interrupted signup/upload/jobs, resumption, corrections, expired grants, provider changes and long agency waits. Polishing happens through implementation, with final family observation and visual/accessibility review. A complete narrow internal slice or synthetic demo is not the family-ready release gate.

### M-01: Measure autonomy alongside outcomes

Initial targets below are proposals to calibrate with Phase 0 fixtures and the first pilot, not measured performance or public guarantees. Never trade accuracy, consent or safety for a lower interruption count.

| Measure | Definition / initial target |
| --- | --- |
| Intake effort | At least 80% of observed families finish minimum intake without operator help within 3 minutes, excluding verification delivery; document reuse reduces repeated typing |
| Autonomous completion of controllable work | At least 80% of eligible routine tasks execute without a family prompt or CaseLink operator doing the task; define and freeze tasks/eligibility from the coverage matrix before each evaluation/pilot run. Missing connectors, failed automation and operator-completed routine work count as failures/dependence, not convenient exclusions. Report all tasks and separately identified provider-required personal acts |
| Unnecessary interruptions | No request to approve an already authorized routine action or reconfirm clear validated facts in the critical evaluation set; report actual prompt counts/reasons per family journey |
| Required participation | Separately count identity/signature/attestation/interview, genuine missing facts, changed scope and meaningful personal choices; do not disguise these as agent failures or hide them from parent-effort measures |
| Operator dependence | Operator touches/minutes per task/request and cause; partner-required service delivery is separate from avoidable internal manual work |
| First useful progress | p95 representative preparation within 60 seconds under declared load; verified urgent help is independent of generation; longer work shows actual status and expected next trigger |
| Complete service outcomes | Food accessed, submissions, appointments, approvals, payments/benefits applied, restoration, declines and unresolved cases by route, source and waiting time |
| Coverage | All C-01 journeys and advertised programs/providers have a working completion contract and evidence; disclose actual automated/assisted mode rather than a raw program count |
| Cost and trust | Per-request/task/outcome model/tool/message/human cost; zero observed unauthorized disclosure, false action/award claims, lost corrections or duplicate submissions |

Measure from the informed start through all attempts, including failed/abandoned tasks. Publish separate total-family-effort and eligible-autonomy measures so exclusion of legal/personal acts cannot inflate a claim of end-to-end automation. One-click completion rate is reported only for cases whose complete provider process supports it; required-personal-step cases remain in total journey reports. Selecting food and utilities produces separate need outcomes under the same household; show all denominators and unknowns.

## 16. Verification and acceptance (V-01)

Each non-trivial behavior change has a runnable regression. Extend existing unit, real Auth/database/storage, integration, headless end-to-end, accessibility, AI and rendered-document tooling. Test implemented routes and their actual channels, not fictional APIs.

| Layer | Required evidence |
| --- | --- |
| Unit | Mandate/action policy, source-backed judgment/fact validity and calculations, necessary-intervention reasons, limits/expiry, packet validation, compatibility/duplicate rules, outcomes, cancellation and notification suppression |
| Auth/data | Parent A/B, partner/referral and legacy isolation; caregiver/third-party acting authority; trusted role assignment; interactive session versus durable grant; current membership/revocation/security holds; storage, exports, deletion and rollback |
| Integration | In-scope autonomous actions and out-of-scope stops; multi-operation mandates; source/packet updates; execution/submission/booking receipts; reconcile retries; callbacks/status if used; supervised browser handover; expiring documents |
| End to end | Every C-01 journey and combined needs, complete autonomous eligible cases, required personal acts and resumed work, no gratuitous approval stops, failure/alternative route, sign-out/reopen, notices, operator/partner exceptions and outcomes |
| Accessibility/visual | Complete phone/laptop and advertised-language journeys, observed mandate comprehension, camera/file/manual alternatives, long text, slow networks, keyboard/screen reader, contrast/zoom/reflow and complete state coverage |
| AI quality/judgment | At least 60 reviewed synthetic multi-step cases spanning all C-01 rows, providers and advertised languages; each enabled action has representative cases; evaluate route choice, source fidelity, auto-use of reliable facts, independent recovery, necessary versus unnecessary intervention, edits, latency and cost |
| Adversarial | Prompt injection in files/pages/messages, mandate expansion, new recipient/data/purpose, forged receipts, misleading status, identity/account mismatch, conflicting sources, unsafe files, exfiltration/search payloads, replay and spend/attempt exhaustion |
| Forms/PDF | Current supported templates/fields/attachments match validated data; actual rendering, no invented attestations/signatures, accessible language/glyphs, exact executed version/receipt and no internal/unrelated content |
| Hosted operations | Exact candidate model/settings, approved program channels, real permitted rehearsals, communications, job persistence, provider/partner updates, cancellation/revocation, cleanup, restore, alerts and rollback |

Critical failures block the affected capability: unauthorized action/sharing, false eligibility/capacity/submission/award claim, fabricated personal fact/signature, missing required human participation, duplicate submission, lost parent correction, or unowned urgent exception. Unnecessary approval loops and routine operator dependence also fail the autonomy/readiness criteria, without weakening the critical safety tests. Version model/settings, playbooks/prompts, program contracts, source facts and the evaluation corpus per release.

## 17. Family-ready release and operating gates (O-01)

Name service, engineering, privacy/security, resource and support owners with partner contacts in restricted records.

**Before any real household intake, upload or live external action, including a closed pilot:** approve and implement the relevant data/vendor/consent controls; verify real account, household, storage and legacy isolation; rehearse the enabled routes and required personal acts; prove scoped execution, receipts, cancellation/revocation, deletion and recovery; provide honest capability copy and owned urgent/help coverage. Until that gate is recorded, use synthetic data and authorized partner rehearsals only. A restricted pilot can enable verified capabilities incrementally, with unsupported capabilities clearly unavailable; it does not certify the finished release.

The finished product release requires:

- C-01 coverage implemented across immediate food, SNAP/WIC and electricity/gas/water, with actual automated/assisted completion contracts and accurate public capability descriptions.
- Named recipients, action/data permissions, mandate presentation, required personal acts and per-route receipts/recovery tested. Provider automation restrictions cannot be overridden by a model or general service consent.
- Real parent/partner/legacy isolation, private document processing, direct secret handling where needed, scoped worker authority and revocation/deletion verified.
- Approved/implemented data purpose, vendor/retention/disclosure controls and parent consent; no reliance on historical school approvals or compliance labels.
- Working accounts/recovery, safe messages, actual source/status upkeep, operator exception coverage, backups/restore, budgets/limits, alerts and per-route stop controls.
- Entire X-01/X-02 product passes phone/laptop visual, accessibility, language and family observation, including failures and lengthy waits; no placeholders or required routine operator completion hidden behind the UI.
- Exact-candidate verification and the reviewed autonomy/outcome scorecard include denominators, required personal work, manually assisted cases and unresolved outcomes.
- Closed-pilot feedback incorporated and a recorded decision to launch, continue testing or repair specific gaps. Extend the pilot or targeted rehearsals when its small sample leaves required journeys, languages or operating conditions untested. No old school release or single-route demo certifies this product.

AI continuously performs permitted routine monitoring/follow-up within each active grant. Humans own alerts for genuine failures, stalled urgent work, unverifiable sources/receipts, cleanup, unusual denials and spend. Alerts contain safe IDs/metadata. Record staffing hours and response targets truthfully; automated availability does not promise round-the-clock human service.

## 18. Implementation decisions to close in Phase 0

| Decision | Owner | Evidence needed |
| --- | --- | --- |
| Full coverage matrix and program/provider contracts | Product/resource owner and partners | C-01 completion paths, required acts, verified urgent food/utility coverage, actual execution/status permission |
| Mandate design and autonomy rules | Product/engineering/privacy owner | Named recipient/program set, allowed actions/data, concrete duration/attempt/booking limits, exceptions and family comprehension |
| Identity/channel/language access | Product owner with families | Tested signup/recovery/contact availability, translations and real partner coverage |
| Document/data/direct-entry handling | Privacy/security and engineering | Minimal inventory, model exclusion of secrets, deletion/retention and source validation |
| Runtime and execution modes | Engineering | Durable tools, API/partner/form/browser feasibility, handover, receipts, isolation and cancellation spikes |
| Quality, autonomy and operational capacity | Service owner | Family-ready checklist, relevant evals, intervention taxonomy, cost/support capacity and release evidence |

These decisions refine execution, not the accepted goal. Broad useful automation and a polished family-ready product in the two domains are required. Build internal slices while resolving external permissions; do not silently redefine the finished product to the easiest available handoff.

## 19. Sources and current implementation

Official sources reviewed for the October 25 planning/revision; recheck program rules and permissions before enabling an action. Sources describe capabilities/processes, not live availability or a household's eligibility.

- [Pennsylvania SNAP](https://www.pa.gov/services/dhs/apply-for-the-supplemental-nutrition-assistance-program-snap) and [WIC](https://www.pa.gov/services/health/request-a-pre-application-appointment-with-a-wic-specialist): agency processes and required participation.
- [UESF benefits](https://uesfacts.org/i-need-help-with/benefits/) and [utility grants](https://uesfacts.org/our-programs/utility-grant-program/): partner service categories.
- [Philadelphia water assistance](https://www.phila.gov/services/payments-assistance-taxes/payment-plans-and-assistance-programs/senior-citizen-programs/apply-for-water-bill-customer-assistance/): supported methods and documents; application materials are not accepted by email.
- [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol): tool/vision capabilities and Responses tool calling.
- [OpenAI tool guardrails and review](https://developers.openai.com/api/docs/guides/agents/guardrails-approvals): validation at side effects and resumable approval; the application implements its authorization policy.
- [Async tools](https://developers.openai.com/api/docs/guides/async-tool-calling), [search controls](https://developers.openai.com/api/docs/guides/tools-web-search#domain-filtering), [computer-use environment/human controls](https://developers.openai.com/api/docs/guides/tools-computer-use-integration#restrict-the-environment), and [background mode](https://developers.openai.com/api/docs/guides/background).
- [Supabase storage](https://supabase.com/docs/guides/storage/buckets/fundamentals), [security](https://supabase.com/docs/guides/security/product-security) and [Vercel Workflow](https://vercel.com/docs/workflows/concepts): implementation foundations requiring route-specific verification.

Local inspection found staff-only signup/roles/password guards, browser-driven saved generation, text-only AI requests, outbound identifier checks and reviewed-plan/takeaway PDFs. Parent mandate execution, uploads, forms/submissions, route adapters and polished parent UI remain unimplemented. The [implementation plan](parent-support-implementation-plan.md) separates internal increments from the complete family-ready release.
