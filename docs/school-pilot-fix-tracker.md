# CaseLink school-pilot fix tracker

**Reviewed:** October 13, 2026 · **Repository baseline:** `e0cb389` · **Status:** implementation in progress on `codex/school-pilot-readiness`.

**Intended rollout:** a few staff at one school, working with real family circumstances. This is not yet approval to store identifiable education or family records. Current product policy requires non-identifying labels and de-identified narrative.

**Recommendation:** complete this first-priority readiness workstream before routine school use. A successful build is not sufficient evidence that account setup, AI recommendations, concurrent edits, and PDF export work together safely. Use synthetic cases for the school demonstration until the applicable release gates below are evidenced.

The current product is family intake → barriers → a goal-based intervention plan with confirmed dates → human review → a professional black-and-white PDF downloaded for manual use. Blank-PDF upload, field detection, form filling, and automatic submission are outside this release. The current decisions in [AGENTS.md](/Users/willsanz/homelessness-project/AGENTS.md) take precedence over older roadmap language.

## How to use this tracker

There are 41 pilot-readiness records (CL-01–CL-39, CL-41–CL-42) and one optional Decisions API evaluation (CL-40). Engineering implementation is assigned to Codex; school, privacy, and operations owners still need to be named. Check a record only after its completion tests pass, then add implementation and test evidence below. Each item is committed separately; its commit is discoverable with `git log --grep='CL-NN'`. A verification record closes with evidence or produces a concrete defect; it does not mean the hosted system is already known to be broken.

- **Fix:** source-confirmed defect or missing behavior.
- **Reproduced:** additionally demonstrated with synthetic local inputs or mocked services.
- **Verify:** required deployment or workflow evidence not available in this audit.
- **Decide:** a product, school, or operating-policy decision is needed before implementation can be finalized.
- **Gate A:** privacy, access, and data integrity. Implement first.
- **Gate B:** reliable and useful daily workflows. Complete before routine pilot use.
- **Gate C:** prove the complete release in staging and record operating readiness.

All gates are part of the requested first-priority workstream. Ordering is not permission to skip the earlier findings. Blank-form filling remains a separate future project.

## Final pilot scope check — October 13, 2026

The scope review retains every original finding and adds explicit production hosting/release controls (CL-41) and secret management (CL-42). The user subsequently authorized implementation, tests, and per-item commits/pushes. Production promotion, paid purchases, and school sign-off remain explicit launch steps.

| Area | Required before this pilot | Outside this pilot |
| --- | --- | --- |
| Core product | Invite staff; create a family profile with a non-identifying label; record barriers; generate/edit a dated goal plan; record progress; review; download the reviewed black-and-white PDF | Blank-form uploads, field detection/filling, signatures, CitySpan integration, automatic submission |
| AI | Correct generation, both refinement flows, and case assistant; grounded resources; preserve human edits; tested failures and usefulness | Decisions API adoption, model-platform migration, agents, new autonomous tools |
| Accounts | Invitation, initial password, login, recovery, session handling, admin MFA, least privilege, offboarding | Public self-signup; building institutional SSO unless the school makes it a launch requirement |
| Data | Agree permitted data, enforce it, test authorization/privacy, approve retention/deletion and vendor handling | Adding identifying fields or broadening data use without the explicit CL-01 decision |
| Hosting | One managed production deployment for this school's trust boundary; isolated synthetic staging; controlled release, monitoring, restore/rollback | Kubernetes, self-hosted database/Auth, multi-region failover, microservices |
| Scale | Test a few concurrent staff plus headroom and realistic case histories; repair currently supported query limits in CL-37 | Building multi-school tenancy, district analytics, speculative high-volume infrastructure |
| Verification | Authenticated end-to-end, database, accessibility, AI evaluations, and rendered current-plan PDFs, with recorded owners/results | Adversarial uploaded-PDF tests for a feature absent from this release; a claim that tests guarantee all future AI answers |

**Scope rules for implementation:** CL-38's multi-school paragraph is a future expansion condition, not a request to build organization management. CL-12 requires accurate current documentation and removal of proven unused paths, not a general refactor. CL-21 covers the selected production models and supported edit types, not every model/API. CL-39 confirms dates through the reviewed-plan workflow; it does not require a separate confirmation click for every field. CL-40 stays optional and cannot delay closure of otherwise complete pilot gates.

The privacy decision must be settled before staff training: real circumstances entered in de-identified form are compatible with the current product policy; identifiable records require a separately approved control/data-policy change before use. School-required SSO, residency, procurement, or accessibility requirements must be recorded early rather than discovered on launch day. Existing roadmap/runbook statements about uploaded blank PDFs are pending correction under CL-12 and are not this pilot's acceptance criteria.

Use a declared synthetic workload for the final rehearsal: provisionally five simultaneous staff, a short burst of ten sessions, and 100 families with histories, multiple plan versions, and enough child rows to exercise API caps. These are test targets, not measured capacity or a statement of the school's actual caseload. Reconcile them with the school before sign-off; keep the existing 25-case initial and 50-case performance evaluation requirements below.

## Production hosting and secrets recommendation

**Recommended pilot architecture:** the existing Next.js application on managed Vercel hosting; managed Supabase for Postgres and Auth; direct server-side OpenAI calls; the existing browser-generated PDF download. Use a separate staging Supabase project with synthetic data and separate provider credentials. Prefer Vercel Pro and Supabase Pro as the starting production plans, subject to the school's requirements and verified current entitlements/costs; buying a plan does not establish application security. Vercel supports this Next.js deployment directly. Supabase's production guidance describes free-project inactivity pausing and recommends appropriate backup/recovery provisions. [Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs), [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod).

The repo is not starting from no hosting configuration: [vercel.json](/Users/willsanz/homelessness-project/vercel.json) defines a Next.js deployment and verification build, and the public site responded during the audit. That does not establish account ownership, plan, deployment provenance, or production settings; CL-41 verifies those instead of creating duplicate projects blindly.

