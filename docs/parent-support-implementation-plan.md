# CaseLink parent support implementation plan

**Planning baseline:** October 25, 2026 (America/New_York)
**Status:** Documentation baseline; implementation has not started
**Product authority:** [Parent support MVP PRD](parent-support-mvp-prd.md)
**Working branch:** `main`
**Preserved case-manager baseline:** `codex/case-manager-baseline-2026-10-25` at `700bb46`

This plan replaces the school-pilot roadmap for new product development. Historical school requirements, operations instructions, and release results remain applicable to their old deployment and must not be represented as verification of the parent service. This plan does not authorize a production release, migration of school records, or actual partner outreach.

## 1. Delivery strategy

Build a narrow service that completes one food-support route and one utility-assistance route through the same parent experience. Prove the handoffs with existing partners before expanding program coverage or browser automation. Reuse the current application stack, validated AI contracts, source grounding, progress patterns, PDF rendering, and test harness where their trust boundaries fit.

The first complete slice is **parent account → household → short intake → saved preparation job → reviewed packet → approved partner handoff → acknowledgement → follow-up → attributed outcome**. Use synthetic households and a fake partner transport until real data and transport gates are met. Build food and utility fixtures from the start; do not ship a polished intake that ends at a list of links.

One Sol 6.1 coordinator with two domain playbooks is enough for the MVP. Durable execution and explicit application permissions carry the work over time. Model prompts do not replace authorization, consent, job state, delivery receipts, or a staffed recovery path. Support one rehearsed benefits path and one utility path; recognize other intents and route them to verified partner assistance without implementing every new/renewal/pending/problem workflow.

Select the smallest secure transport that partners can operate. A new partner view, API connector or automatic status polling is required only if the chosen route needs it. Audited operator confirmation of a partner response is an acceptable pilot update mechanism. Build adapters and callbacks only for actual selected routes, with contract fixtures for their failure paths.

## 2. Branch and environment baseline

| Item | State after the documentation update |
| --- | --- |
| Original development branch | `codex/school-pilot-readiness` remains at the prior app commit `38db6b6` |
| Preserved baseline branch | `codex/case-manager-baseline-2026-10-25` includes the current app and pre-existing background-work instructions at `700bb46` |
| Main | Fast-forwarded from the older main to `700bb46`; parent documentation changes follow that baseline |
| Application implementation | Still the staff-oriented app; parent features in this plan are pending |
| Untracked local assets | Existing skills, design assets, output and temporary files are left in place; they are not part of the baseline commit unless already tracked |
| Hosted environments | Unchanged by this documentation/Git operation; a branch operation is not a deployment or database rollback |

Local branch creation does not establish a remote backup. Record remote branch publication and exact commit IDs when it is performed; do not force-push or reset shared history. Keep the existing disabled automatic main deployment setting until a deliberate parent release decision. Inspect actual hosting/Git behavior before any future push or release.

Use a separate parent service database/environment and synthetic staging by default. Preserve the school deployment and its records under the historical operations runbook. A Git rollback does not roll back database changes, provider settings, sent referrals, or downloaded files.

## 3. Current app: reuse, change, and evidence

The map below is based on local source inspection. Deployed configuration and external capabilities require separate evidence.

