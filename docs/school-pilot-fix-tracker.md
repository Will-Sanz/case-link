# CaseLink school-pilot fix tracker

**Reviewed:** October 15, 2026 · **Repository baseline:** `e0cb389` · **Status:** narrow engineering/release work complete and live; 30-minute observation passed; school/operating acceptance remains open.

**Intended rollout:** a few staff at one school, working with real family circumstances. This is not yet approval to store identifiable education or family records. Current product policy requires non-identifying labels and de-identified narrative.

**Recommendation:** complete this first-priority readiness workstream before routine school use. A successful build is not sufficient evidence that account setup, AI recommendations, concurrent edits, and PDF export work together safely. Use synthetic cases for the school demonstration until the applicable release gates below are evidenced.

**October 14 scope reset (user approved):** finish three narrow engineering outcomes: (1) correct the PDF page break and remove all CaseLink 2FA, (2) verify invited account setup/password login/recovery and the core intake-to-PDF workflow, and (3) finalize production settings/secrets and a controlled release with a usable backup/recovery path. School data/usefulness/resource validation remains a separate fourth outcome. Do not add Face ID/passkeys, Decisions integration, form filling, Kubernetes, or broad redesign. Historical findings and test evidence remain below; superseded MFA requirements are not current acceptance criteria. The 2FA removal is implemented and live; password-only staff/admin behavior is verified in the applicable hosted and CI environments. CaseLink local services remain stopped; all work stays in the background.

