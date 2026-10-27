# CaseLink parent support implementation plan

**Planning revision:** October 27, 2026 (America/New_York)
**Status:** R1 launch sequence L0–L6 defined; existing PECO/SNAP work preserved for R2; actual provider connections and family release gates remain open
**Product authority:** [Parent support MVP PRD](parent-support-mvp-prd.md)
**Current delivery backlog:** [Launch and expansion plan](parent-launch-and-expansion-plan.md)
**Working branch:** `main`
**Preserved case-manager baseline:** `codex/case-manager-baseline-2026-10-25` at `700bb46`

This revision implements the owner's direction for a stable researched MVP, then the full workflow portfolio without restarting engineering. R1 requires two complete workflows: confirmed food access and one adult career-support appointment lifecycle. R2 retains full food/utility C-01; R3 covers the remaining catalog. It supersedes the all-C-01-before-first-release rule, not privacy, product polish, maximum useful independence or actual execution evidence. Historical school evidence remains applicable only to its exact deployment. This planning update changes no runtime permission, live record or external action.

## 1. Deliver the complete product through internal increments

First deliver R1 through L0–L6 in the launch plan: current partner evidence, scoped data/authority, real adult booking and food allocation/fulfillment, polished combined experience, operations and observed pilot/release. L2/L3 require L1 and their own route contracts; either ready route may go first in the single implementation stream. The first candidates are Locke produce distribution and a minimal one-to-one career appointment; their actual access/capacity remain open. A list of links, prepared packet, generated resume or sent inquiry cannot replace a committed workflow. Change a provider within that workflow if its contract fails; do not restart the app or silently substitute a different outcome.

R2 covers C-01: immediate food, SNAP new/renewal/pending/routine problems, relevant WIC enrollment/continuing support, electricity/gas/water affordability/arrears/shutoff/disconnection and combined needs. R3's ordered catalog roadmap is in the launch plan. All advertised journeys need real autonomous or necessarily assisted completion contracts; R1 is not the completed full portfolio.

An early internal slice may complete one food or utility path. Use it to prove architecture and learn; do not treat it as permission to end product scope there. Broaden using reusable provider-permitted actions and secure channels, preserving actual required personal acts. A new portal, speculative connector or fleet of independent agents is not a prerequisite; enough tested execution capability to meet coverage is required.

Build one family service around purpose-scoped reusable facts/documents, one coordinating AI, verified program instructions and exact operations, meaningful evidence and follow-up. Use supported web, official-form/packet, secure partner and appointment channels as the chosen programs need them. The family experience is shared; a program's personal acts, accepted recipient, transmission and outcome evidence remain specific. Present actual browser activity for a web route, the exact packet for a document route and genuine receipt/status evidence for each channel.

The earlier [SNAP/PECO selection](verification/parent-snap-peco-route-selection.md) justified the internal PECO preparation proof. Preserve its packet/evidence work and the COMPASS handoff tests for R2; do not repeat that comparison as the next MVP step or make COMPASS acceptance a prerequisite for unrelated channels. Current working order is L0–L6, with separate normal and Ponytail review before each dependent piece.

After account setup and minimal facts, one informed authorization starts a bounded service mandate. AI chooses and pursues supported routes, reads/reconciles reliable evidence, prepares/completes permitted forms/submissions, coordinates appointments, supplies authorized information, checks status, follows up and recovers. Parent/operator intervention occurs for a classified necessary reason, not every routine decision. The server enforces mandate/provider permissions for each operation; agents cannot expand their own authority.

Human identity/signature/attestation/clinical/legal/financial requirements remain explicit and prepared. Product polish, source fidelity and household privacy are acceptance criteria throughout implementation. Do not lower them to meet an autonomy number.

## 2. Git, existing runtime and environment separation

| Item | Baseline |
| --- | --- |
| School source | Original `codex/school-pilot-readiness` branch remains at `38db6b6`; preserved baseline includes prior background-work instructions at `700bb46` |
| Main | Parent implementation proceeds on `main`; the case-manager baseline remains preserved on its separate branch |
| Application | Parent UI/API, ownership/grants, worker/service, documents/forms, exact operations/receipts, recorded background progress, request-scoped assistant and real public-resource discovery are implemented; live program transports remain disabled |
| Local assets | Existing untracked skills, design assets, output and temporary files remain untouched and outside these commits |
| Hosting/data | Original CaseLink identities reused through the reviewed additive parent/account boundary; school records/settings preserved. Private localhost connection is separate from synthetic tests and public deployment |

Local commits are not a remote backup or deployment. Do not force-push/reset shared history. Inspect hosting/Git behavior before a future push; retain disabled automatic main deployment until an explicit release decision. Git rollback cannot undo a migration, grant, application, shared packet or downloaded document.

Use reviewed forward migrations and separate synthetic environments. No existing school data is copied into parent households by assumption, and no parent identity inherits school staff/RPC access.

## 3. Existing application: reuse and required changes

The source map is based on local inspection, not a hosted capability audit. Review callers, schemas, configuration, exports, fixtures and tests before editing each affected flow.

