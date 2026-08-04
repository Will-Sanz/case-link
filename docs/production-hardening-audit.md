# CaseLink production-hardening audit and plan

**Audit date:** 2026-08-04

**Audit branch:** `codex/production-hardening-audit`

**Base:** `codex/caselink-v1-redesign` at `bb39330`
**Recommendation:** **No-go for a production pilot until PH-01 and PH-02 are fixed and verified.**

## Executive summary

CaseLink already has a stronger baseline than a typical prototype: authentication is checked in the workspace and server actions, family data is protected by Postgres RLS, AI calls are centralized, AI inputs and outputs are bounded, PDF uploads have byte/page/type checks, OpenAI requests use `store: false`, sensitive server errors are generally hidden in production, CI runs the full verification suite, and the core no-PII and PDF logic has unit tests.

The audit nevertheless found two release-blocking issues:

1. A case manager can potentially update their own `app_users.role` to `admin` through the Supabase Data API. The self-update policy restricts the row ID but not the columns, while `is_app_admin()` trusts that column. This can turn into access to every family.
2. The uploaded-PDF flow asks the AI model whether a PDF contains identifying information **after the PDF has already been sent to OpenAI**. A mistaken user confirmation or incomplete visual detection therefore breaks a strict “no PII leaves CaseLink” promise.

The next tier of work is also material: define the tenancy model; replace per-instance rate limiting; protect local browser drafts; make audit events trustworthy; enforce cross-family relational integrity; close open signup and weak-auth gaps; bound every server-action input at runtime; and establish production monitoring, backup/restore, incident response, retention, and security regression tests.

### Finding count

| Priority | Count | Meaning |
| --- | ---: | --- |
| P0 | 2 | Release blocker; fix before any external production use |
| P1 | 9 | Required before a pilot handles real casework |
| P2 | 6 | Required for a defensible production baseline or immediately after a tightly controlled pilot |
| P3 | 2 | Cleanup and maturity work |

## Scope and method

This was a source and configuration audit of the current V1 redesign worktree, including:

- Next.js 16 proxy, layouts, route handlers, server actions, headers, error handling, and current framework guidance from `node_modules/next/dist/docs/`;
- Supabase Auth usage, user roles, RLS policies, grants, SQL functions, family ownership, and family-scoped relationships;
- OpenAI request construction, prompt/data boundaries, model selection, token/input caps, timeouts, rate limiting, and logging;
- blank/fillable/scanned PDF upload, browser persistence, analysis, review, and download;
- validation and no-PII checks across the family, plan, progress, assistant, and paperwork flows;
- CI, tests, build/deploy configuration, dependencies, secret handling, and operational readiness;
- a normal security/privacy/reliability review plus the required Ponytail over-engineering and deletion pass.

### Evidence collected

- `npm run verify`: passed lockfile checks, resource-seed checks, TypeScript, lint, 35 test files / 109 tests, and the Next.js production build. Lint reported seven warnings and no errors.
- `npm audit --omit=dev --json` on 2026-08-04: two moderate production findings, both caused by vulnerable PostCSS `<=8.5.22` nested under Next.js. The registry reports Next.js `16.3.0` as the available fix.
- Production-mode local HTTP checks: `/families` redirected unauthenticated users to login and `/api/paperwork/analyze` returned `401` with `Cache-Control: no-store`. Existing frame, MIME-sniffing, referrer, and permissions headers were present.
- Tracked-file secret scan: no OpenAI key, Supabase service-role key, or private key material was found. `.env*`, private resource data, PEM files, logs, and `.vercel` are ignored.

### Limits of this audit

The repository cannot prove the state of external systems. Before launch, an operator must inspect the actual Supabase, Vercel, DNS, email, and OpenAI project settings. In particular, this audit did not verify deployed database-policy drift, Supabase Auth rate limits and password settings, SMTP delivery, MFA, backup/PITR state, Vercel firewall settings, custom-domain/TLS state, secret age, log retention, or vendor contractual controls. No dynamic authenticated penetration test or remote production test was performed.

## What is already strong

