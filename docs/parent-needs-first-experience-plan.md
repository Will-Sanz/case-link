# Needs-first parent experience: supporting design

November 17, 2026 · America/New_York

**Post-meeting update:** the owner selected food first and explicitly requires guided questions so families do not need to know which program/support to request. The current executable food backlog, question/recommendation contract and implementing-AI kickoff prompt are in [Finish the food workflow](parent-food-workflow-completion-plan-2026-11-17.md). Its dated food priority supersedes this document's earlier near-term cross-program sequencing; preserve existing non-food work. This document remains supporting design detail, not a second competing backlog.

**Resource finalization:** Jared's four links were located in the November 17 “Food Resources” email and folded into the finalized implementation brief above. Local discovery uses the existing City source first, evaluates complementary Share records and Feeding America navigation, and verifies actual site-level access before consequential actions. The resource list is received; local execution authority and outcomes are not established by those links.

**Combined-chat baseline:** before implementation, read the checkpoint README at `/Users/willsanz/homelessness-project/tmp/parent-verification/food-first-checkpoint-2026-11-17/README.md`, then its `food-first-status.md`. The finalized food brief now records the comparison with `/private/tmp/caselink-reuse-review`, preservation of both copies' changes, existing optional-profile reuse, shared fixes, the remaining WIC reaffirmation gap and non-green/unrun verification. Reconcile those food/shared foundations before dependent intake integration; use test data, preserve the live demo during development and keep utilities/fleet/broader expansion paused; then perform the newly authorized gated final rollout. This supporting design does not authorize a separate conflicting implementation stream.

**Final delivery update:** the owner now requires GitHub publication/checks/review/merge and the actual controlled live deployment with post-deploy workflow verification at the end. Protect the current demo during development; the earlier no-final-rollout instruction is superseded. Follow the combined food plan and execution prompt for rollout, data preservation, exact-version checks and rollback. Utilities/fleet remain paused and provider/processing restrictions remain distinct. This document is supporting design; it does not start deployment by being edited.

**Status: supporting design, implementation pending.** This document supplies design detail to the combined food plan; it does not own a separate implementation sequence. Immediate food, SNAP, WIC and required family-profile/shared fixes are active. Utility/fleet/other expansion remains paused. The owner has authorized final GitHub publication/merge/deployment after verification; editing this document itself performs none of those actions. Preserve applicable [PRD](parent-support-mvp-prd.md), [implementation](parent-support-implementation-plan.md), [launch](parent-launch-and-expansion-plan.md) and [architecture](parent-system-architecture.md) requirements, using the latest owner decisions in the combined food plan for scope/order.

## 1. Product decision

Families describe the result they need. CaseLink identifies suitable supported paths, obtains the necessary facts and one informed authorization, and handles routine permitted preparation and follow-up. Families do not need to select the correct benefit journey or supervise internal steps.

Example: “We are short on groceries this week” can lead to immediate food information and a check of relevant longer-term support. It must not silently start SNAP, assume WIC eligibility, create duplicate applications or imply food has been reserved. Actual program names, information sharing and personal requirements remain understandable and controllable.

The parent's default view answers: **Does anything need me? What is CaseLink handling? What happened, and what comes next?** Applications, answers, documents, receipts, permission and stop controls remain accessible.

## 2. Grounding in the current product

Live inspection earlier on November 17 covered the homepage, Get support, My support and the existing fictional SNAP request, including its saved answers, next steps, official-site section and assistant. Observations are dated, not a fresh health claim about the separately changing deployment.

| Current surface or implementation | Carry forward | Change in this experience |
| --- | --- | --- |
| Homepage: “Food support for your family, made simpler,” panorama, violet CTA | Original CaseLink identity, recognition, urgent help and policy/contact links | Offer guided food questions with an optional description and a manual/program shortcut |
| Get support: seven food/SNAP/WIC choices and needs/details/permission stages | Proven typed forms, relevant questions, source and purpose controls | Make guided questions the default; allow a description or explicit service shortcut |
| My support: request cards and progress | Owned saved requests and evidence-backed state | Present family goals, necessary actions and meaningful updates first |
| Request detail: eight checklist sections | Exact forms, correction, documents, official access, history and controls | Consolidate the default summary; make detailed sections secondary destinations |
| Coordinator: GPT selects programs inside an existing request's mandate | Sol Responses, strict outputs, validation and budgets | Add a distinct, limited interpretation step before the service mandate |
| Workers, protected services and program routes | Existing durable execution, exact packets, personal acts, reconciliation and deletion | Reuse them after authorization; this is not a replacement execution engine |