| Area | Current source/foundation | Required product change |
| --- | --- | --- |
| Accounts/roles | `src/lib/parent/auth.ts`, parent sign-in/account components and reviewed shared-identity database controls; legacy password-session rules preserved | Complete hosted recovery/enrollment evidence, adult/acting authority, trusted memberships, scoped partner/operator access and current revocation |
| Database/RPC/storage | Family creator/assignment/admin policies and guarded routines in `supabase/migrations/` | Parent household/request and referral isolation, service grants/mandates, operation evidence, private files and purpose-specific deletion |
| Hosted posture | `src/lib/env.ts`, `src/lib/security/production-posture.ts`, `src/lib/security/deployment-boundaries.ts`, `.env.example`, CI | Explicit parent environment/identity rules and scoped worker runtimes with matching tests; preserve school deployment safeguards |
| Experience | Parent intake, My support, request detail, status/assistant/resource components and original Option 2 design tokens | Verify all real connected states, phone/reflow behavior and family comprehension; complete remaining product and hosted recovery states |
| AI | `src/lib/parent/coordinator.ts`, `assistant.ts`, scoped workers, validated Responses contracts and shared budgets | Verify capped real background planning and grounded request answers; finish permitted execution, targeted intervention and measured full-journey autonomy |
| Program network | Original directory with a safe four-record parent projection, public City food-site query and verified official routes | Finish accepted application/status transports, capability/permission evidence, known forms, recipient/data contracts and real completion rehearsal |
| R1 route additions | Existing strict need/program/packet/receipt schemas, `schedule` action, durable operations and scoped service grants | Add adult-career routing and minimal protected contact/availability fields with purpose/consent and database/API/assistant tests; implement one authorized calendar transport and the actual food allocation method. Neither route is currently just a provider toggle |
| Processing | Request-scoped durable grants/jobs, exact operations and fresh worker-health/progress records | Verify actual browser-independent continuation, cancellation, expiry, recovery and shared budgets in the approved private pilot |
| Privacy | `src/lib/privacy/no-pii.ts`, outbound guards | Purpose-specific parent document/required-field paths with model-minimized context; do not disable legacy protection globally |
| Documents/PDF | Reviewed-plan/takeaway renderer, `pdf-lib`, source/visual checks | Mobile capture, validated documents, known forms, immutable submitted packets/receipts and useful family exports |
| Communication | Auth templates, protected staff invitations | Full parent account/support message experience, consented automated partner follow-up and safe family updates through actual verified channels |
| Quality/operations | Vitest, real Auth/DB scripts, Playwright/axe, AI corpus, rendered-PDF CI | Expanded coverage, mandate execution, unnecessary-intervention tests, visual/language quality, provider failures and real-data/operating gates |

Read installed Next.js guides before framework code and current official vendor docs before integration. Keep Sol 6.1 as requested; a gateway/framework or specialist agent is introduced for a demonstrated execution need rather than as a speculative prerequisite.

## 4. Phases, dependencies and scope control

### Delivery rule: finish one tested piece before expanding

The owner reaffirmed that this is a large product direction, not a single implementation pass. **L0–L6 in the [launch plan](parent-launch-and-expansion-plan.md) now define actual R1 working order, estimates, owners and acceptance.** One main agent implements and a separate agent reviews each piece before dependent work; background source/owner setup may run in parallel. The numbered phases below remain the cross-release engineering/requirement map. The earlier A–H packages in the following table preserve the SNAP/PECO investigation and reusable R2 work; they do not override L0–L6. Code, synthetic tests and a polished screen do not establish an operational connection.

| Work package | Concrete result | Evidence required before the next dependent package |
| --- | --- | --- |
| A. Inspectable family workspace | Upfront known facts, explicit need selection, clickable checklist, contextual chat, accurate work/receipt states, responsive spacing and controls | Current [checkpoint](verification/parent-autonomous-workspace.md): 1,370 automated tests, 76 actual isolated account/workflow assertions, 53 responsive captures, 36 interaction states, rendered PDFs and independent correctness/Ponytail re-review. Restricted preview only; original-account live viewer authentication remains unverified |
| B. Compare and select the first complete route | A bounded SNAP signed-form/fax versus PECO CAP comparison covering exact requirements, personal acts, recipient/channel authority, delivery, program receipt, status, follow-up, outcome, family/operator effort and reusable components | Independently reviewed [selection record](verification/parent-snap-peco-route-selection.md) separates current sources, observations and open gates. Select the strongest next route with explicit reasons and the smallest acceptance checklist; no new transport, processor or private-data capture is enabled by selection. Keep the [COMPASS rejection evidence](verification/parent-snap-verification-investigation.md) and [alternative-channel research](verification/parent-snap-alternative-routes.md) visible; do not require COMPASS acceptance for a different supported channel |
| C. Prove the selected information/form/packet piece | Exact conditional intake and source-to-field mapping, applicable form/version/attachments, immutable packet and readable render using synthetic households; reuse only permitted fresh facts | Focused unit/integration and rendered-form tests cover applicable/skipped fields, missing facts, long/Unicode content, overflow, corrections, current version and exact packet fidelity. Review the whole affected caller/export/fixture flow before adding shared infrastructure. No invented answers/signatures or external sending; this proves preparation only |
| D. Implement the selected personal-act/data boundary | Only the selected route's required certification/signature/identity steps and protected data use, with prepared narrow handoff and automatic resumption; omit optional identifiers | Establish accepted personal-act handling and exact operational use before collection. Test household/subject authority, consent, corrected-packet invalidation, expiry/revocation/deletion, least-privilege use and model/log/screenshot/export exclusion. Follow the [protected identity contract](parent-sensitive-identity.md) only where a verified required field needs it; no speculative SSN vault or Plaid connection |
| E. Prove selected-route transport and receipt | Provider-permitted exact packet transmission, actual channel evidence and genuine receipt/reconciliation, with routine execution from the mandate | Approved isolated or controlled-recipient rehearsal proves destination/processor controls, stable idempotency, partial/unknown delivery, callback authenticity, corrections, restart/cancel/revoke and independently reviewed decision evaluations. Any live provider rehearsal needs its own authority; no synthetic government filing. Transport delivery remains distinct from program registration/acceptance; no placeholder success or routine final-review ceremony |
| F. Finish the selected return journey | Real status, missing-information requests, interview/appointment/personal steps, supplements, follow-up, decision and support-received attribution, with accessible return use | Verify the actual status/receipt contract, stale/unavailable evidence, wrong-case isolation, quiet follow-up, recovery and full lifecycle tests. Attribute operator/parent reports. Observe whether a parent understands what happened and their next step. Complete this lifecycle before broadening provider implementation; a PDF or successful send is not completion |
| G. Validate reuse on a second distinct route, then finish C-01 | A second meaningfully different supported channel/lifecycle using proven household/request/operation patterns, then remaining food/SNAP/WIC, gas/water/urgent and combined journeys | Independently review actual permission, fields/personal acts, delivery/status/outcome evidence and lifecycle tests per route. Extract shared behavior only where real routes demonstrate it. If PECO is first, retain SNAP as a required following route; a water web or WIC appointment journey can test different channel behavior after its gates pass. The route sequence does not remove remaining C-01 coverage |
| H. Family-ready release | Complete declared coverage, deployed protected services, polished UI/languages, operating owners and observed family use | The full PRD release record: exact candidate, security/restore/incident operations, accessibility/language/family observations, autonomy and intervention measures, monitoring, real outcomes and explicit launch decision |