| Area | Existing implementation | Parent-product work |
| --- | --- | --- |
| Identity | `src/app/signup/page.tsx` redirects to demo; `src/lib/auth/session.ts` expects provisioned staff and password sessions; roles in `src/types/user-role.ts` are admin/case_manager | Add the selected parent signup/recovery method and trusted parent/partner/operator memberships; review signed-session assumptions and current revocation checks |
| Database access | Family creator/assignment/admin policies and guarded RPCs in `supabase/migrations/` | Household/referral ownership, partner scope, operator exceptions, storage policies; deny parent use of legacy staff/RPC routes |
| Hosted posture | `src/lib/env.ts`, `src/lib/security/production-posture.ts`, `src/lib/security/deployment-boundaries.ts`, `.env.example`, and CI encode invite-only school operation | Define explicit parent posture and separate environment checks; preserve school guards; update config, tests, CI and operations together |
| Intake and navigation | `src/lib/validations/family-intake.ts`, `src/features/families/intake-form.tsx`, `src/features/families/family-lite-workspace.tsx`, workspace routes | Parent Get support / My support / Request detail, adaptive food/utility intake, confirmed reusable facts, clear status and next action |
| AI | `src/lib/ai/models.ts` already defaults to `gpt-6.1-sol`; `src/lib/ai/client.ts` returns validated text; current prompts are case-manager oriented | Add request-scoped tool calls, two playbooks, extraction boundary, approval pauses, source evidence, bounded execution; retain validation, budgets, safe errors and usage metadata |
| Privacy | `src/lib/privacy/no-pii.ts` and outbound checks reject identifying case context | Add an approved minimum-data path for parent processing and isolated bill extraction; retain legacy checks rather than removing them globally |
| Resource matching | `src/lib/services/matching-resources.ts`, `src/lib/matching/`, imports, `src/types/database.ts` | Distinguish organization/program/provider; reviewed route capabilities, fact sources/freshness, accepted fields, transport and response contracts |
| Background work | `src/lib/domain/plan/poll-generation.ts` advances saved work from the browser; saved generation has leases/recovery | Introduce durable server execution and scoped step operations; browser reads progress rather than driving the agent lifecycle |
| Progress | Existing action/progress/transaction/review patterns and audit events | Request lifecycle plus separately attributed delivery, partner, agency and outcome evidence; retain concurrency protections |
| PDF | `src/features/families/plan-pdf-export.tsx`, family takeaway and source/visual checks | Reuse rendering for a reviewed preparation summary/packet; exact approved data and version checks; avoid forcing plan review onto all parent actions |
| Messaging and invitations | Supabase Auth templates and a staff invitation Edge Function | Separate parent account messaging from optional service reminders; verified transactional transport and minimal partner notifications; no new partner gets staff access |
| Quality | Vitest, local Auth/DB security scripts, Playwright/axe, AI corpora, rendered-PDF scripts and CI | Extend around parent/request/referral boundaries and real handoff failure modes; retain school regression coverage while those routes remain reachable |
| Public content and policy | Staff-oriented marketing, privacy/terms, demo funnel | Parent promise, truthful supported routes, sign-in path, AI/data/consent disclosures and human help; publish with behavior, not ahead of it |

Review callers, schemas, imports, fixtures, exports, configuration and database routines together before each change. Read the installed Next.js guidance and current integration documentation. Do not rename every family/plan symbol before a working slice proves the necessary boundaries.

## 4. Phase sequence and planning ranges

All phases below are **not started**. Effort ranges are provisional active engineering time for one experienced engineer with part-time product, partner, privacy, and QA support; they exclude external waiting and are not commitments. Re-estimate after Phase 0. The combined planning range is about 5–8 working weeks if the partner/data decisions and operational support are available.

| Phase | Result | Dependency | Indicative effort |
| --- | --- | --- | --- |
| 0 | Verified launch routes, trust boundary and technical decisions | Product-owner/partner access | 2–4 engineering days plus external coordination |
| 1 | Parent identity, household isolation and safe deployment foundation | Phase 0 identity/data/environment decisions | 4–7 days |
| 2 | Both journeys work through a synthetic end-to-end service | Phase 1 ownership and Phase 0 route contracts | 4–6 days |
| 3 | Sol preparation and confirmed document extraction | Phase 2 request/packet contracts and approved processing design | 5–8 days |
| 4 | Consented real partner handoff and follow-up | Phase 0 partner agreements; Phases 1–3 controls | 4–7 days |
| 5 | Supported pilot with release evidence | All applicable launch gates | 3–5 engineering days plus the service follow-up period |
| Later | More routes and specifically tested automation | Pilot outcomes and explicit prioritization | Not estimated or part of MVP |

Implement verification within each phase. Phase 5 is the final service rehearsal and pilot review, not the first time authorization or failure recovery is tested.

## 5. Phase 0 — verify the service and choose the smallest architecture

**PRD coverage:** P-01, R-01, D-02, H-01, O-01, M-01.
**Accountable roles:** service owner, resource owner, engineering owner, privacy/security owner, selected partner contacts.

### Deliverables

