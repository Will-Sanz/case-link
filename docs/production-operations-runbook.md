# CaseLink production operations runbook

**Applies to:** the invitation-only V1 pilot

**Current deployment:** one managed Vercel application and a dedicated Supabase production project for this school pilot, plus separate synthetic staging. School/operating acceptance remains open; see the [live release record](verification/production-release.md).

**Data posture:** de-identified case context only; browser-generated reviewed-plan PDF export; no PDF uploads or raw PDF bytes sent to OpenAI

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
- [ ] Set `CASELINK_TENANCY_MODE=single-tenant`, `CASELINK_INVITE_ONLY=1`, `CASELINK_HSTS=1`, `CASELINK_ENVIRONMENT=production`, exact HTTPS `NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_SUPABASE_URL` values, the public Supabase anon key, and the production OpenAI key.
- [ ] Keep `OPENAI_DEBUG`, `OPENAI_PAYLOAD_DEBUG`, `PLAN_REGENERATE_DEBUG`, and `PLAN_REFINE_DEBUG` unset.
- [ ] Use distinct production, preview, test, and local databases, auth projects, secrets, and OpenAI projects.
- [ ] Confirm only the production branch can deploy to production and require passing CI plus review.
- [ ] Verify `/api/health`, unauthenticated workspace redirects, CSP, HSTS, and all security headers on the real domain.

### Supabase Auth

- [ ] Disable public email signup and anonymous signup.
- [ ] Use `npm run db:invite-user` with `NEXT_PUBLIC_SITE_URL`, `CASELINK_INVITE_EMAIL`, optional `CASELINK_INVITE_ROLE` (`case_manager` by default), `CASELINK_OPERATOR_LABEL`, and `CASELINK_CHANGE_REASON`; verify the invite opens the exact callback, establishes a session, and requires initial password setup. Test expired/reused links.
- [ ] Require at least 14 characters and lower/upper-case letters, digits, and symbols; enable leaked-password protection when the hosted plan supports it.
- [ ] Verify invitation/recovery sessions cannot use casework before password sign-in. The database checks the signed authentication method, never editable user metadata. Initial setup and reset end with global sign-out and a fresh password login; earlier case-access tokens must then fail. Existing password users do not need a forced reset. Exercise verification-code and sign-out retry paths without repeating a successful password change.
- [ ] Set email OTP/recovery expiry to 15 minutes, secure password changes, and session timebox/inactivity limits no longer than 12/2 hours.
- [ ] Install the checked-in invite/recovery/reauthentication templates and enable password/email security notices. Match the configured email code length (staging uses eight digits). Verify delivered messages in a synthetic school mailbox, including its link scanner, expiry/resend, a reset requested in another browser, and code renewal. New invitation/reset links open a confirmation screen before redemption and keep their token in the fragment; disable email click tracking and never capture tokens in logs or screenshots. Record actual hosted template/SMTP and canonical-origin settings; local configuration is not hosted evidence.
- [ ] Restrict redirect URLs to the exact production callback and recovery paths. No wildcards.
- [ ] Configure custom SMTP, delivery monitoring, auth abuse limits, CAPTCHA if abuse warrants it, and security notifications.
- [ ] Use password-only CaseLink accounts for both administrators and staff. Disable TOTP/phone/WebAuthn enrollment and verification in hosted Auth; disable passkey sign-in. Confirm no verified factors remain before applying `20261014230221_password_only_pilot_accounts.sql`. Remove any unused factors through the Auth admin API. Prove admin/staff password login, recovery-only denial, offboarding and retained-token denial. Hosting/vendor operator accounts retain their own MFA.
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
- [ ] Authenticated staging checks cover the complete family → barriers → plan → dated-action review → reviewed-plan PDF preview → download flow. Review includes date confirmation and acknowledgement of any earlier open-action dates. Calendar dates use America/New_York for this pilot; Waiting uses its next follow-up date. The review audit records that confirmation.
- [ ] An automated accessibility scan plus keyboard-only check passes for login, Families, Family workspace, plan review, and paperwork review.
- [ ] `npm run test:pdf` passes the reviewed-plan export corpus: exact source text, dates, outcomes, directory contacts, pagination, margins, legibility, monochrome output, unsupported-glyph failure, and no stale or unreviewed export. Uploaded or filled forms are outside this release.
- [ ] AI safety/evaluation fixtures meet the release rubric for privacy, grounding, unsupported claims, resource fidelity, and human-review requirements.
- [ ] Product/privacy, engineering, and the pilot owner sign the residual-risk section of the release ticket.