For each package, the main agent traces the complete affected flow and records a small acceptance checklist before implementation. Build the smallest complete change using the existing stack, test its success and consequential failure paths, then have an independent agent review correctness/security/privacy/accessibility/regressions and separately run the Ponytail deletion pass. Fix findings and rerun affected checks before recording the milestone. Broaden regression testing when shared boundaries change; do not repeatedly run unrelated suites or add speculative abstractions. Preserve every existing package's tests as the next package is added.

Lifecycle completion means the accepted operating contract and tested receipt/status/follow-up/correction/closure behavior are established. Engineering need not wait for an agency's weeks-long decision before safe independent work or the next route can proceed; the real waiting case remains owned and tracked. An unproved status channel or missing operating contract is still a dependency, not a successful wait state.

At major checkpoints, also perform a goal-alignment review: record family work removed, each remaining/new prompt and why it is necessary, routine work still handled by people, the actual outcome proved and the next smallest change toward autonomous completion. Internal verification rehearsals are not permanent family steps. The finished service starts supported work from the mandate, automates reviewed routine transitions, reuses known facts and requests genuinely missing information together; opening the viewer observes ongoing work. A completed connection check must not look like a completed application or replace real filling, filing, receipt and follow-up evidence.

For the information bundle, inventory each field's source, household/subject, purpose, consent, freshness, permitted recipients and expiry against the actual published privacy/data policy before enabling persistence or reuse. Reuse eligible saved facts automatically; test correction, revocation, expired facts and deletion across requests, and prove that an agent read or a new request does not reset retention. Uncovered private-data storage remains disabled until the notice, actual controls and any required new permission are implemented; do not silently rewrite the policy to justify collection. This includes keeping agency-only identifiers outside ordinary profiles, models and logs.

Keep each next change reviewable: a provider feasibility change, a verified form mapping, a protected field channel, one execution operation or one lifecycle state is a suitable unit of work. Test and independently review each piece before the next dependent piece; do not treat the whole selected route as one implementation milestone. Do not batch unrelated UI redesigns, new providers and identity infrastructure into a supposed launch pass. A blocked provider contract does not justify expanding implementation into more unverified connectors. Complete safe, independent feasibility work and record the precise external dependency.

Phases 1–3 have local implementations and synthetic evidence, extended with recorded background progress, contextual chat and the inspectable workspace. The latest workspace checkpoint passed 1,370 automated tests across 179 files, 76 actual isolated account/workflow assertions, 53 responsive captures and 36 interaction states. The earlier bounded original-provider checks and exact disposable-probe cleanup are recorded separately in [background/assistant evidence](verification/parent-background-assistant.md). Phase 4 has execution/recovery foundations, real public discovery and partner-directory links, but no enabled external application transport. Phase 0 still needs complete external completion contracts and family discovery, and Phase 5 still needs release and family-observation evidence. See [implementation progress](parent-support-progress.md) and the [workspace checkpoint](verification/parent-autonomous-workspace.md) for current limits. The old 5–8-week estimate described a narrower product and is superseded. Phase 0 produces an evidence-based estimate for the full coverage/quality target after route feasibility and staffing are known. Time pressure can change delivery order or staffing; it must not silently redefine the completed product.

### Current implementation and next evidence

L1's [reviewed shared-data increments](verification/parent-shared-data-authority.md) now include exact requested-purpose binding, current-permission chat, intake source dates and exact-need restrictions, current-source model/packet projection, final source/routing checks and continued case recovery. **1,792 tests, 18 PDF pages and 160 native database assertions plus budget/concurrency checks passed.** This does not complete L1's actual adult-route data contract or enable a new purpose/transport. The [running owner-needs list](parent-owner-needs.md) tracks food allocation and adult host instructions; implement the selected route's minimum accepted fields/operations when that evidence arrives, without restarting the product or adding speculative private fields. Fix exact-packet personal-act renewal before a route using that evidence; otherwise retain it as an explicit R2 blocker rather than an unrelated MVP dependency. Continue focused tests and independent reviews before dependent execution. The October 30 checkpoint is an owner/evidence decision date, not a provider-response promise. The former existing-account preview approval has expired without renewal; all new migrations were applied only to the isolated local test database.