- Choose one primary food-benefits handoff and one utility handoff from the existing partners; verify an immediate-food route as well. UESF and the existing water-assistance pathway are candidates, not claims that digital referral access is already enabled.
- For each route, record exact provider/program, service area, current instructions, accepted data/documents, authority, transport, acknowledgement, updates, staffed hours, escalation and fallback. Store private contacts outside public Git.
- Reconcile ambiguous directory names, especially the water CAP record versus PECO CAP. Preserve source history and disable an unverified action without deleting the partner record.
- Confirm whether target parents can use the proposed email-code identity method. Select one initial method; add phone-first identity only if access research requires it, with a verified provider and recovery flow.
- Select the minimal secure referral transport with partners. Reuse an existing approved route when it meets the purpose and data requirements; build a minimal authenticated referral view only if needed. Send content-free notifications when supported. Avoid a bespoke connector per organization or a new portal just to satisfy the design.
- Approve the parent data inventory, consent purposes, extraction/vendor handling, retention/deletion schedule, safe contact policy, geographic/language claims, and legacy isolation approach.
- Spike durable execution with synthetic IDs: start, close browser, pause, resume, retry, cancel and deploy/restart. Evaluate Vercel Workflow with existing Responses calls; confirm observability and step storage do not copy private content unnecessarily. Add a framework or gateway only for a proven need.
- Create a compact decision/evidence record with named owners, program contracts and unresolved external items. Establish model/messaging budget, initial pilot load, and an operator acknowledgement/escalation target. Select supported language coverage and a reviewer; English/Spanish remains a proposal until that decision is evidenced.

### Exit evidence

- At least one reviewed food route and one utility route can be rehearsed from packet to acknowledgement and next step. Immediate-food and urgent utility fallback are verified or those claims remain unavailable.
- Parent environment, identity method, data handling, primary handoff and durable runtime decisions are recorded.
- A partner acknowledgement can be represented distinctly from agency submission/award.
- Synthetic technical fixtures can proceed while an unrelated external decision is pending. No production settings, data migration, or actual contact are changed merely to close a planning item.

## 6. Phase 1 — parent accounts and household boundaries

**PRD coverage:** P-02, D-02, O-01; foundations for P-03, D-01, W-01.
**Accountable roles:** engineering and privacy/security owners.

### Implementation

1. Provision isolated parent development/staging targets with synthetic data. Plan parent production separately from the existing school project. Use reviewed migrations; do not edit historical migration files or import real school rows.
2. Add the selected verified signup/sign-in and recovery flow. Update account provisioning, trusted role/membership records, active-session/revocation checks, callbacks, errors, redirects, and auth email copy together. Keep family-existence and email enumeration private.
3. Add one-owner household and parent request ownership. Reuse an existing table only after its grants, policies, triggers and callable routines satisfy the new boundary. Test every reachable legacy route/RPC against parent identities.
4. Define restricted partner and operator authority without broad case-manager access. Preserve protected role assignment, offboarding, audit and current-session behavior for interactive operations. Give background work a bounded request-scoped execution authorization that survives normal sign-out/session expiry, with current membership/account, consent and action-approval checks. Do not keep a parent refresh token as a worker credential. Operator content access needs a reason, scope and expiry.
5. Implement the parent-specific hosted posture and CI fixtures alongside existing school checks. Keep debug/payload logs and public/privileged credentials restrictions. Do not change existing hosted Auth to public signup as an implementation shortcut.
6. Establish private document metadata/storage policies and deletion hooks, with uploads still disabled until Phase 3 processing/consent checks pass.

### Verification and exit evidence

- Real local Auth/DB tests prove parent A cannot read/write parent B data through APIs, direct table access, RPCs, export or storage.
- Legacy staff and unrelated partner/admin identities cannot inherit parent data; role/user-metadata tampering and owner reassignment fail.
- Recovery-only/expired/revoked interactive sessions, offboarding, concurrent signup, sign-out failures, and current-session checks behave safely under the selected method. Authorized background work survives normal sign-out; cancellation, explicit execution-consent withdrawal, inactive membership and offboarding stop future actions.
- Parent environment/CI cannot target the school production database. The current school source tests remain valid and passing for unchanged behavior.
- A parent can verify an account, maintain minimal household facts, sign out, return and request deletion using synthetic data.

## 7. Phase 2 — both journeys through a complete synthetic service

**PRD coverage:** P-03, F-01, F-02, U-01, U-02, R-01, W-01, W-02, H-01, X-01.
**Accountable roles:** engineering and product/resource owners.

### Implementation

