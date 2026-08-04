# CaseLink production operations runbook

**Applies to:** the invitation-only V1 pilot

**Approved deployment shape:** one Vercel project and one Supabase project per school or district

**Data posture:** de-identified case context only; blank unlocked fillable PDFs only; no raw PDF bytes stored server-side or sent to OpenAI

This runbook is a release control. A deployment is not production-ready until every pre-launch item has an owner, date, and evidence link in the release ticket. Repository tests cannot prove hosted-provider configuration, contractual approval, recovery, or alert delivery.

## Roles and contacts

The release ticket must name people for each role. One person may fill several roles in a small pilot, but no role may be blank.

| Role | Accountability |
| --- | --- |
| Service owner | Go/no-go decision, pilot scope, customer communication |
| Release operator | Deploy, migration, smoke test, rollback |
| Security incident commander | Triage, containment, evidence, notification coordination |
| Privacy owner | Approved data use, retention, deletion, vendor terms |
| Pilot administrator | Invitations, assignments, quarterly access review, offboarding |
| District contact | Local escalation and required family/school notification decisions |

Store current phone/email contacts in the restricted operational system, not in this public repository.

## Pre-launch gate

### Application and environment

- [ ] Deploy a dedicated Vercel and Supabase project for exactly one school or district.
- [ ] Set `CASELINK_TENANCY_MODE=single-tenant`, `CASELINK_PDF_MODE=fillable-only`, `CASELINK_INVITE_ONLY=1`, `CASELINK_HSTS=1`, `CASELINK_ENVIRONMENT=production`, exact HTTPS `NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_SUPABASE_URL` values, the public Supabase anon key, and the production OpenAI key.
- [ ] Keep `OPENAI_DEBUG`, `OPENAI_PAYLOAD_DEBUG`, `PLAN_REGENERATE_DEBUG`, and `PLAN_REFINE_DEBUG` unset.
- [ ] Use distinct production, preview, test, and local databases, auth projects, secrets, and OpenAI projects.
- [ ] Confirm only the production branch can deploy to production and require passing CI plus review.
- [ ] Verify `/api/health`, unauthenticated workspace redirects, CSP, HSTS, and all security headers on the real domain.

### Supabase Auth

- [ ] Disable public email signup and anonymous signup.
- [ ] Use `npm run db:invite-user` with `NEXT_PUBLIC_SITE_URL`, `CASELINK_INVITE_EMAIL`, optional `CASELINK_INVITE_ROLE` (`case_manager` by default), `CASELINK_OPERATOR_LABEL`, and `CASELINK_CHANGE_REASON`; verify the invite opens the exact callback, establishes a session, and requires initial password setup. Test expired/reused links.
- [ ] Require at least 14 characters and lower/upper-case letters, digits, and symbols; enable leaked-password protection when the hosted plan supports it.
- [ ] Set email OTP/recovery expiry to 15 minutes, secure password changes, and session timebox/inactivity limits no longer than 12/2 hours.
- [ ] Restrict redirect URLs to the exact production callback and recovery paths. No wildcards.
- [ ] Configure custom SMTP, delivery monitoring, auth abuse limits, CAPTCHA if abuse warrants it, and security notifications.
- [ ] Require TOTP MFA for every administrator and production operator; prove a password-only AAL1 admin cannot access an unrelated synthetic case and an AAL2 session can.
- [ ] Review `app_users` for unexpected roles before launch and attach the query result to the release ticket.

### Platform and vendor controls

- [ ] Confirm TLS and the production domain, then verify HSTS is present before adding the domain to any preload list.
- [ ] Configure Vercel firewall/rate rules for obvious automated abuse and protect preview deployments.
- [ ] Verify Supabase backups/PITR, region, log retention, network restrictions, and database migration state.
- [ ] Verify OpenAI requests use the approved project, spend ceiling, notification threshold, and `store: false` behavior.
- [ ] Record the current vendor inventory and approval/DPA status for Vercel, Supabase, OpenAI, email, and observability.
- [ ] Confirm telemetry contracts and filters prohibit case prose, prompts/output, PDF content/names, credentials, cookies, and auth tokens.