- `src/lib/auth/session.ts` uses `supabase.auth.getUser()` for application authorization and supplies a user-bound client so RLS remains active.
- `src/app/(workspace)/layout.tsx` independently protects all workspace routes; protection does not depend only on the proxy path list.
- `src/lib/ai/client.ts` is a useful single AI chokepoint: it applies timeouts, model allowlisting, input/output caps, generic production errors, per-user accounting, and `store: false` for Responses API calls.
- AI-backed actions generally load the family through the user's RLS-bound client and run `validateFamilyNoPii()` before building prompts.
- `src/app/api/paperwork/analyze/route.ts` authenticates, validates the family, requires a reviewed plan, validates PDF magic/size/page count, rejects XFA and signed files, uses strict structured outputs, and sends no-store responses.
- PDF output remains human-reviewed and downloaded for manual submission; CaseLink does not submit forms automatically.
- Database policies consistently use `can_access_family()` for most family-scoped reads and writes, and privileged service-role use is isolated in a `server-only` module and scripts.
- The repository has custom error boundaries, deterministic fallback behavior, append-only progress updates, optimistic-concurrency checks for meeting updates, a pinned npm lockfile, CI, and a full build gate.

## Findings and required remediation

### PH-01 — P0 — Self-service admin privilege escalation

**Evidence:** `supabase/migrations/20260321000000_init_schema.sql:309-312` lets a user update their own `app_users` row with no column restriction. The row includes `role` (`:35-40`). `supabase/migrations/20260321120000_family_rls.sql:3-16` treats `role = 'admin'` as global admin access. No later migration revokes table-level update and re-grants only safe profile columns.

**Risk:** A signed-in case manager can attempt `PATCH /rest/v1/app_users?id=eq.<their-id>` with `{"role":"admin"}`. If the normal Supabase authenticated table grant is present—as profile updates require—the RLS policy accepts the row because the ID remains their own. Global admin RLS then exposes every family.

**Required change:**

1. Ship an emergency migration that revokes table-level `UPDATE` on `app_users` from `authenticated`, then grants update only on approved profile columns. Do not grant `role`, `id`, or unvalidated auth-identity columns.
2. Move role changes to a service-role-only operator script or a narrowly scoped audited admin RPC. Never take the target role from an ordinary client request.
3. Make email synchronization compare against the authenticated identity, or maintain it from an auth hook; do not restore a general email/role update grant just to support profile saves.
4. Review existing `app_users` and access/audit logs for unexpected role changes before trusting a current environment.

**Verification gate:** With a real case-manager JWT, a direct Data API update of `role`, `id`, and another user's row must fail; safe profile-column updates must pass; a service-role admin change must pass and produce an audit record. Add this as an automated Supabase integration test.

### PH-02 — P0 — PDF PII is detected only after third-party transmission

**Evidence:** `src/app/api/paperwork/analyze/route.ts:185-212` and `:263-293` attach the complete PDF to an OpenAI request. Only after the response does the route evaluate `containsLikelyPersonalData` (`:242-246` and `:312-319`). The UI saves the raw PDF to IndexedDB before analysis completes (`src/features/families/paperwork-workspace.tsx:449-460` and `:497-507`). The prompt explicitly allows partially completed files.

**Risk:** If a case manager mistakenly confirms that a PDF is de-identified, or if a scanned form contains an identifier the model misses, the identifier has already left CaseLink before the rejection. Model-based detection cannot enforce a pre-transmission no-PII boundary.

**Required change:** Make one explicit product decision before pilot:

- **Recommended V1:** accept only genuinely blank forms. For fillable PDFs, inspect all field values locally/server-side and reject any completed field before transmission. For scanned/flattened PDFs, disable third-party visual analysis until a pre-transmission local/on-device DLP/OCR control is available, or use a pre-reviewed form template/coordinate map that never uploads the form to a model.
- **Alternative:** permit possible PII under a formally approved education-record processing posture. This requires district approval, vendor/data-processing terms, retention and deletion decisions, incident response, and legal/privacy copy that no longer claims a no-PII boundary.

Do not describe post-transmission model classification as prevention. Keep the human confirmation as a warning and accountability control, not the only technical gate.

**Verification gate:** A fixture with a filled AcroForm name, visible scanned name, email, phone, ID, and handwritten identifier must be blocked **before any mocked OpenAI request occurs**. Network-call assertions are mandatory.

### PH-03 — P1 — Tenancy is not organization-enforced

**Evidence:** `can_access_family()` grants access to the creator, assigned users, or any global admin. `app_users.organization` is free text, not a foreign key or authorization boundary. The privacy policy says users access data associated with their “account or organization,” but there is no organization membership policy.

**Risk:** A global admin can see all organizations in a shared project, assignments are not constrained to an organization, and the public privacy statement overstates isolation.

**Required change:** Choose and document one model:

- **Recommended for the first small pilot:** one dedicated Supabase project and Vercel environment per school/district. Keep the schema simple and state that the deployment is single-tenant.
- **Required before shared SaaS:** add immutable organization IDs, membership/role tables, organization IDs on every case-scoped object, and RLS that checks both organization membership and family assignment. Add organization-scoped admin roles; eliminate global admin access from ordinary tenant administration.

Update legal copy to match the deployed model, not the future model.

**Verification gate:** Two-organization tests prove that IDs, filters, RPCs, relationship updates, admin actions, and error responses cannot disclose existence or data across organizations.

### PH-04 — P1 — Application validation can be bypassed through direct Data API writes

**Evidence:** The browser has a Supabase anon key and user session. RLS permits authenticated writes to families, notes, goals, barriers, members, plans, and related rows. The no-PII checks and most length/shape constraints live in TypeScript server actions, while many database text/JSONB columns have no equivalent constraint.

**Risk:** A custom client can bypass no-PII, maximum-length, workflow-state, audit, and relationship rules while still satisfying row-level access. RLS answers “which row,” not “which values are safe.”

**Required change:** Treat Postgres as the final trust boundary. Add database constraints/triggers for critical lengths, immutable columns, enums/state transitions, relationship consistency, and deterministic direct-identifier patterns. For consequential mutations that cannot be expressed safely as constraints, revoke direct table mutation and expose the smallest validated RPC. Describe no-PII detection honestly as best-effort DLP unless the accepted input set makes it enforceable.

**Verification gate:** Direct REST/RPC tests—not only server-action tests—must fail for oversized values, obvious identifiers, invalid transitions, mutable ownership/role fields, and cross-family references.

### PH-05 — P1 — Mutable ownership and cross-family relationship gaps

**Evidence:**

- `families_update_access` permits any family accessor to update the entire row, including `created_by_id` (`20260321120000_family_rls.sql:77-80`).
- `case_notes_update_own` checks only `author_id`, so the author can change `family_id` without proving access to the destination (`:149-152`).
- `plan_step_activity` accepts independently supplied `family_id` and `plan_step_id` without proving they match.
- `resource_matches.plan_step_id` can be linked in `src/app/actions/resource-matches.ts:223-254` without checking that the step belongs to the same family.
- `case_progress_updates` direct inserts do not prove that `plan_id` belongs to `family_id`; only the preferred RPC does.
- `archiveFamilyFromWorkspace()` updates the shared family row for any accessor while the UI says “Remove family from **my** list.” This hides the case for every accessor, not just the caller.

**Risk:** An assignee can become the owner, hide a family from collaborators, or create inconsistent/cross-family references. Object IDs should not become authorization capabilities.

**Required change:** Make ownership and tenant IDs immutable outside audited transfer functions. Add composite foreign keys or constraint triggers that prove all denormalized family IDs match their parent records. Decide whether archive is global or per-user: use owner/admin-only global archive, or a user-specific hidden/archive preference table for “my list.” Validate the same relationships in server actions for clear errors.

**Verification gate:** Build an authorization matrix covering creator, assignee, unrelated user, organization admin, and service role for every CRUD operation and relationship change.

### PH-06 — P1 — Audit events are forgeable and some audit failures are ignored

**Evidence:** `activity_log_insert` lets an authenticated family accessor insert arbitrary `action`, `entity_type`, `entity_id`, `details`, and even a null actor (`20260321120000_family_rls.sql:163-170`). Many application inserts ignore the returned error, including paperwork download authorization and family/archive activity. There is no immutable event taxonomy, request ID, source, or integrity test.

**Risk:** The activity table is a useful timeline but not a defensible security/audit log. Users can fabricate events and important actions can succeed without a corresponding record.

**Required change:** Revoke arbitrary authenticated inserts. Record a small allowlisted event schema through database functions/triggers that derive `actor_user_id = auth.uid()`, family/object identity, and timestamp. Separate product timeline content from security audit events if they have different trust/retention requirements. Consequential writes and their audit event should share one transaction; failure must be visible.

**Verification gate:** Direct fabricated/null-actor inserts fail; each reviewed plan, role/assignment change, archive, export authorization, and destructive action writes exactly one immutable event with a correlation ID.

### PH-07 — P1 — Rate limiting and cost controls are not production-grade

**Evidence:** `src/lib/rate-limit/memory-bucket.ts` stores sliding windows in process memory. It does not coordinate across Vercel instances and does not evict inactive keys. `OPENAI_RATE_LIMIT_PER_IP_MAX` is disabled unless configured. Every AI request has the same weight, the PDF route parses the full multipart/PDF before the AI limiter is reached, and a rate-limited scanned-PDF request becomes HTTP `502`, not `429`. The staged-generation mutex in `src/app/actions/plans.ts:1178-1192` is also process-local.