Preserved R2 evidence: the [SNAP/PECO comparison](verification/parent-snap-peco-route-selection.md) selected PECO CAP for the first non-sending preparation slice. The [PECO preparation checkpoint](verification/parent-peco-cap-preparation.md) records exact official-source mapping, synthetic drafts, field/overflow/render checks and independent normal/Ponytail clearance. This does not enable live family inputs, signatures, delivery or status; B's comparison and the bounded unsigned formatter proof are complete while C's information/evidence integration and D–F remain open for R2.

The following [income-evidence and certification checkpoint](verification/parent-peco-income-certification.md) adds independently reviewed metadata-only evidence readiness, a correction that shows all required personal acts together, and an actual offline selected-byte packet with page/hash/deadline binding. Current source research distinguishes standard evidence, whole-household zero, approved DHS sharing and actual provider-issued short consent; PECO's shipped online signature control has a different declaration and unproved authenticated operation. For R2, continue the accepted personal-act lifecycle, including genuine renewal after evidence expiry, while establishing protected income/identity projection and concrete signing/transport/status. This preserved route work does not override R1 L0–L6. Do not activate collection or transport merely because a packet or public signature component exists; C's real-data integration, D–F and full family-release gates remain open.

The [current COMPASS verification investigation](verification/parent-snap-verification-investigation.md) is the latest detailed browser-connection evidence. It distinguishes the corrected post-verification normal Next, an expected pending provider result, explicit human verification and confirmed rejection code 1053; the underlying reason remains unknown. Preserve original permission expiry, no input during unconfirmed waits, exact-session resumption and safe failed-run diagnostics. Real accepted resumption is required before household-field execution in that COMPASS session; a replay cannot close this gate. This gate does not block synthetic packet proof or an independently verified alternative submission/status channel. The [alternative-route assessment](verification/parent-snap-alternative-routes.md) and [SNAP/PECO comparison](verification/parent-snap-peco-route-selection.md) determine the next bounded route work without claiming either connection is complete.

- **Actual progress:** saved jobs, expiring worker health, next actor/trigger, necessary actions and pause/cancel/closed states drive status. Real synthetic planning completed after all test pages closed. A missed heartbeat is an unconfirmed service state, not proof the process stopped; no invented completion percentage or receipt is shown. Continue exact-candidate recovery, revocation/expiry and operating evidence rather than infer a permanent service from one run.
- **Family assistant:** Ask CaseLink uses GPT-6.1 Sol Responses in the private worker, selecting validated facts/actions from that owned request, saved progress, scope and official sources. It has separate consent, identifier/secret rejection, minimized context, attribution, queued/running/answered/failure/cancellation states and request/account/project budgets. A real answer completed after all test pages closed; detected SSN rejection, question cancellation, history export and denial of an anonymous conversation read passed. Questions do not submit, change facts or permissions, sign or restart a cancelled request. Continue broader lifecycle, availability and family-comprehension evidence.
- **Real resources:** public City API lookup supplies active ZIP-level food locations with retrieved source/time and unconfirmed availability; the original UESF, PECO and two PWD records project only safe public partner details. The actual connected rehearsal loaded all four safe records and live 19104 food results. Missing sources/records report unavailability rather than substitute fixtures. Next: establish real execution/receipt contracts per program. Listings/links do not reserve food, send referrals or apply for benefits.
- **SNAP:** the actual guest portal permits reaching a no-account path. Real isolated parent Auth/RLS and the native private browser service passed the independently reviewed [connection checkpoint](verification/parent-snap-connection-checkpoint.md). Its live automated browser still stops at DHS verification. The owner separately advanced an official browser tab to the blank first-person household form; [the same-tab inspection](verification/parent-snap-manual-verification.md) confirms its exact public field definitions without entering applicant information. A shared recognizer now fails closed on changed fields/routes. That separate manual observation transferred no cookies. The reviewed [same-session control implementation](verification/parent-snap-same-session-handoff.md) adds nonce-bound public input and automatic reviewed public transitions; isolated actual-Auth/Next/browser replay passes. The live private session accepted one ordinary continuation, but confirmed household-form resumption remains unproved and a later diagnostic confirmed rejection 1053 without establishing its cause. For R2, reuse the completed SNAP/PECO comparison and verify the selected accepted certification, delivery, registration, status and follow-up route rather than repeat comparison or depend on that browser barrier. Current R1 next work is L1. If COMPASS work resumes, its exact acceptance boundary remains mandatory. Preserve new-application versus continuing-case routing; no fake adapter or untested controls qualify as this work.
- **PECO CAP candidate:** evaluate the current official application and accepted channels through account-holder authority, required information, certification, secure transport, actual receipt, status and account outcome. Published destinations and a short form are feasibility evidence, not delegation, automated-delivery permission or a working status connection. Start only the selected reviewed piece; no CAP application transport is currently enabled.
- **Private pilot:** the owner approved up to 30 new synthetic validation calls and capped background planning/assistant availability for 24 hours on existing-account localhost. The actual database and private services are active until **October 27, 2026, 12:54:27 p.m. EDT / `2026-10-27T16:54:27.009Z`**, with a **100-call combined planning/chat project ceiling** plus narrower existing limits. The exact identity cutoff is `2026-10-26T17:29:15.717757Z`, including the approved disposable probe; new enrollment remains closed. The three restricted SQL credentials expire at the recorded deadline, with live processing checks still required. Final visual confirmation and cleanup are pending. Preserve original Auth/recovery configuration and the secret-free web server. No partner submissions or SSN transmission are included; [the shared-account guide](parent-shared-accounts.md) records both the boundary and the separate project-wide Storage-key residual risk. This does not approve public launch or complete Phase 4/5.

