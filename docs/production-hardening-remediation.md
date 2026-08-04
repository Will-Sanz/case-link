# CaseLink production-hardening remediation

**Remediation date:** 2026-08-04

**Branch:** `codex/production-hardening-remediation`

**Base:** `codex/production-hardening-audit` (`fa91f77`), itself based on the V1 redesign

**Source audit:** [production-hardening-audit.md](./production-hardening-audit.md)

## Decision

The repository blockers identified in PH-01 and PH-02 are remediated. The codebase now enforces the approved V1 boundary: invitation-only access, one school/district per deployment, de-identified case context, blank unlocked fillable PDFs only, no persistent browser PDF drafts, and no reachable server route that sends raw PDF bytes to OpenAI.

This does **not** authorize a production launch by itself. Hosted Auth/firewall/backup/alert/vendor settings, a restore exercise, an incident tabletop, and authenticated staging workflow/accessibility checks require an actual target environment and named operators. They remain explicit no-go gates in [production-operations-runbook.md](./production-operations-runbook.md).

## Finding closure matrix

| Finding | Repository disposition | Evidence | Remaining launch evidence |
| --- | --- | --- | --- |
| PH-01 role escalation | Closed | Column-level profile grant, immutable identity/role trigger, service-role-only audited provisioning, real JWT-role database tests | Review existing hosted roles and admin MFA |
| PH-02 PDF PII after transmission | Closed for approved V1 | Raw/scanned analysis route removed; local blank-field and active-content gate; only bounded field metadata reaches mapping; no IndexedDB draft | Run the approved production PDF corpus on the release candidate |
| PH-03 tenancy | Closed for approved V1 | Production startup requires `single-tenant`; legal copy and runbook require a dedicated Vercel/Supabase environment | Provision and verify the dedicated projects |
| PH-04 direct Data API bypass | Closed | Critical DB constraints/triggers; direct consequential DML revoked; narrow validated RPCs; adversarial database tests | Compare hosted grants/migrations to the candidate |
| PH-05 ownership/cross-family integrity | Closed | Immutable ownership/author fields, relationship triggers, owner/admin archive RPC, cross-family integration tests | Run assignment matrix in staging |
| PH-06 forgeable audit | Closed | Arbitrary activity DML revoked; actor-derived allowlisted RPCs; consequential write+event transactions; separate security audit | Configure alerts and verify hosted audit retention |
| PH-07 rate/concurrency limits | Closed | Atomic Postgres minute/hour/day budgets, operation weights, emergency cutoff, and one-owner job claims; concurrent database tests | Set spend ceiling/alerts and tune from pilot metrics |
| PH-08 invitation/auth posture | Repository closed | Public signup route redirects; shared safe internal-path parser; callback-bound invite/password setup; real password reset; 14-character policy; AAL2-gated admin RLS; hardened local Supabase config; safe invitation scripts | Apply and test hosted Auth, SMTP, CAPTCHA/rate, MFA enrollment/challenge, and redirect settings |
| PH-09 browser drafts | Closed | IndexedDB persistence removed; PDFs and mapped values live only in the active tab and clear after download/refresh | Shared-device staging check |
| PH-10 recovery/retention/incident | Control defined | Concrete retention table, deletion/legal-hold process, RPO/RTO, restore, access review, incident and vendor procedures in the runbook | Name owners; complete restore and tabletop exercises |
| PH-11 observability | Repository baseline closed | Privacy-filtered structured error payloads, fingerprints/correlation IDs, health endpoint, metric/SLO/alert policy | Configure approved provider and prove synthetic alert delivery/no-prose telemetry |
| PH-12 PDF active/resource safety | Closed for supported profile | Rejects active actions, attachments, non-blank/non-fillable/encrypted/scanned files; byte/page/field/object caps; local processing | Execute full adversarial corpus and record browser resource measurements |
| PH-13 server-action validation | Closed | Generic step helper removed; staged inputs use runtime schemas; paperwork mapping is bounded and literal fillable mode only | Keep exported-boundary inventory in review checklist |
| PH-14 headers | Closed | Enforced CSP, frame ancestors/object/base/form policies, HSTS production gate, browser policies, unit assertions | Verify real-domain responses and all CSP-sensitive workflows |
| PH-15 dependency/supply chain | Closed | Next/PostCSS fixed versions, production audit in CI, tracked-file secret scan, SHA-pinned Actions, CodeQL, Dependabot | Enable repository security features and review first scheduled results |
| PH-16 security/workflow tests | Material repository layer added | Real Postgres grants/RLS/transactions/concurrency suite; PDF adversarial unit tests; existing unit/build suite | Authenticated E2E, automated accessibility, rendered PDF corpus, AI eval, and restore drill remain launch gates |
| PH-17 provisioning credentials | Closed | No default/argument passwords, local-only test-user guard, invitation provisioning, audited role assignment, regression tests | Operator TOTP and access review |
| PH-18 error/transactions | Closed for consequential flows | Atomic family/note/plan/review/archive/paperwork/staged-plan RPCs; rollback tests; safe production error logs | Staging failure injection and alert check |
| PH-19 dead paths/signal | Closed | Legacy dashboard/calendar/barrier reference workflow, generic helper, raw PDF route, duplicated auth code, and obsolete revalidations removed; lint is a zero-warning gate | Remove any retained legacy database table only through approved retention/deletion process |

## Defense-in-depth changes

- Production refuses ambiguous tenancy, PDF, invitation, HSTS, origin, or debug settings.
- Auth redirects reject scheme-relative, encoded, double-encoded, backslash, and control-character variants.
- PDF inputs are limited to 15 MB, 50 pages, 150 fields, and 20,000 indirect objects; output values are bounded and identity/signature fields stay manual.
- OpenAI inputs remain bounded, models allowlisted, responses non-stored, and shared database budgets fail closed in production.
- Database authorization derives identity from the JWT, not caller-supplied actor or owner IDs.
- CI runs production dependency policy, secret scanning, unit/type/lint/build verification, CodeQL, and a real local Supabase security job.

## Verification evidence

The final repository verification was run on 2026-08-04 from a cleanly rebuilt local test stack:

- `supabase db reset` successfully recreated the database and applied every migration through `20260804173443_production_hardening.sql`.
- `npm run test:db-security` passed the real-Postgres grant, RLS, role/AAL2, assignment, cross-family integrity, identifier-DLP, immutable audit, rollback, and concurrent-budget checks.
- The strict production-posture `npm run verify` gate passed its lockfile and resource-seed checks, the tracked/unignored-file secret scan, TypeScript, zero-warning ESLint, 33 test files / 108 tests, and the Next.js 16.3.0 production build.
- `npm audit --omit=dev --audit-level=high` and `npm audit --audit-level=high` each reported zero vulnerabilities.
- A live local production build returned `200` plus `Cache-Control: no-store` and a request ID from `/api/health`; redirected unauthenticated `/families` to `/login`; redirected `/signup` to `/request-demo`; and returned `404` for the removed `/api/paperwork/analyze` route.
- Live responses included the enforced CSP, HSTS, frame denial, MIME-sniffing protection, referrer policy, permissions policy, cross-origin opener policy, and cross-domain policy headers.

These results verify repository controls only. The hosted and exercise evidence listed in the operations runbook remains part of the production go/no-go decision.

## Residual-risk rule

No checkbox in the operations runbook may be waived verbally. A deferral requires a named owner, written rationale, compensating control, approval from the service and privacy owners, and an expiry date. PH-01, PH-02, hosted invitation controls, deployed RLS verification, backup restore, and incident response have no launch waiver for a pilot handling real casework.