## School data boundary and staff rehearsal

This pilot permits real circumstances only in de-identified form. It does not authorize identifiable school or family records. Before the first real case, the school privacy owner and service owner must approve the examples, access list, vendor handling, retention schedule, incident contacts, and staff training record in the restricted release ticket. Those approvals are still launch gates; repository changes cannot supply them.

| Staff entry | Permitted example | Keep in the school's required records system |
| --- | --- | --- |
| Family label | `Family 014`, unrelated to any school/student identifier | Names, initials that identify a person, student IDs, or the mapping back to a person |
| Circumstances/barriers | `Transportation is unreliable; prefers an afternoon meeting` | Addresses, exact birth dates, phone/email, identifying combinations of school/class/family details |
| Plan/progress/AI question | `Confirm transport options by October 20`; `Waiting for a callback` | Named-person narratives, copied emails, unredacted records, signatures |
| Resource contacts | Approved directory entries maintained by the resource owner | Family contact details disguised as an agency contact; unverified model-generated contacts |
| Downloads | Reviewed plan on a school-approved device/location, for manual use | Personal email, public links, or uncontrolled copies |

Use only the detail needed to prepare the plan. Automated checks catch representative identifiers, including unformatted phone numbers, explicit name fields, and some likely names; they do not prove anonymity. A person must review the whole entry, including combinations of facts. If the work cannot be done without identifying information, keep it in the school's required system and resolve the data-policy decision before broadening CaseLink's scope.

Rehearse with synthetic cases: enter an identifier and correct it, prepare a de-identified plan, confirm dates and agency facts, review/download, sign out on a shared device, and report an accidental entry. Do not copy accidentally entered content into a support ticket or screenshot. Stop further AI use for that case, notify the named privacy/incident owner through the approved channel, and follow the incident procedure to contain access and decide deletion/provider follow-up. Archive is not deletion. Account/profile names needed for staff authentication are separate from family narrative and must not be included in AI prompts.

## Data inventory and retention

The schedule below is the proposed operational policy. The school/privacy owner must approve it and the operator must evidence its implementation before launch; these periods are not an automatic database deletion job.

| Data class | Location | Retention | Disposal/control |
| --- | --- | --- | --- |
| Account/profile and assignment | Supabase Auth/Postgres | Authorized service period; disable immediately at offboarding | Delete after contractual/account close and legal-hold check |
| Active de-identified family, plan, note, and referral records | Postgres | Authorized service period | Archive on request or service close |
| Archived case records | Postgres | 90 days | Monthly operator deletion after legal-hold approval |
| Product activity and security audit events | Postgres | 365 days | Monthly age-based deletion; no browser mutation |
| Structured application/error logs | Approved logging provider | 30 days | Provider TTL; allowlisted metadata only |
| AI usage metadata | Application/provider | 30 days unless contract requires less | Provider/project retention control; no prompt or response logging |
| Reviewed-plan PDF bytes | Active browser tab; approved device after download | Tab lifetime; downloaded copies follow school policy | No app-server, OpenAI, IndexedDB, or localStorage persistence |
| Demo/contact email | Approved mailbox | 90 days unless an active sales relationship exists | Quarterly mailbox review/deletion |
| Database backups/PITR | Supabase | At most 30 days after source deletion | Provider expiry; restoration access restricted and audited |

The privacy owner approves every deletion. A documented legal hold pauses deletion only for the named records and is reviewed monthly. Deletion evidence records counts and opaque IDs, never case narrative.