The public site currently advertises food/benefits. Local WIC/utility additions and their collection/execution gates have separate release status. Interpretation of a broad need cannot activate an unfinished route. The live request reported background planning unavailable during inspection; future reassuring copy must depend on verified service state.

## 3. Proposed family journey

### A. Explain a situation or answer guided questions

Keep the existing homepage style and family panorama. Offer “Let’s find food support that works for your family” with guided ordinary-language choices, Not sure and optional text. A family need not know what to type or which program to choose. Keep the explicit service-selection shortcut available and urgent official help usable without sign-in or model generation.

Explain the intended use before model processing. The entry is a description of need, not a channel for identifiers, credentials, signatures or private application documents. Sensitive guest drafts must not enter URLs, analytics, localStorage or sessionStorage. The first implementation keeps guest text in memory and requires the existing authenticated account plus the applicable notice before submitting it for interpretation. Do not open anonymous model access or new enrollment as a shortcut.

For internal navigation, a small client-only memory handoff can preserve the draft through the existing sign-in flow; verify actual router refresh behavior. A full reload/external recovery may clear an unsaved guest draft. Explain that boundary rather than persist sensitive guest text secretly. Auth/recovery behavior itself stays owned by the existing account implementation.

### B. Establish intent with minimum questions

Use the description, authorized current saved facts and actual request history. Distinguish immediate food, new benefits, renewal, pending application and existing-benefit problems. “My SNAP stopped” is not evidence that a new application is appropriate. Do not treat missing facts as an eligibility rejection.

Ask an ambiguity question only when it changes the path. Group known required questions in compact accessible forms once the relevant path is established. Reuse the existing program-specific forms rather than generating arbitrary application fields or turning every field into a separate chat turn. Check existing compatible facts first, preserving source, period, corrections, scope and original expiry.

For WIC, the applicable notice/purpose gate precedes private questions. Utility-specific collection/integration remains paused. A broad description does not permit health-data collection, cross-program private roster copying or account/identity inference. Detecting secrets is defense in depth, not proof that free text is safe. Unexpected protected information must not be queued or dispatched to the model through this entry.

### C. Explain and authorize the proposed work

Present a concise plan naming the actual programs, reasons they may fit, allowed actions, information use, limits, duration and stop controls. Separate executable, preparation-only and currently unavailable paths. Let the parent exclude a path or change a meaningful preference without having to design the workflow.

Processing a needs description and authorizing external service work are different permissions. The triage notice allows only the former. One informed service mandate covers the exact supported recipient/action/data scope; it does not authorize arbitrary future recipients. Routine in-scope work then proceeds without repeated approval. Preserve SNAP's expressly requested genuine exact-application review and Submit, required certifications and other provider-specific personal acts.

### D. Start the existing execution flow

Validate the proposal on the server against the current program catalog, route requirements, source validity, processing controls, required facts and permissions. Revalidate when the parent starts because availability or authority may have changed after interpretation. Create the existing typed request using existing idempotency and atomic private-start behavior. The model cannot construct a grant or supply a verified receipt.

For the first complete slice, support a food need leading to immediate public food information and one appropriately selected existing SNAP journey. Public lookup remains information, not allocated food. Unfinished renewal/status/execution routes remain honest about their actual capability; a new-application connection cannot stand in for them.

Do not send a combined WIC/SNAP proposal into a single-program private-start API; do not start new utility work. Initial integration can use the one existing compatible request shape; unsupported combinations must remain proposed, not partially authorized behind the parent's back. When compound private starts are actually needed, the route and experience owners jointly specify exact grants, durable creation/recovery and per-path outcomes before enabling them. Do not add a general case-grouping platform now.

### E. Follow the work and handle necessary participation

Keep My support as the returning-parent home. A family-goal title can sit above named program paths without changing request IDs, splitting historical packets or migrating records merely for presentation.

Default summary:

- **Needs you:** only genuine missing facts, expanded permission, required personal acts, meaningful choices or reliably unresolved execution/safety issues. Explain why and open the exact relevant action.
- **CaseLink is handling:** real current work, who is expected next, last recorded update and the next scheduled check/event when known.
- **Updates and results:** meaningful prepared/sent/received/approved/received-support events with attribution. Each path retains its own outcome.

Provide reachable applications/documents, activity/receipts and permission/control destinations. Keep corrections, export, help and deletion available. Show official website/browser work prominently only for an actual required interaction; opening a viewer never initiates routine work. One request-scoped assistant answers questions about this work; the homepage entry starts new support. Updating facts or starting another action through chat requires its own explicit validated implementation and is not included automatically.