**October 15 live release:** [www.thecaselink.com](https://www.thecaselink.com) now serves production build `dpl_8BAZJwJQEqFG7RkjykwuwyrXGEU8`, exact source `9e7d0e29aa556eb780b96e04e6d4c5ef8511e19b`. CI **38753128811**, CodeQL **38753128797**, release preflight, hosted staging, production-candidate and canonical workflows pass. Coverage includes 686 unit/component tests, seven browser scenarios, database/Auth/restore/legacy/PDF checks, all four live AI paths, repeated reads, edit recovery/preservation and human-reviewed PDF download. Both canonical PDF pages were visually inspected; no test case/account remains. The user explicitly approved the plan-loading migration and release. Both databases now have 41 migrations; all 54 resources and existing accounts are preserved. The earlier failures and bounded-save test correction remain recorded. The 30-minute observation passed all 45 checks, with no Vercel error/fatal entries in the window. [Observation evidence](verification/2026-10-15-release-observation.json). [Release record](verification/production-release.md), [handoff](pilot-readiness-handoff.md).

| Current requested outcome | Engineering result | Remaining boundary |
| --- | --- | --- |
| PDF page break and all-account 2FA removal | Implemented, tested and live | School acceptance of password-only policy remains part of its operating decision |
| Account setup/login/recovery and intake-to-PDF | Hosted setup/recovery and complete canonical workflow pass | School mailbox/filter check and staff practice require school participation |
| Production settings/secrets and controlled release | Isolated settings, compatible migrations, actual release and recovery drill verified | 30-minute observation passed; recurring/off-machine backups, budgets/alerts and historical-secret review remain operating gates |

Historical findings below retain their original context. An open record can now represent a school/operating decision rather than unfinished application code; the current result above and latest dated paragraph take precedence.

The current product is family intake → barriers → a goal-based intervention plan with confirmed dates → human review → a professional black-and-white PDF downloaded for manual use. Blank-PDF upload, field detection, form filling, and automatic submission are outside this release. The current decisions in [AGENTS.md](/Users/willsanz/homelessness-project/AGENTS.md) take precedence over older roadmap language.

## How to use this tracker

There are 41 original pilot-readiness records (CL-01–CL-39, CL-41–CL-42), one optional Decisions API evaluation (CL-40), and a superseded device-verification proposal (CL-43). Engineering implementation is assigned to Codex; school, privacy, and operations owners still need to be named. Check a record only after its completion tests pass, then add implementation and test evidence below. Each item is committed separately; its commit is discoverable with `git log --grep='CL-NN'`. A verification record closes with evidence or produces a concrete defect; it does not mean the hosted system is already known to be broken.

- **Fix:** source-confirmed defect or missing behavior.
- **Reproduced:** additionally demonstrated with synthetic local inputs or mocked services.
- **Verify:** required deployment or workflow evidence not available in this audit.
- **Decide:** a product, school, or operating-policy decision is needed before implementation can be finalized.
- **Gate A:** privacy, access, and data integrity. Implement first.
- **Gate B:** reliable and useful daily workflows. Complete before routine pilot use.
- **Gate C:** prove the complete release in staging and record operating readiness.

The current three engineering outcomes above govern remaining work. Retain privacy, access and data-integrity safeguards; keep external school decisions open. Blank-form filling remains a separate future project.

## Final pilot scope check — October 13, 2026

The scope review retains every original finding and adds explicit production hosting/release controls (CL-41) and secret management (CL-42). The user subsequently authorized implementation, tests, and per-item commits/pushes. Production promotion, paid purchases, and school sign-off remain explicit launch steps.

| Area | Required before this pilot | Outside this pilot |
| --- | --- | --- |
| Core product | Invite staff; create a family profile with a non-identifying label; record barriers; generate/edit a dated goal plan; record progress; review; download the reviewed black-and-white PDF | Blank-form uploads, field detection/filling, signatures, CitySpan integration, automatic submission |
| AI | Correct generation, both refinement flows, and case assistant; grounded resources; preserve human edits; tested failures and usefulness | Decisions API adoption, model-platform migration, agents, new autonomous tools |
| Accounts | Invitation, initial password, login, recovery, session handling, password-only accounts, least privilege, offboarding | Public self-signup; building institutional SSO unless the school makes it a launch requirement |
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

The table below is the **October 13 audit baseline**, not the current verification result. Current per-item evidence and the October 14 handoff supersede it.

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

**October 13, 2026 — engineering and training guidance complete; school approval remains open:** the de-identified-only boundary is unchanged. The runbook now gives allowed/forbidden examples, keeps re-identification mappings in the school's required system, specifies a synthetic staff rehearsal and accidental-entry response, and explicitly marks retention periods as requiring approval and operational implementation. The privacy page explains that passing a detector is not permission to enter identifiable records. Detection now covers common unformatted/parenthesized/country-code phones, ISO birth dates, accented names, lowercase name fields/labels, and name labels with appended numbers. Database checks reject the representative phone/birth-date/explicit-name variants even through authenticated direct requests.

**Evidence:** 12 new probes failed before the change; all 22 detector tests now pass, including ordinary context/date/opaque-ID false-positive checks. The full unit suite passes 493 tests. A clean migration rebuild and the complete database security suite pass; advisors report no warnings. Full verification runs before push. Normal correctness/security/privacy and separate Ponytail review completed. The detector is a limited warning/control, not a de-identification guarantee. Named owners, school acceptance of examples/training, permitted data, vendor handling, access, and retention/deletion approval remain required before real pilot use. AI payload/contact provenance remains tracked in CL-18/CL-06. Commit: `git log --grep='CL-01'`.

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

### [x] CL-04 — Make unsaved-work recovery safe on shared computers

**Completed October 13, 2026 — engineering:** drafts now use per-account, per-plan session storage with a 30-minute lifetime and bounded, validated editable fields. Persistent legacy drafts are deleted. Explicit sign-out removes recovery copies; a content-free logout marker also invalidates suspended/duplicated tabs. Account switches clear drafts and hide the old workspace; ordinary token renewal preserves the current editor, and session expiry permits the same account to recover within the lifetime. Restore rechecks scope, expiry, child ownership, and privacy. Likely identifiers prevent storage immediately; blocked storage and quota failures keep the current edit in memory and explain that recovery is unavailable. Forty-seven focused checks passed across draft, account, and auth flows, including rendered edit/recovery, cross-account/logout events, malformed nested content, rejected identifiers, and quota failure. Normal correctness/privacy/accessibility and separate Ponytail reviews completed; full verification runs on push. The detector is a safeguard, not proof that text is de-identified; the school data-policy decision remains CL-01. Deployed browser rehearsal remains CL-08. Commit: `git log --grep='CL-04'`.

**Type:** Fix · **Responsible:** engineering + privacy owner.

The plan editor saves the entire draft to `localStorage` every 250 ms, before server validation. Its key identifies the plan, without user scope or expiry, and sign-out does not clear these drafts. Disallowed identifying text can therefore remain on the device even when saving is rejected.

**Fix:** choose a recovery mechanism consistent with CL-01, with explicit user scope, expiry, and logout/account-switch handling. Preserve recoverable work across session renewal without silently keeping raw case content indefinitely. Do not solve this by disabling recovery altogether.

**Close with:** shared-device account switch, logout, expired-session recovery, abandoned draft expiry, storage-disabled/quota errors, and rejected-PII draft tests. **Sources:** [draft persistence](/Users/willsanz/homelessness-project/src/features/families/family-plan-panel.tsx:446), [sign-out](/Users/willsanz/homelessness-project/src/app/actions/auth.ts).

### [x] CL-05 — Bind review and export to the revision the person saw

**Completed October 13, 2026 — engineering:** plan, actions, case context, and PDF header fields now come from one database snapshot with content and material-content revisions. Approval checks the displayed revision while holding the plan/context locks and records both revisions in the audit event. All child edits serialize with review; material edits invalidate it, while progress-only edits retain material approval. Directly forging review revisions is denied. PDF preparation checks approval before and after rendering; download rechecks the exact source and uses the same preview bytes, refusing stale or unavailable authorization. Real local database tests cover a review waiting for an edit, an edit waiting for review, cross-family snapshot denial, stale approval with no audit evidence, approved export, material/progress changes, and changed family header context. Focused server/rendered tests cover displayed-revision submission, failed review recovery, edits during rendering, stale download, and duplicate clicks. Normal correctness/security/accessibility and separate Ponytail review completed; the fresh-migration database run passed and full verification runs on push. Deployed two-tab/browser evidence remains CL-08/CL-35/CL-38. Commit: `git log --grep='CL-05'`.

**Type:** Fix · **Responsible:** engineering.

Review submits family and plan IDs without an expected revision. If another staff member changes the plan after a screen loads, the first person's click can mark the newer unseen content reviewed. Existing review invalidation after edits does not prevent this race.

**Fix:** make review an atomic check of the displayed plan revision and its relevant children. Record reviewer and revision; export exactly that reviewed content. Preserve the intended distinction between a material plan edit and a progress-only update.

**Close with:** two-tab edit/review races, edit during review, stale export, and material-edit invalidation tests in both the database and browser. No unseen revision may gain review evidence. **Sources:** [review payload](/Users/willsanz/homelessness-project/src/lib/validations/plans.ts), [review UI](/Users/willsanz/homelessness-project/src/features/families/family-plan-panel.tsx:1202), [review transaction](/Users/willsanz/homelessness-project/supabase/migrations/20260804173443_production_hardening.sql:1520).

### [x] CL-06 — Ground resource facts in approved records

**Completed October 13, 2026 — engineering:** generation, both refinement flows, and chat now select directory IDs through strict output schemas. The app copies program names and supplied phone/email values from authorized, active, non-demo, non-dismissed matched records, retains the exact source/version, and leaves missing facts missing. Contact values and individual directory contact names are excluded from model prompts. Chat displays source contacts separately from conversational prose; follow-ups do not resend them. Manual edits select directory entries instead of accepting arbitrary contact text. Recovery stores source references, and historical contacts remain visible until explicitly removed or replaced.

**Evidence:** 563 automated tests pass, including forged/unknown/duplicate/unavailable references, unsupported model contact fields and prose, missing facts, selected edits, reference-only recovery, and sources changed before/during generation or refinement/chat. The clean local migration rebuild and database suite prove canonical copying, direct-write protection, family authorization, denied review/export after a source edit/dismissal, preserved historical contacts on unrelated edits, and explicit removal/reselection. Security/performance advisors report no warnings. Ten live synthetic schema checks pass across both supported models ([metadata](verification/2026-10-14-ai-resource-contracts.json)); no family data was sent. A PDF rendered from the real reviewed local snapshot was text-extracted and visually checked against its directory program, phone, email, and verification notice. Correctness/security/privacy/accessibility, separate Ponytail deletion, and React reviews completed; full verification runs before push. Narrative recommendations still require human verification; current real program details and school usefulness remain CL-33/CL-34.

**Rollout:** deploy migration `20261014012912` with this code. Existing plans require a new review because their review hash now includes source validity. Older interrupted AI jobs must restart with the new source snapshot. No existing plan content is automatically discarded. Complete outbound payload coverage is tracked separately in CL-18.

**Type:** Reproduced · **Responsible:** engineering + resource owner.

Model output accepts arbitrary contact names, phones, and emails and maps them into plan details. Prompt instructions against invention do not enforce a relationship to a real directory entry. Contact fields are also treated differently from narrative by privacy controls.

**Fix:** have AI identify approved resource records and copy their factual details deterministically. Validate references and distinguish supplied facts, missing facts, and proposed wording. Never invent eligibility, openings, operating hours, or contact details to complete an answer.

**Close with:** invented/altered phone, unknown resource ID, dismissed/inactive resource, stale information, and no-resource cases across generation, both refinements, chat, and PDF. All factual contacts must trace to approved source data. **Sources:** [lean output schema](/Users/willsanz/homelessness-project/src/lib/plan-generator/lean-plan-schema.ts), [resource context](/Users/willsanz/homelessness-project/src/lib/plan-generator/resource-context.ts).

### [x] CL-07 — Make offboarding deny access at the database boundary

**Type:** Fix + Verify · **Responsible:** engineering + pilot administrator.

`can_access_family` checks ownership, assignments, and admin status without a separate active-account/session-revocation condition. Ending refresh sessions alone does not guarantee that an already-issued access token immediately loses direct Data API access while its permissions remain. Supabase documents that revoked-session access tokens remain valid until expiry. [Supabase sign-out behavior](https://supabase.com/docs/guides/auth/signout).

**Fix:** define an auditable offboarding operation that removes effective access immediately, revokes sessions, and safely preserves/reassigns cases. Enforce the inactive-user condition or equivalent removal of effective permissions inside database authorization, not just navigation.

**Close with:** retain a synthetic user's access token, offboard them, then prove direct reads/writes/RPCs fail for owned and assigned cases; cover admin downgrade, session refresh, reassignment, and audit history. **Source:** [family access policies](/Users/willsanz/homelessness-project/supabase/migrations/20260321120000_family_rls.sql:18).

**Completed October 13, 2026 — engineering:** active-account state now gates family authorization, administrator authority, direct table operations, and non-family mutation RPCs. The protected `db:offboard-user` job atomically denies access, reassigns cases, revokes sessions/refresh tokens, and audits the operation; Auth sign-in is then disabled and a second session cleanup closes that interval. Historical creators remain unchanged. Partial Auth failures preserve database denial and provide retry instructions. Eleven targeted unit/rendered tests passed; the expanded database suite proved AAL2 admin downgrade/offboarding, unauthorized operator rejection, no self-reactivation, and audit-failure rollback. A new real local Auth/Data API test retained the same unexpired JWT through removal and proved owned/assigned reads, writes, RPCs, refresh, and sign-in are denied while the replacement keeps access; public signup also remains disabled. This test runs in CI. The rehearsal exposed and corrected the local email-provider setting that had disabled password login. Supabase's local security advisor reported no warnings after the existing timestamp trigger's search path was fixed. Correctness/security and separate Ponytail review completed; full verification is required on push. Hosted role/configuration evidence still belongs to CL-38/CL-41. Commit: `git log --grep='CL-07'`.

### [x] CL-11 — Remove CaseLink 2FA under the revised pilot scope

**Completed October 15 — live engineering:** `323314c` removes the application requirement, `20261014230221` preserves password/session/role permissions, and exact source `9e7d0e2` is now live. Production has zero factors and rejects enrollment; canonical password login/Settings/logout pass. Staff/admin coverage passes in staging and CI; no production administrator fixture was created. [Canonical workflow](verification/2026-10-15-canonical-workflow.json), [production provider proof](verification/2026-10-15-production-password-only.json).

**October 15 production provider verification:** the upgraded database has no enrolled factors. A disposable standard staff account signed in with a password, remained non-admin, and received `mfa_totp_enroll_not_enabled` when attempting enrollment; it was removed afterward. Passkey sign-in, phone MFA and the AAL1 deadline are disabled. Production administrator fixture creation was rejected by automatic review and was not performed; the safer staff test passed, while administrator behavior is covered by staging/CI. The production app still needs promotion. [Provider/access proof](verification/2026-10-15-production-password-only.json).

**October 14 user decision:** remove 2FA from every CaseLink account, including administrators. Password-session checks, active-account/session revocation, roles and family permissions remain required. Remove enrollment/challenge UI and dead recovery code, update database guards and provider settings, and prove password-only admin/staff access plus negative authorization cases. Prior MFA implementation below is historical evidence, not the current requirement. Removal is implemented: all 682 unit/component tests pass. The new administrator regression failed before the change. Migration `20261014230221` preserves password sessions, active accounts and family authorization, and stops if verified factors remain. Staging now has all 40 migrations, no factors, disabled TOTP enrollment and verified password-only staff/admin access. Full CI and CodeQL pass; production release remains open. [Evidence](verification/2026-10-14-password-only-accounts.json).

**Type:** Fix + Verify · **Responsible:** engineering + administrator.

Database admin privilege requires an AAL2 session, but the app has no complete TOTP enrollment/challenge flow. The invitation script only tells the operator to require enrollment. A password-only administrator can therefore sign in without being able to perform intended admin work.

**Fix:** support enrollment, verification, login challenge, and a documented recovery procedure. Preserve the database AAL2 guard; do not relax it to make onboarding appear successful.

**Close with:** first admin setup, returning login, incorrect/expired code, recovery, factor removal, and direct AAL1/AAL2 authorization tests. **Sources:** [admin guard](/Users/willsanz/homelessness-project/supabase/migrations/20260804173443_production_hardening.sql:82), [invitation script](/Users/willsanz/homelessness-project/scripts/invite-user.ts), [auth components](/Users/willsanz/homelessness-project/src/features/auth/login-form.tsx).

**Completed October 13, 2026 — engineering:** added authenticator enrollment, returning-login challenge, manual setup key, recoverable failures/unfinished enrollment, confirmed removal, and logout retry at `/verify-account`, linked from Settings. Password recovery routes enrolled users to their authenticator instead of mislabeling the link as expired. Administrators require verified MFA for all casework, including owned cases; enrolled case managers also must verify. Database checks combine the signed assurance claim with the current session level and a current verified factor, denying stale tokens after removal or downgrade. The protected recovery job requires an independent identity-check record, audits/revokes sessions, invalidates the old password before removing factors, revokes sessions again, and sends recovery mail. It preserves case history and cannot reactivate offboarded users. Thirty-nine focused form/session/recovery tests plus two destination-validation tests passed. Real local Auth/Data API tests proved enrollment, wrong/expired challenge rejection, returning login, AAL1 denial, AAL2 access, immediate removal denial, MFA-change notices, email-reset resistance to MFA bypass, full lost-device recovery, old-password denial, and required re-enrollment. Database tests additionally proved current-factor/session checks, browser denial of operator recovery, and rollback when audit recording fails. Supabase security advisor: no warnings. Correctness/security/accessibility and separate Ponytail review completed; full verification is required on push. Hosted MFA/SMTP rehearsal and a named school recovery operator remain CL-16/CL-36/CL-38 launch gates. Commit: `git log --grep='CL-11'`.

### [x] CL-18 — Validate the exact outbound AI content, with provenance

**Completed October 13, 2026 — engineering:** the shared provider client serializes one immutable request, checks all its textual content (including instructions, history and schema text), and sends exactly those inspected bytes. Identifying content fails before rate-budget reservation, network access, or debug logging, with a content-free error. Saved and unsaved plan checks now share complete detail/workflow/action coverage, including the previously missed contact script and milestone fields. Directory contact values remain outside AI requests and browser chat history under CL-06; no assistant-message or arbitrary-contact exemption was added.

**Evidence:** 11 provider-boundary tests and 27 saved-field tests failed before the fix. All 643 repository tests now pass, including full serializer-to-HTTP checks across generation, both refinements and chat; private values in prior-phase text, directory descriptions, instructions, every editable plan text category, and complete conversation exchanges; forged directory claims; no budget/network/log disclosure on denial; and caller mutation while awaiting a budget. Legitimate source contacts survive the displayed answer and follow-up without being transmitted. Typecheck/lint, correctness/security/privacy, and separate Ponytail deletion review pass; full verification runs before push. Identifier detection remains a heuristic safeguard, not proof of de-identification or approval to enter identifiable records (CL-01).

**Type:** Fix + Reproduced · **Responsible:** engineering + privacy owner.

`familyPrivacyFields` does not include plan steps/details/action notes, although related AI paths use saved plan content. Conversely, chat scans assistant history as though every phone or email were a family identifier: an answer quoting a legitimate directory phone can block the next question.

**Fix:** validate the actual provider-bound payload, including saved and unsaved plan text. Keep trusted directory facts distinguishable from user narrative and untrusted model claims. Never solve the false positive by exempting all assistant text or all contact fields.

**Close with:** a synthetic identifier placed in each outbound field is caught before the provider call; legitimate source-backed agency contacts remain usable on follow-up; fabricated contacts cannot obtain the same exemption. **Sources:** [privacy field collection](/Users/willsanz/homelessness-project/src/lib/privacy/no-pii.ts:237), [assistant validation](/Users/willsanz/homelessness-project/src/app/actions/case-assistant.ts), [step refinement](/Users/willsanz/homelessness-project/src/lib/plan-generator/openai-plan.ts).

### [x] CL-27 — Preserve human work when applying AI edits

**Type:** Fix · **Responsible:** engineering.

Single-step preview sends only the saved step ID and feedback, not the current unsaved draft. Applying it replaces details and resets checklist completion. A request to improve one sentence can overwrite unrelated edits or completion evidence.

**Fix:** generate from the explicitly selected draft and base revision; apply a validated, reviewable change to the requested fields only. Protect owner, completed work, outcomes, manually confirmed dates, and unrelated details. Ignore stale previews after editing, canceling, or switching actions.

**Close with:** unsaved manual edits plus rewrite, narrow wording change, completed checklist, stale response, cancel/reopen, and changed base revision tests. **Sources:** [preview/apply UI](/Users/willsanz/homelessness-project/src/features/families/family-plan-panel.tsx:925), [saved-step lookup](/Users/willsanz/homelessness-project/src/app/actions/plans.ts).

**Completed October 13, 2026 — engineering:** single-action and whole-plan refinement now use the actual unsaved draft, original row versions, and current plan revision. Both paths share one validated refiner. Previews show each proposed field with before/after values and require an explicit selection; completed work, ownership, checklist completion, notes, and outcomes cannot be changed by AI application. Dates change only when selected. Human edits, cancellation, and saved-plan changes invalidate pending/ready previews. Atomic saves retain original conflict timestamps; conflict comparisons include all persisted details, checklist evidence, and action fields. Whole-plan edits now warn before closing the tab, and applying a preview restores keyboard focus. Removed the retired single-step refiner and checklist-resetting save cleanup.

**Evidence:** 48 focused server, provider/merge, domain, and rendered-component tests cover narrow edits alongside unsaved human text, completed work and legacy checklists, explicit document removal, selected dates, stale/late replies, revision changes, failed saves/retries, conflict detail visibility, tab-close warnings, and focus restoration. Typecheck/lint and normal correctness/security/privacy plus separate Ponytail/React reviews completed; full verification is enforced before push. Browser acceptance and live AI usefulness remain in CL-08/CL-34. Commit: `git log --grep='CL-27'`.

### [x] CL-28 — Match full-plan refinements by stable IDs

**Type:** Fix · **Responsible:** engineering.

Full-plan AI input omits step/action IDs and action status/outcomes. Application matches the response by array position and retains existing statuses. If two same-phase tasks are reordered without changing counts, a completed status can attach to the wrong task.

**Fix:** use stable step/action IDs and scoped patches; reject unknown, duplicate, or unauthorized IDs. Preserve completion and ownership independently of wording/order. Treat explicitly requested structural changes as separate reviewable operations.

**Close with:** swapped same-phase steps, swapped action rows, duplicate IDs, deleted IDs, completed actions, and another family's IDs. No outcome or completion history may move to a different action. **Source:** [full-plan preview and apply](/Users/willsanz/homelessness-project/src/features/families/family-plan-panel.tsx:1001).

**Completed October 13, 2026 — engineering:** full-plan draft input, model output, merge, and UI application now carry the original goal/action IDs. The server confirms the exact IDs and parent-child relationships against the authorized current plan before calling AI. A shared ID check rejects missing, duplicate, foreign, and reassigned children; valid reordered responses are matched back to the original records. Status, notes, outcomes, owner, and checklist completion remain attached to the original draft records. Newly supplied progress text is privacy-checked before the request. Thirty-four focused tests passed across the server boundary, mocked provider/merge, and rendered Apply → Save workflow, including reordered same-phase goals/tasks and forged progress values. Typecheck/lint passed; normal security/correctness and separate Ponytail/React reviews completed. Full verification runs at push. Narrow edit scope and stale-preview handling remain in CL-27; live usefulness remains in CL-34. Commit: `git log --grep='CL-28'`.

### [x] CL-30 — Save one reviewed edit transactionally

**October 15 hosted-build test correction:** Vercel Preview `dpl_31fem9LnVRymBT3XGhpBx3p2gtAh` at `8c614d0` failed one of 686 tests because the test dispatched `beforeunload` immediately after observing the save message, before React completed passive-effect cleanup. The equivalent GitHub verification passed. The assertion now waits for that observable cleanup and still fails if the unload warning remains; no application code or assertion was removed. All 23 plan-panel tests and targeted lint passed. Correctness and Ponytail review confirmed this is a test synchronization change. The final `8ace965` passes full remote checks and the hosted staging and production-candidate workflows. [Failure record](verification/2026-10-15-preview-test-timing.json).

**Additional finding during CL-05:** `capture_case_progress_update` still executes with the browser role even though the hardening migration revoked the required direct case-progress/activity/family writes. Include a real successful meeting-progress transaction, its permissions and rollback tests here; preserve material approval for progress-only updates instead of clearing review unconditionally.

**Type:** Fix · **Responsible:** engineering.

Full-plan save loops through steps, and each step then saves action items separately. A later failure leaves earlier changes committed. The UI can keep old base timestamps after the partial save, so retry can conflict with its own earlier writes.

**Fix:** use a scoped database transaction for one user-confirmed edit, including expected revisions and audit evidence. An individual step edit that updates its actions needs the same all-or-nothing behavior. Reuse the repository's existing transactional RPC pattern.

**Close with:** force failure on the second step and second child update; assert no partial content or audit commit; prove stale-version rejection and a successful retry without duplicates. **Source:** [step persistence and bulk save](/Users/willsanz/homelessness-project/src/features/families/family-plan-panel.tsx:622).

**Completed October 13, 2026 — engineering:** goal/action and full-plan edits now use one authorized database transaction with original revisions, parent/child ownership checks, deterministic locking, and atomic audit events. The UI retains a failed working copy and exposes conflicts inside the full-plan dialog. Meeting progress uses an append-only authorized transaction; staff can read their permitted history. A request ID and payload hash make unchanged/concurrent retries return the existing note without duplicate changes, while changed reuse is rejected. Progress-only changes retain material review evidence. The form catches lost responses, prevents duplicate submissions, retains its original revision across refreshes, and uses the same note limits as storage. The retired standalone goal-save action was removed.

**Evidence:** 23 focused component/action tests passed. A fresh local Supabase reset and the database security suite passed, including forced second-goal, second-action, and audit failures; zero partial writes; stale/foreign-child rejection; unchanged and concurrent retries; retry after rollback; forbidden direct inserts; and unrelated-staff read/write denial. Security advisors reported no issues. Correctness/security/privacy and separate Ponytail/React reviews completed for the few-staff pilot; full repository verification is enforced by the pre-push hook. Deployed browser acceptance remains in CL-08/CL-38; AI edit preservation remains in CL-27/CL-28. Commit: `git log --grep='CL-30'`.

### [ ] CL-38 — Prove least-privilege access and the one-school boundary

**Current remainder:** production upgrade, RLS/grants, standard-staff isolation/offboarding and current canonical workflow pass at 41 migrations. Retained-account access review and school approval of the installation trust boundary remain open. Do not interpret this unchecked school gate as an unperformed database upgrade.

**October 15 original-project upgrade:** following the user's explicit approval, the backed-up 44 demo families and linked case history were removed in a serializable transaction and the 21 missing rehearsed migrations were applied. All 54 resources, 11 application accounts, 13 Auth accounts, original retained fields and Auth identities were preserved. Sixty-seven final constraints passed; migration history now matches all 40 repository migrations. Independent read-back confirms no table missing RLS and no anonymous privileged-function execution. Two disposable staff accounts then passed real ownership/foreign-write denial, offboarding, preserved reassignment, refresh/sign-in denial, retained-token denial and logout checks; all fixtures were removed. [Executed upgrade and limits](verification/production-demo-upgrade.md), [transaction](verification/2026-10-15-production-upgrade.json), [access proof](verification/2026-10-15-production-access.json). Normal correctness/security/data-loss review and separate Ponytail review completed. Production application release remains a distinct CL-41 check.

**Later October 14 real hosted Auth/Data API check:** two disposable `case_manager` accounts and two synthetic families passed password login, minimal intake, owner reads, unrelated-staff read/write denial, and denied-write preservation. The existing offboarding operation revoked access and refresh/sign-in, reassigned the family while preserving its original creator, and left the replacement's own access intact. Unexpired tokens were denied after offboarding and global logout, including direct mutation/budget RPCs. Both fixture accounts/families were removed; the existing operator account and audit history were preserved. No email or administrator account was created by this rehearsal. Its initial temporary-runner import error occurred before any hosted request and was corrected. [Exact checks and cleanup evidence](verification/2026-10-14-hosted-access-smoke.json). Normal correctness/security/privacy and separate Ponytail review covered the reused operations and scoped cleanup. This is real hosted standard-role evidence; administrator/MFA, the complete action matrix, school boundary and live legacy upgrade remain open.

**Later October 14 preparation:** complete schema/ACL definitions are captured without row data, and a synthetic upgrade/rollback rehearsal is added to CI. It checks all 20 legacy tables, exact baseline fingerprints, final-schema equivalence and existing-content preservation. After correcting an initial synthetic seed error, the second run preserved records and rolled back incompatible data, then detected legacy permission drift. A new migration removes inherited function/maintenance access and unsafe defaults; regressions exercise explicit permissions for future objects and reject service-role truncation. The complete rerun passed on `8257d5f` (CI 38633669561), including record preservation, rollback and final grant equivalence. Staging now has all 39 migrations; permissions and the rolled-back hosted SQL-role smoke pass. [Rehearsal evidence](verification/2026-10-14-legacy-upgrade.json). A read-only, aggregate preflight found 39 action rows and 58 plan steps incompatible with the strengthened privacy rules (other 57 checks zero); a reviewed handling plan is required, with no automatic rewriting or validation bypass. Existing directory aggregates confirm 54 active entries and no explicitly demo-labelled records. Production is unchanged. [Upgrade preparation and remaining gates](verification/hosted-database-preflight.md).

**Critical hosted follow-up:** read-only policy/grant/function inspection confirms authenticated self-insert/update can set the trusted admin role. A local synthetic reproduction proves the resulting cross-family access. The minimal [containment](verification/legacy-access-containment.sql) blocks those writes while preserving profile editing, existing roles and owned-case access; its [regression drill](verification/2026-10-14-legacy-containment.json) passes and is in CI. The user explicitly approved applying it; live migration `20261014165601` is now verified, with the account-row digest and all account/family/resource counts unchanged. [Live read-back](verification/2026-10-14-live-containment.json). Existing-role/access-history review, public-signup disablement and full hosted session/MFA/upgrade verification remain required. No hosted exploit was executed.

**October 14 initial hosted finding:** the user-restored configured project is healthy, but it has 44 existing family records, 20 older public tables, no private tables and no recorded migrations. RLS is enabled on all observed public tables; that does not establish the new active-account/session/review controls. Advisors flag a mutable function search path, anonymous access to privileged functions and disabled leaked-password protection. No identities or narratives were read. Subsequent changes are the explicitly approved legacy containment and synthetic staging setup. [Metadata, staging evidence and safe legacy-upgrade procedure](verification/hosted-database-preflight.md). Local role/session/MFA/database and browser tests pass; the new staging project now has all 38 migrations, with a passing rolled-back SQL role smoke test and no anonymous privileged RPCs. Real hosted Auth/MFA/browser authorization and a rehearsed data-preserving legacy upgrade remain open. Do not reset this project or blindly replay/mark the initial migrations.

**Type:** Verify · **Responsible:** engineering + pilot administrator.

Application authentication and family-level row policies are good foundations, but the deployed policy state was not inspected. Current admin authority is installation-wide; the production posture is explicitly single-tenant. That is appropriate only when the installation's trust boundary matches the school pilot.

**Fix/verify:** exercise every family-scoped server action and direct database operation with owner, assigned staff, unrelated staff, unprovisioned user, anonymous caller, and AAL1/AAL2 admin. Verify grants, cross-family child relationships, audit immutability, and no client-chosen privilege escalation. Before another independent school joins, explicitly choose isolated deployments or organization-scoped authorization.

**Close with:** fresh database suite plus authenticated staging evidence against the deployed migrations. Record the school boundary; do not infer multi-school isolation from family RLS. **Sources:** [security suite](/Users/willsanz/homelessness-project/scripts/test-database-security.ts), [session authorization](/Users/willsanz/homelessness-project/src/lib/auth/session.ts), [production posture](/Users/willsanz/homelessness-project/src/lib/env.ts).

## Gate B: complete the staff workflows

### CL-43 — Device verification deferred; superseded by password-only pilot

**October 14 user decision:** no Face ID/passkey or authenticator requirement for this pilot. The capability research below is retained for reference only. CL-11 tracks complete removal of existing CaseLink 2FA; CL-43 is not a launch gate.

**Added October 14 at the user's request:** prefer Face ID/fingerprint or the device's secure prompt without forcing staff to install a dedicated authenticator app. The existing TOTP implementation and its prior regression evidence remain valid; the new experience is not implemented. The approved temporary staging administrator test proved password-only casework is gated, then restored the original case-manager role and verified normal access. Hosted enrollment stopped when the user raised this preference. [Gate and restoration evidence](verification/2026-10-14-hosted-mfa-gate.json).

**Type:** Decide + Fix + Verify · **Responsible:** engineering + service owner.

**Fix/verify:** choose and implement the smallest provider-supported device-verification flow, preserving invitation-only onboarding, strong administrator access, current-session checks and recovery protections. Supabase's passkey sign-in and WebAuthn second-factor APIs are currently experimental; the staging Passkeys setting is off, and SDK support alone does not prove hosted second-factor availability. Passwordless sign-in also requires deliberate changes to the existing password-session boundary. [Provider findings, implementation boundaries and exact acceptance tests](verification/passkey-readiness.md).

**Hosted capability check:** a disposable confirmed staging Auth account received HTTP 422 / `mfa_webauthn_enroll_not_enabled`; public settings independently show passkeys off. The probe sent no email, granted no application role and opened no biometric prompt. Its sessions/account were removed. Provider enablement/support terms and the actual device experience remain open. [Exact result](verification/2026-10-14-device-feature-probe.json).

**Close with:** supported-provider/plan evidence; regression tests for enrollment, sign-in, cancellation, fallback, removal, recovery and retained-token denial; actual hosted authorization checks; and separately authorized real-device acceptance. Keep this item open until the user-preferred experience is proven or the user explicitly accepts a documented pilot fallback. Do not silently weaken MFA or treat a virtual authenticator as real-device acceptance.

### [x] CL-09 — Surface plan-loading failures instead of empty content

**Completed October 13, 2026 (Codex; correctness/security and Ponytail review):** child query failures now abort the family detail load instead of producing an empty plan. Eleven tests independently fail every constituent query and distinguish absent content from unavailable content; both child-query cases failed before the fix. The existing route error boundary supplies retry, and server callers cannot proceed with a partial returned family. Targeted tests, typecheck, and lint pass; full verification is required on push. Commit: `git log --grep='CL-09'`.

**Type:** Reproduced · **Responsible:** engineering.

`getFamilyDetail` handles parent-query errors but discards errors from plan-step/action-item queries. A failed child query can produce an apparently empty plan or missing tasks, inviting regeneration or incorrect advice.

**Fix:** propagate a recoverable load error and retain a previously loaded view where appropriate. Distinguish absent content from unavailable content; do not generate or review against a partially failed load.

**Close with:** independently fail parent, step, action-item, resource, and progress queries; show an explicit retry state and prohibit consequential writes using incomplete context. **Source:** [family detail loader](/Users/willsanz/homelessness-project/src/lib/services/families.ts:299).

### [x] CL-10 — Budget AI around complete staff journeys

**Type:** Fix · **Responsible:** engineering + service owner.

A plan phase costs two units and the per-user phase limit is six units per ten-minute window. A successful three-phase plan consumes that allocation; immediate regeneration or a retry can be blocked. The displayed error always says to wait a minute, even for a different wait, disabled AI, or an unavailable budget control.

**Fix:** set measured limits for a complete plan plus ordinary repair/refinement work; retain shared server-side abuse/cost controls. Return a safe reason and actual retry time through callers. Reject invalid oversized input before charging its generation budget; avoid duplicate charges for duplicate jobs where appropriate.

**Close with:** two consecutive family plans, malformed-output repair, local quota, global quota, AI-disabled state, unavailable control, and concurrent-user tests. Show accurate recovery without losing completed stages. **Sources:** [rate policy](/Users/willsanz/homelessness-project/src/lib/rate-limit/ai-rate-limit.ts), [shared counters](/Users/willsanz/homelessness-project/supabase/migrations/20260804173443_production_hardening.sql:720), [AI client](/Users/willsanz/homelessness-project/src/lib/ai/client.ts).

**Completed October 13, 2026 — engineering:** the pilot phase allowance supports two complete plans plus two phase repairs per ten-minute window (16 units); refinements allow six requests (12 units) in a separate ten-minute window. Existing chat, per-user hourly, and deployment daily ceilings remain. All three database counters now reserve atomically; any local/hourly/daily rejection leaves every counter unchanged. Invalid model/size/input requests fail before charging, and malformed/unavailable budget controls fail closed in every environment. Safe messages explain the specific limit and its actual retry period, or disabled/unavailable AI, through the existing caller error flow. Busy/duplicate jobs remain protected by CL-32 leases.

**Evidence:** tests exercise two complete journeys with repairs/refinements for concurrent staff, malformed phase recovery in the same version without duplicate tasks, invalid/oversized preflight, missing/malformed controls, disabled AI, accurate waits, and a 20-request race for the last daily slots. Local/hourly/global denials preserve exact counters. Local database integration and security/performance advisors pass; full verification runs before push. These are request-unit limits, not a dollar spending guarantee; the provider project spending cap and operator alert rehearsal remain CL-42/CL-36. Correctness/security and separate Ponytail reviews completed. Commit: `git log --grep='CL-10'`.

### [x] CL-12 — Reconcile product scope and remove proven unused paths

**Type:** Fix · **Responsible:** product + engineering.

README, PRD, privacy/operations material, and retained PDF helpers describe blank-form preparation that current product decisions defer. Operators and school staff could prepare for unsupported behavior. The separate Ponytail deletion pass found 149 lines of PDF inspection code and a 10-line field-policy helper without production callers; retained tests are their references.

**Fix:** update current-facing promises and release checks to reviewed-plan PDF export. Reconcile the legacy `CASELINK_PDF_MODE=fillable-only` schema/startup requirement with the actual export-only product, preserving the privacy and deployment checks. Label historical design documents clearly. Remove the unused helpers and obsolete tests if still unused at implementation; keep PDF dependencies needed by the actual renderer. Recheck dead AI task/mode configuration before removing it.

**Close with:** repo-wide reference search, updated school-demo instructions, and normal verification. Preserve historical data/migrations unless a separate reviewed migration is required. **Sources:** [README](/Users/willsanz/homelessness-project/README.md), [PRD](/Users/willsanz/homelessness-project/docs/intervention-planning-prd.md), [former PDF inspector at audit baseline](https://github.com/Will-Sanz/case-link/blob/e0cb389feaa0096175b33f05602ed72f0041c467/src/lib/paperwork/pdf-form.ts), [former field policy at audit baseline](https://github.com/Will-Sanz/case-link/blob/e0cb389feaa0096175b33f05602ed72f0041c467/src/lib/paperwork/field-policy.ts). **Lean opportunity:** at least 159 implementation lines, zero dependencies established for removal.

**Completed October 13, 2026 — engineering:** README and school-demo instructions, current PRD acceptance matrix, privacy/terms text, and the operations runbook now describe reviewed-plan PDF export. Historical audits/design proposals are explicitly marked superseded. Removed the obsolete fillable-PDF deployment setting from startup validation, CI, and examples while retaining all eleven applicable production safety checks. Repository-wide caller searches established that the uploaded-form inspector/field policy, raw AI file-input assembly, retired single-request/rules generation and templates, direct checklist action, and legacy helper/Chat Completions routing had no product callers; those implementations and their obsolete tests were deleted. Staged generation, scoped refinements, case assistance, the reviewed PDF renderer/finalizer, database history/migrations, and both PDF dependencies remain.

**Evidence:** all 336 tests in 59 files, typecheck, and lint passed after deletion. Active AI task routing tests cover all four current task types; the source-boundary test now rejects any raw-file AI path anywhere in production source. Existing review/export, conflict/rollback, session, and production-posture tests still pass. Normal correctness/security/privacy/regression and separate Ponytail reviews found no remaining caller regression; full verification/build runs before push. Approximately 2,800 net lines of obsolete code/document duplication were removed. Hosted release gates remain open. Commit: `git log --grep='CL-12'`.

### [x] CL-13 — Make invitation retry and partial provisioning recoverable

**Type:** Fix · **Responsible:** engineering + pilot administrator.

New users receive an invitation before the role-provisioning RPC completes. If provisioning fails, an Auth account/email can already exist. Re-running the script finds the existing account and changes its role but does not resend an expired or unopened invitation.

**Fix:** provide explicit, auditable invite/resend/repair operations with safe idempotency. Distinguish inviting a new person, resending setup, and changing an existing person's role; never reset an established account accidentally.

**Close with:** first invite, existing active user, expired invite, failed role RPC after email creation, retry, duplicate operator requests, and wrong-role input tests with a synthetic mailbox. **Sources:** [invitation workflow](/Users/willsanz/homelessness-project/scripts/invite-user.ts), [provisioning safety](/Users/willsanz/homelessness-project/scripts/provisioning-safety.ts).

**Completed October 13, 2026 — engineering:** account creation and audited permission provisioning now precede invitation delivery. Failed provisioning sends no email; retries reuse the unconfirmed account and resend its invitation, including after expiry. Duplicate creation is resolved by the existing account instead of creating another. Confirmed users receive only a role update unless the operator explicitly requests `CASELINK_INVITE_RESEND=true`, which sends a recovery link for interrupted setup or renewed access. Offboarded accounts cannot be reactivated by this operation. Safe stage-specific errors explain what remains to retry, and provider waits are bounded. Ten invitation/provisioning unit tests passed, covering ordering, partial failure, resend, duplicate requests, active users, role validation, and offboarding. The real local Auth test now consumes delivered messages from the isolated mailbox and passed initial invite, forced expiry, resend to the same account, initial password, explicit recovery email, one-time links, and old/new password checks. Correctness/security and separate Ponytail review completed; full verification is required on push. School SMTP delivery remains CL-16. Commit: `git log --grep='CL-13'`.

### [x] CL-14 — Make auth callbacks and failures finish predictably

**Related fix in CL-07:** real local Auth testing found that `auth.email.enable_signup=false` disabled the email provider. The provider is now enabled while top-level public signup remains disabled; both behaviors are tested. Callback/form work and hosted evidence below remain open.

**Type:** Fix + Verify · **Responsible:** engineering.

The callback supports PKCE codes, token hashes, and fragment sessions. Its async work has no outer failure handler, and its redirect guard does not prevent duplicate one-time token exchanges. Strict Mode/remount races are a test risk, not a reproduced production failure. Several auth forms also lack an explicit thrown-error path.

**Fix:** give every supported callback and network failure a finite, safe result; allow only intended verification types; prevent competing exchanges/redirects. Preserve safe internal redirects and token cleanup. Handle sign-out failures deliberately instead of ignoring the SDK error result.

**Close with:** the auth matrix below, including expired/reused links, remount, missing verifier, bad type, malformed fragment, denied cookies, provider outage, and sign-out failure. **Sources:** [callback](/Users/willsanz/homelessness-project/src/app/auth/callback/auth-callback-client.tsx), [login](/Users/willsanz/homelessness-project/src/features/auth/login-form.tsx), [forgot password](/Users/willsanz/homelessness-project/src/features/auth/forgot-password-form.tsx), [sign-out](/Users/willsanz/homelessness-project/src/app/actions/auth.ts).

**Completed October 13, 2026 — engineering:** callbacks now validate one supported exchange (PKCE, invitation/recovery token hash, or complete fragment session), scrub query/fragment credentials before browser-client initialization, and share the current operation across Strict Mode and route remounts. Stored and provider-verified account identities must agree. Invalid/ambiguous input, missing session, blocked storage, thrown failures, and unsafe destinations finish at a generic recovery screen without provider text in URLs. Browser/server/proxy requests have bounded waits and preserve cancellation. Login, reset-email, reset-session, and password-update failures recover with retained input and duplicate-submit guards. Sign-out reports failure with retry; success revokes global refresh sessions. Database authorization additionally requires a live, unexpired session belonging to the authenticated account, so an old unexpired JWT cannot access cases after logout. Thirty-nine focused checks passed, plus real local Auth logout/retained-token tests and database tests for expired/mismatched sessions. Supabase security advisor: no issues. Correctness/security and separate Ponytail review completed; full verification is required on push. Actual school mail delivery and deployed browser/cookie settings remain CL-08/CL-16/CL-38 gates. Commit: `git log --grep='CL-14'`.

### [x] CL-15 — Define and complete initial-password and reset behavior

**Type:** Fix + Decide + Verify · **Responsible:** product + engineering.

Invited users are directed to password setup, but there is no explicit server-enforced setup-complete state. A valid invitation session can navigate elsewhere first; that is an onboarding-policy gap, not proof of unauthenticated access. Password UI advertises length only while local Auth requires mixed case, digits, and symbols. Successful reset redirects to login while retaining a session, and the login page redirects signed-in users to Families.

**Fix:** decide whether password setup must finish before workspace use, enforce that decision, show the actual password policy, and make the post-reset destination intentional. Cover secure-password-change reauthentication if enabled; do not tell users to request a new link for every ordinary policy error.

**Close with:** initial invite setup, attempted skip, password mismatch/policy rejection, fresh and older recovery sessions, repeat submission, old-password denial, new-password login, and intended session revocation. **Sources:** [reset form](/Users/willsanz/homelessness-project/src/features/auth/reset-password-form.tsx), [login route](/Users/willsanz/homelessness-project/src/app/login/page.tsx), [Auth configuration](/Users/willsanz/homelessness-project/supabase/config.toml).

**Completed October 13, 2026 — engineering:** case access now requires Supabase's signed password-authentication claim as well as an active account and live session. Invitation/recovery sessions can finish account setup but cannot read cases or call casework RPCs; editable user metadata cannot bypass this. Existing password users continue normally. The form displays and checks the configured password rules, retains editable input after policy/verification errors, supports the provider's reauthentication code, prevents duplicate updates, and clears password fields after success. It then revokes sessions and directs the user to password sign-in; a failed sign-out retries only sign-out. Cancel also signs out to avoid a login/setup loop. Twenty-eight focused unit/rendered checks passed, including setup routing, policy parity, mismatch, nonce handling, expiry/error recovery, duplicate submissions, and sign-out retry. Real local Auth/Data API tests passed for initial invitation, attempted bypass, weak password, first login, fresh recovery, old-password denial, replacement-password login, one-time recovery links, and revocation of earlier JWT access. Direct database security checks and the Supabase security advisor passed. Correctness/security/accessibility and separate Ponytail review completed; full verification is required on push. Hosted mail and browser rehearsal remain CL-08/CL-16/CL-38 gates. Commit: `git log --grep='CL-15'`.

### [ ] CL-16 — Ship and verify the actual account emails

**Current remainder:** engineering setup, real owner-inbox delivery and hosted invitation/recovery pass. The main site is now released with the canonical callback. Only school mailbox/filter acceptance and operational sending-key ownership remain open; no school invitation has been sent.

**October 15 production email setup:** all 13 checked-in templates were installed, reloaded and matched to their rendered source text; seven security notices persisted as enabled. Existing Resend SMTP credentials were preserved. A single recovery request to the authorized owner inbox arrived with SPF/DKIM passing, the canonical `https://www.thecaselink.com/auth/callback`, fragment-only token, explicit confirmation, and 15-minute/one-use wording. It was not redeemed and no existing password changed. [Template settings](verification/2026-10-15-production-email-settings.json), [actual production delivery](verification/2026-10-15-production-recovery-email.json), [Auth settings and Free-plan limits](verification/2026-10-15-production-auth-settings.json).

**October 15 hosted account/recovery evidence:** the exact candidate passed expired-invite denial, renewed invitation, explicit link confirmation, pre-password casework denial, password mismatch validation, initial password setup and login. A recovery link worked in an independent browser with no original verifier; the prior browser/session and old password were denied, the new password worked, and link reuse failed. All temporary accounts were removed; the existing owner's password was unchanged. [Account checks](verification/2026-10-15-hosted-account-recovery.json). One separately requested recovery email reached the authorized owner inbox with SPF/DKIM passing, the correct canonical callback, token only in the fragment and 15-minute/single-use instructions; it was not redeemed. [Delivery evidence](verification/2026-10-15-recovery-email.json). Generated-token tests and inbox receipt are distinct evidence; school-mailbox/scanner acceptance is still external.

**Later October 14 hosted verification:** the exact staging origin/callback, session rotation/TOTP controls and seven security notifications are saved. Existing Resend is Free (3,000/month, 100/day, pay-as-you-go off), with verified domain and tracking off. The user privately saved a separate SMTP key. All 13 email bodies are installed and their complete rendered text was verified after page reload. The initial editor operation saved subjects but left default bodies; read-back caught this before sending, and native paste corrected it. Ten focused invitation/template tests pass; a new check covers all seven notification files and rejected an intentionally inserted compact credential placeholder in a hosted-only template, then the original was restored. Normal correctness/security/privacy and separate Ponytail review found no additional change needed.

The audited operator flow then provisioned a standard case-manager account and sent one invitation to the exact operator-controlled inbox authorized in this chat. Gmail Inbox receipt, SPF/DKIM, the canonical staging callback and fragment-only credential links are verified. Opening the link removed the address-bar credential and left Auth unconfirmed until explicit Continue. After confirmation, trying Families before setting a password correctly returned to setup. The user privately completed password setup and password sign-in to Families; the password-change notice reached the same Inbox with SPF/DKIM passing and no credential link. An earlier administrator-creation request was rejected before execution. After explicit user authorization, the existing staging account temporarily became administrator, correctly hit the mandatory verification gate, then returned to its original case-manager role through the audited operation. Enrollment/challenge stopped for the user's device-verification preference (CL-43). Hosted recovery, expiry/resend, sending-key domain-scope read-back and school-mailbox/scanner acceptance remain open. No school staff are invited. [Provider](verification/2026-10-14-email-provider.json), [settings](verification/2026-10-14-staging-auth-settings.json), [templates](verification/2026-10-14-staging-email-templates.json), [invitation evidence](verification/2026-10-14-hosted-invitation.json), [MFA gate/restoration](verification/2026-10-14-hosted-mfa-gate.json), [anonymous checks](verification/2026-10-14-hosted-auth-posture.json).

**October 14 staging follow-up:** the new synthetic project is invitation-only, with email confirmation, secure email/password changes, a configured 14-character mixed password policy, and 900-second email-code expiry. Its default eight-digit email code exposed a six-digit-only form limit; the form now accepts the local and hosted code lengths, while Auth verifies validity/expiry. The expanded regression failed before the fix; all 16 focused sign-in form tests now pass, including malformed-code denial and sign-out ordering. Normal correctness/security/privacy/accessibility and separate Ponytail reviews completed. No hosted invitation was sent; SMTP/templates, canonical redirects, real sessions/MFA and school-mailbox delivery remain open. [Configuration and regression evidence](verification/2026-10-14-hosted-auth.json).

**October 14 hosted observation:** the restored project's public Auth settings report signup enabled, email confirmation enabled and anonymous/other providers disabled. [Allowlisted metadata](verification/2026-10-14-hosted-auth.json). This contradicts the invitation-only launch policy and requires a hosted change; no signup attempt or email was sent. Actual SMTP, installed templates, token lifetime, secure-change/session controls, canonical redirects, synthetic school mailbox and its active link scanner remain unverified. Local tests pass; they do not certify the hosted account flow.

**Type:** Fix + Verify · **Responsible:** engineering + operator.

Email-template documentation instructs operators to install `recovery.html`, but that file is absent. Some template expiry wording differs from local OTP settings. Neither fact proves which template is installed in the hosted project.

**Fix:** supply a correct recovery template, align link lifetime wording with actual configuration, and verify invite/recovery/security notifications through school email filtering. Confirm one canonical HTTPS origin and exact redirect allowlist, including apex-to-www behavior and cross-device recovery.

**Close with:** delivered messages in a synthetic school mailbox, correct single-use links, scanner/preview behavior, expiry and resend, no sensitive tokens in diagnostic logs, and recorded hosted template/SMTP settings. **Sources:** [template instructions](/Users/willsanz/homelessness-project/supabase/email-templates/README.md), [magic-link template](/Users/willsanz/homelessness-project/supabase/email-templates/magic_link.html), [site-origin helper](/Users/willsanz/homelessness-project/src/lib/auth/public-site-url.ts).

**Implemented and locally verified October 13, 2026; school/hosted gate remains open:** added the missing recovery template and installed invite/recovery/reauthentication templates and password/email/MFA security notices in local configuration. Template lifetimes now match the 15-minute OTP policy; notification text contrast was corrected. New invitation/recovery links carry a token in the URL fragment, scrub browser history, and wait for a deliberate confirmation before redemption. A page preview, including JavaScript rendering, makes no Auth request. Duplicate/ambiguous callback parameters are rejected. Thirty-three focused tests passed. Real local email/Auth tests proved the custom templates were actually delivered, expired invitations can be resent, recovery works in a separate client even when requested with PKCE, changed passwords produce a distinct notice, and an older session must supply a delivered six-digit code (wrong/expired codes fail; renewed code succeeds). Bodies, codes, and links stay out of test output. Correctness/security/accessibility and separate Ponytail review completed; full verification is required on push. **Still required:** install/verify these templates and SMTP in the actual hosted project, test a synthetic school mailbox and its active link scanner, and record canonical-domain/redirect behavior. At that October 13 checkpoint, no school email was sent or hosted setting changed; the October 14 staging changes are recorded above. Commit: `git log --grep='CL-16'`.

### [x] CL-17 — Include provisioning safety tests in CI

**Completed October 13, 2026 (Codex; correctness/security and Ponytail deletion review):** the standard Vitest include now covers `scripts/**/*.test.ts`. All four provisioning safety tests run in the same CI command as application tests. Full `npm run verify` passed: 37 files / 113 tests, typecheck, lint, secret/resource/lockfile checks, and production build. Invalid production inputs, roles, and invitation origins are explicitly rejected. Commit: `git log --grep='CL-17'`.

**Type:** Fix · **Responsible:** engineering.

The four tests in `scripts/provisioning-safety.test.ts` are outside Vitest's `src/**` include patterns. The standard verification command therefore does not run them.

**Fix:** include this exact security-test location or move the tests into a discovered location. Keep the command unambiguous rather than adding a second forgotten test runner.

**Close with:** CI output explicitly includes these tests; a deliberately invalid production/test provisioning input fails. **Sources:** [tests](/Users/willsanz/homelessness-project/scripts/provisioning-safety.test.ts), [test discovery](/Users/willsanz/homelessness-project/vitest.config.mts), [CI](/Users/willsanz/homelessness-project/.github/workflows/ci.yml).

### [x] CL-19 — Handle AI terminal states before accepting text

**Completed October 13, 2026 (Codex; correctness/privacy and Ponytail review):** shared AI client accepts only completed, non-refused, nonempty results. Both API paths validate response structure; incomplete/refused/provider/malformed/timeout/network failures remain errors, preserve safe categories and retry timing, and never return partial prose. Provider error bodies are not exposed or logged. No automatic retry was added. Of 27 contract tests, 22 failed before the fix; all pass afterward, along with typecheck/lint. Every AI caller uses this shared boundary. Full verification runs on push. Commit: `git log --grep='CL-19'`.

**Type:** Reproduced · **Responsible:** engineering.

The Responses parser accepts any returned output text on HTTP 200 without checking response status, incomplete details, or refusal. A truncated assistant answer is presented as complete. Structured parsing may reject broken JSON, but that does not cover partial prose or semantically incomplete valid JSON.

**Fix:** distinguish completed output, refusal, incomplete output, provider error, malformed response, and timeout. Preserve safe error categories/retry information. No partial response should become approved or silently committed content. Bound retries by reason, budget, and idempotency.

**Close with:** mocked completed, token-limit, content-filter, refusal, empty, malformed, 429/Retry-After, 5xx, timeout, and network-abort responses across all callers. **Source:** [AI response handling](/Users/willsanz/homelessness-project/src/lib/ai/client.ts:354). [OpenAI output handling guidance](https://developers.openai.com/api/docs/guides/structured-outputs).

### [x] CL-20 — Keep API routing and model capabilities explicit

**Completed October 13, 2026 (Codex; correctness/security and Ponytail review):** model overrides preserve task routing. Configuration permits only `gpt-5.6-luna` (unchanged default) and `gpt-4o` (existing QA override), with explicit reasoning/output limits and tested request options. Legacy helper requests use `max_completion_tokens`. Fast-only product routing remains unchanged. All 38 AI contract tests, typecheck, and lint pass. Synthetic live Responses requests confirmed both selected models accept strict JSON, token limits, reasoning/temperature, and `store: false`. The first GPT-4o prompt failed the exact-label assertion; a clarified JSON instruction passed. This was an API compatibility check, not the CL-34 domain-quality evaluation. Commit: `git log --grep='CL-20'`. References: [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [GPT-4o](https://developers.openai.com/api/docs/models/gpt-4o).

**Type:** Reproduced + Verify · **Responsible:** engineering.

Setting `OPENAI_MODEL_OVERRIDE` silently sends ordinary Responses tasks to Chat Completions. Model validation is prefix-based and capability checks infer support from a few model-name patterns. This can accept a nonexistent/incompatible model or send unsupported parameters. No live account-model compatibility check was performed.

**Fix:** keep the endpoint choice stable when overriding a model. Support a small tested set of deployed model/parameter combinations; fail clearly on invalid configuration. Evaluate any model change for quality, latency, and cost rather than replacing the default based on its name.

**Close with:** default and per-task/global override contract tests plus a synthetic smoke request on the actual OpenAI project for every selected model. Verify reasoning, temperature, token limits, structured output, and `store: false`. **Sources:** [routing](/Users/willsanz/homelessness-project/src/lib/ai/client.ts:159), [model configuration](/Users/willsanz/homelessness-project/src/lib/ai/models.ts), [allowlist](/Users/willsanz/homelessness-project/src/lib/ai/model-allowlist.ts).

### [x] CL-21 — Use one tested structured-output contract

**Type:** Fix · **Responsible:** engineering.

Current lean generation/refinement calls explicitly use `strict: false`, and hand-written JSON schemas can drift from local validation and persistence. Strict output alone would still not prove factual correctness.

**Fix:** use a supported strict schema for each structured task, reusing the installed Zod/schema helper where suitable. Model optional values explicitly, then run semantic checks for allowed IDs, dates, task identity, contacts, and protected edits before saving. Align valid cardinality/date ranges between manual edits, AI previews, and storage.

**Close with:** missing/extra fields, nulls, length/count boundaries, invalid dates, unsupported schema, all supported model contracts, and semantic rejection tests. **Sources:** [schema helper](/Users/willsanz/homelessness-project/src/lib/ai/structured-json-schema.ts), [lean generation](/Users/willsanz/homelessness-project/src/lib/plan-generator/openai-plan-lean-phase.ts), [refine schema](/Users/willsanz/homelessness-project/src/lib/plan-generator/plan-refine-lean.ts). [OpenAI strict schema requirements](https://developers.openai.com/api/docs/guides/structured-outputs).

**Completed October 13, 2026 — engineering:** generation and refinement now derive provider JSON schemas from their strict Zod validators. Every provider property is required; optional content uses explicit nulls. All active structured calls enforce strict output, with no non-strict fallback. The schema helper rejects optional/open objects and unsupported composition. Generation rejects wrong phases and missing/impossible action dates instead of coercing them. Task text/week/calendar limits reuse the manual-edit schema; generation follows the database's 20-new-task cap, while refinement supports up to 50 existing tasks without changing membership. Null dates preserve confirmed dates, and AI cannot change scheduling metadata or progress. Errors no longer echo malformed model fields into the UI or logs.

**Evidence:** focused tests cover missing/extra fields, explicit nulls, whitespace, length/count/week boundaries, leap days, invalid dates, wrong phases, protected fields, IDs, unsupported schemas, and failure without fallback. The opt-in `npm run test:ai-contracts -- --live` checks all three phase contracts and refinement against both allowed models using synthetic examples, `store: false`, and metadata-only output. All eight final live checks passed; see [contract evidence](verification/2026-10-13-ai-schema-contracts.json). Normal correctness/security/privacy and separate Ponytail reviews completed; full verification runs before push. Contract validity is not factual correctness: contact grounding and complete outbound provenance remain CL-06/CL-18, and school usefulness remains CL-34. Commit: `git log --grep='CL-21'`.

### [x] CL-22 — Give the assistant the progress it claims to know

**Type:** Fix · **Responsible:** engineering + case-manager reviewer.

The assistant claims live context about blockers and progress but primarily receives summary, barriers, resource matches, step titles, and one current step. It omits the action-level target dates, completion/outcomes, and recent meeting updates needed to answer “What should I prioritize this week?” accurately.

**Fix:** build bounded, authorized context from the same next-work/date/status rules used by the workspace, plus relevant recent progress. Distinguish missing information from known facts; keep source references to actions/resources and make context limits clear.

**Close with:** overdue task, completed task, waiting follow-up, updated meeting outcome, conflicting older notes, no plan, and inaccessible-family fixtures. Answers should reflect the latest approved case state. **Sources:** [assistant context](/Users/willsanz/homelessness-project/src/lib/case-assistant/ai-case-assistant.ts:13), [existing next-work logic](/Users/willsanz/homelessness-project/src/lib/domain/family-workspace/next-work.ts).

**Completed October 13, 2026 — engineering:** the assistant now receives a bounded snapshot of the current plan/review state, goal responsibility, action IDs/titles, exact dates, status, notes, outcomes, and dated recent meetings and notes. It uses the workspace next-work selector; Waiting uses its follow-up date, completed/withdrawn work is not resurrected from an older open parent, and overdue evaluation uses the school's Philadelphia date. Prompts distinguish current state from historical observations and chat, require honest unknowns/conflict handling, and declare omitted records/shortened text. Account/author identifiers are omitted; newly included narrative is checked before provider access.

**Evidence:** 14 focused tests passed for overdue/completed/withdrawn/Waiting work, conflicting old notes and newer outcomes, no plan, bounded large cases with explicit omissions, local-date rollover, private text in newly included fields, inaccessible families, and expired sessions. Typecheck/lint and normal correctness/security/privacy plus separate Ponytail reviews completed. Full verification runs before push. These tests prove context fidelity; live answer quality and case-manager acceptance remain CL-34, while full provider-payload provenance and source-backed contacts remain CL-18/CL-06. Commit: `git log --grep='CL-22'`.

### [x] CL-23 — Preserve important instructions and one consistent generation context

**October 15 production-directory regression:** approved protected-candidate access exposed a real plan-start failure before any AI call: the durable snapshot included directory phone/email values and the database correctly rejected them as identifiers. The shared snapshot builder now keeps those values out; the existing provenance trigger supplies exact current contact facts when saving steps. No privacy rule, permission or source-freshness check was weakened. A regression failed before the change, then all 103 focused planning/grounding/outbound-privacy tests passed; typecheck/lint passed. A disposable standard-staff production check confirmed start, phase save and exact canonical contacts, then removed its case/account without changing the directory. Added the same real snapshot → start → append → canonical-contact assertion to the database suite; it passes full remote CI at `8ace965`, followed by rebuilt hosted staging and production-candidate workflows. Independent intermittent production-read delays remain open under CL-41. Normal correctness/security and separate Ponytail deletion review passed: one shared mapping, no dependency, migration or new abstraction. [Original failure](verification/2026-10-15-production-candidate-plan-start-failure.json), [production regression](verification/2026-10-15-production-generation-regression.json).

**Type:** Reproduced + Fix · **Responsible:** engineering.

The planning brief places extra feedback after existing notes and slices the combined text to 1,200 characters. A long saved summary can discard a new contact restriction entirely. Staged generation also rebuilds prompts from freshly loaded detail while passing the saved brief as feedback, allowing duplicated or mixed-revision context.

**Fix:** preserve explicit new instructions and critical constraints; bound context deliberately and surface material omissions. Generate all stages from an identified case revision/snapshot, or explicitly invalidate/restart when relevant inputs change. Include appropriate recent outcomes when regenerating.

**Close with:** long notes plus final critical instruction, many barriers/goals, refresh between phases, case edit during generation, and regeneration after completed work. No silent omission of the requested change. **Sources:** [planning brief](/Users/willsanz/homelessness-project/src/lib/plan-generator/planning-brief.ts), [staged actions](/Users/willsanz/homelessness-project/src/app/actions/plans.ts:547).

**Completed October 13, 2026 — engineering:** all three stages use one persisted, family-bound, hashed snapshot of the planning brief and resource recommendations. Refreshes and concurrent case edits cannot rebuild or duplicate the context. New instructions, all barriers/goals, and current action status/outcomes are retained in full; oversized context fails clearly before starting. Five recent notes/meetings are included with explicit older-history counts. Resource recommendations identify omitted matches/shortened explanations; contact identifiers are excluded from the frozen narrative. Missing or damaged legacy snapshots require a fresh draft. The plan view explains the saved-context boundary and history limit.

**Evidence:** focused tests cover long notes plus a final restriction, many barriers/goals, completed outcomes, history/resource limits, oversized/mutated/cross-family snapshots, private action outcomes, and the real start/advance action flow through all three model requests with a concurrent case edit. The local database security suite verifies the exact snapshot survives transactional phase persistence. Normal correctness/security/privacy and separate Ponytail reviews completed; full verification runs before push. Directory grounding and live usefulness remain CL-06/CL-34. Commit: `git log --grep='CL-23'`.

### [x] CL-24 — Bound chat history before validation

**Completed October 13, 2026 (Codex; correctness/accessibility and Ponytail review):** client and provider formatting use complete recent exchanges, bounded by 40 messages / 12,000 content characters. The server separately enforces text size and alternating roles; the UI shows its 4,000-character question limit and explains limited history. Visible history is capped at 100 messages. Seven tests cover 0/40/42/100 messages, overlong text, incomplete exchanges, and a rendered 23-exchange conversation with a successful follow-up. Typecheck/lint pass; full verification runs on push. Commit: `git log --grep='CL-24'`.

**Type:** Reproduced · **Responsible:** engineering.

The browser sends every previous message, but the server accepts at most 40. After 21 successful question/answer pairs, the next request contains 42 prior messages and fails until the conversation is cleared. The later 12,000-character formatter cannot fix validation that already failed.

**Fix:** send a bounded set of complete recent turns, enforce total input size, and show the question-length limit. Preserve necessary continuity without growing browser/API payloads indefinitely.

**Close with:** 0/40/42/100 prior messages, long assistant answers, an overlong question, and a useful follow-up after trimming. **Sources:** [history builder](/Users/willsanz/homelessness-project/src/features/families/case-assistant-chat.tsx:154), [request schema](/Users/willsanz/homelessness-project/src/lib/validations/ai-actions.ts).

### [x] CL-25 — Recover from failed or superseded AI requests

**October 14 hosted regression:** a synthetic headless run found that full-plan refinement could open the previous plan while an action save refreshed the page. The revision guard safely rejected the preview, but the workflow stalled. The control now reuses the existing pending/save states until fresh data arrives. A new component regression failed before the two-line fix and passes afterward; all 23 panel tests, type checks and targeted lint pass. The browser release journey now also exercises full-plan refinement and exact preservation of the saved action rows. Normal correctness/security/accessibility and separate Ponytail reviews completed. Fresh candidate CI and the hosted rerun remain required. [Reproduction, preceding passes and cleanup](verification/2026-10-14-hosted-refinement-regression.json).

**Completed October 13, 2026 (Codex; correctness/accessibility, React, and Ponytail review):** failed chat questions are restored for editing/keyboard retry without adding failed exchanges to history. Request identities ignore replies after clear, cancellation, or unmount; family-keyed chat/editor instances isolate navigation. Both preview flows catch failures, settle pending state, and invalidate cancelled requests. Ten rendered component tests cover long chat, returned/thrown failures, keyboard retry, duplicate pending sends, clear/new conversation, family switch, cancelled/reopened preview, and both preview failure paths. Targeted checks, typecheck, and lint pass; full verification runs on push. Commit: `git log --grep='CL-25'`.

**Type:** Fix · **Responsible:** engineering.

Chat clears the input and appends a user message before the request succeeds, without a retry/edit state. “New conversation” remains available while a request is pending, so its old answer can arrive in the new conversation. Refinement preview promises lack a catch/finally path and can remain pending after an unexpected rejection.

**Fix:** preserve failed text for retry/edit; give requests an identity so superseded replies are ignored; settle every pending state on success, failure, cancel, and navigation. Reuse existing UI conventions rather than a new workflow framework.

**Close with:** failed send/retry, clear during request, switch family/action, duplicate click, late response, thrown server-action error, and keyboard-only recovery. **Sources:** [chat](/Users/willsanz/homelessness-project/src/features/families/case-assistant-chat.tsx), [refinement requests](/Users/willsanz/homelessness-project/src/features/families/family-plan-panel.tsx:925).

### [x] CL-26 — Make single-step AI changes reach the real actions

**Type:** Reproduced · **Responsible:** engineering.

Single-step refinement asks the model for action items and dates, but the returned result contains only title, description, details, and priority. The UI never applies the proposed action items. “Move the call to October 20” can change prose while leaving the saved call date unchanged.

**Fix:** return and preview the supported action changes, preserving IDs and human approval; or explicitly restrict the feature to wording and reject unsupported requests. The preferred product behavior is a reviewed, consistent change to the actual dated action.

**Close with:** deadline change, action wording change, unsupported structural request, cancel, apply, reload, and PDF comparison. Prose and stored tasks must agree. **Sources:** [refinement result](/Users/willsanz/homelessness-project/src/lib/plan-generator/openai-plan.ts), [apply path](/Users/willsanz/homelessness-project/src/features/families/family-plan-panel.tsx:954).

**Completed October 13, 2026 — engineering:** the shared refinement path returns actual task IDs, wording, and dates. Staff select each proposed change before applying it and save separately; unsupported structural changes fail without modifying the draft. A new regression test reproduced an additional Waiting bug: an unchanged task could offer its historical target date instead of its current follow-up. Model context, merge, and review now use the effective follow-up consistently, preserving dates when the model leaves actions unchanged or returns a null date.

**Evidence:** provider/merge tests cover Waiting wording-only, explicit-date, and unchanged-list responses. Rendered UI tests cover pending and Waiting task wording/date preview, no automatic selection or save, explicit application, save payload, and reload. Existing tests cover cancellation, unselected edits, stale responses, and unsupported IDs/cardinality. A real local database rehearsal selects the proposal, atomically saves it, reloads it, and approves its exact revision; the resulting PDF was text-extracted and visually checked. It contains the selected task wording and Oct 20, 2026 follow-up, preserves the callback note, and omits the old dates. Database security tests, typecheck/lint, normal correctness/security/privacy review, and separate Ponytail deletion review pass; full verification runs before push. Full authenticated browser acceptance and live model usefulness remain CL-08/CL-34. Commit: `git log --grep='CL-26'`.

### [x] CL-29 — Preserve one-action plans and deliberate removals

**Type:** Reproduced + Fix · **Responsible:** engineering.

The full-plan refinement baseline replaces fewer than two action items with generic “Start” and “Follow up” tasks. A legitimate one-action step therefore changes before the model edits it. Empty returned contacts/documents also mean “keep the old values,” so explicit removal cannot be represented reliably.

**Fix:** preserve valid existing cardinality; distinguish no change from an explicit clear/remove operation. Do not insert filler tasks or contacts to satisfy legacy output assumptions.

**Close with:** zero/one/many existing actions according to the product contract, unchanged one-action rewrite, removal of a wrong contact/document, and UI/server count agreement. **Source:** [baseline and merge](/Users/willsanz/homelessness-project/src/lib/plan-generator/plan-refine-lean.ts:137).

**Completed October 13, 2026 — engineering:** refinement merges directly into the actual draft; the legacy baseline/default passes that invented tasks, contacts, checklists, and blockers were removed. Zero/one/many existing actions retain their exact cardinality. `null` means keep an existing list; `[]` explicitly clears contacts/documents. Unsupported action-count changes return an error for manual review instead of silently adding or retaining tasks. Dates and action descriptions reach the model intact, and editor/server limits agree. Seventeen focused refinement/component tests passed, including the mocked provider-to-merge path and the UI's explicit empty-list save payload; typecheck and lint passed. Normal correctness/privacy and separate Ponytail review completed. Full verification runs before this item's push; live-model quality and identity/edit-preservation evidence remain in CL-21/CL-27/CL-28/CL-34. Commit: `git log --grep='CL-29'`.

### [x] CL-31 — Persist the context staff enter before using it

**Type:** Fix · **Responsible:** engineering.

The barrier-generation action persists selected barriers but uses `additionalDetails` as generation feedback without saving it to the family summary. Reload reads the older saved summary. Matching runs before that new text becomes durable, so matching, generated plans, and later chat can use different context.

**Fix:** establish whether this field edits the family description or is a generation-only instruction and label it accordingly. For the current “Short description” behavior, save it with the intake update before matching/generation, with conflict protection and a clear failure state.

**Close with:** change description, generate, refresh, reopen, inspect matching/assistant inputs, and fail the save. No displayed saved description may silently revert or differ from the case used downstream. **Source:** [barrier workflow](/Users/willsanz/homelessness-project/src/app/actions/barrier-workflow.ts:272).

**Completed October 13, 2026 — engineering:** one authorized database transaction now saves the short description and barriers before matching/generation. It locks the family and checks the form's original database revision; barrier edits from the profile also invalidate that revision. A failed child write rolls back description, barriers, and audit events. The UI retains its draft revision across background refreshes and advances it after a successful context save even if AI fails, so retries remain possible without silently adopting another person's revision. Six action/rendered regression tests passed, plus local Supabase tests for stale edits, missing barriers, rollback, preserved audit counts, and denied cross-family writes. Typecheck/lint and the full pre-push verification gate passed. Correctness/security and separate Ponytail review completed for the single-school pilot. Migration must be applied to staging before the CL-08/CL-38 deployed journey; those gates remain open. Commit: `git log --grep='CL-31'`.

### [x] CL-32 — Resume staged generation through busy and interrupted states

**Type:** Fix + Verify · **Responsible:** engineering.

The browser stops its stage loop on any unsuccessful advance, including “already running.” The resume effect is keyed to a running status that may remain unchanged, leaving no scheduled retry after another request releases its claim. This is especially relevant to refreshes and two tabs. Existing server job claims are useful and should be retained.

**Fix:** distinguish busy/retryable, failed, completed, and superseded states; poll/read progress until a bounded terminal or recoverable state. Test claim expiry and idempotent stage commits. Keep the last usable reviewed plan accessible when replacement generation fails, and verify generation duration against actual hosting limits.

**Close with:** refresh during an active request, two tabs, closed browser, timeout, quota exhaustion, lease expiry, failure after a committed stage, and resume without duplicate tasks/version increments. **Sources:** [browser stage loop](/Users/willsanz/homelessness-project/src/features/families/family-lite-workspace.tsx:245), [claim/release](/Users/willsanz/homelessness-project/src/app/actions/plans.ts:1000).

**Completed October 13, 2026 — engineering:** advances are tied to the requested plan and return typed busy, advanced, complete, superseded, failed, or retryable outcomes. The browser waits through occupied claims, bounds connection retries and total polling, handles requests that never return, stops on navigation, and offers manual continuation after a pause. Provider/quota failures do not trigger automatic spend retries. Database claims now carry per-request lease IDs; expired workers cannot release another request's lease or persist stale state/phases. Recovery fills missing earlier phases before declaring completion. A read-only previous-reviewed-plan page preserves reference access during replacement failure without relaxing current review/export checks. Generation pages declare a 300-second limit; the current single provider request is capped at 180 seconds, below the 600-second lease. Hosted timeout verification remains part of CL-41.

**Evidence:** unit/rendered tests cover busy tabs, missed responses, quota failures, total and per-request timeouts, cancellation, remounts, superseded IDs, manual continuation, earlier-phase gaps, and prior-plan rendering/error states. Local database tests cover concurrent claims, expired lease takeover, stale release/write rejection, atomic phase/audit rollback, exact context preservation, and permission-protected prior-plan access. A clean migration reset and security/performance advisors pass. Equivalent staff-visibility policies were consolidated after an advisor warning; self/peer access conditions remain unchanged and unrelated staff access is tested. Correctness/security/privacy/accessibility and separate Ponytail reviews completed. Intake also no longer duplicates already-saved barriers/description as instructions; a long-description regression test covers the former overflow. Full verification runs before push. Commit: `git log --grep='CL-32'`.

### [ ] CL-33 — Validate a useful resource directory for this school

**October 15 current catalog:** the preserved production directory contains 54 resources and supplied 24 matches for the synthetic case. A generated contact matched the current selected source exactly, and separate source-provenance regressions pass. No resource was replaced or edited. Current availability, geography, contact accuracy and school usefulness still need the resource owner's review.

**Type:** Verify + Decide · **Responsible:** resource owner + school case managers.

**October 13, 2026 — engineering safeguards complete; school verification remains open:** the product owner chose to keep the existing directory and update its CSV later as needed. No replacement catalog or production import was performed. A read-only connection to the configured hosted catalog was unavailable, so its contacts and coverage are not certified here. Explicitly labelled `(Demo)` records and inactive resources are excluded from matching, selection, and AI context; database mutation functions independently reject their suggestion, acceptance, and linking. Dismissal/unlinking remain possible. Matching loads every active entry with bounded paging, and failed/partial loads leave existing suggestions intact. Cards distinguish the directory update date from verification, and imports preserve disabled entries without printing raw rows, contacts, or full paths. The resource-owner process is in `data/README.md`.

**Evidence:** paging tests cover empty, one, page-boundary, 1,065, and over-10,000 records; context/action tests cover inactive/demo/dismissed resources and unavailable versus empty results. Real local database tests cover all resource mutations, restoration, and family permissions. The real Data API import test proves repeat CSV imports retain `active=false`; the Auth suite still passes. A fresh migration rebuild and both database/Auth suites pass; security/performance advisors report no warnings. Full verification runs before push. Normal correctness/security/privacy/accessibility and separate Ponytail deletion reviews completed. Current contacts, geographic fit, common-barrier coverage, and a named school resource owner remain required launch evidence. Source-backed AI contact handling is CL-06/CL-18. Commit: `git log --grep='CL-33'`.

The committed seed is explicitly synthetic; the actual hosted catalog was not inspected. Current keyword/category matching does not establish current availability or eligibility. Technically successful AI output can still be useless if it recommends demo, stale, or geographically unsuitable resources.

**Fix:** validate the pilot's actual resource set and an owner/freshness process. Clearly distinguish matching, no matches, and matching unavailable. Start with the small directory the school actually uses; do not build a broad resource platform first.

**Close with:** case-manager-reviewed coverage for the pilot's common barriers, verified contacts/source dates, demo-data exclusion, no-resource cases, inactive/dismissed resources, and source-backed factual claims. **Sources:** [seed policy](/Users/willsanz/homelessness-project/data/README.md), [matching rules](/Users/willsanz/homelessness-project/src/lib/matching/engine.ts), [resource matching action](/Users/willsanz/homelessness-project/src/app/actions/resource-matches.ts).

### [x] CL-37 — Prevent larger lists from silently losing next-action data

**Type:** Fix + Verify · **Responsible:** engineering.

**Completed October 13, 2026 — engineering:** one security-invoker database request now returns at most one next-work summary per visible family, using only its latest plan. Stable ID ties preserve consistent ordering; Waiting uses the next follow-up date, completed tasks stay completed, and actionless legacy goals still work. Malformed/missing summaries fail visibly instead of showing an empty workload. Child read policies reuse authorized parent rows, preserving RLS and removing repeated nested permission checks.

**Evidence:** 22 focused tests and the local database security suite pass. Fixtures contain 100 families, 1,200 plan versions, 2,700 goals, and 4,800 actions; every summary matches the complete source. Tests cover 0/1/10/100-family responses, concurrent staff, foreign families, no plan, legacy goals, all-completed work, undated work, and equal-date ties. After a clean migration rebuild, local response measurements were 5/62/331/582 ms respectively; the 100-family response was 27,104 bytes. The initial 100-family query took 19,473 ms; reusing authorized parents removed that bottleneck. These are local measurements, not a hosted SLA. Full session/MFA/offboarding and mutation-isolation tests still pass, and database advisors report no warnings. Normal correctness/security/performance and separate Ponytail deletion reviews completed; full verification runs before push. Commit: `git log --grep='CL-37'`.

Original finding: family-list enrichment fetches all versions for the listed families, then their steps/actions without explicit result paging. The local API cap is 1,000 rows and supported family page size reaches 100. A 100-family page with 15 steps each already exceeds that step cap; even the default page can accumulate enough action rows or historical versions to cross it. The actual hosted cap is unverified.

**Fix:** fetch only the latest relevant plan and bounded next-work data, or explicitly page the child queries. Prefer a small targeted query/RPC over downloading every historical version. Keep authorization on the database path.

**Close with:** 0/1/10/100 families, more than 1,000 aggregate child rows, many versions, and concurrent staff. Compare each displayed next action with the complete source data and record query/response latency. **Sources:** [list enrichment](/Users/willsanz/homelessness-project/src/lib/services/families.ts:88), [page-size validation](/Users/willsanz/homelessness-project/src/lib/validations/family-list-query.ts), [API row cap](/Users/willsanz/homelessness-project/supabase/config.toml:18).

### [x] CL-39 — Verify date meaning and case-manager confirmation

**Type:** Verify + Decide · **Responsible:** engineering + case-manager reviewer.

**Completed October 13, 2026 — engineering:** the Philadelphia pilot uses the America/New_York calendar consistently in browser defaults, server meeting validation, AI date anchors, goal ordering, and PDF preparation. Exact YYYY-MM-DD dates display without device-timezone shifts. Waiting shows and edits the next follow-up date; older target dates no longer drive its ordering. Completed work can omit a deadline, and manually chosen dates may extend beyond the AI's 90-day suggestion window.

Review now asks the person to confirm all dates, identifies open work with past dates, and explains that AI dates are proposals. The server and database require explicit confirmation; the revision-bound review event records confirmation, school date/timezone, and past-date count. One confirmation covers the reviewed plan; no extra per-field approvals were added.

**Evidence:** regression tests cover invalid and leap dates, three device timezones, midnight/DST, frozen AI anchors, missing/unconfirmed dates, completed work, Waiting edits and saved values, manual dates, cancellation, stale approvals, and real database review/audit behavior. A clean migration rebuild and full database security suite pass; advisors report no warnings. The real generated one-page PDF was text-extracted and visually inspected: Nov 1, 2026 Waiting follow-up, Feb 29, 2028 manual date, and completed outcome match the source, while the original 2020 Waiting target is absent. Normal correctness/security/accessibility, separate Ponytail deletion, and React reviews completed. Full verification runs before push. School acceptance of the workflow remains CL-34; the wider PDF corpus/browser gate remains CL-35/CL-08. Commit: `git log --grep='CL-39'`.

The product requires exact, confirmed target dates and a follow-up date for waiting work. AI dates and deterministic date fallbacks must not be mistaken for a person's confirmed commitment. Current generation prompts still use 30/60/90 phase language behind a goal/date-oriented product.

**Fix/verify:** show proposed dates for explicit confirmation before review; make waiting dates consistently mean next follow-up. Align UI, persistence, prompts, ordering, and PDF with the same date-only rules. Keep phase internals only where they support the current product.

**Close with:** unconfirmed/missing/invalid date, completed action without a future deadline, waiting follow-up, leap day, DST/timezone, past-date acknowledgement, manual dates outside generation windows, and screen/PDF agreement. **Sources:** [date rules](/Users/willsanz/homelessness-project/src/lib/domain/plan/action-target-date.ts), [plan editor](/Users/willsanz/homelessness-project/src/features/families/family-plan-panel.tsx), [review requirements](/Users/willsanz/homelessness-project/supabase/migrations/20260804173443_production_hardening.sql:1520).

## Gate C: prove the release and prepare support

### [x] CL-08 — Establish the complete release test gate

**October 15 latest exact-source verification:** `8ace965` passes 686 unit/component tests, seven browser scenarios, database/Auth/restore/legacy/PDF checks and the complete hosted staging workflow. The final production-candidate retry also passes login/Settings, minimal intake, all four AI paths, three plan reloads (1.853/1.143/1.070 seconds), recovered edits, preserved actions/dates/progress, human review and byte-identical PDF download. Both pages were visually inspected; zero unhandled browser errors, HTTP errors or Vercel runtime errors in its window. All synthetic fixtures were removed. Earlier production timeouts are retained under CL-41; a passing retry does not close reliability/release. [Exact checks](verification/2026-10-15-final-candidate-checks.json), [staging](verification/2026-10-15-hosted-directory-fix.json), [production retry](verification/2026-10-15-production-candidate-workflow.json).

**October 15 final staging candidate:** `7c9af9e` passed the exact required checks and a headless en-GB / Pacific-Auckland browser run with no unhandled errors. Staff/admin password login, minimal intake, all four live AI paths, unsaved edit recovery, selective refinements preserving action identities/dates/progress, review, matching preview/download bytes and logout passed. Generation took 21.070 seconds; action/full refinements 4.944/4.937 seconds; assistant 3.896 seconds. Both downloaded PDF pages were visually inspected and remained legible without clipped/overlapping content. Disposable cases/accounts were removed. [Full candidate evidence](verification/2026-10-15-hosted-candidate-workflow.json). Staging has no resource catalog, so directory usefulness is a separate production-candidate check; school acceptance remains open.

**October 14–15 hosted follow-up:** on `323314c`, two runs passed the functional intake/AI/edit/review/PDF/assistant steps, but the final browser-error assertion caught React hydration error 418. A short isolated run confirmed `/profile`: server and browser formatted account timestamps in different default timezones/locales. The fix uses the existing school timezone and explicit US English in both date displays. Both new server-render regression cases failed before and pass after; all 13 focused profile/date tests, typecheck and targeted lint pass. The administrator browser regression now runs in a different locale/timezone and rejects unhandled errors. Normal correctness/security/privacy/accessibility/regression review and the separate Ponytail deletion pass found no additional change needed: no helper, dependency, hidden warning or new configuration. The final candidate evidence above closes this defect. [Before-fix failure](verification/2026-10-14-profile-hydration-before.json), [functional workflow and final error](verification/2026-10-14-hosted-password-only-workflow.json). An earlier ambiguous AI refinement request returned no changes and left the saved plan intact; naming the actual saved step title produced the requested change. This is not school usefulness acceptance.

**Type:** Verify + Fix · **Responsible:** engineering.

**October 13 evening — partial browser evidence and intake fix:** a production-build Chromium harness now uses real isolated local Supabase/Auth/mail and synthetic accounts. Only the AI HTTP response is deterministic; authorization, server actions, persistence, review, and PDF rendering remain real. Invitation, password setup, invalid login, password sign-in, separate-browser recovery, previous-session denial, and anonymous reuse of a recovery link pass. Keyboard activation and automated WCAG scans cover the visited setup/login/intake/overview screens.

The browser reproduced a blocker: intake labels such as “Housing instability” disappeared because planning expected “Housing.” Shared result mapping now preserves the exact saved wording without inferring a more specific health/legal category; saves retain all twelve intake resource-matching keys. Commas and semicolons stay within custom labels, and overlong labels fail visibly instead of being truncated. Seventeen new regression tests failed before the fix; all 26 focused tests now pass. A real browser → action → database → plan run confirms all twelve intake barriers survive generation unchanged. Correctness/security/privacy and separate Ponytail deletion review completed; duplicate label/key mapping and loader logic were removed.

**Completed October 14 — engineering:** all seven independent Chromium scenarios now pass: invite/reset/returning sign-in, MFA, all intake barriers, interrupted generation/resume, session expiry and draft recovery, account switching, concurrent edits, selective refinement, confirmed review, exact PDF download, stale-export denial and assistant use. Keyboard and Axe checks include inline editing, narrow layout and 200% CSS zoom. The browser tests exposed and fixed unnamed fields, review-focus loss, a production CSP block on the PDF's WebAssembly engine, and the assistant's unreachable page. General JavaScript evaluation remains blocked. Native modal rendering avoids hydration errors and restores focus. The assistant uses the existing family authorization and cannot be opened from unsaved edits.

**Evidence:** 672 unit/component tests across 76 files, full verification/build, seven browser scenarios (67 seconds), and the real local Auth security suite passed. Browser execution now runs in CI against isolated synthetic services and rejects focused tests. The generated preview blob and downloaded PDF have identical SHA-256; the actual two-page download was also displayed and visually checked in isolated Chromium with the restrictive object policy intact. Normal correctness/security/privacy/accessibility/regression, React, and separate Ponytail deletion reviews completed; no new production dependency or custom focus manager was added. [Browser reproduction and limits](verification/browser-regressions.md), [result metadata](verification/2026-10-14-browser-regressions.json). Exact hosted-candidate checks and device/email/school acceptance remain CL-16/CL-34/CL-41; local browser coverage does not prove live AI usefulness or hosted readiness. Commit: `git log --grep='CL-08'`.

At the audit baseline, existing tests covered useful units and database controls, but no complete authenticated browser, automated accessibility, or AI-quality release suite was found. Compiling and rendering a valid PDF file do not prove the staff workflow.

**Fix:** add the smallest useful integration/browser/accessibility coverage for the matrices below, and run the real database suite on an isolated test stack. Connect required checks to CI/release evidence. Preserve tests for regressions fixed under every other record; avoid implementation-mirroring tests.

**Close with:** an independently repeatable synthetic invite → case → plan → edit → review → downloaded PDF journey, returning-user resume, concurrent edits, failure recovery, and accessibility checks. **Sources:** [CI](/Users/willsanz/homelessness-project/.github/workflows/ci.yml), [test configuration](/Users/willsanz/homelessness-project/vitest.config.mts), [PRD test matrix](/Users/willsanz/homelessness-project/docs/intervention-planning-prd.md:995).

### [ ] CL-34 — Measure AI safety and usefulness with school reviewers

**October 14 engineering evidence:** a versioned 50-case synthetic evaluation now exercises generation, both refinements and the assistant through real production prompts, transport, validators and human-selection merges. Version 7 accepted 299/300 initial tasks; one incomplete provider response was safely rejected, and the targeted six-task retry passed. Zero deterministic critical-check failures does not certify all prose: manual review caught unsupported claims in earlier otherwise-passing runs, which were corrected and retained as regressions. Successful full drafts measured p75 14.15s / p95 16.14s, excluding the failed draft and browser/hosting overhead. Dates are now enforced, completion dates remain explicitly unknown, sparse plans are smaller, and missing history never establishes that outside activity did not happen. [Outputs, failures, costs, source hash and review protocol](verification/ai-quality.md). Normal correctness/security/privacy and separate Ponytail deletion reviews completed. School usefulness/editing-time scores, a fresh unseen validation set and hosted end-to-end timing remain open.

**Type:** Verify + Fix · **Responsible:** engineering + case-manager reviewers.

No repeatable, scored evaluation set establishes that generated plans and answers are correct, actionable, respectful, grounded, and worth the user's time. Prompt inspection and mocked output tests cannot establish live model quality.

**Fix:** implement the evaluation protocol below with synthetic cases and task-specific rubrics. Version the model, prompt, schema, resource snapshot, and expected constraints. Compare changes against the same cases and separate development from held-out cases.

**Close with:** zero critical safety/grounding/edit-preservation failures in the release set, recorded human usefulness review, and measured end-to-end latency/cost. Report failed cases, not just an average score. **Sources:** [AI callers](/Users/willsanz/homelessness-project/src/lib/ai/client.ts), [product quality requirements](/Users/willsanz/homelessness-project/docs/intervention-planning-prd.md), [OpenAI evaluation guidance](https://developers.openai.com/api/docs/guides/evaluation-best-practices).

### [x] CL-35 — Verify the downloaded PDF visually and against its reviewed source

**October 15 hosted closure:** the exact released source passes the rendered corpus and current staging/candidate/canonical download checks. Both pages of each final hosted PDF were visually inspected; no clipping, overlap or blank page was found, and preview/download bytes match. Human edits, Waiting reasons and exact dates are present. [Canonical evidence](verification/2026-10-15-canonical-workflow.json).

**October 14 follow-up:** reopened after the real hosted synthetic PDF placed a task over the footer. The exact new fixture fails before the fix; bounded title/date/status now stay together and long details wrap normally. All five fixtures / 17 rendered pages / 415 source fields pass, with visual inspection, five component tests, typecheck and targeted lint. [Before/after evidence](verification/2026-10-14-pdf-page-boundary.json). Correctness/privacy/accessibility and separate Ponytail deletion reviews passed; no dependency or saved-data change. Fresh hosted release verification remains step 2.

**Type:** Verify + Fix · **Responsible:** engineering + case-manager reviewer.

**Completed October 13, 2026 — engineering:** a repeatable four-case PDF corpus now checks 368 source fields across 15 rendered pages, including maximum saved text, long unbroken filenames, eight goals/forty actions, exact dates, Waiting, completed/withdrawn work, directory contacts, and composed/decomposed Western European accents. It compares text and repeated-field inventory, margins, overlaps, headings, page numbering, and monochrome pixels. The corpus reproduced and fixed clipped filenames, exposed internal note markers, and a goal heading stranded on a mostly empty page. Withdrawn tasks no longer inflate completed counts on screen or in PDFs.

**Evidence:** all 650 unit/component tests pass, including rendering/finalization failures and retry, identical preview/download bytes, stale-revision checks, late requests, and URL cleanup. Loading/errors are announced; download remains available when the embedded viewer is unavailable. Built-in fonts require no network loading; unsupported glyphs fail clearly without changing the saved plan instead of silently omitting characters. The 15 page images were inspected for legibility and placement. CI runs `npm run test:pdf`; [reproduction and font scope](verification/pdf-regressions.md) and [result metadata](verification/2026-10-14-pdf-regressions.json) are versioned. Normal correctness/privacy/accessibility, separate Ponytail deletion, and React reviews completed. Full production verification runs before push. The authenticated browser and hosted-candidate journey remains CL-08; school acceptance remains CL-34. Commit: `git log --grep='CL-35'`.

Current PDF tests establish useful file/metadata/page/color properties but not complete rendered placement and legibility. A structurally valid file can still clip long content, split rows badly, omit characters, or show the wrong reviewed revision.

**Fix:** maintain a small rendered-PDF fixture corpus for the actual plan export. Compare extracted content with the reviewed plan and inspect page images for placement. Cover supported characters, long fields, many goals/actions, dates, waiting/completed work, and black-and-white printing.

**Close with:** deterministic content assertions, reviewed page images, browser preview/download parity, failed-render retry, font-load failure, and revision checks from CL-05. Include keyboard-accessible download and a usable alternative when embedded preview is unavailable. **Sources:** [PDF renderer](/Users/willsanz/homelessness-project/src/features/families/plan-pdf-document.tsx), [export](/Users/willsanz/homelessness-project/src/features/families/plan-pdf-export.tsx), [current PDF tests](/Users/willsanz/homelessness-project/src/features/families/plan-pdf-document.test.tsx).

### [ ] CL-36 — Record hosted configuration, recovery, and support evidence

**October 15 provider limitations:** production security advisors report 31 warnings, not a clean result: 29 intentionally authenticated, guarded database RPCs/helpers; disabled MFA matching the user decision; and unavailable Free-plan leaked-password screening. Current Free also does not allow the runbook's 12-hour/2-hour session timebox/inactivity settings. Refresh-token rotation and explicit logout/offboarding denial are verified. No paid upgrade was performed. [Warning dispositions](verification/2026-10-15-production-security-advisors.json), [actual session settings](verification/2026-10-15-production-auth-settings.json).

**October 15 hosted recovery evidence:** encrypted a consistent recovery point from the original project before the user-approved demo cleanup, then restored 56 tables / 4,286 rows with exact hashes in an isolated database. All scratch databases were removed. The small operator-only recovery utility authenticates metadata, verifies the archive hash, writes private files without overwriting, and never connects to a database. Two regression tests, typecheck/lint and recovery of the real archive passed; normal correctness/security/privacy and separate Ponytail reviews completed. [Backup](verification/2026-10-15-hosted-backup.json), [restore](verification/2026-10-15-hosted-restore.json), and the runbook record provider-owned-grant limitations and failed attempts. Off-machine recovery, recurring backups, alert delivery, operating owners and school approvals remain open; this evidence does not close those gates.

**October 14 engineering evidence:** `npm run test:restore` creates two isolated synthetic databases inside the local CaseLink container, restores a logical backup, compares all 49 tables exactly, preserves the reviewed revision and access denials, rejects corrupt backup data and stale export, then passes the full database security suite. Both temporary databases were removed. All 37 migration IDs survived; recovery plus regression checks took 21.066 seconds with zero lost synthetic rows. Initial setup failures and their corrections are preserved in [the drill record](verification/2026-10-14-local-restore.json). The export-only runbook now distinguishes this rehearsal from hosted PITR, Auth/session recovery, provider settings and real RPO/RTO. Normal correctness/security/privacy and separate Ponytail deletion reviews completed. No existing case rows were copied or remote service contacted. Hosted backup/restore, alert delivery, owners, retention/vendor approval and incident rehearsal remain open.

**Type:** Verify + Decide · **Responsible:** service owner + operator + privacy owner.

Repository settings and old hardening reports do not prove today's hosted state. `/api/health` is liveness only and does not check the database, Auth, or AI. Backup, restore, email delivery, provider configuration, alert routing, and rollout ownership remain unverified.

**Fix/verify:** complete the existing runbook using the actual Supabase/Vercel/OpenAI projects and the current export-only scope. Record migrations/RLS/grants, invitation-only signup, password/session/MFA settings, redirects/SMTP, production flags/debug restrictions, provider data controls/budgets, backup/restore, retention/deletion, rollback, and incident contacts. Test dependency health safely without exposing data through a public endpoint. Record production hosting/release setup under CL-41 and secret inventory/rotation under CL-42; link the same evidence rather than repeating those tasks.

**Close with:** named owners and support path; isolated restore exercise; synthetic failure alert delivery; deployment/rollback rehearsal; school sign-off on allowed data and pilot boundaries; measured pilot traffic and AI spend. **Sources:** [runbook](/Users/willsanz/homelessness-project/docs/production-operations-runbook.md), [health endpoint](/Users/willsanz/homelessness-project/src/app/api/health/route.ts), [environment posture](/Users/willsanz/homelessness-project/src/lib/env.ts).

### [ ] CL-41 — Establish managed production hosting and a gated release

**October 15 live release:** exact source `9e7d0e2`, required checks, production-candidate workflow and canonical workflow pass. `www.thecaselink.com` now maps to `dpl_8BAZJwJQEqFG7RkjykwuwyrXGEU8`. The first verified production baseline is recorded; old pre-upgrade builds are not certified rollback targets. Observation passed all 45 probes. Operating ownership/provider-access review and the school launch decision remain open; PR #15 remains draft/unmerged. [Current release record](verification/production-release.md).

**October 15 measured plan-read fix:** a representative synthetic plan (six directory entries, four saved steps and twelve actions) passed five sequential and nine concurrent reads, with all fixtures removed. Query-plan inspection under the same live staff permissions showed eight evaluations of each action. Materializing only the already-filtered snapshot reduced execution from 214.614/210.515 ms to 28.499/28.036 ms, returning identical content and review hashes. The new migration preserves RLS, grants, source checks and all revision semantics; the database regression counts executed action rows instead of imposing a fragile wall-clock threshold. Its condition fails for the measured original (96 reads for 12 actions) and passes for the comparison (12). Typecheck/lint, exact-source CI **38753128811**, CodeQL **38753128797**, release preflight and the full hosted staging workflow pass at `9e7d0e2`. The user explicitly approved the production migration and release after the initial automatic-review rejection. Both databases now have 41 migrations with unchanged grants and retained counts. Production verification passed five sequential and nine concurrent reads; the deployed query read each action once and returned identical full content/review hashes. The production candidate passed, was promoted with explicit user approval, and the canonical workflow passed. The 30-minute observation passed; named operating owners, budgets/alerts and access review remain open. Normal correctness/security/privacy review and separate Ponytail deletion review found no broader rewrite needed. This is a demonstrated source of excess database work, not proof of the sole cause of the earlier timeout. [Measurements](verification/2026-10-15-plan-snapshot-measurement.json).

**October 15 paused release checkpoint:** exact `8ace965` is READY in production candidate `dpl_7TyYy3KhJREBvVer5YY4x6rLnmNh` after all required checks and release preflight. The approved existing authenticated test access works without new secrets or protection changes. The final full production workflow passes, including actual AI, saved edits/review, three reloads and the visually checked PDF. However, an earlier `get_family_plan_snapshot` read hit PostgreSQL `57014` and a later Settings navigation timed out. Five direct one-step reads and the final full workflow passed; their success does not establish the failures' cause. No speculative optimization/timeout increase was made. Keep reliability follow-up open, then promote, verify the canonical workflow and observe 30 minutes. The old canonical deployment remains unchanged and is not a certified rollback candidate. Stop here per the user's request; school invitations remain closed. [Failures, timings, recovery boundary and next steps](verification/production-release.md).

**October 15 staging rollback:** switched the stable staging alias from `123b74e` to verified `7c9af9e`, checked routing/headers/staging boundary, then restored its exact starting deployment and repeated the checks. The production alias was unchanged; no data or protection setting changed. Runtime/dependency/config/migration files match across the pair. This verifies staging switching, not old-production compatibility. [Evidence](verification/2026-10-15-staging-rollback.json). Full CI `38666170553` and CodeQL `38666170540` passed at `123b74e`.

**October 15 controlled production candidate:** exact application commit `7c9af9e` passed release preflight, full CI/CodeQL and hosted staging. Vercel built production candidate `dpl_2bGrr5VGVTrqdRtwRzGq2tu57zpi` to READY with production-only settings and without assigning the canonical domains. `www.thecaselink.com` still points to the old `dpl_4ZDwYiPntxhM6NUnmBud6dJ3yRnW`. The initial candidate entry was denied by deployment protection; the user later approved the existing authenticated test-cookie method and access passed. Its subsequent directory snapshot failure led to `8c614d0` and the replacement candidate above. This `7c9af9e` candidate is superseded and must not be promoted. No protection change, public promotion or rollback occurred. [Current release record](verification/production-release.md).

**Later October 14 release follow-up:** isolated previews at `5a3e282` and `8257d5f` are READY. The latter passed CI/CodeQL and the exact-commit release preflight; the former was correctly rejected for its failed database check. Production remains on `e0cb389`. The source configuration now disables automatic Git deployments from the verified production branch `main`, preserving feature-branch previews and requiring a deliberate approved release. The setting matches the official Git schema and both preflight tests pass; Vercel accepted this configuration in READY preview `dpl_7oQ6x69KYmABzzopXfXNMEq7wDgH`; main-trigger behavior, operator bypass permissions and the full authenticated rehearsal remain open. No merge or production deployment was performed.

**October 14 engineering evidence:** aligned local/CI/hosting on Node 24, patched available development dependency advisories, and added CSV-import regressions and the synthetic restore drill to CI. Main now requires four exact-provider checks, an up-to-date PR and resolved conversations, including for admins, and denies force-push/deletion. No main commit was changed. The tested `verify:release` command rejects missing/failed/pending/skipped/wrong-SHA/wrong-provider checks and stale successes. The historical `eda55cb` candidate passed its live exact-SHA preflight. Full local repository, database/Auth, restore, browser/a11y and rendered-PDF verification passed with the patched dependencies. Production dependency audit is clean; one unpatched development-only advisory remains explicitly recorded. [Hosting, branch-policy and dependency evidence](verification/hosting-release.md). Normal correctness/security/regression and separate Ponytail reviews completed. Separate hosted staging, legacy database reconciliation, protected previews, no-bypass release rehearsal, actual auth-to-PDF/rollback, named operating owners and launch approval remain open. The earlier unsafe-environment preview failures are superseded by the isolated READY previews above; the production configuration and remaining gates must still pass before release.

**Type:** Verify + Decide + Fix where missing · **Responsible:** engineering + service owner · **Gate:** required before pilot.

The repo already targets Vercel, but the actual team/project ownership, production environment, and promotion rules remain unverified. Vercel's configured `npm run verify` build does not itself run the dependency-audit or database-security jobs that exist separately in GitHub CI. A successful hosting build therefore must not be the only release condition.

**Fix/verify:** identify the existing production project and approved domain before provisioning anything. Record named billing/recovery owners; MFA and least-privilege operator access; selected plans, runtime and region; exact Auth redirects; isolated staging database/provider credentials; protected preview access; and spending alerts. Align CI/local/hosting runtime versions. Confirm staged AI requests fit the selected function limits and can recover from a killed request. Ensure production release waits for the exact candidate commit's complete required checks, including dependency audit and database security, using supported deployment checks or an explicit controlled promotion procedure.

**Close with:** record project/environment/deployment IDs and candidate commit without secrets; prove staging cannot reach production data; deliberately fail a required check and show that production does not advance; pass the synthetic auth-to-PDF journey on the candidate; rehearse application rollback with database compatibility verified. Reuse CL-08 and CL-36 test evidence. A basic live health response alone cannot close this record. **Sources:** [hosting config](/Users/willsanz/homelessness-project/vercel.json), [verification scripts](/Users/willsanz/homelessness-project/package.json), [CI jobs](/Users/willsanz/homelessness-project/.github/workflows/ci.yml), [Vercel Deployment Checks](https://vercel.com/docs/deployment-checks).

### [ ] CL-42 — Inventory, isolate, and test production secrets

**October 15 live configuration:** the new main-site build uses the verified production-only Config/Secret settings, and all four live AI paths work. It has no web service-role credential; staging remains separate. Historical snapshots/local-key exposure, provider budgets, operator recovery ownership and any explicitly authorized rotation remain open. [Current inventory](verification/secret-isolation.md).

**October 15 production settings:** the canonical site URL, original Supabase URL/public key, single-tenant/invite-only/HSTS flags, environment and production-project marker are verified. The web-hosted service-role key and obsolete PDF flag were removed from future production configuration; the existing write-only production OpenAI Secret was preserved, separate from staging. Read-back accepted the public key, confirmed signup disabled and absence of web-admin/debug settings. The READY production candidate builds with these settings; old deployments retain their historical snapshots until retired. The final production-candidate workflow verifies AI-key usability through all four live paths. Provider key provenance/budgets, historical exposure/rotation and operational recovery remain explicitly open. [Environment metadata](verification/2026-10-15-production-environment.json), [current inventory](verification/secret-isolation.md).

**Later October 14 hosted progress:** the original five shared environment entries are now Production-only; original OpenAI and admin credentials are write-only Secrets. Eight public/security settings are scoped to the readiness Preview branch and the separate staging Supabase project. Per-mutation metadata read-back passed. The user saved the separate staging OpenAI key as a Secret scoped only to this Preview branch; metadata was verified without retrieving its value. Isolated previews are READY, and protected health/login/routing checks pass. The latest release-control preview also builds successfully. Full invited-account, AI and PDF verification is still open. Old deployment snapshots, production web-admin removal, exposure review, rotations and access controls remain open. [Scope evidence](verification/2026-10-14-preview-environment.json).

**October 14 engineering evidence and hosted blocker:** read-only Vercel metadata shows the database URL/public key, OpenAI key and privileged service-role key assigned to Production, Preview and Development in shared entries. No values were accessed. The build/runtime now reject unsafe hosted scope, mismatched project markers and web-admin credentials. A synthetic canary reproduced server-key retention in Turbopack's persistent compiler cache; disabling and clearing only those caches fixed it. All seven browser scenarios then passed with no canary in complete build/browser artifacts or captured logs and no usable web-admin credentials. Controlled provider tests verify cached-key rotation/restart, revocation and redacted errors. [Inventory, findings, exact hosted change/recovery procedure and limitations](verification/secret-isolation.md). Normal correctness/security/privacy and separate Ponytail deletion reviews completed. Hosted environment separation, managed Secret type/access, cache exposure review and real rotation/revocation remain required; the current hosted configuration must not be promoted.

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
| Password-only pilot | Admin and staff login without MFA; old verification link; provider enrollment disabled | Authorized password sessions work; invitation/recovery-only, revoked and inactive sessions remain denied |
| Workspace session | Reload, refresh-token rotation, two tabs, expiry, inactivity, lost network | No redirect loop or stale-token write; safe reauthentication with approved draft recovery |
| Password reset | Known/unknown email, actual email link, expiry, reuse, secure change, success | Generic request acknowledgement; only intended account changes; post-reset session behavior matches policy |
| Logout | Success, provider failure, another tab/device, Back button, account switch | Intended session scope ends; no residual sensitive app drafts shown to another person |
| Authorization | Every action and direct database request with the role matrix | No cross-family access, self-promotion, audit forgery, or unauthorized mutation |
| Offboarding | Retained JWT, owned/assigned cases, admin downgrade, refresh token | Access denied according to the immediate-offboarding policy; case history preserved |

Use browser tests for cookies/redirects/navigation and real isolated Auth/Postgres integration tests for token and authorization behavior. A mocked login component cannot prove those boundaries. Record hosted auth rate limits and test them with bounded synthetic requests; aggressive testing against production is unnecessary.

## AI feature inventory and expected behavior

| Feature | Current implementation | Useful behavior to verify |
| --- | --- | --- |
| Initial plan / regeneration | Staged lean generation using one immutable saved snapshot | Specific goals/actions grounded in saved barriers, preferences, outcomes, and available resources; proposed dates; explicit partial/failure states |
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

**October 14 decision: defer production integration.** Current official documentation and one synthetic account-access probe confirm the separate endpoint works: HTTP 200, `gpt-6-luna`, 256 ms, 202 input tokens. One obvious unsupported-claim predicate returned probability 1; this is not a calibrated quality result. [Assessment and exact metadata](verification/decisions-assessment.md). No production feature was added. The optional reviewer-labelled comparison, error-contract implementation if adoption is justified, and endpoint data approval remain open; they do not delay otherwise complete pilot gates.

**Type:** Decide + Verify · **Responsible:** engineering + case-manager reviewer · **Gate:** optional evaluation; not a pilot launch blocker.

**Experiment:** start offline with the CL-34 synthetic draft set and a human-labeled actionability rubric. Compare Decisions with deterministic checks and the existing workflow. Measure agreement with reviewers, missed defects, false alarms, refusal/error rates, total latency, and cost. Calibrate thresholds on development cases and report held-out results; a model's confidence is not a correctness guarantee.

**Implementation boundary if justified:** current `createAiResponse` parses generated text, and its model allowlist rejects `gpt-6-luna`. A Decisions experiment needs a small separately typed request/answer path, not just `OPENAI_MODEL_OVERRIDE`. Reuse privacy, timeout, budget, and safe-logging controls; verify endpoint-specific data handling rather than assuming Responses parameters apply. Match named answers to expected questions, validate result types/ranges, and treat refusal, missing answers, low confidence, or service failure as “check unavailable/needs human review,” never a pass. Do not insert an extra production call into every plan until its benefit is demonstrated.

**Close with:** a written adopt/defer decision backed by synthetic results and reviewer agreement; confirmed account access/data controls; mocked response/error contract tests; and proof that enabling or disabling the advisory check cannot approve, mutate, or block access to otherwise usable casework. The original documentation assessment made no calls; the October 14 synthetic access probe is recorded above. **Sources:** [current AI client](/Users/willsanz/homelessness-project/src/lib/ai/client.ts), [current model allowlist](/Users/willsanz/homelessness-project/src/lib/ai/model-allowlist.ts), [Decisions guide](https://developers.openai.com/api/docs/guides/decisions), [provider data controls](https://developers.openai.com/api/docs/guides/your-data).

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

| Release gate | Current result, October 15 | Remaining evidence |
| --- | --- | --- |
| Approved pilot data boundary | Engineering controls verified; school decision open | CL-01: permitted de-identified data, retention/vendor acceptance |
| Dependency and repository checks | Verified on live source `9e7d0e2` | Development-only unpatched advisory remains recorded; production audit passed |
| Auth and database access | Hosted/CI verified | CL-16 school mailbox/filter; CL-38 retained access/trust-boundary approval |
| Concurrent editing/review integrity | Engineering verified | Preserve CI regressions in future changes |
| AI correctness and usefulness | Automated/live synthetic evaluation verified | CL-34 school usefulness and unseen-case review |
| Complete intake-to-PDF journey | Verified on the canonical production site | Staff practice and school acceptance |
| Hosted operation and recovery | Actual historical backup/restore verified | CL-36 recurring/off-machine backup, alerts, support/recovery owners |
| Managed hosting and release control | Production release, canonical checks and 30-minute observation pass | CL-41 operating access/ownership |
| Production secrets and recovery access | Current runtime scopes and usability verified | CL-42 historical exposure, provider budget/alerts and recovery ownership |
| Larger-case-list behavior | Engineering verified; bounded hosted reads pass | Real pilot traffic observation; no sustained-load claim |
| Accurate scope and staff guidance | Engineering documentation updated | School training and support contacts |

### Final pilot launch decision

- [x] The three narrowed engineering outcomes are complete with linked evidence, and the exact production build passed the canonical workflow and 30-minute observation. Superseded requirements and remaining operating limits are explicit; no privacy/access/data-integrity test was disabled. School/data acceptance remains the next separate gate.
- [ ] Named school, product/privacy, engineering, and operating owners have agreed the permitted data, support hours, resource directory, staff list, service limits, and recovery targets. Staff have practiced the full workflow with synthetic cases and know how to report an error.
- [ ] Invite the named pilot staff only after the candidate release is approved. Start with supervised use, review errors/latency/cost and user feedback during the first week, and assign an owner for follow-up. This is an operating plan, not a scheduled automation created by this audit.
- [ ] Decisions API evaluation, uploaded-PDF features, multi-school infrastructure, and Kubernetes remain outside the launch gate. Any newly mandated school requirement is recorded and assessed before sign-off.

**Still not certified:** school mailbox/filter behavior, school-reviewed usefulness and permitted-data policy, ongoing/off-machine recovery, alert delivery, historical-secret remediation and sustained real workload. Actual owner-inbox email, hosted account/workflow tests, deployed access controls, bounded live AI checks and logical backup restoration now have linked evidence. Preserve user-bound clients, RLS, safe redirects, shared AI budgets, `store: false` and human review.