**Risk:** Multi-instance requests bypass aggregate limits; parallel requests can duplicate expensive model work; PDF parsing can consume CPU/memory before rejection; costs have no daily/user/organization ceiling; and clients cannot back off correctly.

**Required change:** Use one shared, atomic limiter already available in the production platform or database—do not build a custom distributed limiter. Enforce limits before body parsing/model work where possible, with separate budgets for:

- AI helper/chat requests;
- plan generation/refinement, weighted by expected cost;
- PDF visual analysis, with one concurrent job per user/family;
- per-user minute/hour quotas, deployment/organization daily budget, and a global emergency cutoff.

Return `429` and `Retry-After` for route handlers. Add an idempotency key or database claim/advisory lock for staged phases so only one instance can own a phase. Start conservatively (for example, PDF analysis around 3 attempts per 10 minutes per user and one concurrent job) and tune from measured pilot traffic and spend rather than raising limits speculatively.

**Verification gate:** A multi-process concurrency test proves aggregate enforcement, duplicate phase calls produce one model request/one set of steps, and a rejected oversized/rate-limited PDF is not parsed or transmitted.

### PH-08 — P1 — Authentication posture conflicts with invitation-only V1

**Evidence:** `/signup` is public and calls `supabase.auth.signUp()`. Client validation permits six-character passwords. Login and signup accept any `next` value beginning with `/`, while the callback correctly also rejects `//`; the path policy is duplicated across components. Supabase dashboard settings are not represented or tested in the repo.

**Risk:** Unauthorized self-registration, weak credentials, redirect edge cases, user enumeration/brute-force pressure, and environment drift. A newly registered account automatically receives a case-manager `app_users` row.

**Required change:** Disable public signup in Supabase and remove/guard `/signup` for invitation-only V1. Use a single internal-path validator everywhere. Configure and document email confirmation, password minimum and compromised-password checks, auth rate limits/CAPTCHA where warranted, short recovery-link lifetimes, redirect allowlists, custom SMTP, security notifications, session lifetime, and admin MFA. Require recent authentication/MFA for role changes and destructive operations.

**Verification gate:** Self-signup fails, invite acceptance works, common/weak passwords fail, `//host` and encoded redirect variants remain internal, reset links are single-use/short-lived, and auth throttling is observed in a staging test.

### PH-09 — P1 — Browser-local paperwork drafts lack a retention and shared-device boundary

**Evidence:** `src/lib/paperwork/local-paperwork-draft.ts` stores raw PDF bytes and proposed/edited form values in IndexedDB, keyed only by family ID, with no user namespace, TTL, automatic logout cleanup, or retention notice. Data remains until the user explicitly resets the paperwork.

**Risk:** Sensitive case context and potentially partially completed PDFs remain readable on a shared or lost school device and are available to any same-origin script after an XSS. A crash between local save and failed AI analysis can leave a rejected file behind.

**Required change:** For V1, prefer session-only storage unless resume-after-browser-close is an explicit, approved requirement. If persistence is required, namespace by authenticated user, set a short TTL, purge on sign-out/account change/plan completion, show clear device-storage copy, and provide “clear local drafts.” Do not persist any file before its pre-transmission privacy gate passes. Browser encryption with a key stored in the same browser is not a substitute for endpoint/device security.

**Verification gate:** Sign-out and account switching remove or isolate drafts; expired drafts purge automatically; failed/rejected uploads leave no bytes; a shared-browser E2E test cannot recover the prior user's data.

### PH-10 — P1 — Operational recovery, retention, and incident response are undefined

**Evidence:** The repo has no production runbook, backup/restore drill, recovery objectives, incident classification/escalation, breach procedure, access-review procedure, secret-rotation schedule, or enforceable retention/deletion job. The privacy policy says data is retained “as long as needed” and account deletion may require contact.

**Risk:** A correct application can still lose data, retain it indefinitely, or respond too slowly to compromise. Legal copy is not an operational control.

**Required change:** Before pilot, assign an owner and document:

- data inventory/classification and approved uses;
- retention periods for active, archived, audit, AI metadata, demo/contact, logs, backups, and browser drafts;
- user/account/family deletion and legal-hold behavior;
- Supabase backups/PITR, encrypted exports if used, RPO/RTO, and a staging restore drill;
- incident severity, containment, key rotation, vendor notification, district notification, evidence preservation, and postmortem process;
- quarterly user/admin/access review and immediate offboarding;
- vendor inventory and current DPA/data-control decisions for Supabase, Vercel, OpenAI, email, and any observability provider.