- **Conditional sensitive identity:** implement a verified form-required identifier through the [protected identity path](parent-sensitive-identity.md), with manual/provider entry first and optional approved Plaid Layer prefill. Required values must be accepted by that reviewed field; optional identifiers stay omitted. No SSN capture, vault, Plaid connection or sensitive submission is implemented/authorized by the current pilot. Keep ordinary chat/record guards until the protected channel exists; safe chat sanitization is a separate UX improvement. Establish actual recipient permission, isolated keys/token handling, artifact/export treatment and deletion evidence before enabling collection. Acquisition needs informed consent; routine authorized use does not add repeated approval.

R1's two complete workflows define its bounded release; full C-01 remains R2's definition of done, with later R3 catalog expansions. Necessary participation, polished UX and actual attributed outcomes apply to every release. Existing evidence does not convert preparation/chat into completed actions or replace privacy/vendor/operating gates with a zero-breach or legal-compliance claim.

| Phase | Deliverable | Main dependency | Exit distinction |
| --- | --- | --- | --- |
| 0 | Full coverage/capability matrix, autonomy mandate and family-ready design/feasibility baseline | Existing partners and family discovery | Establish what can execute independently and which personal acts are truly required |
| 1 | Parent identity, data ownership, service authority and isolated runtime foundation | Identity/data/mandate decisions | Real authorization/revocation works without relying on a live parent browser |
| 2 | Complete parent experience and service spine across coverage using synthetic channels | Phase 1 records and Phase 0 contracts | Internal working product, not a family release or substitute for real execution |
| 3 | Sol judgment, document reuse and supported forms with low-interruption behavior | Stable facts/mandates/requests and processing design | Routine decisions succeed without unnecessary reviews; uncertain/required acts pause narrowly |
| 4 | Verified independent execution and follow-up across C-01 | Actual provider/partner permissions and Phases 1–3 | Required APIs/secure channels/browser handovers and receipts, not a one-route handoff ceiling |
| 5 | Polished family-ready release, controlled pilot and outcome/autonomy review | Full applicable quality and real-data gates | Family-observed complete service with honest automated/assisted capability and measured exceptions |

Test during each phase; Phase 5 is not the first time privacy, autonomy or visual quality is evaluated. Work can overlap where interfaces are stable. Integration blockers stay visible in the coverage matrix with owner, evidence and alternative; operators cannot silently become the permanent implementation of routine AI work.

## 5. Phase 0 — full service, autonomy and execution feasibility

**PRD:** P-01, C-01, A-02, R-01, D-02, H-01, X-02, M-01, O-01.

### Deliverables

- Inventory existing partners against every C-01 journey and electricity/gas/water provider. Verify actual immediate-food routes, language/geography, required information, submission/status channels, appointment and document capabilities, personal acts, capacity uncertainty, escalation and fallback.
- For R1 complete L0's real food allocation and adult host contracts, controlled-test authority and receipt/change/fulfillment evidence. Retain the independently reviewed SNAP/PECO comparison for R2 rather than repeating it as the MVP starting point. Keep each small next milestone separate from transport activation or a completed-service claim.
- Classify each action as unattended permitted API/partner execution, tested browser-assisted work, required parent participation or qualified partner work. Record permission/delegation evidence and proposed adapter reuse. An absent API triggers investigation of permitted secure/browser/partner routes, not automatic exclusion of the journey.
- Define the standing mandate: individually named recipients/program set, purposes/actions/data/document use, preferences/booking windows, concrete duration, attempts/recipient limits, revocation and out-of-scope action approval. Test understanding of the initial authorization without adding redundant confirmation screens.
- Identify adult/third-party acting authority and household/account edge cases. Validate signup/recovery/contact access with families; select actual launch channels and advertise only verified languages/geography.
- Define supported facts/notice/form versions, source priority, field freshness, contradiction handling and when an otherwise clear fact requires a personal assertion. Government/clinical/financial acts remain specific per-route requirements, not blanket bans or permissions.
- Verify exact sensitive-field requirements and accepted recipient channels using the [conditional identity change map and acceptance tests](parent-sensitive-identity.md). Prefer official/provider-hosted entry; build only the narrow tokenized/encrypted delegated path an actual supported submission needs. Optional data prefill must have verified product access, subject binding, use/sharing and retention terms; it is not a phone-number identity lookup.
- Spike actual high-risk technical uncertainties with synthetic data: Sol tools/vision/async work, durable execution and grants, one permitted submission/receipt contract, status reconciliation, isolated known-form/browser handover and protected required-field entry where needed. These are early proofs, not the finished coverage.
- Approve parent data/vendor/minimization/retention controls and legacy isolation design. Validate confidential contacts/contracts outside public Git.
- Produce a complete family UX/state map and representative phone/laptop design, including capture, mandate, autonomous progress, real required action, waiting/failure/recovery, privacy/help and return use. Establish the complete visual/accessibility/language acceptance checklist.
- Freeze autonomy/intervention definitions and evaluation cases; set task/operator/messaging budgets, support ownership and justified effort/staffing estimates for the full product.

### Exit evidence

R1's two routes have L0 operating contracts and the required mandate/data/identity decisions; C-01 and the catalog retain named later work and evidence gaps. Unresolved external items can run alongside independent safe work. Missing R1 coverage blocks R1; missing C-01 coverage blocks R2, rather than deleting scope or indefinitely withholding a ready explicitly bounded R1. No contact, live submission or real parent processing is inferred from documenting a route.

## 6. Phase 1 — accounts, household data and scoped autonomous authority