### Release verification

- [ ] `npm ci`, production dependency audit, secret scan, typecheck, lint, unit/integration tests, production build, and database security suite pass on the candidate commit.
- [ ] Authenticated staging checks cover the complete family → barriers → plan → review → blank PDF → field review → page review → download flow.
- [ ] An automated accessibility scan plus keyboard-only check passes for login, Families, Family workspace, plan review, and paperwork review.
- [ ] PDF corpus tests reject filled, scanned, encrypted, signed, XFA, active-content, attached, malformed, oversized, over-page, over-field, and excessive-object files without an AI call.
- [ ] AI safety/evaluation fixtures meet the release rubric for privacy, grounding, unsupported claims, resource fidelity, and human-review requirements.
- [ ] Product/privacy, engineering, and the pilot owner sign the residual-risk section of the release ticket.

## Data inventory and retention

| Data class | Location | Retention | Disposal/control |
| --- | --- | --- | --- |
| Account/profile and assignment | Supabase Auth/Postgres | Authorized service period; disable immediately at offboarding | Delete after contractual/account close and legal-hold check |
| Active de-identified family, plan, note, and referral records | Postgres | Authorized service period | Archive on request or service close |
| Archived case records | Postgres | 90 days | Monthly operator deletion after legal-hold approval |
| Product activity and security audit events | Postgres | 365 days | Monthly age-based deletion; no browser mutation |
| Structured application/error logs | Approved logging provider | 30 days | Provider TTL; allowlisted metadata only |
| AI usage metadata | Application/provider | 30 days unless contract requires less | Provider/project retention control; no prompt or response logging |
| Blank and completed PDF bytes | Active browser tab | Until download, refresh, or tab close | No server, OpenAI, IndexedDB, or localStorage persistence |
| Demo/contact email | Approved mailbox | 90 days unless an active sales relationship exists | Quarterly mailbox review/deletion |
| Database backups/PITR | Supabase | At most 30 days after source deletion | Provider expiry; restoration access restricted and audited |

The privacy owner approves every deletion. A documented legal hold pauses deletion only for the named records and is reviewed monthly. Deletion evidence records counts and opaque IDs, never case narrative.

## Access lifecycle

### Invite

1. Pilot administrator verifies the work email and business need out of band.
2. Release operator runs the invitation script using environment variables; passwords never appear in arguments or output.
3. Assign the least-privileged `case_manager` role. Admin role changes require service-owner approval, recent authentication, TOTP MFA, and an operator audit event.
4. Confirm the user can access only an explicitly owned or assigned synthetic case before real use.

### Offboard

1. Disable the Supabase Auth user immediately.
2. Remove family assignments and active sessions.
3. Transfer owned cases only through the approved, audited operator process.
4. Record actor, target opaque user ID, reason, approval, and completion time in the security audit.

Review every user, admin, assignment, service credential, and vendor operator quarterly and before each pilot extension.

## Deploy and rollback

### Deploy

1. Record the commit SHA, migration list, dependency-audit result, approvals, and backup status.
2. Apply migrations to staging from scratch and run `npm run test:db-security`.
3. Deploy staging, execute the release verification checks, and review CSP/structured logs for prohibited content.
4. Take/verify the production recovery point, apply migrations, then deploy the same immutable commit.
5. Smoke-test `/api/health`, login, one synthetic family read/write, plan review, and blank-form download.
6. Monitor errors, auth failures, rate limits, latency, and spend for at least 30 minutes.

### Rollback