## Access lifecycle

### Invite

1. Pilot administrator verifies the work email and business need out of band.
2. Release operator runs `npm run db:invite-user` using environment variables; passwords and links never appear in arguments or output. It creates an unconfirmed Auth account, saves audited permissions, and then requests email delivery. A permission failure sends no invitation. Rerun the same operation after fixing a partial failure; it reuses the account and resends an unopened or expired invitation. Respect the provider's resend delay (at least one minute).
3. Assign the least-privileged `case_manager` role. Admin role changes require service-owner approval, recent operator authentication, and an operator audit event. Hosting/vendor operator MFA remains in place; CaseLink itself uses password-only accounts.
4. Existing confirmed accounts get the requested role update without an unsolicited email. If setup was interrupted after accepting the invite, or a new link is needed, set `CASELINK_INVITE_RESEND=true` to send a recovery link. This also works through the normal Forgot password flow. Neither path reactivates an offboarded account. A delivery-accepted result is not evidence that the school's mailbox received the email; verify receipt separately.
5. Confirm the user can access only an explicitly owned or assigned synthetic case before real use.

### Offboard

1. In a protected operator environment, identify the departing account's opaque user ID and an active replacement staff account. Set `CASELINK_OFFBOARD_USER_ID`, `CASELINK_REASSIGN_USER_ID`, `CASELINK_OPERATOR_LABEL`, and `CASELINK_CHANGE_REASON`; supply the project URL and service key through protected environment secrets, never command arguments or screenshots.
2. Run `npm run db:offboard-user`. Its first database transaction disables effective access, assigns owned/assigned cases to the replacement, removes departing assignments, revokes Auth sessions and their refresh tokens, and records `user.disabled` with actor/reason/replacement/counts. Original case creators and case history remain intact. Database policies and mutation functions check the current active-account flag, including requests with an old JWT.
3. The job disables further Auth sign-in and then revokes sessions again to close the interval between the first transaction and the Auth change. A partial failure exits unsuccessfully and names the stage to retry; a failed Auth call never re-enables database access. Rerunning is safe. Never treat a partial-success message as completed offboarding.
4. Verify the security audit, replacement access, inactive account, and zero remaining sessions using the protected operator job/dashboard. Test this procedure in staging before pilot invitations. Do not delete the account or rewrite historical creators as a substitute. A later role change does not reactivate an offboarded account; reactivation requires a separate approved operating decision.

The automated synthetic rehearsal is `npm run test:auth-security`. It only accepts the local Supabase service addresses and proves that a retained unexpired token cannot read/write owned or assigned cases, refresh, or sign in again. The database regression suite also checks inactive administrator and direct RPC behavior. Repeat the authorized rehearsal in isolated staging under CL-38 before launch. Supabase's [session documentation](https://supabase.com/docs/guides/auth/sessions) explains why token expiry alone is insufficient for immediate removal.

Successful staff sign-out ends all refresh sessions. Database case access also checks that the JWT session still exists and has not expired, so revoked tokens cannot keep reading casework until token expiry. A failed sign-out stays visible with a retry action; staff should confirm completion before leaving a shared device. Browser draft cleanup and recovery are tracked separately in CL-04.

Review every user, admin, assignment, service credential, and vendor operator quarterly and before each pilot extension.

### Password recovery

Staff use Forgot password, confirm the link in their own mailbox, choose a new password, and sign in again. The completed reset revokes earlier sessions. An expired or already used link requires a new request; links and passwords stay out of support tickets. If the mailbox is unavailable or provider account settings block reset, the designated operator verifies identity through the school's established procedure before changing account access. Do not enable self-provisioning or reactivate an offboarded account to resolve a login problem.

The October 14 pilot decision removes CaseLink 2FA. The former authenticator enrollment/recovery UI and operator job are removed; historical audit entries remain intact. Provider operator-account security is unchanged.

## Deploy and rollback

### Deploy