**PRD:** P-02, A-02, D-02, W-01, O-01.

### Implementation

1. Keep development/staging synthetic and separate from production; reuse existing CaseLink identities in the explicit reviewed shared-account mode for the parent deployment. Preserve old migrations/history, school settings and records. Implement trusted adult ownership/acting authority, household/request records and password/code recovery, with enumeration protection and accessible contact options. Review project-wide Auth enrollment hooks before enabling new parent signup.
2. Add trusted partner/operator memberships and narrow referral access. Test every reachable legacy route/RPC against parent/partner identities. Operator content access is reasoned, scoped, time-limited and audited.
3. Add versioned standing mandates and request-scoped worker grants: recipient/program set, data/actions, duration/preferences/limits, suspension/revocation and action-specific approvals. A normal session closing does not kill authorized work; membership/account disable, security holds, expiry or cancellation does.
4. Implement deterministic per-operation policy checks for exact proposed packets, provider capability/permission, live mandate and household authority. One mandate supports multiple valid operations, each immutable and idempotent. A packet update inside its scope does not demand reapproval; an expansion or required personal act pauses only that action.
5. Implement private document metadata/storage and purpose/expiry, with real uploads disabled until processing controls are verified. Keep secrets/privileged credentials out of clients and ordinary web deployment; scoped worker operations are not blanket service-role access.
6. Update parent-specific environment validation, CI fixtures, configuration and Auth/session expectations together while retaining school guards and tests.

### Verification/exit

Real Auth/DB/storage tests prove parent A/B, partner/referral, operator and legacy isolation, current membership/revocation/security holds, account/acting authority, callback/file/export boundaries and ownership-tampering denial. Mandate tests prove in-scope automatic actions, expanded-scope stops, correct durable continuation after sign-out, concurrent cancellation/revocation and no duplicate effects. Recovery, deletion and session failures preserve work and privacy.

## 7. Phase 2 — complete family experience and service spine

**PRD:** P-03, C-01, F-01/F-02, U-01/U-02, W-01/W-02, H-01, N-01, X-01/X-02.

### Implementation

1. Build the actual parent surfaces and complete state inventory using current tokens/components. Include truthful public entry, account/recovery, Get support, My support, request detail, household settings, help/privacy, mandate control/history and printable views.
2. Implement adaptive intake for all covered intents, Not sure/manual paths, reuse of sourced facts, account-holder context and separate outcomes for combined needs. Keep urgent verified help independent of generation/login where appropriate.
3. Implement the short informed authorization and one-start experience, durable request/event model, real next actor/trigger, safe stop/resume and corrections. Include request-scoped grounded questions and truthful background status, with explicit consent, privacy, budgets and cancellation. Add optional direct control/preparation-only preference without making it the default journey.
4. Exercise planned coverage contracts through explicitly synthetic test adapters while building the real runtime connections. Runtime uses the actual source/transport or an honest unavailable state; it never substitutes fake sites, receipts or responses. Build a vertical slice first, then complete the matrix; do not label the first working route the completed product.
5. Model sent/received/accepted/submitted/approved/received-support separately, including multiple programs, pending outcomes, compatible parallel attempts and truthful alternatives. Unresolved closure records exhausted/unsafe routes or limits with an honest notice and re-entry/help path; parent silence alone never resolves a need or closes independent work.
6. Build a targeted intervention card/owned specialist exception with reason, prepared action and resume event. Avoid generic chat detours and full-journey pauses when one step needs help.
7. Build partner views only when a real route needs them; support the chosen secure transports and attributable updates. Synthetic message sinks and explicit fake receipts stay internal and cannot be mistaken for production success.

### Verification/exit

Headless complete-journey tests span C-01, combined needs, low-bandwidth interrupts, long waits, sign-out/return, cancellation, edits, changed grants and evidence distinctions. Test phone/laptop/reflow/keyboard/screen-reader critical paths and all empty/loading/error/waiting/success states using realistic content. Every advertised journey has a working internal completion contract; no hidden routine operator workaround or placeholder control passes this phase.

## 8. Phase 3 — autonomous judgment, document use and forms

**PRD:** A-01/A-02, D-01/D-02, F-02, U-01/U-02, E-01, V-01, M-01.

### Implementation

1. Extend current Responses contracts with typed scoped tools, budgets and validated results. Preserve Sol 6.1; verify deployed settings/access. Add research/preparation/execution/follow-up specializations only where they improve measured outcomes or implementation clarity.
2. Implement evidence-based urgency/fit/prioritization, compatible program selection, route choice, targeted questions and independent recovery. Record decision facts/alternatives/policy/reason without logging private chain-of-thought or exposing it to families.
3. Add source-backed field extraction and freshness/consistency checks across parent data, bills, notices and permitted provider results. Preserve source/page, units, income frequency/applicable period and route-specific age limits; calculations use tested deterministic rules. Auto-use clear current allowed values. A consequential parent correction invalidates queued uses of superseded facts and triggers reconciliation/correction of executed work. Self-reported model confidence does not waive validation, stale facts, contradictions or required personal assertions.
4. Implement polished mobile capture/upload/manual alternatives, actual type/size/page/encryption checks, safe isolated processing, model-minimized contexts and raw-file cleanup. Obtain understandable processing consent before the first upload/extraction even if it helps intake before the service mandate; that permission does not authorize sharing/submission. Parents are asked only for indispensable facts/unreadable input after permitted recovery.
5. Complete supported known forms/templates and online-field mapping with current versions, required attachments, source-to-field/render checks and no invented signatures/attestations. New layouts/requirements need controlled verification, not blind external experimentation.
6. Produce immutable attempted/executed packets and receipts plus useful family summaries from the same validated data. In-scope updates get automatic revalidation; changed purpose/authority/personal legal acts get the narrow required intervention.
7. Implement asynchronous independent work, durable bounded tool loops, route alternatives, source failure handling and meaningful progress. Keep identity/authentication secrets outside model context and general persistence; direct-entry/delegated credential paths are separately reviewed when needed.