1. Stop traffic or disable the affected feature when data integrity or confidentiality may be at risk.
2. Roll application code back to the last known-good immutable deployment.
3. Do not reverse a data migration blindly. Use a reviewed forward-fix unless a tested down migration and recovery point make rollback demonstrably safe.
4. If data may be corrupt, make the service read-only, preserve evidence, and invoke the restore procedure.

## Backup, restore, and continuity

Targets for the pilot are **RPO ≤ 24 hours** and **RTO ≤ 8 hours**. A stricter district requirement supersedes these targets.

Before launch and quarterly:

1. Restore the latest production-shaped backup into an isolated staging project.
2. Record backup timestamp, restore start/end, achieved RPO/RTO, row counts, migration version, and operator.
3. Run database security tests and synthetic family/plan/PDF-download workflow checks against the restored system.
4. Verify the restore cannot send real email or OpenAI requests and that access is limited to the drill team.
5. Delete the drill environment under the retention policy and record failures with owners and due dates.

An untested backup does not satisfy the launch gate.

## Monitoring, SLOs, and alerts

Pilot SLO: **99.5% monthly availability** for authenticated non-AI workflows, excluding scheduled maintenance announced at least 24 hours in advance.

Alert the named operator for:

- health check failure for 5 minutes;
- non-AI server error rate above 2% for 10 minutes;
- repeated RLS/authorization denials or auth failures above the staging-derived abuse threshold;
- any audit-write failure or unexpected admin/role event;
- AI failure above 10% for 15 minutes, p95 latency above 90 seconds, rate-limit spikes, or 80% of the daily spend ceiling;
- PDF rejection/parse failures above 10% for 15 minutes;
- database capacity, connection, or backup failure warnings.

Every alert must carry only time, environment, route/event taxonomy, correlation ID, error fingerprint, status, duration, and aggregate counts. Test alert delivery with synthetic failures before launch and quarterly.

## Incident response

| Severity | Example | Initial response |
| --- | --- | --- |
| SEV-1 | Confirmed data exposure, account takeover, destructive corruption | Page immediately; contain within 15 minutes |
| SEV-2 | Material auth/RLS weakness, prolonged outage, uncontrolled AI spend | Respond within 30 minutes |
| SEV-3 | Degraded feature with safe fallback and no exposure | Respond same business day |

1. Declare the incident, incident commander, severity, and private evidence channel.
2. Contain: disable invites/AI/feature or traffic; revoke sessions and rotate affected secrets; preserve immutable logs and deployment/database state.
3. Assess affected time window, deployments, users, records, vendors, and whether prohibited PII entered the system. Do not copy case narrative into the incident tracker.
4. Notify the service owner, privacy owner, district contact, and vendors. Qualified privacy/legal owners determine any required individual, regulator, or insurer notice and timing.
5. Recover from a known-good state, rerun the security and workflow gates, and monitor closely.
6. Produce a blameless postmortem within five business days with root cause, impact, detection gap, corrective owners/dates, and evidence of completion.

Run a tabletop before launch and every six months. At minimum simulate a role escalation, a prohibited PDF upload, a leaked service key, and an unavailable AI provider.

## Degraded modes

- **OpenAI unavailable or budget cutoff:** keep saved context; show a specific retryable failure; do not duplicate jobs; allow non-AI editing and existing plan/PDF manual work.
- **Supabase unavailable:** fail closed for authorization and mutations; never use cached case data as authorization evidence.
- **PDF unsupported:** preserve no server copy; explain the accepted blank fillable profile; allow the user to choose another form.
- **Email unavailable:** pause invitations and password recovery; do not bypass identity verification.

## Evidence record

Each production release ticket must attach:

- commit and deployment IDs;
- migration version and deployed-schema check;
- CI, database-security, dependency, secret, E2E/accessibility, PDF, and AI-eval results;
- hosted Auth, backup, firewall, domain/header, alert, spend-cap, and vendor-control screenshots or exports;
- latest restore and incident-tabletop reports;
- access review date;
- named approvals, residual risks, owner, and expiry.