**Kubernetes is not needed for the stated pilot.** It would introduce responsibility for cluster upgrades, workload configuration, networking, access policy, monitoring, and recovery while leaving the application defects unchanged. Revisit only if measured workload or an institutional hosting requirement justifies it. Kubernetes Secrets are not a substitute for a secrets-management design: upstream defaults store them unencrypted in etcd unless encryption is configured, although managed distributions may apply stronger defaults. [Kubernetes secret guidance](https://kubernetes.io/docs/concepts/security/secrets-good-practices/).

**Secrets:** use the hosting platform's managed Secret variables for credentials required by the deployed app and an access-controlled encrypted operator vault for administrative/recovery credentials. Vercel Secret values cannot be read back by members after saving, but remain available to deployments; production and nonproduction values can be separated by policy. Reviewed deployment code still has access, so protect who can deploy and which builds receive secrets. [Vercel Config and Secret variables](https://vercel.com/changelog/environment-variables-now-use-config-and-secret-types).

| Credential/configuration | Intended location | Boundary |
| --- | --- | --- |
| Production `OPENAI_API_KEY` | Production Vercel Secret, scoped to a dedicated provider project | Server only; separate test key; budgets/alerts; no prompt/response logging |
| Supabase secret/service-role key | Protected operator vault or restricted operator job for invitations/imports | Not needed by normal user-bound web requests; omit from app deployment unless an audited runtime use appears |
| Production database password, migration/admin tokens | Protected operator/CI environment only for the specific approved operation | No preview, browser, ordinary build, or routine developer access |
| Auth SMTP password | Supabase Auth's SMTP settings; recoverable operator-vault record where appropriate | Separate test delivery; not an app client variable |
| Hosting/DNS/email/account recovery credentials | Encrypted operator vault with named access and recovery owners | MFA; individual operator accounts; no shared plaintext document |
| Supabase URL and current `NEXT_PUBLIC_SUPABASE_ANON_KEY` / publishable equivalent | Public environment configuration | Intended for clients; authorization must come from authenticated user sessions and RLS |
| Local-development credentials | Separate development values in gitignored local environment or vault injection | Never pull/copy production secrets into routine local development |

The Supabase public key is not the privileged secret; secret/service-role credentials can bypass row-level security and must remain protected. A key-format migration is not required merely to complete this pilot. [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys).

Keep a recovery point and test restoration. The runbook currently targets at most 24 hours of lost writes and restoration within 8 hours; the school must accept or tighten these targets. Daily backups may meet that loss window; enable point-in-time recovery if a smaller window is required and verify it in a restore drill. Select backup retention consistent with the approved deletion policy. [Supabase backup options](https://supabase.com/docs/guides/platform/backups).

An additional external secrets service, an AI gateway, and Kubernetes are not launch prerequisites. Introduce another service only for a documented access, rotation, or institutional requirement, with its data path and failure handling reviewed.

## Evidence and limits

| Check | Observed result | What it establishes |
| --- | --- | --- |
| `npm run verify` | Passed: lockfile/resource-seed/secret checks, TypeScript, zero-warning lint, 36 test files / 109 tests, production build | Existing repository checks pass; they do not cover the entire staff journey |
| Production dependency audit | Failed: four affected packages; one critical and three high classifications | Dependency remediation remains required despite the successful build |
| Ten additional characterization probes | 10/10 reproduced the behavior described below, using synthetic data and mocked OpenAI responses | Evidence of defects; these are not passing safety/regression tests |
| Earlier focused probes | Offset timestamp rejected; plan-child query error appeared as empty content; identifier detector missed examples | Concrete reproduction beyond code inspection |
| Public deployment checks | Canonical site health endpoint returned 200; anonymous `/families` redirected to login; security headers present | Public routing and liveness only |
| Real database security suite | Not rerun: local Docker daemon was stopped | Existing CI database job and older reports are not fresh passing evidence |
| Hosted Supabase inspection | Actual application project was not available through the connected project inventory | Deployed policies, migrations, Auth settings, and backup configuration remain unverified |
| Authenticated browser / email / live AI evaluation | Not performed | No claim that end-to-end onboarding or model usefulness has been certified |

The local verification used Node 24.3; CI selects Node 20. Strict hosted-production posture was not established by the local build. Recheck the actual deployment runtime and configuration in CL-36. No live family data was sent to an AI service, and no invitation or reset emails were sent during the audit.

### Additional synthetic reproductions

The temporary characterization suite was run with Vitest outside the application test tree. Each assertion deliberately confirms today's wrong behavior; implementation should add tests for the corrected behavior in the normal suite.

| Probe | Actual result | Record |
| --- | --- | --- |
| Same timestamp with `.123456+00:00` versus `.123456Z` | Offset rejected; Z accepted | CL-03 |
| Chat history with 40 versus 42 messages | 40 accepted; 42 rejected | CL-24 |
| 1,200-character existing summary followed by new contact restriction | New restriction absent from planning brief | CL-23 |
| Refinement baseline with one approved action | Replaced with two generic actions | CL-29 |
| Model step containing an invented agency and phone | Accepted by output schema | CL-06 |
| `john smith needs help` and `Call 2155550123` | Neither flagged by identifier detector | CL-01 |
| Assistant history containing synthetic directory phone `215-555-0199` | Follow-up privacy validation rejected | CL-18 |
| Mocked HTTP 200 response with `status: incomplete` and partial text | Returned `ok: true` | CL-19 |
| Responses task with `OPENAI_MODEL_OVERRIDE=gpt-4o` | Request sent to Chat Completions | CL-20 |
| Single-step model answer containing a new task and October 20 target date | Returned refinement omitted action items and that date | CL-26 |

## Original findings: all retained

| Earlier issue | Tracking record |
| --- | --- |
| 1. Real-data policy and incomplete identifier detection | CL-01, CL-18, CL-36 |
| 2. Vulnerable production dependencies | CL-02 |
| 3. Database timestamp format rejected by save validation | CL-03 |
| 4. Sensitive drafts persist in browser storage | CL-04 |
| 5. Stale screen can approve an unseen plan revision | CL-05 |
| 6. AI can invent resource contact details | CL-06, CL-33 |
| 7. Offboarding does not guarantee immediate database denial | CL-07 |
| 8. Missing end-to-end, accessibility, AI, and rendered-PDF evidence | CL-08, CL-34, CL-35 |
| 9. Plan query errors can appear as empty plans | CL-09 |
| 10. AI budgets interrupt ordinary planning work | CL-10 |
| 11. Admin MFA required without a complete user flow | CL-11 |
| 12. Documentation and unused code describe deferred PDF features | CL-12 |

## Gate A: protect access, information, and approved work

### [ ] CL-01 — Agree and enforce the real-data boundary

**Type:** Decide + Reproduced · **Responsible:** product/privacy owner with school administrator.

The privacy page and operating runbook permit de-identified casework, not identifiable family records. The identifier detector misses plausible names and unformatted phone numbers; passing its scan does not establish de-identification. Staff could mistake a technical warning system for permission to enter names, contact information, or detailed identifying narratives.

**Fix:** document exactly what staff may enter, who controls the records, retention/deletion, access, incident responsibilities, and provider handling. Keep the current restrictions unless the school and service owners approve a broader data model and its controls. Improve representative detector gaps without promising perfect detection.

**Close with:** school-approved data examples and training; tests covering identifier variations and legitimate resource facts; an approved retention/access/vendor record if identifiable information will be allowed. **Sources:** [privacy guard](/Users/willsanz/homelessness-project/src/lib/privacy/no-pii.ts), [privacy page](/Users/willsanz/homelessness-project/src/app/privacy/page.tsx), [runbook](/Users/willsanz/homelessness-project/docs/production-operations-runbook.md).

### [x] CL-02 — Resolve production dependency advisories

**Completed October 13, 2026 (Codex; correctness/security and Ponytail review):** Next/ESLint config 16.3.8, sharp 0.35.5, nanoid 3.3.20, and source-map-js 1.2.2. Production audit reports zero vulnerabilities. Full verification passed (37 files / 113 tests, including real PDF rendering). Node 24 production smoke: health and login 200, anonymous family access redirects to login, image optimizer 200. Hosted project uses Node 24.x. Authenticated end-to-end proof remains tracked in CL-08. Development-tool advisories still exist and must be assessed as part of the release tooling review; they are outside this production-only audit result. Commit: `git log --grep='CL-02'`.

**Type:** Reproduced · **Responsible:** engineering.

The October 13 production audit flags `next` 16.3.0, pinned `sharp` 0.35.0, `nanoid`, and `source-map-js`. The advisory classification is not proof that every affected feature is reachable in this application, but the dependency gate currently fails.

**Fix:** select compatible patched versions using the current advisory ranges; update the lockfile and remove/adjust the vulnerable override as needed. Do not apply an unreviewed force upgrade. Rerun the audit when implementing because advisory ranges can change.

**Close with:** zero unresolved findings at the configured CI threshold, full verification, and auth/image/PDF smoke checks on the supported runtime. **Sources:** [package manifest](/Users/willsanz/homelessness-project/package.json), [lockfile](/Users/willsanz/homelessness-project/package-lock.json), [Next advisory](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4).

### [x] CL-03 — Accept database timestamps without weakening conflict detection

**Completed October 13, 2026 (Codex; correctness/security and Ponytail review):** step/action/meeting validation accepts offsets without converting or truncating timestamps. Removed redundant string-equality prechecks; the atomic database timestamp predicate decides revision equality. Nine regression tests cover offset/Z/equivalent timezone values, unchanged microseconds, malformed revisions, and conflict responses. Five failed before the fix and all now pass. Local database integration verifies real PostgreSQL JSON timestamps, equivalent representations, and stale-write rejection. Typecheck/lint pass; the full suite/build also runs in the required pre-push hook. Commit: `git log --grep='CL-03'`.

**Type:** Reproduced · **Responsible:** engineering.

Save schemas use `z.string().datetime()` while callers pass database timestamps that can include `+00:00`. An otherwise valid update fails before reaching its conflict check. The barrier action accepts offsets but delegates to a rejecting schema; meeting-progress validation has the same mismatch.

**Fix:** accept the database's valid timestamp representation consistently. Preserve sub-millisecond precision used for optimistic concurrency; converting through a JavaScript Date can lose that precision.

**Close with:** step, action-item, and meeting saves using actual database-returned timestamps; equivalent valid offset forms; malformed values rejected; stale concurrent writes still rejected. **Sources:** [plan validation](/Users/willsanz/homelessness-project/src/lib/validations/plans.ts:112), [progress action](/Users/willsanz/homelessness-project/src/app/actions/case-progress.ts), [barrier action](/Users/willsanz/homelessness-project/src/app/actions/barrier-workflow.ts:212).

### [ ] CL-04 — Make unsaved-work recovery safe on shared computers

**Type:** Fix · **Responsible:** engineering + privacy owner.

The plan editor saves the entire draft to `localStorage` every 250 ms, before server validation. Its key identifies the plan, without user scope or expiry, and sign-out does not clear these drafts. Disallowed identifying text can therefore remain on the device even when saving is rejected.

**Fix:** choose a recovery mechanism consistent with CL-01, with explicit user scope, expiry, and logout/account-switch handling. Preserve recoverable work across session renewal without silently keeping raw case content indefinitely. Do not solve this by disabling recovery altogether.

**Close with:** shared-device account switch, logout, expired-session recovery, abandoned draft expiry, storage-disabled/quota errors, and rejected-PII draft tests. **Sources:** [draft persistence](/Users/willsanz/homelessness-project/src/features/families/family-plan-panel.tsx:446), [sign-out](/Users/willsanz/homelessness-project/src/app/actions/auth.ts).

### [ ] CL-05 — Bind review and export to the revision the person saw

**Type:** Fix · **Responsible:** engineering.

Review submits family and plan IDs without an expected revision. If another staff member changes the plan after a screen loads, the first person's click can mark the newer unseen content reviewed. Existing review invalidation after edits does not prevent this race.

**Fix:** make review an atomic check of the displayed plan revision and its relevant children. Record reviewer and revision; export exactly that reviewed content. Preserve the intended distinction between a material plan edit and a progress-only update.

**Close with:** two-tab edit/review races, edit during review, stale export, and material-edit invalidation tests in both the database and browser. No unseen revision may gain review evidence. **Sources:** [review payload](/Users/willsanz/homelessness-project/src/lib/validations/plans.ts), [review UI](/Users/willsanz/homelessness-project/src/features/families/family-plan-panel.tsx:1202), [review transaction](/Users/willsanz/homelessness-project/supabase/migrations/20260804173443_production_hardening.sql:1520).

### [ ] CL-06 — Ground resource facts in approved records

**Type:** Reproduced · **Responsible:** engineering + resource owner.

Model output accepts arbitrary contact names, phones, and emails and maps them into plan details. Prompt instructions against invention do not enforce a relationship to a real directory entry. Contact fields are also treated differently from narrative by privacy controls.

**Fix:** have AI identify approved resource records and copy their factual details deterministically. Validate references and distinguish supplied facts, missing facts, and proposed wording. Never invent eligibility, openings, operating hours, or contact details to complete an answer.

**Close with:** invented/altered phone, unknown resource ID, dismissed/inactive resource, stale information, and no-resource cases across generation, both refinements, chat, and PDF. All factual contacts must trace to approved source data. **Sources:** [lean output schema](/Users/willsanz/homelessness-project/src/lib/plan-generator/lean-plan-schema.ts), [resource context](/Users/willsanz/homelessness-project/src/lib/plan-generator/resource-context.ts).

### [ ] CL-07 — Make offboarding deny access at the database boundary

**Type:** Fix + Verify · **Responsible:** engineering + pilot administrator.

`can_access_family` checks ownership, assignments, and admin status without a separate active-account/session-revocation condition. Ending refresh sessions alone does not guarantee that an already-issued access token immediately loses direct Data API access while its permissions remain. Supabase documents that revoked-session access tokens remain valid until expiry. [Supabase sign-out behavior](https://supabase.com/docs/guides/auth/signout).

**Fix:** define an auditable offboarding operation that removes effective access immediately, revokes sessions, and safely preserves/reassigns cases. Enforce the inactive-user condition or equivalent removal of effective permissions inside database authorization, not just navigation.

**Close with:** retain a synthetic user's access token, offboard them, then prove direct reads/writes/RPCs fail for owned and assigned cases; cover admin downgrade, session refresh, reassignment, and audit history. **Source:** [family access policies](/Users/willsanz/homelessness-project/supabase/migrations/20260321120000_family_rls.sql:18).

### [ ] CL-11 — Complete administrator MFA enrollment and challenge

**Type:** Fix + Verify · **Responsible:** engineering + administrator.

Database admin privilege requires an AAL2 session, but the app has no complete TOTP enrollment/challenge flow. The invitation script only tells the operator to require enrollment. A password-only administrator can therefore sign in without being able to perform intended admin work.

**Fix:** support enrollment, verification, login challenge, and a documented recovery procedure. Preserve the database AAL2 guard; do not relax it to make onboarding appear successful.

**Close with:** first admin setup, returning login, incorrect/expired code, recovery, factor removal, and direct AAL1/AAL2 authorization tests. **Sources:** [admin guard](/Users/willsanz/homelessness-project/supabase/migrations/20260804173443_production_hardening.sql:82), [invitation script](/Users/willsanz/homelessness-project/scripts/invite-user.ts), [auth components](/Users/willsanz/homelessness-project/src/features/auth/login-form.tsx).

### [ ] CL-18 — Validate the exact outbound AI content, with provenance

**Type:** Fix + Reproduced · **Responsible:** engineering + privacy owner.

`familyPrivacyFields` does not include plan steps/details/action notes, although related AI paths use saved plan content. Conversely, chat scans assistant history as though every phone or email were a family identifier: an answer quoting a legitimate directory phone can block the next question.

**Fix:** validate the actual provider-bound payload, including saved and unsaved plan text. Keep trusted directory facts distinguishable from user narrative and untrusted model claims. Never solve the false positive by exempting all assistant text or all contact fields.

**Close with:** a synthetic identifier placed in each outbound field is caught before the provider call; legitimate source-backed agency contacts remain usable on follow-up; fabricated contacts cannot obtain the same exemption. **Sources:** [privacy field collection](/Users/willsanz/homelessness-project/src/lib/privacy/no-pii.ts:237), [assistant validation](/Users/willsanz/homelessness-project/src/app/actions/case-assistant.ts), [step refinement](/Users/willsanz/homelessness-project/src/lib/plan-generator/openai-refine-step.ts).

### [ ] CL-27 — Preserve human work when applying AI edits

**Type:** Fix · **Responsible:** engineering.

Single-step preview sends only the saved step ID and feedback, not the current unsaved draft. Applying it replaces details and resets checklist completion. A request to improve one sentence can overwrite unrelated edits or completion evidence.

**Fix:** generate from the explicitly selected draft and base revision; apply a validated, reviewable change to the requested fields only. Protect owner, completed work, outcomes, manually confirmed dates, and unrelated details. Ignore stale previews after editing, canceling, or switching actions.

**Close with:** unsaved manual edits plus rewrite, narrow wording change, completed checklist, stale response, cancel/reopen, and changed base revision tests. **Sources:** [preview/apply UI](/Users/willsanz/homelessness-project/src/features/families/family-plan-panel.tsx:925), [saved-step lookup](/Users/willsanz/homelessness-project/src/app/actions/plans.ts).

### [ ] CL-28 — Match full-plan refinements by stable IDs

**Type:** Fix · **Responsible:** engineering.

Full-plan AI input omits step/action IDs and action status/outcomes. Application matches the response by array position and retains existing statuses. If two same-phase tasks are reordered without changing counts, a completed status can attach to the wrong task.

**Fix:** use stable step/action IDs and scoped patches; reject unknown, duplicate, or unauthorized IDs. Preserve completion and ownership independently of wording/order. Treat explicitly requested structural changes as separate reviewable operations.

**Close with:** swapped same-phase steps, swapped action rows, duplicate IDs, deleted IDs, completed actions, and another family's IDs. No outcome or completion history may move to a different action. **Source:** [full-plan preview and apply](/Users/willsanz/homelessness-project/src/features/families/family-plan-panel.tsx:1001).

### [ ] CL-30 — Save one reviewed edit transactionally

**Type:** Fix · **Responsible:** engineering.

Full-plan save loops through steps, and each step then saves action items separately. A later failure leaves earlier changes committed. The UI can keep old base timestamps after the partial save, so retry can conflict with its own earlier writes.

**Fix:** use a scoped database transaction for one user-confirmed edit, including expected revisions and audit evidence. An individual step edit that updates its actions needs the same all-or-nothing behavior. Reuse the repository's existing transactional RPC pattern.

**Close with:** force failure on the second step and second child update; assert no partial content or audit commit; prove stale-version rejection and a successful retry without duplicates. **Source:** [step persistence and bulk save](/Users/willsanz/homelessness-project/src/features/families/family-plan-panel.tsx:622).

### [ ] CL-38 — Prove least-privilege access and the one-school boundary

**Type:** Verify · **Responsible:** engineering + pilot administrator.

Application authentication and family-level row policies are good foundations, but the deployed policy state was not inspected. Current admin authority is installation-wide; the production posture is explicitly single-tenant. That is appropriate only when the installation's trust boundary matches the school pilot.

**Fix/verify:** exercise every family-scoped server action and direct database operation with owner, assigned staff, unrelated staff, unprovisioned user, anonymous caller, and AAL1/AAL2 admin. Verify grants, cross-family child relationships, audit immutability, and no client-chosen privilege escalation. Before another independent school joins, explicitly choose isolated deployments or organization-scoped authorization.

**Close with:** fresh database suite plus authenticated staging evidence against the deployed migrations. Record the school boundary; do not infer multi-school isolation from family RLS. **Sources:** [security suite](/Users/willsanz/homelessness-project/scripts/test-database-security.ts), [session authorization](/Users/willsanz/homelessness-project/src/lib/auth/session.ts), [production posture](/Users/willsanz/homelessness-project/src/lib/env.ts).

## Gate B: complete the staff workflows

### [x] CL-09 — Surface plan-loading failures instead of empty content

**Completed October 13, 2026 (Codex; correctness/security and Ponytail review):** child query failures now abort the family detail load instead of producing an empty plan. Eleven tests independently fail every constituent query and distinguish absent content from unavailable content; both child-query cases failed before the fix. The existing route error boundary supplies retry, and server callers cannot proceed with a partial returned family. Targeted tests, typecheck, and lint pass; full verification is required on push. Commit: `git log --grep='CL-09'`.

**Type:** Reproduced · **Responsible:** engineering.

`getFamilyDetail` handles parent-query errors but discards errors from plan-step/action-item queries. A failed child query can produce an apparently empty plan or missing tasks, inviting regeneration or incorrect advice.

**Fix:** propagate a recoverable load error and retain a previously loaded view where appropriate. Distinguish absent content from unavailable content; do not generate or review against a partially failed load.

**Close with:** independently fail parent, step, action-item, resource, and progress queries; show an explicit retry state and prohibit consequential writes using incomplete context. **Source:** [family detail loader](/Users/willsanz/homelessness-project/src/lib/services/families.ts:299).

### [ ] CL-10 — Budget AI around complete staff journeys

**Type:** Fix · **Responsible:** engineering + service owner.

A plan phase costs two units and the per-user phase limit is six units per ten-minute window. A successful three-phase plan consumes that allocation; immediate regeneration or a retry can be blocked. The displayed error always says to wait a minute, even for a different wait, disabled AI, or an unavailable budget control.

**Fix:** set measured limits for a complete plan plus ordinary repair/refinement work; retain shared server-side abuse/cost controls. Return a safe reason and actual retry time through callers. Reject invalid oversized input before charging its generation budget; avoid duplicate charges for duplicate jobs where appropriate.

**Close with:** two consecutive family plans, malformed-output repair, local quota, global quota, AI-disabled state, unavailable control, and concurrent-user tests. Show accurate recovery without losing completed stages. **Sources:** [rate policy](/Users/willsanz/homelessness-project/src/lib/rate-limit/ai-rate-limit.ts), [shared counters](/Users/willsanz/homelessness-project/supabase/migrations/20260804173443_production_hardening.sql:720), [AI client](/Users/willsanz/homelessness-project/src/lib/ai/client.ts).

### [ ] CL-12 — Reconcile product scope and remove proven unused paths

**Type:** Fix · **Responsible:** product + engineering.

README, PRD, privacy/operations material, and retained PDF helpers describe blank-form preparation that current product decisions defer. Operators and school staff could prepare for unsupported behavior. The separate Ponytail deletion pass found 149 lines of PDF inspection code and a 10-line field-policy helper without production callers; retained tests are their references.

**Fix:** update current-facing promises and release checks to reviewed-plan PDF export. Reconcile the legacy `CASELINK_PDF_MODE=fillable-only` schema/startup requirement with the actual export-only product, preserving the privacy and deployment checks. Label historical design documents clearly. Remove the unused helpers and obsolete tests if still unused at implementation; keep PDF dependencies needed by the actual renderer. Recheck dead AI task/mode configuration before removing it.

**Close with:** repo-wide reference search, updated school-demo instructions, and normal verification. Preserve historical data/migrations unless a separate reviewed migration is required. **Sources:** [README](/Users/willsanz/homelessness-project/README.md), [PRD](/Users/willsanz/homelessness-project/docs/intervention-planning-prd.md), [PDF inspector](/Users/willsanz/homelessness-project/src/lib/paperwork/pdf-form.ts), [field policy](/Users/willsanz/homelessness-project/src/lib/paperwork/field-policy.ts). **Lean opportunity:** at least 159 implementation lines, zero dependencies established for removal.

### [ ] CL-13 — Make invitation retry and partial provisioning recoverable

**Type:** Fix · **Responsible:** engineering + pilot administrator.

New users receive an invitation before the role-provisioning RPC completes. If provisioning fails, an Auth account/email can already exist. Re-running the script finds the existing account and changes its role but does not resend an expired or unopened invitation.

**Fix:** provide explicit, auditable invite/resend/repair operations with safe idempotency. Distinguish inviting a new person, resending setup, and changing an existing person's role; never reset an established account accidentally.

**Close with:** first invite, existing active user, expired invite, failed role RPC after email creation, retry, duplicate operator requests, and wrong-role input tests with a synthetic mailbox. **Sources:** [invitation workflow](/Users/willsanz/homelessness-project/scripts/invite-user.ts), [provisioning safety](/Users/willsanz/homelessness-project/scripts/provisioning-safety.ts).

### [ ] CL-14 — Make auth callbacks and failures finish predictably

**Type:** Fix + Verify · **Responsible:** engineering.

The callback supports PKCE codes, token hashes, and fragment sessions. Its async work has no outer failure handler, and its redirect guard does not prevent duplicate one-time token exchanges. Strict Mode/remount races are a test risk, not a reproduced production failure. Several auth forms also lack an explicit thrown-error path.

**Fix:** give every supported callback and network failure a finite, safe result; allow only intended verification types; prevent competing exchanges/redirects. Preserve safe internal redirects and token cleanup. Handle sign-out failures deliberately instead of ignoring the SDK error result.

**Close with:** the auth matrix below, including expired/reused links, remount, missing verifier, bad type, malformed fragment, denied cookies, provider outage, and sign-out failure. **Sources:** [callback](/Users/willsanz/homelessness-project/src/app/auth/callback/auth-callback-client.tsx), [login](/Users/willsanz/homelessness-project/src/features/auth/login-form.tsx), [forgot password](/Users/willsanz/homelessness-project/src/features/auth/forgot-password-form.tsx), [sign-out](/Users/willsanz/homelessness-project/src/app/actions/auth.ts).

### [ ] CL-15 — Define and complete initial-password and reset behavior

**Type:** Fix + Decide + Verify · **Responsible:** product + engineering.

Invited users are directed to password setup, but there is no explicit server-enforced setup-complete state. A valid invitation session can navigate elsewhere first; that is an onboarding-policy gap, not proof of unauthenticated access. Password UI advertises length only while local Auth requires mixed case, digits, and symbols. Successful reset redirects to login while retaining a session, and the login page redirects signed-in users to Families.

**Fix:** decide whether password setup must finish before workspace use, enforce that decision, show the actual password policy, and make the post-reset destination intentional. Cover secure-password-change reauthentication if enabled; do not tell users to request a new link for every ordinary policy error.

**Close with:** initial invite setup, attempted skip, password mismatch/policy rejection, fresh and older recovery sessions, repeat submission, old-password denial, new-password login, and intended session revocation. **Sources:** [reset form](/Users/willsanz/homelessness-project/src/features/auth/reset-password-form.tsx), [login route](/Users/willsanz/homelessness-project/src/app/login/page.tsx), [Auth configuration](/Users/willsanz/homelessness-project/supabase/config.toml).

### [ ] CL-16 — Ship and verify the actual account emails

**Type:** Fix + Verify · **Responsible:** engineering + operator.

Email-template documentation instructs operators to install `recovery.html`, but that file is absent. Some template expiry wording differs from local OTP settings. Neither fact proves which template is installed in the hosted project.

**Fix:** supply a correct recovery template, align link lifetime wording with actual configuration, and verify invite/recovery/security notifications through school email filtering. Confirm one canonical HTTPS origin and exact redirect allowlist, including apex-to-www behavior and cross-device recovery.

**Close with:** delivered messages in a synthetic school mailbox, correct single-use links, scanner/preview behavior, expiry and resend, no sensitive tokens in diagnostic logs, and recorded hosted template/SMTP settings. **Sources:** [template instructions](/Users/willsanz/homelessness-project/supabase/email-templates/README.md), [magic-link template](/Users/willsanz/homelessness-project/supabase/email-templates/magic_link.html), [site-origin helper](/Users/willsanz/homelessness-project/src/lib/auth/public-site-url.ts).

### [x] CL-17 — Include provisioning safety tests in CI

**Completed October 13, 2026 (Codex; correctness/security and Ponytail deletion review):** the standard Vitest include now covers `scripts/**/*.test.ts`. All four provisioning safety tests run in the same CI command as application tests. Full `npm run verify` passed: 37 files / 113 tests, typecheck, lint, secret/resource/lockfile checks, and production build. Invalid production inputs, roles, and invitation origins are explicitly rejected. Commit: `git log --grep='CL-17'`.

**Type:** Fix · **Responsible:** engineering.

The four tests in `scripts/provisioning-safety.test.ts` are outside Vitest's `src/**` include patterns. The standard verification command therefore does not run them.

**Fix:** include this exact security-test location or move the tests into a discovered location. Keep the command unambiguous rather than adding a second forgotten test runner.

**Close with:** CI output explicitly includes these tests; a deliberately invalid production/test provisioning input fails. **Sources:** [tests](/Users/willsanz/homelessness-project/scripts/provisioning-safety.test.ts), [test discovery](/Users/willsanz/homelessness-project/vitest.config.mts), [CI](/Users/willsanz/homelessness-project/.github/workflows/ci.yml).

### [ ] CL-19 — Handle AI terminal states before accepting text

**Type:** Reproduced · **Responsible:** engineering.

The Responses parser accepts any returned output text on HTTP 200 without checking response status, incomplete details, or refusal. A truncated assistant answer is presented as complete. Structured parsing may reject broken JSON, but that does not cover partial prose or semantically incomplete valid JSON.

**Fix:** distinguish completed output, refusal, incomplete output, provider error, malformed response, and timeout. Preserve safe error categories/retry information. No partial response should become approved or silently committed content. Bound retries by reason, budget, and idempotency.

**Close with:** mocked completed, token-limit, content-filter, refusal, empty, malformed, 429/Retry-After, 5xx, timeout, and network-abort responses across all callers. **Source:** [AI response handling](/Users/willsanz/homelessness-project/src/lib/ai/client.ts:354). [OpenAI output handling guidance](https://developers.openai.com/api/docs/guides/structured-outputs).

### [ ] CL-20 — Keep API routing and model capabilities explicit

**Type:** Reproduced + Verify · **Responsible:** engineering.

Setting `OPENAI_MODEL_OVERRIDE` silently sends ordinary Responses tasks to Chat Completions. Model validation is prefix-based and capability checks infer support from a few model-name patterns. This can accept a nonexistent/incompatible model or send unsupported parameters. No live account-model compatibility check was performed.

**Fix:** keep the endpoint choice stable when overriding a model. Support a small tested set of deployed model/parameter combinations; fail clearly on invalid configuration. Evaluate any model change for quality, latency, and cost rather than replacing the default based on its name.

**Close with:** default and per-task/global override contract tests plus a synthetic smoke request on the actual OpenAI project for every selected model. Verify reasoning, temperature, token limits, structured output, and `store: false`. **Sources:** [routing](/Users/willsanz/homelessness-project/src/lib/ai/client.ts:159), [model configuration](/Users/willsanz/homelessness-project/src/lib/ai/models.ts), [allowlist](/Users/willsanz/homelessness-project/src/lib/ai/model-allowlist.ts).

### [ ] CL-21 — Use one tested structured-output contract

**Type:** Fix · **Responsible:** engineering.

Current lean generation/refinement calls explicitly use `strict: false`, and hand-written JSON schemas can drift from local validation and persistence. Strict output alone would still not prove factual correctness.

**Fix:** use a supported strict schema for each structured task, reusing the installed Zod/schema helper where suitable. Model optional values explicitly, then run semantic checks for allowed IDs, dates, task identity, contacts, and protected edits before saving. Align valid cardinality/date ranges between manual edits, AI previews, and storage.

**Close with:** missing/extra fields, nulls, length/count boundaries, invalid dates, unsupported schema, all supported model contracts, and semantic rejection tests. **Sources:** [schema helper](/Users/willsanz/homelessness-project/src/lib/ai/structured-json-schema.ts), [lean generation](/Users/willsanz/homelessness-project/src/lib/plan-generator/openai-plan-lean-phase.ts), [refine schema](/Users/willsanz/homelessness-project/src/lib/plan-generator/plan-refine-lean.ts). [OpenAI strict schema requirements](https://developers.openai.com/api/docs/guides/structured-outputs).

### [ ] CL-22 — Give the assistant the progress it claims to know

**Type:** Fix · **Responsible:** engineering + case-manager reviewer.

The assistant claims live context about blockers and progress but primarily receives summary, barriers, resource matches, step titles, and one current step. It omits the action-level target dates, completion/outcomes, and recent meeting updates needed to answer “What should I prioritize this week?” accurately.

**Fix:** build bounded, authorized context from the same next-work/date/status rules used by the workspace, plus relevant recent progress. Distinguish missing information from known facts; keep source references to actions/resources and make context limits clear.

**Close with:** overdue task, completed task, waiting follow-up, updated meeting outcome, conflicting older notes, no plan, and inaccessible-family fixtures. Answers should reflect the latest approved case state. **Sources:** [assistant context](/Users/willsanz/homelessness-project/src/lib/case-assistant/ai-case-assistant.ts:13), [existing next-work logic](/Users/willsanz/homelessness-project/src/lib/domain/family-workspace/next-work.ts).

### [ ] CL-23 — Preserve important instructions and one consistent generation context

**Type:** Reproduced + Fix · **Responsible:** engineering.

The planning brief places extra feedback after existing notes and slices the combined text to 1,200 characters. A long saved summary can discard a new contact restriction entirely. Staged generation also rebuilds prompts from freshly loaded detail while passing the saved brief as feedback, allowing duplicated or mixed-revision context.

**Fix:** preserve explicit new instructions and critical constraints; bound context deliberately and surface material omissions. Generate all stages from an identified case revision/snapshot, or explicitly invalidate/restart when relevant inputs change. Include appropriate recent outcomes when regenerating.

**Close with:** long notes plus final critical instruction, many barriers/goals, refresh between phases, case edit during generation, and regeneration after completed work. No silent omission of the requested change. **Sources:** [planning brief](/Users/willsanz/homelessness-project/src/lib/plan-generator/planning-brief.ts), [staged actions](/Users/willsanz/homelessness-project/src/app/actions/plans.ts:547).

### [ ] CL-24 — Bound chat history before validation

**Type:** Reproduced · **Responsible:** engineering.

The browser sends every previous message, but the server accepts at most 40. After 21 successful question/answer pairs, the next request contains 42 prior messages and fails until the conversation is cleared. The later 12,000-character formatter cannot fix validation that already failed.

**Fix:** send a bounded set of complete recent turns, enforce total input size, and show the question-length limit. Preserve necessary continuity without growing browser/API payloads indefinitely.

**Close with:** 0/40/42/100 prior messages, long assistant answers, an overlong question, and a useful follow-up after trimming. **Sources:** [history builder](/Users/willsanz/homelessness-project/src/features/families/case-assistant-chat.tsx:154), [request schema](/Users/willsanz/homelessness-project/src/lib/validations/ai-actions.ts).

### [ ] CL-25 — Recover from failed or superseded AI requests

**Type:** Fix · **Responsible:** engineering.

Chat clears the input and appends a user message before the request succeeds, without a retry/edit state. “New conversation” remains available while a request is pending, so its old answer can arrive in the new conversation. Refinement preview promises lack a catch/finally path and can remain pending after an unexpected rejection.

**Fix:** preserve failed text for retry/edit; give requests an identity so superseded replies are ignored; settle every pending state on success, failure, cancel, and navigation. Reuse existing UI conventions rather than a new workflow framework.

**Close with:** failed send/retry, clear during request, switch family/action, duplicate click, late response, thrown server-action error, and keyboard-only recovery. **Sources:** [chat](/Users/willsanz/homelessness-project/src/features/families/case-assistant-chat.tsx), [refinement requests](/Users/willsanz/homelessness-project/src/features/families/family-plan-panel.tsx:925).

### [ ] CL-26 — Make single-step AI changes reach the real actions

**Type:** Reproduced · **Responsible:** engineering.

Single-step refinement asks the model for action items and dates, but the returned result contains only title, description, details, and priority. The UI never applies the proposed action items. “Move the call to October 20” can change prose while leaving the saved call date unchanged.

**Fix:** return and preview the supported action changes, preserving IDs and human approval; or explicitly restrict the feature to wording and reject unsupported requests. The preferred product behavior is a reviewed, consistent change to the actual dated action.

**Close with:** deadline change, action wording change, unsupported structural request, cancel, apply, reload, and PDF comparison. Prose and stored tasks must agree. **Sources:** [refinement result](/Users/willsanz/homelessness-project/src/lib/plan-generator/openai-refine-step.ts), [apply path](/Users/willsanz/homelessness-project/src/features/families/family-plan-panel.tsx:954).

### [ ] CL-29 — Preserve one-action plans and deliberate removals

**Type:** Reproduced + Fix · **Responsible:** engineering.

The full-plan refinement baseline replaces fewer than two action items with generic “Start” and “Follow up” tasks. A legitimate one-action step therefore changes before the model edits it. Empty returned contacts/documents also mean “keep the old values,” so explicit removal cannot be represented reliably.

**Fix:** preserve valid existing cardinality; distinguish no change from an explicit clear/remove operation. Do not insert filler tasks or contacts to satisfy legacy output assumptions.

**Close with:** zero/one/many existing actions according to the product contract, unchanged one-action rewrite, removal of a wrong contact/document, and UI/server count agreement. **Source:** [baseline and merge](/Users/willsanz/homelessness-project/src/lib/plan-generator/plan-refine-lean.ts:137).

### [ ] CL-31 — Persist the context staff enter before using it

**Type:** Fix · **Responsible:** engineering.

The barrier-generation action persists selected barriers but uses `additionalDetails` as generation feedback without saving it to the family summary. Reload reads the older saved summary. Matching runs before that new text becomes durable, so matching, generated plans, and later chat can use different context.

**Fix:** establish whether this field edits the family description or is a generation-only instruction and label it accordingly. For the current “Short description” behavior, save it with the intake update before matching/generation, with conflict protection and a clear failure state.

**Close with:** change description, generate, refresh, reopen, inspect matching/assistant inputs, and fail the save. No displayed saved description may silently revert or differ from the case used downstream. **Source:** [barrier workflow](/Users/willsanz/homelessness-project/src/app/actions/barrier-workflow.ts:272).

### [ ] CL-32 — Resume staged generation through busy and interrupted states

**Type:** Fix + Verify · **Responsible:** engineering.

The browser stops its stage loop on any unsuccessful advance, including “already running.” The resume effect is keyed to a running status that may remain unchanged, leaving no scheduled retry after another request releases its claim. This is especially relevant to refreshes and two tabs. Existing server job claims are useful and should be retained.

**Fix:** distinguish busy/retryable, failed, completed, and superseded states; poll/read progress until a bounded terminal or recoverable state. Test claim expiry and idempotent stage commits. Keep the last usable reviewed plan accessible when replacement generation fails, and verify generation duration against actual hosting limits.

**Close with:** refresh during an active request, two tabs, closed browser, timeout, quota exhaustion, lease expiry, failure after a committed stage, and resume without duplicate tasks/version increments. **Sources:** [browser stage loop](/Users/willsanz/homelessness-project/src/features/families/family-lite-workspace.tsx:245), [claim/release](/Users/willsanz/homelessness-project/src/app/actions/plans.ts:1000).

### [ ] CL-33 — Validate a useful resource directory for this school

**Type:** Verify + Decide · **Responsible:** resource owner + school case managers.

The committed seed is explicitly synthetic; the actual hosted catalog was not inspected. Current keyword/category matching does not establish current availability or eligibility. Technically successful AI output can still be useless if it recommends demo, stale, or geographically unsuitable resources.

**Fix:** validate the pilot's actual resource set and an owner/freshness process. Clearly distinguish matching, no matches, and matching unavailable. Start with the small directory the school actually uses; do not build a broad resource platform first.

**Close with:** case-manager-reviewed coverage for the pilot's common barriers, verified contacts/source dates, demo-data exclusion, no-resource cases, inactive/dismissed resources, and source-backed factual claims. **Sources:** [seed policy](/Users/willsanz/homelessness-project/data/README.md), [matching rules](/Users/willsanz/homelessness-project/src/lib/matching/engine.ts), [resource matching action](/Users/willsanz/homelessness-project/src/app/actions/resource-matches.ts).

### [ ] CL-37 — Prevent larger lists from silently losing next-action data

**Type:** Fix + Verify · **Responsible:** engineering.

Family-list enrichment fetches all versions for the listed families, then their steps/actions without explicit result paging. The local API cap is 1,000 rows and supported family page size reaches 100. A 100-family page with 15 steps each already exceeds that step cap; even the default page can accumulate enough action rows or historical versions to cross it. The actual hosted cap is unverified.

**Fix:** fetch only the latest relevant plan and bounded next-work data, or explicitly page the child queries. Prefer a small targeted query/RPC over downloading every historical version. Keep authorization on the database path.

**Close with:** 0/1/10/100 families, more than 1,000 aggregate child rows, many versions, and concurrent staff. Compare each displayed next action with the complete source data and record query/response latency. **Sources:** [list enrichment](/Users/willsanz/homelessness-project/src/lib/services/families.ts:88), [page-size validation](/Users/willsanz/homelessness-project/src/lib/validations/family-list-query.ts), [API row cap](/Users/willsanz/homelessness-project/supabase/config.toml:18).

### [ ] CL-39 — Verify date meaning and case-manager confirmation

**Type:** Verify + Decide · **Responsible:** engineering + case-manager reviewer.

The product requires exact, confirmed target dates and a follow-up date for waiting work. AI dates and deterministic date fallbacks must not be mistaken for a person's confirmed commitment. Current generation prompts still use 30/60/90 phase language behind a goal/date-oriented product.

**Fix/verify:** show proposed dates for explicit confirmation before review; make waiting dates consistently mean next follow-up. Align UI, persistence, prompts, ordering, and PDF with the same date-only rules. Keep phase internals only where they support the current product.

**Close with:** unconfirmed/missing/invalid date, completed action without a future deadline, waiting follow-up, leap day, DST/timezone, past-date acknowledgement, manual dates outside generation windows, and screen/PDF agreement. **Sources:** [date rules](/Users/willsanz/homelessness-project/src/lib/domain/plan/action-target-date.ts), [plan editor](/Users/willsanz/homelessness-project/src/features/families/family-plan-panel.tsx), [review requirements](/Users/willsanz/homelessness-project/supabase/migrations/20260804173443_production_hardening.sql:1520).

## Gate C: prove the release and prepare support

### [ ] CL-08 — Establish the complete release test gate

**Type:** Verify + Fix · **Responsible:** engineering.

Existing tests cover useful units and database controls, but no complete authenticated browser, automated accessibility, or AI-quality release suite was found. Compiling and rendering a valid PDF file do not prove the staff workflow.

**Fix:** add the smallest useful integration/browser/accessibility coverage for the matrices below, and run the real database suite on an isolated test stack. Connect required checks to CI/release evidence. Preserve tests for regressions fixed under every other record; avoid implementation-mirroring tests.

**Close with:** an independently repeatable synthetic invite → case → plan → edit → review → downloaded PDF journey, returning-user resume, concurrent edits, failure recovery, and accessibility checks. **Sources:** [CI](/Users/willsanz/homelessness-project/.github/workflows/ci.yml), [test configuration](/Users/willsanz/homelessness-project/vitest.config.mts), [PRD test matrix](/Users/willsanz/homelessness-project/docs/intervention-planning-prd.md:995).

### [ ] CL-34 — Measure AI safety and usefulness with school reviewers

**Type:** Verify + Fix · **Responsible:** engineering + case-manager reviewers.

No repeatable, scored evaluation set establishes that generated plans and answers are correct, actionable, respectful, grounded, and worth the user's time. Prompt inspection and mocked output tests cannot establish live model quality.

**Fix:** implement the evaluation protocol below with synthetic cases and task-specific rubrics. Version the model, prompt, schema, resource snapshot, and expected constraints. Compare changes against the same cases and separate development from held-out cases.

**Close with:** zero critical safety/grounding/edit-preservation failures in the release set, recorded human usefulness review, and measured end-to-end latency/cost. Report failed cases, not just an average score. **Sources:** [AI callers](/Users/willsanz/homelessness-project/src/lib/ai/client.ts), [product quality requirements](/Users/willsanz/homelessness-project/docs/intervention-planning-prd.md), [OpenAI evaluation guidance](https://developers.openai.com/api/docs/guides/evaluation-best-practices).

### [ ] CL-35 — Verify the downloaded PDF visually and against its reviewed source

**Type:** Verify + Fix · **Responsible:** engineering + case-manager reviewer.

Current PDF tests establish useful file/metadata/page/color properties but not complete rendered placement and legibility. A structurally valid file can still clip long content, split rows badly, omit characters, or show the wrong reviewed revision.

**Fix:** maintain a small rendered-PDF fixture corpus for the actual plan export. Compare extracted content with the reviewed plan and inspect page images for placement. Cover supported characters, long fields, many goals/actions, dates, waiting/completed work, and black-and-white printing.

**Close with:** deterministic content assertions, reviewed page images, browser preview/download parity, failed-render retry, font-load failure, and revision checks from CL-05. Include keyboard-accessible download and a usable alternative when embedded preview is unavailable. **Sources:** [PDF renderer](/Users/willsanz/homelessness-project/src/features/families/plan-pdf-document.tsx), [export](/Users/willsanz/homelessness-project/src/features/families/plan-pdf-export.tsx), [current PDF tests](/Users/willsanz/homelessness-project/src/features/families/plan-pdf-document.test.tsx).

### [ ] CL-36 — Record hosted configuration, recovery, and support evidence

**Type:** Verify + Decide · **Responsible:** service owner + operator + privacy owner.

Repository settings and old hardening reports do not prove today's hosted state. `/api/health` is liveness only and does not check the database, Auth, or AI. Backup, restore, email delivery, provider configuration, alert routing, and rollout ownership remain unverified.

**Fix/verify:** complete the existing runbook using the actual Supabase/Vercel/OpenAI projects and the current export-only scope. Record migrations/RLS/grants, invitation-only signup, password/session/MFA settings, redirects/SMTP, production flags/debug restrictions, provider data controls/budgets, backup/restore, retention/deletion, rollback, and incident contacts. Test dependency health safely without exposing data through a public endpoint. Record production hosting/release setup under CL-41 and secret inventory/rotation under CL-42; link the same evidence rather than repeating those tasks.

**Close with:** named owners and support path; isolated restore exercise; synthetic failure alert delivery; deployment/rollback rehearsal; school sign-off on allowed data and pilot boundaries; measured pilot traffic and AI spend. **Sources:** [runbook](/Users/willsanz/homelessness-project/docs/production-operations-runbook.md), [health endpoint](/Users/willsanz/homelessness-project/src/app/api/health/route.ts), [environment posture](/Users/willsanz/homelessness-project/src/lib/env.ts).

### [ ] CL-41 — Establish managed production hosting and a gated release

**Type:** Verify + Decide + Fix where missing · **Responsible:** engineering + service owner · **Gate:** required before pilot.

The repo already targets Vercel, but the actual team/project ownership, production environment, and promotion rules remain unverified. Vercel's configured `npm run verify` build does not itself run the dependency-audit or database-security jobs that exist separately in GitHub CI. A successful hosting build therefore must not be the only release condition.

**Fix/verify:** identify the existing production project and approved domain before provisioning anything. Record named billing/recovery owners; MFA and least-privilege operator access; selected plans, runtime and region; exact Auth redirects; isolated staging database/provider credentials; protected preview access; and spending alerts. Align CI/local/hosting runtime versions. Confirm staged AI requests fit the selected function limits and can recover from a killed request. Ensure production release waits for the exact candidate commit's complete required checks, including dependency audit and database security, using supported deployment checks or an explicit controlled promotion procedure.

**Close with:** record project/environment/deployment IDs and candidate commit without secrets; prove staging cannot reach production data; deliberately fail a required check and show that production does not advance; pass the synthetic auth-to-PDF journey on the candidate; rehearse application rollback with database compatibility verified. Reuse CL-08 and CL-36 test evidence. A basic live health response alone cannot close this record. **Sources:** [hosting config](/Users/willsanz/homelessness-project/vercel.json), [verification scripts](/Users/willsanz/homelessness-project/package.json), [CI jobs](/Users/willsanz/homelessness-project/.github/workflows/ci.yml), [Vercel Deployment Checks](https://vercel.com/docs/deployment-checks).

### [ ] CL-42 — Inventory, isolate, and test production secrets

**Type:** Verify + Fix where missing · **Responsible:** engineering + operator · **Gate:** required before pilot.

Gitignored environment files and a secret scan are useful but do not establish protected production storage, narrow access, environment separation, or recovery. The source only uses the service-role key for privileged scripts; normal web access should retain user-bound database authorization.

**Fix/verify:** record secret names, purpose, provider/project, environment, owner, permitted consumers, and rotation/recovery procedure without recording values. Store production application keys as managed Secret variables and administrative/recovery credentials in a restricted encrypted vault or protected operator job. Keep production values out of previews, ordinary CI tests, local development, source control, command arguments, logs, and test artifacts. Give secret-bearing deployment/build code only to trusted reviewed commits. Review existing credentials for exposure and replace exposed/unknown-provenance credentials through a planned rotation; storing an already exposed key elsewhere is not remediation.

**Close with:** non-secret evidence of scope/access settings; a synthetic credential injection/leak test proving client bundles, error output, logs, and artifacts do not expose server secrets; separate staging/production project checks; a safe rotation/redeploy/revocation rehearsal showing the new credential works and the old one no longer does. Confirm the normal app works without a service-role/database-admin key. Do not display real credential values in the release record. **Sources:** [environment consumers](/Users/willsanz/homelessness-project/src/lib/env.ts), [invitation script](/Users/willsanz/homelessness-project/scripts/invite-user.ts), [secret scanner](/Users/willsanz/homelessness-project/scripts/scan-tracked-secrets.mjs), [Vercel Secret variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables).

## Account and sign-in acceptance matrix

Account creation is currently **operator invitation**, not public signup: `/signup` redirects to request-demo. Retain that pilot model unless deliberately changed. Test with synthetic accounts/mailboxes in a separate environment; do not perform destructive account tests on school staff.

| Stage | Required cases | Passing result |
| --- | --- | --- |
| Public signup | UI route and direct Auth signup request | No unauthorized account can provision workspace access; hosted signup settings match policy |
| Invitation | New, duplicate, existing active, expired, resend, provisioning failure | Clear operator result, intended role, recoverable setup, auditable change |
| Email callback | Actual configured flow, PKCE, token-hash/fragment if supported, cross-device, apex/www | One intended session and safe destination; unsupported modes fail clearly |
| Malicious/invalid callback | External/double-encoded next, backslash/control characters, missing/bad type, expired/reused token | No open redirect, token disclosure, unexpected account, or indefinite spinner |
| First password | Valid/weak/mismatched password, skipped setup, interrupted setup | Clear requirements and intentional access policy |
| Login | Correct/wrong password, unknown user, case/whitespace email, duplicate submit, throttling/outage | No account enumeration or raw provider detail; recoverable, accurate state |
| MFA | Enrollment, challenge, bad code, returning admin, recovery | Required admin operations demand verified AAL2 |
| Workspace session | Reload, refresh-token rotation, two tabs, expiry, inactivity, lost network | No redirect loop or stale-token write; safe reauthentication with approved draft recovery |
| Password reset | Known/unknown email, actual email link, expiry, reuse, secure change, success | Generic request acknowledgement; only intended account changes; post-reset session behavior matches policy |
| Logout | Success, provider failure, another tab/device, Back button, account switch | Intended session scope ends; no residual sensitive app drafts shown to another person |
| Authorization | Every action and direct database request with the role matrix | No cross-family access, self-promotion, audit forgery, or unauthorized mutation |
| Offboarding | Retained JWT, owned/assigned cases, admin downgrade, refresh token | Access denied according to the immediate-offboarding policy; case history preserved |

Use browser tests for cookies/redirects/navigation and real isolated Auth/Postgres integration tests for token and authorization behavior. A mocked login component cannot prove those boundaries. Record hosted auth rate limits and test them with bounded synthetic requests; aggressive testing against production is unnecessary.

## AI feature inventory and expected behavior

| Feature | Current implementation | Useful behavior to verify |
| --- | --- | --- |
| Initial plan / regeneration | Staged lean generation plus retained full-plan generation path | Specific goals/actions grounded in saved barriers, preferences, outcomes, and available resources; proposed dates; explicit partial/failure states |
| Single-action refinement | Structured model result followed by local preview/apply | Requested change reaches the actual task/date and preserves unrelated human work |
| Full-plan refinement | Structured result merged into a draft, then saved | Stable identity, narrow changes, explicit review, atomic save, no reassignment of completion history |
| Case assistant | Text answer from case/resource context plus in-memory conversation | Correct next action, useful scripts/checklists, stated uncertainty, no invented facts or unsupported decisions |
| Resource matching | Deterministic keyword/category rules | Transparent suggestions from an approved current directory; explicit no-match/unavailable state |
| Current PDF export | Deterministic rendering of reviewed plan | Exact reviewed content, readable black-and-white output, manual download only |

Task names in model configuration do not prove separate shipped features. Generic helper/file-mapping names should be checked for real callers before they influence the implementation scope.

### Decisions API assessment and Responses API role

**Clarification, October 13:** the requested evaluation is of OpenAI's newly released **Decisions API**, not just Responses. **Recommendation: evaluate Decisions for narrow advisory checks, while retaining Responses for writing plans, refinements, and explanations.** Adopting Decisions is not a prerequisite for the school pilot.

Decisions returns condition probabilities (`predicate`), fixed-option selections (`choice`), or rubric scores (`score`). As of this review it is public beta, supports `gpt-6-luna`, and uses `/v1/decisions`. Published base pricing is $0.10 per million input tokens, with regional/long-context qualifications. OpenAI advertises approximately 10× faster results than Responses; that is not a measured CaseLink improvement. [Decisions guide](https://developers.openai.com/api/docs/guides/decisions).

The following are proposed CaseLink uses, not existing features or proven improvements:

| Candidate | Proposed role | Boundary |
| --- | --- | --- |
| Draft actionability check | Flag vague actions against a school-approved rubric | Advisory feedback; a score cannot approve a plan |
| Barrier-category suggestion | Suggest existing categories from approved de-identified narrative | Staff confirm; retain manual selection and compare with current rules |
| Rewrite-request classification | Distinguish wording, deadline, and structural requests | Server validation and human confirmation still govern actual changes |
| Future blank-form identification | Suggest which known template a page resembles | Separate deferred PDF project; no automatic filling or submission |

Do not use it to determine family eligibility, clinical/legal risk, or access priority. Do not send prohibited identifiers to Decisions to discover whether they are prohibited: the outbound privacy boundary must be enforced before any provider call. Existing deterministic checks for required dates, authorized IDs, and exact directory contacts remain preferable where they fully establish correctness.

The endpoint can return a refusal instead of a typed answer and does not accept PDF/file inputs or function calls. It therefore does not replace document extraction, PDF rendering, or the plan-generation contract. [Decisions API reference](https://developers.openai.com/api/reference/resources/decisions/methods/create).

The central client already posts to `/v1/responses` for plan generation, refinements, and case assistant by default. Keep and standardize that integration for generated text and custom structured objects. Tool use and provider-managed conversation state are optional. [OpenAI migration guide](https://developers.openai.com/api/docs/guides/migrate-to-responses).

The immediate work is CL-19–CL-23: correct terminal-state handling, stable endpoint/model configuration, strict compatible schemas, source-backed facts, and complete authorized context. Keep application-owned conversation/context and `store: false`. That parameter disables response application-state storage; it does **not** itself establish zero retention of all provider data. Default abuse-monitoring logs may retain content for up to 30 days, subject to the documented exceptions and approved account controls. Verify the actual project agreement and settings before expanding the data boundary. [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data).

Use the current centralized client and installed validation tools unless a concrete tested gap justifies an SDK/dependency change. Streaming is optional after correctness and measured latency are understood. Neither an agent framework, persistent provider conversation, vector database, nor autonomous external tools are prerequisites for this pilot.

For future blank-PDF filling, create a separate validated scope: approved blank templates, bounded file inspection, field provenance, deterministic population where possible, human review of each consequential value, and rendered/extracted-value tests. Responses could propose mappings, but it cannot establish that a filled PDF is correct. Do not enable uploads or automatic submission as part of this readiness workstream.

### [ ] CL-40 — Evaluate Decisions API as an optional advisory check

**Type:** Decide + Verify · **Responsible:** engineering + case-manager reviewer · **Gate:** optional evaluation; not a pilot launch blocker.

**Experiment:** start offline with the CL-34 synthetic draft set and a human-labeled actionability rubric. Compare Decisions with deterministic checks and the existing workflow. Measure agreement with reviewers, missed defects, false alarms, refusal/error rates, total latency, and cost. Calibrate thresholds on development cases and report held-out results; a model's confidence is not a correctness guarantee.

**Implementation boundary if justified:** current `createAiResponse` parses generated text, and its model allowlist rejects `gpt-6-luna`. A Decisions experiment needs a small separately typed request/answer path, not just `OPENAI_MODEL_OVERRIDE`. Reuse privacy, timeout, budget, and safe-logging controls; verify endpoint-specific data handling rather than assuming Responses parameters apply. Match named answers to expected questions, validate result types/ranges, and treat refusal, missing answers, low confidence, or service failure as “check unavailable/needs human review,” never a pass. Do not insert an extra production call into every plan until its benefit is demonstrated.

**Close with:** a written adopt/defer decision backed by synthetic results and reviewer agreement; confirmed account access/data controls; mocked response/error contract tests; and proof that enabling or disabling the advisory check cannot approve, mutate, or block access to otherwise usable casework. No API calls or application changes were made for this documentation assessment. **Sources:** [current AI client](/Users/willsanz/homelessness-project/src/lib/ai/client.ts), [current model allowlist](/Users/willsanz/homelessness-project/src/lib/ai/model-allowlist.ts), [Decisions guide](https://developers.openai.com/api/docs/guides/decisions), [provider data controls](https://developers.openai.com/api/docs/guides/your-data).

### AI evaluation protocol

1. Start with the PRD's first **25 synthetic internal cases**. Expand to at least **50 representative cases for performance acceptance**, with a distinct held-out subset not used while changing prompts. Include simple, sparse, multi-barrier, resource-poor, long-context, and returning-user cases. Record fixture versions and resource snapshots.
2. Cover all four generative features. Add adversarial variants: fabricated contacts, unknown eligibility, no available resource, stale/dismissed resources, contradictory notes, completed tasks, waiting dates, deadline changes, contact restrictions, sensitive identifiers, prompt injection in case/resource/history text, and irrelevant or impossible requests.
3. Include high-risk situations in synthetic form. Expected behavior follows the school's approved escalation protocol, acknowledges limits, and preserves human judgment; it must not invent clinical/legal determinations or decide eligibility. Evaluate respectful language, family preferences, and different family structures/languages without inferring protected traits.
4. Run deterministic checks for schema/ID/date validity, source-backed contact facts, privacy boundaries, unchanged protected fields, and absence of writes before confirmation. These checks should not depend on a model grading itself.
5. Have case managers rate factual support, relevance, actionability, clarity, family voice, and editing effort. Compare representative AI drafts with the current manual approach. Track time to an accepted plan and substantive corrections; a fluent answer that needs extensive repair is not a success.
6. Save synthetic outputs and rubric results with model, prompt/schema version, task, duration, token use, and safe failure category. Keep production narratives out of eval datasets and ordinary logs unless separately authorized and properly de-identified.

**Proposed quality gate for school agreement:** zero critical safety, fabricated-resource-fact, privacy, or protected-edit failures in the release set; all accepted structured outputs pass validation; at least 90% of representative tasks receive a human usefulness score of 4/5 or better. These are proposed thresholds, not measured performance or a statistical guarantee. Review every critical failure individually and expand the set after new failure classes.

**Existing PRD latency targets to measure:** p95 first progress ≤2 seconds; first useful action p75 ≤5 seconds / p95 ≤10 seconds; complete draft p75 ≤15 seconds / p95 ≤30 seconds; step rewrite p75 ≤6 seconds; no silent resource failures. Record actual results. If the pilot needs different targets, revise them explicitly with the school rather than treating a 180-second request timeout as an acceptable user experience.

## Implementation sequence and release record

1. Resolve CL-01's data boundary; identify the managed production/staging projects and secret boundaries under CL-41–CL-42; establish synthetic staging accounts/data. Start targeted regression tests while repairing dependencies, authorization/offboarding/MFA, timestamp handling, draft privacy, review revision checks, and atomic edit preservation.
2. Complete invitation/login/reset/logout and the full auth matrix. Add missing provisioning-test discovery. Verify actual hosted settings and email delivery before inviting staff.
3. Repair shared AI contracts and privacy/grounding first; then generation context/resume/budget behavior; then refinement identity/application and chat continuity. Keep each fix small and tested against its observed failure.
4. Reconcile current product documentation, validate the school's resources, and run the case-manager AI evaluation. Complete visual PDF and accessibility checks for the real export workflow.
5. Run the complete staging journey with concurrent staff, perform restore/rollback/alert exercises, record owners and release evidence, and review the final pilot go/no-go with the school.

**Every closed record must include:** implementation commit/PR; test command and result; fixture or environment; reviewer/date; any remaining constraint. For external configuration, record non-secret setting evidence rather than credentials or case content.

| Release gate | Status at this audit | Evidence needed |
| --- | --- | --- |
| Approved pilot data boundary | Open | CL-01 and school/privacy-owner decision |
| Dependency and repository checks | Open | CL-02 plus fresh complete CI |
| Auth and database access | Open | CL-07, CL-11, CL-13–17, CL-38 and auth matrix |
| Concurrent editing/review integrity | Open | CL-03–05, CL-27–30 and injected-failure tests |
| AI correctness and usefulness | Open | CL-06, CL-10, CL-18–26, CL-29, CL-32–34 and eval results |
| Complete intake-to-PDF journey | Open | CL-08–09, CL-31, CL-35, CL-39 and browser/render evidence |
| Hosted operation and recovery | Open | CL-36 and current runbook evidence |
| Managed hosting and release control | Open | CL-41; exact candidate checks gate production; isolated staging; verified rollback |
| Production secrets and recovery access | Open | CL-42; scoped managed storage; leak checks; rotation/revocation evidence |
| Larger-case-list behavior | Open | CL-37 synthetic scale results |
| Accurate scope and staff guidance | Open | CL-12 and pilot training material |

### Final pilot launch decision

- [ ] All required records CL-01–CL-39 and CL-41–CL-42 are closed with evidence, or the existing runbook's explicit residual-risk process has approved a permitted exception. No silent deferrals; privacy/access/data-integrity blockers cannot be hidden by disabling a test.
- [ ] Named school, product/privacy, engineering, and operating owners have agreed the permitted data, support hours, resource directory, staff list, service limits, and recovery targets. Staff have practiced the full workflow with synthetic cases and know how to report an error.
- [ ] Invite the named pilot staff only after the candidate release is approved. Start with supervised use, review errors/latency/cost and user feedback during the first week, and assign an owner for follow-up. This is an operating plan, not a scheduled automation created by this audit.
- [ ] Decisions API evaluation, uploaded-PDF features, multi-school infrastructure, and Kubernetes remain outside the launch gate. Any newly mandated school requirement is recorded and assessed before sign-off.

**Not certified by this audit:** live email and authenticated user journeys; current hosted database security/configuration; live-model quality; backup restoration; sustained load. Existing safeguards such as user-bound database clients, row-level security, safe redirects, shared AI budgets, `store: false`, and human review should be preserved while closing these gaps.