**Verification gate:** Complete one restore exercise and one tabletop incident exercise; record evidence, timings, failures, and owners.

### PH-11 — P1 — Production observability is insufficient for a sensitive workflow

**Evidence:** Runtime observability is primarily `console.*`. AI usage logs include user ID, route, model, tokens, and latency, but there is no request/correlation ID, durable error tracker, alert policy, health/readiness check, security-event alert, SLO, or dashboard. Several catch blocks collapse database/provider failures into “Unauthorized.”

**Risk:** Real incidents, cross-service failures, cost spikes, repeated authorization failures, and degraded PDF/AI performance may be invisible or misdiagnosed. Adding a vendor without privacy controls could also create a new data leak.

**Required change:** Add privacy-filtered structured logging and error monitoring with explicit field allowlists; never send family narrative, PDF names/content, prompts, model output, auth tokens, or cookies. Add correlation IDs and metrics for auth failures, RLS denials, AI rate limits/cost/latency, generation failures, PDF parse failures, audit-write failures, and request latency. Define alerts and SLOs, plus a no-AI/degraded-mode runbook. Keep telemetry minimal and contractually approved.

**Verification gate:** Synthetic staging failures trigger the expected alert and contain only allowlisted metadata. A log review finds no case prose or credentials.

### PH-12 — P2 — PDF active content and parser resource limits need hardening

**Evidence:** The PDF flow rejects XFA and signed PDFs but preserves the original document when writing fields. There is no explicit rejection/sanitization of embedded JavaScript, launch actions, external links, attachments, or other active content. Byte/page limits reduce risk but do not test compressed/decompression bombs or worst-case object graphs. The function can run for 180 seconds.

**Risk:** A malicious or compromised template can remain active in the downloaded document; crafted PDFs can consume excessive browser/server memory or CPU.

**Required change:** Define a supported safe PDF profile. Reject active content and attachments, or produce a flattened/sanitized output that strips them while preserving the required form. Run parser fuzz/corpus tests and measure memory/CPU for adversarial small files. Keep hard byte/page/field/option limits and add a stricter execution/concurrency budget. Never fetch URLs referenced inside a PDF.

**Verification gate:** Fixtures containing JavaScript, launch actions, attachments, XFA, signatures, malformed xref tables, compressed streams, and excessive objects are rejected safely without output or model transmission.

### PH-13 — P2 — Some exported server actions lack runtime schemas

**Evidence:** `saveStepHelperOutputAction()` and `saveStepHelperAction()` rely on TypeScript-only `StepHelperType`, field, and value types. The generic action can write a dynamic JSONB key and unbounded/unscanned value. `startStagedLeanPlanGeneration()` and `advanceStagedLeanPlanGeneration()` also accept typed objects without a complete runtime schema. Next.js explicitly treats every reachable server action as an untrusted POST boundary.

**Risk:** Custom callers can send invalid fields, oversized arrays/text, PII, or malformed IDs despite safe UI types.

**Required change:** Delete the generic exported save action and retain one narrow action with a Zod schema, allowlisted helper type, bounded value shape, no-PII validation, family/step relationship check, and optimistic concurrency if overwrites matter. Apply the same schema rule to every exported action and route input.

**Verification gate:** Generate an inventory of exported server actions and require tests for unauthenticated, unauthorized, invalid, oversized, and valid requests for each mutation/expensive action.

### PH-14 — P2 — Security headers are incomplete

**Evidence:** `next.config.ts` sets `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, and a limited `Permissions-Policy`. Production-mode HTTP inspection confirmed them. There is no Content Security Policy, HSTS, `frame-ancestors`, `object-src`, `base-uri`, or `form-action` policy.

**Risk:** Missing defense in depth for XSS, injected external resources, unsafe base/form targets, and downgrade protection. This matters more because IndexedDB contains case/PDF draft data.

**Required change:** Deploy CSP in report-only mode first, observe violations, then enforce a minimal policy compatible with the app. At minimum cover `default-src`, `script-src`, `style-src`, `img-src`, `font-src`, `connect-src` (Supabase only where browser auth requires it), `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, and `frame-ancestors 'none'`. Add HSTS only on the real HTTPS production domain after confirming all subdomains are ready. Prefer CSP `frame-ancestors` while retaining legacy `X-Frame-Options`.

**Verification gate:** Automated production-response tests assert the policy, and CSP reporting remains clean through auth, workspace, PDF preview/download, and marketing flows.