### Verification/exit

R1's reviewed corpus contains at least 60 multi-step synthetic cases across its two routes, advertised languages and enabled actions; R2 expands coverage to every C-01 row. It tests correct judgment, use of clear facts without approval loops, notice handling, necessary intervention, compatible parallel work, route recovery, stale facts and corrections. Relevant negatives cover missing/personal assertions, source conflict, hallucinations, injection, unsafe files, unauthorized sharing, form-version changes and unsupported claims.

The source-to-form/PDF corpus passes exact values, current versions/attachments, Unicode/translated content, rendering and executed-version fidelity. File deletion/reuse/expiry and direct-secret exclusion pass read-back/log checks. Each automatic action is traceable to evidence and current authority. Failed or refused generation is never converted into fabricated success.

## 9. Phase 4 — independent permitted execution across full coverage

**PRD:** C-01, A-02, W-01/W-02, H-01, N-01, D-02, O-01.

### Implementation

1. Implement and verify the actual APIs, secure partner workflows, known forms and browser-assisted routes needed for C-01. Reuse adapters; do not force one transport or require a native API per program. Enable capabilities separately after permission, fields, data handling and recovery checks.
2. At every effect atomically claim the logical operation, enforce current mandate/grant and provider permission, validate exact payload/version/attachments, and preserve receipts. Routine supplements/follow-ups and permitted route changes proceed without a parent prompt; new scope, required personal acts and financial commitments pause appropriately.
3. Implement permitted application/referral submission, callback requests/booking inside stated preferences, document supplementation, actual status retrieval and follow-up. Check duplicate/overlapping applications and program compatibility; do not mass-submit or make new commitments.
4. For isolated browser execution, allowlist domains/actions and safely hand over required login/MFA/identity/signature/attestation or sensitive authenticated work according to provider/tool policy. No CAPTCHA bypass, credential disclosure or impersonation. Verified unattended API/partner delegation is a separate mode.
5. Reconcile unknown delivery before retry, verify callbacks/status, preserve evidence attribution and detect real missing requirements. AI handles routine replies and alternatives; qualified partners/operators resolve genuine exceptions with an accountable next step.
6. Deliver complete opt-in family updates and routine authorized partner follow-up through verified channels, with safe previews, quiet hours, delivery tracking, opt-out and useful deep links. Avoid soliciting family confirmation when a receipt/status tool can establish the result.
7. Implement all stop/expiry/offboarding/deletion behavior, route kill switches, source/capability changes, attachment expiry/recovery, limits and owned exceptions. Continue independent work when a single step pauses.

### Verification/exit

Every advertised action/channel has a permitted synthetic or partner rehearsal, including actual packet/mandate authorization, receipt, acknowledgement, follow-up and attributed outcome. Verify required personal acts are honored, while fully eligible cases proceed from one start without avoidable family/operator intervention.

Test partial acceptance/timeouts/restarts, concurrent revocation, unknown receipts, callback replay, browser layout/auth failures, closed sources, partner silence and duplicate suppression. Record verified agency submission separately from channel delivery and actual support separately from approval. Unverified routes remain explicit release gaps until a reliable autonomous or legitimately assisted completion contract exists; they cannot be hidden by shrinking advertised coverage after testing.

## 10. Phase 5 — polish, protected pilot and complete product release

**PRD:** all requirements; final X-01/X-02, V-01, M-01, O-01 acceptance.

### Gate before any real parent pilot or data processing

- Verify parent/partner/legacy isolation, adult/acting authority, current mandates/grants, consent, protected document/vendor/direct-field handling, data minimization/deletion/retention and safe notifications.
- Rehearse actual approved route permissions, required personal acts, receipts/reconciliation, urgent fallback, cancellation, limits, source integrity, incident handling, backups/restore and route stops in the isolated parent environment.
- Name operating owners/staffed hours/acknowledgement targets, partner contacts and privacy/security incident responders. Use synthetic data until these gates pass; calling a deployment a pilot does not waive them.
- Complete appropriate hosted Auth/messages/model/tool configuration checks on the exact candidate; do not reuse school approvals or historical test results.

### Family-ready product and pilot work

- Complete the declared release scope: both L-01/B-01 workflows for R1, all C-01 for R2, or the declared R3 wave. Complete X-02 screens/states, phone/laptop visual QA, applicable capture/manual alternatives, real notices, privacy/control/help, return links, useful artifacts and advertised languages. A closed research session evaluating an internal slice is not a release.
- Run the full relevant unit, real Auth/RLS/storage, integration, adversarial, end-to-end, accessibility/visual, AI-judgment and rendered-form/PDF suites. Test declared load (initial target: five concurrent households plus headroom), meaningful progress latency and affordable operating cost; revise assumptions with evidence.
- Recruit approximately 15–20 consenting households with accessible support and a representative coverage sample. Continue external follow-up through outcomes/explicit unresolved closure rather than ending at recruitment or a referral.
- Measure total family effort, eligible autonomous tasks, necessary personal participation, unnecessary interruptions, operator work, program-required partner service and failed/abandoned/pending work separately. Freeze eligible routine task definitions before evaluation; missing connectors or manual routine completion count as dependence/failure, not convenient exclusions.
- Compare with the PRD's proposed 80% routine-task autonomy target and strict critical failure rules. No score justifies bypassing consent, factual uncertainty, provider-required acts or privacy. Observe whether families understand the initial mandate and can pause/correct/revoke without navigating technical controls.
- Fix pilot findings, rerun affected regressions, and update public copy/privacy/terms/developer/operations docs to the actual product. The previous 5–8-week estimate must not force unannounced loss of coverage or quality.