1. Build Get support, My support, and Request detail using current components/tokens. Keep Household settings secondary. Replace staff/caseload language in the parent surface.
2. Add adaptive minimum intake, urgency, recognition of existing applications/renewals, Not sure/manual paths, shared confirmed facts, independent food/utility requests, and autosave/recovery. Implement preparation only for the selected launch paths; other recognized needs use a verified partner-help path. A parent need not invent goals or follow-up dates to start.
3. Implement reviewed program/route contracts and source references. Add stale/unavailable/unknown states. Do not infer current funding from an active directory entry or successful webpage fetch.
4. Add prepared packet versions, missing questions, scoped review, approval invalidation, and a deterministic external-action policy. The parent sees exactly what would be shared and with whom.
5. Introduce durable jobs and request events behind the selected transport's synthetic adapter. Persist before dispatch, use operation keys, reconcile unknown outcomes, enforce bounded retries and current request-scoped authority on resume. Bind approval to one logical operation so safe retries can finish that operation without permitting a second referral.
6. Build the operator exception path and the smallest partner view only if the selected transport needs it. Keep notifications in a test sink. Show Prepared, Sent, Partner received, Partner accepted, Agency submitted, Assistance approved and Support received as distinct evidence-backed events. Operator-confirmed responses are explicitly attributed.
7. Ensure urgent verified help is visible before generation/login where possible. An unavailable immediate-food route or urgent utility route has an explicit human fallback and known staffing hours.

### Verification and exit evidence

- Headless end-to-end tests cover the selected food and utility paths and both needs through a fake partner acknowledgement and an attributed outcome. Other recognized intents reach verified partner help without unsupported application automation.
- Closing/reopening, duplicate clicks, stale tabs, packet edits, expired/revoked approval, resumed jobs and cancellation do not lose work or send twice.
- A fake timeout after transport acceptance reconciles the existing attempt before retry. Where the selected route uses callbacks, forged/replayed callbacks are rejected; do not build hypothetical integrations only to exercise a test.
- Any partner view is confined to a consented referral; operator-recorded updates retain source/actor/time and the exception has a real owner and expiry/escalation rule.
- Keyboard, phone-width/reflow and error recovery checks cover the new critical path. Live sends and real uploads remain disabled.

## 8. Phase 3 — Sol preparation and document-assisted intake

**PRD coverage:** A-01, A-02, D-01, D-02, F-02, U-01, U-02, E-01, V-01.
**Accountable roles:** engineering, domain/resource reviewer and privacy/security owners.

### Implementation

1. Extend the current AI boundary with typed, request-scoped tools and validated tool results. Preserve configured `gpt-6.1-sol`, request limits, safe errors and content-free usage measurement. Review overrides and task settings rather than assuming local defaults are deployed.
2. Add food and utility playbooks for minimum questions, known sources, selected-path preparation, urgent help and failure recovery. Recognize active applications/renewals and route unsupported variants to verified partner assistance. Use ordinary code for authorization, consent, amounts, dates, state transitions and source-to-field checks.
3. Give the coordinator read/prepare capabilities first. Bind its context to the server-authorized request, minimize private context, and keep public search queries free of identifiers. Use approved-domain research and field-level sources.
4. Add optional consented utility bill/notice and response extraction. Validate JPEG/PNG/PDF type, size/pages/encryption; isolate rendering; prevent active content; suggest allowed fields; require parent confirmation. Every extraction failure has manual entry and preserves the request.
5. Implement upload expiry and deletion, extraction/confirmation separation, masked account display, provenance, logs/traces filtering and minimal transfer to the model. Retain an original needed for a supported handoff only under an explicit approved purpose/expiry; an expired attachment requires re-upload, confirmation and a new packet approval rather than silently sending an incomplete packet. Keep school no-PII guards intact on legacy paths.
6. Prepare a readable packet/review and optional PDF summary from the same confirmed data. Reuse the renderer and current revision protections; do not use a separate AI call that can introduce different facts in the PDF.
7. Add asynchronous independent lookups only after the basic tool loop works. Set budgets, turn/tool limits, deadlines, cancellation and resume behavior. Do not use model context or API background mode as long-term job storage.

### Verification and exit evidence

- The PRD's reviewed synthetic AI corpus passes with the selected model/settings, source versions and tool definitions; record usefulness, questions, false claims, latency, cost and reviewer disposition.
- Injection in a bill, website or partner response cannot change recipient, tool permissions, ownership, or search payload policy.
- Unreadable/wrong/conflicting amounts and dates are surfaced for confirmation. Parent edits survive regeneration and delayed jobs.
- Supported and rejected file fixtures cover oversized, corrupt, encrypted, spoofed-type and multi-page files; unauthorized downloads and unconsented processing fail.
- Raw upload cleanup, required-attachment expiry/re-upload and account/request deletion pass read-back checks; no private content appears in provider-independent workflow logs, traces or application analytics. Expiry does not silently remove a required attachment from an approved packet.
- PDF text matches the approved packet, rendered pages are legible, Spanish/special characters are supported or fail clearly, and stale versions cannot export as current.
- Full synthetic journeys still complete with AI failure and a truthful recovery path. No fabricated fallback is called a prepared or submitted application.