### PH-15 — P2 — Dependency and CI supply-chain controls need expansion

**Evidence:** Current `npm audit --omit=dev` reports the PostCSS advisory [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) through Next.js 16.2.12; Next.js 16.3.0 is offered as the fix. CI does not run a dependency audit, secret scan, CodeQL/SAST, RLS integration test, or dynamic security test. GitHub Actions are tag-pinned rather than commit-SHA-pinned.

**Risk:** Known vulnerabilities and dependency drift can enter production without a blocking signal. The current PostCSS advisory is most relevant when processing attacker-controlled CSS; CaseLink does not intentionally do that, so it is not a release blocker, but it should not remain open without an explicit decision.

**Required change:** Upgrade Next.js/PostCSS following the bundled Next 16 migration notes and rerun the full suite. Add automated dependency update PRs, production dependency audit/policy, secret scanning, CodeQL or equivalent, SBOM/license review where procurement requires it, and SHA-pin third-party Actions. Review new advisories by reachability rather than blindly accepting every automated major upgrade.

**Verification gate:** CI fails on an agreed severity/reachability policy, and the current advisory is fixed or documented with owner, scope, and expiry.

### PH-16 — P2 — Security and workflow tests stop at the application-unit layer

**Evidence:** The suite has 109 passing tests but no real Supabase policy tests, multi-user authorization matrix, browser E2E suite, automated accessibility scan, PDF active-content corpus, restore test, AI safety/evaluation gate, or load/concurrency test. The PRD requires these test categories for consequential product workflows.

**Risk:** Mocked Supabase clients cannot detect policy/grant mistakes such as PH-01. Compilation and happy-path unit tests do not validate production trust boundaries.

**Required change:** Add the smallest runnable layers that catch distinct regressions:

1. ephemeral Supabase integration tests for migrations, grants, RLS, RPCs, and two-user/two-organization isolation;
2. E2E tests for invite/login, family create/edit/archive, plan review, upload/rejection/review/download, session expiry, and account switching;
3. automated accessibility checks plus keyboard/manual review of dialogs and the paperwork flow;
4. PDF security/correctness corpus with rendered-page comparison;
5. AI eval fixtures for privacy refusal, grounding, owner/consent rules, and unsupported claims;
6. load/concurrency tests for generation, rate limits, database connections, and PDF memory.

**Verification gate:** These tests run in CI or a mandatory staging release job and retain human-readable evidence.

### PH-17 — P2 — Provisioning scripts expose weak default credentials

**Evidence:** `scripts/create-admin-user.ts` defaults to `admin@example.com / admin` and prints the password (`:14-15`, `:60`, `:78`). `scripts/create-test-user.ts` defaults to `test@example.com / test` and prints the password (`:17-18`, `:90`). Both take passwords on the command line, which can enter shell history and process listings.

**Risk:** Operators can accidentally create trivial production credentials or leak credentials into terminals, CI logs, recordings, and shell history.

**Required change:** Remove defaults and password logging. Require an explicit non-production target for test-user creation. For real users, prefer Supabase invite/recovery flows over operator-chosen passwords. If a bootstrap admin is unavoidable, read a generated secret from a protected prompt/stdin, require rotation/MFA on first use, and log only the user ID/email and action result.

**Verification gate:** Scripts refuse weak/missing inputs, refuse the production project for test users, and never emit a credential.

### PH-18 — P3 — Error classification and transaction boundaries are inconsistent

**Evidence:** Some actions catch any failure and return “Unauthorized,” obscuring provider/database faults. Several multi-row workflows use manual rollback rather than one database transaction. In `generatePlan()`, a plan-row insert can survive a step insert error, and audit writes often happen outside the primary mutation.

**Risk:** Partial state, confusing support incidents, and inaccurate audit timelines.

**Required change:** Use atomic RPCs for multi-table mutations that must commit together; reserve “Unauthorized” for verified auth failure; assign stable internal error categories/correlation IDs while keeping client messages generic. Do not wrap every simple single-row write in a new abstraction.

**Verification gate:** Fault-injection tests at each write boundary prove all-or-nothing behavior and the correct public/internal error classification.

### PH-19 — P3 — Lint warnings and dead paths reduce signal

**Evidence:** The full verification suite passes with seven unused-code warnings. Legacy dashboard/calendar/barriers code and revalidation calls remain although those routes now redirect to Families. An unused hard-delete server action remains beside the preferred archive flow.

**Risk:** Low direct security impact, but dead surface hides real findings, increases review scope, and makes warnings easier to ignore.