Waiting on an agency, waiting on the parent, a worker outage and unknown delivery must look different. “Nothing needs you” can coexist with a service problem, but must never imply CaseLink is actively working when that cannot be verified. Notifications use the existing consented channel and privacy-safe outbox; no sensitive application content in push/email previews.

## 4. Parallel work and ownership

Planning can proceed now. Implementation branches can proceed concurrently only where their actual file/API contracts are independent. Separate branches or worktrees isolate source changes, not live databases, ports, budgets, credentials or provider actions.

| Workstream | Owns | Coordination needed |
| --- | --- | --- |
| Existing release and final rollout | Existing Auth/service behavior, GitHub release and deployed evidence | Preserve the demo during development; follow F5 for the authorized controlled final replacement |
| Reconciled food implementation | SNAP/WIC/profile requirements, private forms, protected execution, receipt/status and outcome evidence | Preserve both chats’ work and reconcile through F0; utility/fleet expansion stays paused |
| Needs-first experience | Homepage entry, bounded interpretation, relevant questions, initial plan and simplified summary | Consumes the verified route contracts; does not declare their readiness |
| Shared-file integration | Intake, request creation, domain/mandate validation, progress and worker dispatch | One implementer per shared slice; reviewed commits integrate sequentially |

High-overlap files: `src/features/parent/intake.tsx`, `api.ts`, `application-workspace.tsx`, `support-detail.tsx`, `support-progress.tsx`, `parent.module.css`; `src/app/api/parent/requests/route.ts`; `src/lib/parent/domain.ts`, `programs.ts`, `policy.ts`, `data.ts`, `worker-runtime.ts`; and additive SQL migrations. The current working tree already contains route work in many of these files. Do not deploy or copy that whole tree as a UI change.

At kickoff, each workstream records its exact reviewed base and shared-file owner. Transfer a narrow commit, file-scoped patch or documented interface, not unrelated uncommitted work. No outside message is sent by this plan; the owner can paste the handoff below into the other chat.

## 5. Bounded pre-request AI design

The existing `parent_jobs` requires a unique real `request_id`; assistant messages/call records also require a real request. The current coordinator filters programs through an already accepted mandate. Therefore reusing either unchanged would require inventing a request/permission before the parent has authorized it.

The proposed narrow addition is one authenticated, purpose-limited intake-draft operation in the same private runtime. If durable model processing is needed, add one owned intake-draft record with bounded queued/leased/result/expired/cancelled states, following existing assistant lease/idempotency patterns. It has no provider-execution grant. Do not make ordinary request/assistant foreign keys nullable or introduce a generic agent/task platform. The additive migration must specify the actual processing notice, allowed minimized fields, rights/export/deletion, retention and account-level budgets before real use; new storage and model processing are not authorized merely by this document.

If the actual async flow requires durable draft work, the web API queues only that bounded work and returns an owned draft handle. A private worker checks owner/account, processing permission, current revision, expiry, cancellation and budget before dispatch and before result commit. Editing invalidates old results; uncertain responses reuse the exact attempt. Fixed expiry follows the approved policy and is not renewed by reads/polling; an expired draft cannot start a request. Prefer existing validated forms and deterministic branching for simple questions, and do not add this queue merely because it is described here. Model credentials remain private in either implementation.

Model input: permitted minimized description, explicit current routing facts, relevant owned existing-request summaries and server-selected supported candidates. No raw protected documents, private WIC/utility detail, identifiers or full account history. Use the current Sol Responses integration and existing privacy/budget patterns; no web-runtime model key.

Model output: validated known need/journey IDs, candidate program IDs, bounded source-backed routing reasons and IDs of vetted missing questions. Parent statements, inferred possibilities and verified facts remain distinct. The model cannot author arbitrary fields, URLs, eligibility decisions, signatures, permissions or status claims. Render ordinary-language explanations from validated output and reviewed source text. The current post-authorization coordinator remains separate and reusable.

Do not create a second source of program truth. Project the current catalog, verified requirements and runtime capabilities read-only. Provider/model failures offer the existing manual entry and official help, preserving the draft where permitted. Do not repeatedly call a failed model or silently choose a benefit application. Confidence percentages are not a decision gate; evaluation must establish which ambiguous cases need clarification.

## 6. Apply this design through the single F0–F5 backlog

The combined food plan is the only executable backlog. Do not create or restart a separate N0–N5 stream.