## 9. Phase 4 — controlled partner execution and continued follow-up

**PRD coverage:** A-02, W-01, W-02, H-01, N-01, D-02, O-01.
**Accountable roles:** engineering, service operator and partner contacts.

### Implementation

1. Implement the agreed primary transport for the selected food and utility pathways. Keep each route independently disabled until its authorization, destination and contract are verified.
2. At execution, atomically claim the logical operation and validate the exact approval/packet/recipient, current request-scoped authority, account/membership and consent. The execution grant is independent of the original browser session. Record transport acknowledgement separately from partner receipt/acceptance, submission, approval or actual receipt of support.
3. Connect the selected route's partner acknowledgement, information requests and dispositions. Use authenticated partner updates or audited operator-confirmed responses, as agreed. Where callbacks exist, validate scope, event IDs, signatures or equivalent authentication, and actor authority. Do not assume an automated status API.
4. Implement opt-in service email, safe previews, quiet hours, delivery tracking, deduplication and suppression after closure/cancellation/withdrawal. Auth emails remain a separate channel/purpose.
5. Resume the request after verified updates. AI can explain the update, ask a focused question and prepare a revised packet; sharing materially changed information requires fresh approval.
6. Create overdue/failed/unknown-delivery exceptions with named owners and deadlines. Record a human escalation or alternative route without claiming that a callback, appointment, application or award exists before evidence.
7. Make cancellation, consent withdrawal, parent/partner offboarding and deletion stop future actions. Explain delivered-packet limits; do not claim a sent packet can always be recalled.

### Verification and exit evidence

- Rehearse one complete food and one complete utility handoff with each participating partner using an authorized synthetic packet and agreed test recipient/process.
- Capture parent review, exact shared fields, logical operation key, transport receipt, partner acknowledgement, next action and an attributed test outcome. Prove that partner acceptance is not inferred from delivery and assistance approval is not recorded as support already received.
- Lost receipts, partial success, worker restarts, normal parent sign-out, callback replay where applicable, partner silence and delivery failure do not create duplicate referrals or false status. Safe retry can finish one approved operation; it cannot initiate another.
- Required official-site applications/signatures remain parent-led; opening an external link never marks them submitted.
- Email deliverability, preview safety, opt-out, quiet hours and message-link access are verified against the hosted candidate.
- Partners and the operator accept the staffed-hours, escalation and response process. Actual live referrals remain off until Phase 5's real-data gate.

## 10. Phase 5 — release rehearsal, supported pilot and launch decision

**PRD coverage:** all MVP requirements, with final V-01, O-01 and M-01 acceptance.
**Accountable roles:** service owner with engineering, privacy/security, resource and partner sign-off.

### Before admitting real households

- Finish the applicable unit, real Auth/RLS/storage, integration, end-to-end, accessibility, adversarial, AI and PDF evidence on the exact candidate.
- Complete privacy/terms/consent and retention implementation; verify parent/legacy separation and vendor processing. Do not reuse the historical school data approval or release results as parent approval.
- Rehearse backup/restore, deletion replay after restore, callback/transport disable, stuck-job alerts, budget exhaustion, cancellation and rollback. Keep signed packet evidence and private documents outside public CI artifacts.
- Update the parent-specific deployment/operations instructions, release checks, `.env.example`, CI, developer guidance and marketing to match implemented behavior. Existing script names in the README describe the school baseline until explicitly extended; record new commands and owners when introduced.
- Verify a declared synthetic load (initial planning target: five concurrent households plus headroom), real API model access/settings, processing latency/cost, partner capacity and operator coverage. Revise the pilot load explicitly if discovery changes it.
- Name who can pause a route, stop sends, handle privacy incidents and receive urgent exceptions. Configure route-level kill switches and content-free alerts before enabling sending.

### Pilot operation and evaluation

Recruit approximately 15–20 consenting households with an accessible support script and operator availability. Exercise both journeys; collect at least five requests per journey before reporting journey-level adoption. Record intake help, corrections, completed actions, waiting/unknown outcomes, partner response and operator minutes. Continue through external outcomes; an agency wait is not a product-completed case.