**Required change:** Delete unused V1 code after confirming no caller, make CI warning-free, and keep only routes/actions that are intentionally available in production.

## Implementation plan

### Phase 0 — Stop-ship fixes and policy decisions

**Target:** before any external user or real case data.

- Fix PH-01 with a migration and real JWT integration test.
- Resolve PH-02. Default to blank fillable PDFs only; feature-flag scanned/visual PDF analysis off until the privacy boundary is technically honest.
- Disable public signup and weak provisioning defaults.
- Inspect existing user roles and rotate privileged credentials if any environment has been exposed.
- Add a temporary production launch check that refuses to enable the app unless the approved tenancy and PDF modes are explicitly configured.

**Exit criteria:** both P0 tests pass against staging; no self-registration; no PDF can reach OpenAI before the approved privacy gate.

### Phase 1 — Authorization, data integrity, and auditability

**Target:** before a controlled pilot.

- Choose dedicated single-tenant deployments or implement organization tenancy.
- Make role, owner, organization, and parent IDs immutable except through audited transfers.
- Fix archive semantics and cross-family foreign-key consistency.
- Move consequential multi-table changes and audit events into narrow transactions/RPCs.
- Add database-level length/state/direct-identifier controls and remove unnecessary direct mutation privileges.
- Add the full creator/assignee/unrelated/admin/service-role RLS matrix.
- Close every unvalidated exported action, beginning with step-helper persistence.

**Exit criteria:** direct Data API and server-action tests agree on every authorization decision; the privacy policy matches actual isolation.

### Phase 2 — Abuse, PDF, and AI controls

**Target:** before broadening the pilot.

- Replace process-local AI throttling and staged-generation locking with shared atomic controls.
- Add per-operation concurrency, user/hour, tenant/day, and global spend budgets; correct `429` behavior.
- Reject requests before expensive parsing where possible and add route-handler Origin/CSRF defense in depth.
- Define and enforce the supported safe PDF profile; add parser corpus/fuzz/resource tests.
- Apply TTL/user isolation/logout purge to browser drafts, or revert to session-only persistence.
- Validate AI outputs semantically, retain human review, and build the smallest privacy/grounding eval set required by the PRD.

**Exit criteria:** multi-instance abuse tests pass; PDF security fixtures are rejected safely; local drafts meet the retention policy.

### Phase 3 — Operations and secure delivery

**Target:** before production launch sign-off.

- Patch the current dependency advisory and add dependency/secret/SAST automation.
- Add CSP report-only, then enforce it; add HSTS on the confirmed production domain.
- Configure and document Supabase Auth, SMTP, redirect allowlists, sessions, admin MFA, Vercel environment separation, firewall/bot controls where needed, and secret rotation.
- Add privacy-filtered error monitoring, correlation IDs, dashboards, alerts, and SLOs.
- Write retention/deletion, backup/restore, incident response, access review/offboarding, deploy/rollback, and vendor runbooks.
- Verify production and preview use separate Supabase/OpenAI data and keys. Never point preview deployments at production case data.

**Exit criteria:** a restore drill and incident tabletop succeed; alerts fire in staging; external settings are captured in an operator checklist with screenshots or exported configuration where safe.

### Phase 4 — Launch validation

**Target:** final release candidate.

- Run the full CI and staging release suites, including RLS, E2E, accessibility, AI eval, PDF render/security, and load/concurrency checks.
- Perform an authenticated manual security test with at least two users and, if applicable, two organizations.
- Test session expiry, offboarding, role downgrade, archive/recovery, AI outage, Supabase outage, OpenAI rate limit, audit failure, and rollback.
- Review logs for sensitive content and verify dashboards/alerts during the test.
- Have product/privacy, engineering, and the pilot owner sign the go-live checklist and named residual risks.

## Go-live checklist

### Release blockers

- [ ] Case-manager JWT cannot change `app_users.role` or immutable identity/ownership columns.
- [ ] Existing user roles were reviewed for unexpected elevation.
- [ ] PDF privacy policy is explicit and enforced before third-party transmission.
- [ ] Public signup is disabled; invite-only onboarding and offboarding are tested.
- [ ] Tenancy model is documented and matches RLS plus legal copy.
- [ ] Multi-user RLS integration suite passes against the deployed migration set.

### Security and privacy