1. Record the commit SHA, migration list, dependency-audit result, approvals, and backup status.
2. Run `npm run test:db-security` and the database/Auth/restore/browser suites on isolated local or CI infrastructure. Apply migrations only to the dedicated empty synthetic staging project, verify its exact migration inventory, then run bounded hosted checks. Do not redirect destructive local fixture runners to a hosted database. The restored legacy project requires its separately rehearsed data-preserving upgrade and backup approval.
3. Run `npm run verify:release -- <exact-40-character-SHA>`, deploy the authorized protected staging candidate, execute the hosted release checks, and review CSP/structured logs for prohibited content.
4. After explicit release approval, verify the production recovery point, apply the separately reviewed compatible migrations, then deploy the same immutable commit with production-scoped credentials.
5. Smoke-test `/api/health`, login, one synthetic family read/write, dated-action review, and reviewed-plan PDF preview/download.
6. Monitor errors, auth failures, rate limits, latency, and spend for at least 30 minutes.

### Rollback

The October 15 AI release is `dpl_BtUijxvxRbopdJ5Ebr214t36grWU` at source `59ef91349f0076c1f3d70a515277915a645facd5`, with 43 migrations through `20261015191247`. Retain both new migrations during application rollback. The prior `2dfb8b83` deployment (`dpl_FesLWbGr9B5jYCs1gwQYpdEtb7uL`) can read/edit completed plans and continue legacy drafts, but cannot reliably resume unfinished compact drafts or parse their richer saved context. Before reverting, prevent new generation starts and confirm no unfinished `generation_strategy=single` drafts or in-flight generation workers remain. Complete them in the new release, or have a case manager explicitly continue failed drafts manually. If safe draining is unavailable, keep generation unavailable and forward-fix. Never rewrite generation markers or delete drafts to force compatibility. Verify secret scopes as well. Historical builds are not unconditional recovery targets. See the [current release evidence](verification/production-release.md).

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

Local preparation: `npm run test:restore` creates two randomly named databases inside only the local CaseLink container. It copies schema definitions and migration IDs, seeds new synthetic Auth/case/plan records, checks a custom-format backup against exact row hashes, rejects a corrupt backup, and verifies access, review preservation and stale-export rejection after restoration. It then runs the complete database security suite against the restored target and removes both temporary databases. It never copies existing family rows, sends email/AI requests, or restores over the application database. See [the October 14 drill](verification/2026-10-14-local-restore.json): 49 tables, 37 migration versions, 21.066 seconds including regression checks, no lost synthetic rows. This is not a hosted RPO/RTO, PITR, storage-object, cluster-role, or provider-configuration rehearsal.

Before the hosted exercise, explicitly disable external email delivery, outbound AI and automated jobs, and restrict network/operator access. Restore Auth state as well as application data; then revoke pre-incident sessions before reopening a real restored service, so recovery does not revive access that was revoked after the backup. Reconcile migration history and provider settings separately. Verify backup recency and credential recovery against the actual project; do not assume a successful scheduled-backup indicator means a usable recovery point exists.

### Verified October 15 recovery point

Before the approved demo-data cleanup, the operator took an encrypted, consistent backup of the original hosted project, including application data, Auth, storage metadata and migration history. A fresh isolated database restored all 56 tables and 4,286 rows with identical content hashes; the temporary database was then removed. See [backup evidence](verification/2026-10-15-hosted-backup.json) and [restore evidence](verification/2026-10-15-hosted-restore.json). Nine provider-owned default grants were excluded from the drill and object ownership was assigned to postgres; application grants were retained. This verifies logical recovery, not reconstruction of provider settings, SMTP, cluster ownership or off-machine disaster recovery. No storage objects existed.

The private recovery point is under the operator's `~/.local/share/caselink/backups/` directory, with file mode 600 and directory mode 700. Its AES-256-GCM key is in macOS Keychain under service `CaseLink database backup`, with an account matching the backup filename before `.backup.json`. The filename contains the project reference and UTC timestamp. Keep the encrypted file and key out of Git, tickets, chat, and ordinary email.