Review the proposed PRD targets and actual evidence with partners and observed parent feedback. Stop the affected route for any unauthorized disclosure, approval bypass, false submission/award claim, duplicate referral, lost confirmed information, or unowned urgent exception. Resolve and rerun the relevant regression evidence before resuming.

### Exit evidence

The release record identifies exact code/migrations/prompts/model/program contracts, owners, tests, hosted checks, incident/rollback paths, real-data consent, and residual risks. Pilot results include denominators, pending cases, manual work and costs. The service owner records one of: continue supported pilot, revise a specific failure, expand a verified route, or approve a broader launch. There is no automatic promotion based solely on a passing build or pilot recruitment count.

## 11. Later work, only after evidence

- More verified programs, geography, notification channels or a second identity method when parent demand and operational support justify them.
- Specific parent-approved form preparation and partner/agency connectors after proving route permissions, source mapping, identity/attestation boundaries and duplicate recovery.
- Browser-assisted work only for tested allowed domains/actions in isolated sessions, with safe parent takeover for login, identity checks and signatures. A computer-use model is not a universal program integration.
- Additional caregiver membership after its consent, recovery and household visibility model is defined.
- Job support or other catalog topics require a separate product decision; they are not hidden milestones of this MVP.

## 12. Requirement-to-phase traceability

| PRD requirement | Main delivery phase | Required proof |
| --- | --- | --- |
| P-01 scope and truthfulness | 0, 5 | Verified routes, accurate product copy, explicit pending/unsupported behavior |
| P-02 ownership/access | 1, 4 | Real Auth/RLS/storage and scoped worker/partner denial tests |
| P-03 intake/experience | 2 | Both journeys, combined needs, autosave and parent usability |
| F-01 immediate food | 0, 2, 4 | Actual route/fallback, no generation delay, evidence of access |
| F-02 benefits | 2, 3, 4 | One supported path; new/renewal/pending intent recognition and verified help for other variants; no false eligibility/submission |
| U-01 bill/urgency | 2, 3 | Manual/extracted confirmation and urgent assistance path |
| U-02 utility assistance | 0, 2, 4 | Correct provider/program contract, active-application handling and actual handoff |
| R-01 resource evidence | 0, 2, 3 | Source/version/freshness and approved action capabilities |
| A-01 coordinator/tools | 3 | Sol/tool corpus, scope/injection tests, budgets and edit preservation |
| A-02 approval | 2, 4 | Exact packet/recipient/action, invalidation, one logical operation and safe retries |
| W-01 durable execution | 0, 2, 4 | Browser/session-independent execution grant, restart/wait/cancel/reconciliation and revocation |
| W-02 evidence/status | 2, 4 | Correctly attributed events and separate outcomes |
| D-01 documents | 1, 3 | Private storage, consented extraction, confirmation, limits and cleanup |
| D-02 privacy | 0, 1, 3, 4, 5 | Purpose/retention, legacy isolation, minimal data, revocation/deletion |
| H-01 human handoff | 0, 2, 4 | Agreed secure transport, scoped partner view only if needed, attributed updates, owned exceptions and fallback |
| N-01 notifications | 4 | Consent, safe preview, quiet hours, delivery and suppression |
| X-01 accessibility | 2–5 | Automated plus manual critical-path and language checks |
| E-01 export | 3 | Reviewed source-to-PDF data, rendered pages and revision checks |
| M-01 measurement | 0, 2, 5 | Defined denominators, event instrumentation and reported uncertainty/cost |
| V-01 verification | Every phase | Runnable regressions and exact-candidate evidence |
| O-01 operations | 0, 1, 4, 5 | Owners, environment isolation, response processes, restore and release decision |

## 13. Change discipline

Use small, reviewable increments. Each non-trivial behavior change includes the smallest runnable regression that demonstrates the new behavior and its important failure path. Preserve security, validation, accessibility and recovery when reusing code. Apply both the normal correctness/security/privacy/accessibility/performance review and a separate Ponytail over-engineering/deletion pass for code reviews.

Do not weaken a guard because parent signup or document processing currently fails under the school rules; implement and test the parent-specific boundary. Do not discard the existing test suite because it describes the old product: keep school behavior verified while reachable, then remove proven-unused paths and their tests as a deliberate later change. Retain migration and audit history.

Completed phase work should update this plan's status and evidence links, the current PRD if a decision changes, README commands/capabilities, `AGENTS.md` if working rules change, and the parent-specific operations/release record. Historical school evidence remains unchanged and dated.