| Design responsibility | Owning food work package |
| --- | --- |
| Source/authority/capability contract, existing profile and recovery | F0: reconcile both copies and close the WIC reaffirmation gap |
| Guided entry, relevant questions, proposed plan and readable summary fixtures | F1, with fixture-only work permitted while unrelated external checks wait |
| Bounded interpretation where needed, exact questions/fact reuse and typed request/mandate start | F2 after its affected F0/F1 contracts and checks |
| Accurate ongoing status/summary/assistant, necessary personal steps and returning use | F3 and the actual food journeys in F4; shared display/control work is integrated with its evidence source |
| WIC, SNAP continuing journeys and verified local-food routes | F4; utility/fleet/catalog expansion stays paused |
| Complete language/account/visual/operating acceptance, GitHub and actual live verification | F5 and the execution prompt’s release procedure |

Each affected piece receives normal correctness/security/privacy/accessibility/performance/regression review and a separate simplicity/deletion pass. Preserve original branding and actual routes; a fixture prototype is not completion. Integrate shared files sequentially, use the existing release path and re-estimate from current evidence without inventing a launch date or hosting purchase.

## 7. Verification and measures

Freeze expected behavior before model runs. Extend the existing [AI evaluation](parent-ai-evaluation.md) for natural-language intake; existing program-selection results do not validate the new responsibility. Preserve its applicable V-01 full model-run review requirements and use approved capped synthetic runs. No new model call or spend is authorized or performed here.

Required cases include urgent food without SNAP, explicit new SNAP, renewal, pending case, stopped benefits/notice, ambiguity, combined needs, voluntary refusal of a proposed route, unsupported provider/geography, closed collection purpose, model outage, unsupported language, prompt injection, unexpected sensitive text, stale/corrected/withdrawn saved facts and an existing application that must not be duplicated. Test missing information without fabricated answers or automatic rejection.

API/database/worker tests must prove cross-household and school-role denial, no external operation from triage, notice/permission ordering, cancellation, fixed expiry, stale-result rejection, bounded model use, exact retry/unknown-result handling, interrupted/repeated sign-in and idempotent start. New SQL changes require native security/concurrency/rollback checks alongside the existing legacy coverage.

Actual browser tests cover description through necessary questions, informed start, saved request and personal-step return; manual alternatives; back/forward and refresh recovery; 320px reflow, touch/keyboard/screen-reader focus; retained drafts; accessible loading/empty/waiting/error/success; readable language and family comprehension. Preserve document-consent, protected entry, known-form content/rendering and PDF export tests even when those screens become secondary. An English model or configured Spanish preference does not establish Spanish quality.

Compare the same declared scenario set against the current manual flow. Record total family time, questions/fields, repeated facts, routine versus necessary interventions and reasons, operator work, failed/abandoned tasks, latency/cost and attributed outcomes. Include missing connections and failures in the denominator; do not count a synthetic receipt or proposed program as successful help.

Before release, verify actual worker health, page-close/sign-out continuation within mandate, outages, safe recovery, revocation/correction, deletion/retention and truthful next-check state on the exact candidate. Capacity claims require representative concurrency/resource/cost tests; a read-only dashboard does not establish fleet capacity.

## 8. Direction checkpoint

**Family work targeted for removal:** selecting benefit jargon, finding the correct workflow, repeated general facts, monitoring internal steps and routine follow-up.

**Participation retained for an actual reason:** indispensable unresolved facts, the initial named mandate or expanded scope, required personal authentication/signature/attestation, meaningful choices and qualified judgments. A developer rehearsal or missing connector is not a provider-required family task.

**Routine work still missing:** the combined plan records current SNAP/WIC/local-food accepted delivery/status/outcome gaps. This design does not finish them or assign them invisibly to an operator; utility expansion stays paused.

**Outcome proved by this planning task:** a grounded UX/technical sequence and coordination boundary. No family effort reduction, AI quality, live route, new capacity or release is claimed. The next source-integration task is F0 reconciliation; F1 guided-question fixtures may progress independently where their dependencies allow.

## 9. Handoff into the combined food implementation

> Use the combined food plan and persistent execution prompt as the single assignment. Read the checkpoint README, then its food-first status; reconcile SNAP/WIC/optional-profile and required shared fixes from both copies in isolation. Keep utilities/fleet/other expansion paused. Families start with guided questions or an optional description; existing typed forms, protected boundaries, one named mandate and actual provider requirements remain. Preserve the current demo during development, then complete the authorized GitHub publication/checks/review/merge and controlled live rollout with post-deploy verification. Do not treat this supporting design as another backlog or a reason to rebuild the profile, queue, Auth, theme or service engine.