- [ ] Every exported server action and route authenticates, authorizes the object, and runtime-validates bounded input.
- [ ] Direct Data API writes cannot bypass critical privacy, integrity, ownership, or audit rules.
- [ ] Audit events are immutable, actor-derived, transactional where required, and monitored for failure.
- [ ] Browser drafts are session-only or user-scoped with TTL and purge behavior.
- [ ] CSP is enforced; HSTS is enabled on the validated production domain.
- [ ] Production, preview, and development use separate data stores and secrets.
- [ ] Admin MFA, auth redirect allowlist, SMTP, recovery, session, and brute-force controls are verified.
- [ ] Privacy policy, terms, vendor list, retention, deletion, and contact process are current and reviewed.

### Abuse and AI/PDF safety

- [ ] Shared rate limits, concurrency locks, daily cost budgets, `429`, and emergency cutoff are tested across instances.
- [ ] OpenAI requests continue to use `store: false`; approved vendor/data controls are documented.
- [ ] PDF active-content, malformed-file, resource-exhaustion, and PII fixtures fail safely before prohibited transmission.
- [ ] Human review remains mandatory for plans and every populated form; identity/signature/consent fields remain manual.
- [ ] AI privacy, grounding, ownership/consent, and unsupported-claim evals meet the agreed release threshold.

### Reliability and operations

- [ ] Full verification, E2E, accessibility, RLS, PDF, AI eval, and load tests pass on the release candidate.
- [ ] Current production dependency audit meets the agreed policy; SBOM/license needs are satisfied.
- [ ] Structured logs contain no case prose, PDF content, prompts/output, credentials, tokens, or cookies.
- [ ] Alerts, on-call contacts, incident runbook, deploy/rollback, and vendor outage procedures are tested.
- [ ] Backup/PITR is enabled as required and a restore drill meets documented RPO/RTO.
- [ ] Data retention, archive, account deletion, and local-draft purge jobs are operational.

## Recommended ownership

| Workstream | Accountable owner | Required approver |
| --- | --- | --- |
| RLS, grants, tenancy, audit integrity | Backend/security engineer | Product owner |
| PDF/no-PII boundary and AI vendor handling | Privacy/security lead | District/pilot privacy authority |
| Auth configuration and user lifecycle | Backend/operator | Pilot administrator |
| Shared rate limits, spend controls, concurrency | Backend/platform engineer | Product owner |
| Monitoring, backups, incident and deployment runbooks | Platform/operator | Engineering owner |
| E2E, accessibility, PDF render, and AI eval gates | QA/engineering | Product owner and pilot lead |
| Legal copy, retention, deletion, vendor inventory | Product/privacy owner | Qualified counsel/district authority as applicable |

## Ponytail deletion and simplification pass

These are separate from the correctness/security findings. Apply them only after confirming the V1 caller graph; deletion must not remove validation, authorization, privacy, accessibility, recovery, or required workflow behavior.

- `src/app/actions/families.ts:376-402`: **delete:** unused hard-delete server action beside the shipped archive flow. Nothing replaces it until an approved retention/deletion workflow exists.
- `src/app/actions/step-helper.ts:73-137`: **shrink:** generic dynamic-field save action plus wrapper. One validated allowlisted save action replaces both.
- `src/app/actions/barrier-workflow.ts:268-555`: **delete:** legacy reference-ID workflow actions and recent-record surface are reachable only from the redirected legacy barriers experience. Keep only the family-scoped V1 path.
- `supabase/migrations/20260802120000_demo_requests.sql:1-18`: **delete:** service-role demo-request table is unused because the current form opens a mail draft. Nothing replaces it unless server-side lead capture returns.
- `src/features/auth/sign-up-form.tsx:52-68`, `src/features/auth/forgot-password-form.tsx:11-31`, `src/lib/auth/public-site-url-client.ts`: **shrink:** duplicate public-origin parsing and internal redirect checks. One browser-safe origin helper and one internal-path helper replace them.
- `src/app/actions/*.ts` repeated `/dashboard` and `/calendar` revalidations: **delete:** legacy revalidation calls for routes that now redirect to Families. Revalidate only active V1 paths.
- legacy dashboard/calendar/barriers implementation files behind redirects: **delete:** speculative non-V1 surface after confirming no production navigation/import. Families remains the single entry point.

`net: approximately -350 lines possible before deleting the larger dormant dashboard/calendar feature implementations.`

## Final production decision

CaseLink should remain **no-go** until PH-01 and PH-02 are closed with integration-level evidence. A tightly controlled pilot can proceed after all P1 items have owners, the tenancy/privacy model is explicit, the RLS matrix passes, shared abuse controls are active, and the restore/incident runbooks have been exercised. P2 items should be complete before general production availability; any deferral needs a named owner, written rationale, compensating control, and expiry date.
