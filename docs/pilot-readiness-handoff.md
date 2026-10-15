# CaseLink pilot checkpoint — October 15, 2026

## Later QA work: AI preparation upgrade

The later user-authorized AI upgrade is verified in isolated QA on source `f0ed2be84b77ea08706d00c5e8991a596b25cd68`. Its current status, model comparison, failures and final acceptance evidence are maintained in [the AI upgrade record](verification/2026-10-15-ai-upgrade.md). QA now has 43 migrations; the two additions enable compact generation and an explicit manual handoff after AI failure. These changes have not been promoted to production.

The production alias was read back during this work at `dpl_FesLWbGr9B5jYCs1gwQYpdEtb7uL`, source `2dfb8b83ce93b60e1a8bdc859f65d240d0eb821c`. PR #15 remains draft and unmerged. The earlier release checkpoint below is historical; its source, migration counts and statement that no work is queued describe that earlier checkpoint.

## Earlier production release checkpoint

Continue only within the user-approved narrow pilot scope. Repository: `/Users/willsanz/homelessness-project`, branch `codex/school-pilot-readiness`, draft [PR #15](https://github.com/Will-Sanz/case-link/pull/15). The current release record is [production-release.md](verification/production-release.md); the full historical findings remain in [the tracker](school-pilot-fix-tracker.md).

## Current state

**The main site now serves the verified production build.** `https://www.thecaselink.com` maps to `dpl_8BAZJwJQEqFG7RkjykwuwyrXGEU8`, exact source **`9e7d0e29aa556eb780b96e04e6d4c5ef8511e19b`**. It was built with production settings, tested at its protected immutable address, then promoted after the user's explicit approval. The public health/login, closed signup, anonymous workspace denial, apex redirect and security-header checks pass.

**Canonical verification passed:** the full live workflow ran 15:02:52.672–15:04:14.052 UTC, including all four AI paths, preserved edits, repeated reads, human review and the visually inspected two-page PDF. No browser/HTTP error was recorded, and all disposable fixtures were removed. [Canonical evidence](verification/2026-10-15-canonical-workflow.json).

**Release observation complete:** 11:02:54–11:32:54 a.m. America/New_York on October 15 (15:02:54–15:32:54 UTC). All **45 probes** passed over 30 minutes; no Vercel error/fatal entries appeared in that window. Alias read-back still identifies the same released build. [Observation evidence](verification/2026-10-15-release-observation.json). The hidden browsers and temporary test/observation runners are finished; Docker/local CaseLink services were never restarted.

**No further autonomous launch work is queued.** The narrow engineering/release task is complete, and the one-time automation remains paused. School/operating decisions below are still open. The evidence checkpoint `15d5f18` passed CI **38758405925** and CodeQL **38758405788**. Further evidence-only commits do not require a new production deployment.

The deployed source is pinned; later evidence-only commits do not imply a different live build. PR #15 remains draft and unmerged. Do not merge or publish another build merely to update documentation.

## Scope and operating preferences

The user narrowed work to (1) PDF pagination and removing all CaseLink 2FA, (2) invited account setup, password login/recovery and intake → AI → edits/review → PDF, and (3) production settings/secrets and a controlled release. School acceptance is separate. No passkeys, Decisions integration, uploaded-form filling, Kubernetes or redesign.

- Work entirely in the background. Never open visible tabs/panels, bring apps forward or change the active chat. Use hidden/headless tools only.
- Keep Docker and the seven CaseLink local Supabase services stopped, with data preserved. Do not stop unrelated services or port 3000. Use remote CI for heavy checks.
- Routine SQL is authorized. The user explicitly approved the 44-demo-case cleanup and upgrade and, later, this plan-loading migration and production release. The initial automatic-review rejection was respected; execution followed the new explicit approval.
- Preserve all 54 resources and all pre-existing accounts. Do not change the owner's password. Synthetic email tests are authorized only to the owner inbox named in the chat. No school invitations, paid upgrades or live-key rotations.
- Use Ponytail full and a separate deletion review. Preserve unrelated AGENTS/design/skills/output changes. Stage exact paths. Use `HUSKY=0 git push` to avoid restarting heavy local checks, then inspect CI.
- The one-time continuation automation `finish-caselink-pilot-readiness` is PAUSED. Do not restart it as a daily task.

## Verified engineering evidence

- Source `9e7d0e2`: CI **38753128811**, CodeQL **38753128797** and exact-source preflight passed. Coverage includes **686 unit/component tests**, seven browser scenarios, database authorization/concurrency, real Auth, restore/legacy-upgrade and rendered PDF checks. [Check record](verification/2026-10-15-snapshot-fix-checks.json).
- PDF pagination, all-account password-only policy and Settings locale/timezone hydration are fixed. Hosted account setup/recovery covers expired/renewed invitations, deliberate confirmation, first password, independent-browser reset, old session/password denial and link reuse. Actual owner recovery email passed SPF/DKIM and the canonical fragment-only link; the owner's password was unchanged. [Account evidence](verification/2026-10-15-hosted-account-recovery.json).
- Generation now omits directory phone/email from durable input snapshots; the existing provenance check supplies exact current contacts on save. Real-directory generation and exact selected-source checks pass. RLS/privacy/source-freshness controls remain intact.
- Both staging (`umnbyupudhunyccqhyrp`) and production (`zpfypkizsapvsxeykmdq`) have **41 migrations**, latest `20261015143343`. The plan snapshot materializes only the already-filtered result. Its regression counts action reads. A representative four-step/twelve-action production plan now reads each action once instead of eight times and returns identical full content and review hashes. Sequential and concurrent reads passed; all fixtures removed. [Migration](verification/2026-10-15-production-snapshot-migration.json), [read verification](verification/2026-10-15-production-snapshot-reads.json).
- Full current staging and production-candidate workflows pass login, minimal intake, all four live AI paths, repeated Settings/plan loads, unsaved edit recovery, selective refinement preserving action identities/dates/progress, human review, byte-identical PDF preview/download, assistant and logout. Both final PDF pages were visually inspected. The candidate's measured saves were 883/845 ms; a Settings navigation before logout took 10.561 seconds and remains a latency observation. [Candidate evidence](verification/2026-10-15-production-snapshot-workflow.json).
- Candidate cleanup read-back: **0 families, 0 plans, 54 resources, 11 application accounts, 13 Auth accounts, 0 MFA factors, no public table without RLS, no anonymous privileged-function execution, no scratch database**. Security advisors report no errors and 31 previously dispositioned warnings (29 guarded authenticated routines, user-approved MFA removal and Free-plan leaked-password screening).
- Production has eight verified Config values and one preserved write-only OpenAI Secret; staging has separate database/AI/SMTP. The web service-role key and obsolete PDF flag are absent from the new production build's settings. Existing SMTP works. [Environment inventory](verification/secret-isolation.md).

## Failures retained and their limits

Earlier overnight testing recorded a plan-read statement timeout and a 30-second Settings navigation timeout. The later query measurement proved unnecessary repeated plan work, not the sole cause of every delay. No RLS weakening or global timeout increase was made. Both original failures remain in the release record.

The first new candidate run hit the temporary test's five-second save assertion while Saving was displayed. Cleanup aborted the request and deleted the synthetic account; an authentication error followed. The next run used a bounded 30-second assertion and passed, with measured sub-second saves. No application change or assertion removal was needed. Preserve [the failed attempt](verification/2026-10-15-production-save-test-cutoff.json). The Supabase log connector denied access in this run; do not claim its database logs were clear. Vercel's error/fatal scan for the successful candidate window returned no entries.

## Recovery and remaining human decisions

This release is the **first verified production baseline**. Never roll back to the old `e0cb389` or superseded candidates merely because they are listed by the provider: they predate current schema/privacy guards and may retain old environment snapshots. For a future application regression, verify this baseline remains compatible with then-current schema/secrets before promoting it; never reverse data migrations blindly. Staging alias switching and restoration were rehearsed separately.

The original pre-cleanup encrypted recovery point restored **56 tables / 4,286 rows** with identical hashes. Its file is in the private `~/.local/share/caselink/backups/` directory; its key is in macOS Keychain under `CaseLink database backup`. `scripts/recover-backup.ts` was tested against the actual archive. It is a recoverable historical point, not a recurring or off-machine backup process.

Before routine real-case use, the school/service owner still needs to accept the de-identified data boundary, resource accuracy, AI usefulness, staff list, training/support contacts and residual risks. Recurring/off-machine backups, provider spending/alert delivery and historical-secret exposure/rotation remain explicit operating gates. Free Supabase lacks configurable timebox/inactivity limits and leaked-password screening. No paid upgrade, secret rotation or school invitation was performed. The live release and synthetic test success do not supply school sign-off.