### Finished-release gate

Record exact code/migrations/model/settings/playbooks/program versions, coverage/mode matrix, test evidence, actual autonomy/intervention/outcome denominators, privacy/operational controls, family observations, visual/accessibility/language checks and remaining limitations. The service owner decides launch or specific remaining work. One route, one happy family, a polished mockup, or a passing build cannot substitute for that record.

Stop the affected capability after unauthorized action/disclosure, fabricated personal facts/signature or action/award evidence, omitted required personal participation, duplicate submission, lost correction or unowned urgent exception. Restore only after the cause and relevant tests are resolved. Also resolve avoidable routine operator dependence and unnecessary confirmation loops as product failures.

## 11. Ordered expansion after the bounded MVP

Follow the launch plan's R2 utility/food-benefit completion and R3 employment/finance, housing/family support, school/routines/technology, childcare/camp/community waves. Each has concrete intended outcomes and additional authority/data/provider gates; booking one workshop does not complete an entire need area. Full C-01 remains mandatory for R2. New payment/financial commitments, caregiver collaboration and data purposes require their actual controls and permission. The roadmap does not approve future private-data collection. Reuse proven components; estimate each wave from actual route evidence and measured reuse at the preceding release checkpoint.

## 12. Requirement-to-phase traceability

| Requirement | Main phases | Acceptance evidence |
| --- | --- | --- |
| P-01 scope/truth | 0, 5 | Complete service definition, honest capability and outcomes |
| L-01 staged releases / B-01 adult booking | L0–L6, then phases 0–5 per release | Two complete R1 workflows and all applicable gates; preserved full C-01 R2 and catalog R3; no hidden operator, route substitution or restart |
| C-01 coverage | 0, 2, 4, 5 | Every food/SNAP/WIC/electricity/gas/water/combined journey and actual completion contract |
| P-02 ownership | 1, 4 | Real membership/authority/legacy isolation and scoped tool/storage denial tests |
| P-03 parent journey | 2, 5 | One informed start, minimum facts, controlled progress and targeted necessary actions |
| F-01 immediate food | 0, 2, 4 | Verified access/constraints, independent urgent route and follow-through |
| F-02 benefits | 0, 2–4 | New/renewal/pending/routine issue coverage; permitted steps and necessary personal acts |
| U-01 bills/urgency | 2, 3 | Source-backed auto-use, corrections/freshness, consequential ambiguity and urgent help |
| U-02 utility help | 0, 2–4 | Electricity/gas/water supported actions, compatibility, actual account outcome |
| R-01 program evidence | 0, 3, 4 | Fresh facts, capability/permission contract and controlled source changes |
| A-01 AI judgment | 3, 5 | Correct prioritization/route/field reuse/recovery and necessary-intervention evaluation |
| A-02 mandate | 0, 1, 4 | Named permissions, multi-operation auto-policy, exceptions/expiry/revocation and receipts |
| W-01 durable work | 1, 2, 4 | Browser-independent grants/waits/restarts/continuation/cancellation and safe retries |
| W-02 evidence | 2, 4 | Sent/receipt/acceptance/submission/approval/received-support distinctions |
| D-01 documents | 1, 3 | Capture/manual, safe extraction, provenance/current facts, form/attachment checks and cleanup |
| D-02 privacy | 0, 1, 3–5 | Pre-pilot consent/vendor/minimization/retention/deletion and household/legacy isolation |
| H-01 execution/help | 0, 4 | Actual API/secure/browser modes, required handover and owned qualified exceptions |
| N-01 communication | 2, 4, 5 | Meaningful routine follow-up, safe channels/quiet hours, receipt reconciliation and controls |
| X-01 accessibility | 2–5 | Full critical paths and advertised languages, phone/reflow/keyboard/screen-reader checks |
| X-02 family polish | 0, 2, 5 | Complete real screen/state inventory, visual QA, family observations and no hidden manual work |
| E-01 forms/exports | 3, 4 | Supported source-to-field/render/attachment and immutable executed-version fidelity |
| M-01 autonomy/outcomes | 0, 3, 5 | Frozen denominators, all intervention reasons, routine-task autonomy and total effort/cost |
| V-01 verification | Every phase | Runnable regressions, coverage corpus and exact-candidate evidence |
| O-01 operations | 0, 1, 4, 5 | Separate pre-pilot real-data and complete-product release gates, owners/alerts/restore/stop controls |

## 13. Change discipline

Use the smallest correct implementation that fully delivers these requirements. Reuse current patterns and installed dependencies; add focused integration/runtime components when they actually enable the requested independence. Do not use simplification to delete coverage, polish, consent, authorization, evidence, recovery or accessibility.

Every non-trivial logic change needs a runnable regression and the relevant verification layer. Code reviews include normal correctness/security/privacy/accessibility/performance checks and a separate Ponytail over-engineering/deletion pass. Keep school regressions while corresponding routes are reachable; remove proven-unused paths deliberately without rewriting migration/audit history.

Update phase status, PRD decisions, README/capability claims, AGENTS, configuration, actual test commands and parent operations/release evidence as implementation progresses. Remaining provider constraints and real necessary personal acts stay explicit. Internal milestones are a delivery method, not a license to label an incomplete handoff prototype the finished product.