To recover a private PostgreSQL custom-format archive on that operator machine:

```sh
node --import tsx scripts/recover-backup.ts /absolute/path/to/project-timestamp.backup.json /private/recovery/new-archive.dump
```

The output directory must be private and the output filename unused. The utility authenticates the encrypted metadata, checks the archive SHA-256, refuses to overwrite a file, and writes mode 600. It does not connect to a database. Its unit tests reject corrupted ciphertext, a wrong key, modified metadata, an unsupported format and an invalid archive hash. The actual backup was recovered with this utility, its hash matched the verified archive, and PostgreSQL successfully read the full archive; the temporary plaintext copy was deleted. Normal security/data-loss review and the separate Ponytail deletion pass found no outstanding defects for this single-operator recovery tool; it uses only built-in Node APIs.

Restore only to an isolated target following the procedure above. Reconcile provider-owned privileges and Auth settings explicitly; revoke restored sessions before real access. Delete plaintext recovery files after use. A separately protected off-machine backup/key copy and a recurring backup process remain open operational work; this one recovery point does not establish a daily backup or the stated ongoing RPO.

## Monitoring, SLOs, and alerts

Pilot SLO: **99.5% monthly availability** for authenticated non-AI workflows, excluding scheduled maintenance announced at least 24 hours in advance.

Alert the named operator for:

- health check failure for 5 minutes;
- non-AI server error rate above 2% for 10 minutes;
- repeated RLS/authorization denials or auth failures above the staging-derived abuse threshold;
- any audit-write failure or unexpected admin/role event;
- AI failure above 10% for 15 minutes, p95 latency above 90 seconds, rate-limit spikes, or 80% of the daily spend ceiling;
- PDF rendering/download failures above 10% for 15 minutes, or any stale/unauthorized export attempt;
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

Run a tabletop before launch and every six months. At minimum simulate a role escalation, a stale or unauthorized PDF export, a leaked service key, and an unavailable AI provider.

## Degraded modes

- **OpenAI unavailable or budget cutoff:** keep saved context; show a specific retryable failure; do not duplicate jobs; allow non-AI editing and existing plan/PDF manual work.
- **Supabase unavailable:** fail closed for authorization and mutations; never use cached case data as authorization evidence.
- **PDF export unavailable:** preserve the saved plan and review state; offer retry, verify the current revision, and check rendering errors without logging case content. Uploaded forms are outside pilot scope.
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


## Interrupted plan preparation

Each stage is saved before the next begins. Reloading or returning to the plan resumes the same version; another active tab is reported as busy and polled without making a second provider request. After a connection failure, the browser makes at most three consecutive attempts; provider/quota errors require staff to choose Continue draft. Polling stops after twelve minutes and cancels on navigation. No response may hold the browser loop past its deadline.

Each server request owns a unique database lease. A lost lease expires after ten minutes; the previous request cannot release or write using a newer lease. Current generation makes one provider request per stage with a three-minute timeout; plan and overview pages request a five-minute hosting limit. Confirm that the actual hosting deployment applies that limit in the CL-41 rehearsal. Use the saved plan ID when investigating; never restart generation automatically as a new version. While a replacement is unfinished, View previous reviewed plan opens the prior version for reference. It does not authorize exporting stale content.


## AI request allowances

A phase or refinement uses two units; a chat request uses one. Each staff account can run eight phases per ten minutes (two complete plans plus two repairs), six refinements per ten minutes, and thirty chat requests per minute. The aggregate ceilings remain 120 units per user per hour and 2,000 units per deployment per UTC day. Invalid or oversized inputs are rejected before reservation. Provider attempts consume their allowance, including an incomplete or malformed model response; quota rejection and unavailable controls consume none. These allowances are request counters, not dollar limits. Set and test the approved OpenAI project spending cap and alerts before the pilot. Change limits only with service-owner approval and rerun the journey/concurrency fixtures.
