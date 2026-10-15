# Current checkpoint — October 14 evening / October 15 UTC, 2026

Continue in `/Users/willsanz/homelessness-project`, branch `codex/school-pilot-readiness`, draft [PR #15](https://github.com/Will-Sanz/case-link/pull/15). Use the current tracker and [production release record](verification/production-release.md); older historical entries are superseded by the October 15 evidence.

## Scope and authorization

The user narrowed the work to (1) PDF pagination and removal of all CaseLink 2FA, (2) invited signup/password login/recovery and the family → AI → edits/review → PDF workflow, and (3) production settings/secrets and a controlled release. School acceptance remains separate. No passkeys, Decisions integration, form filling, Kubernetes or redesign.

The user authorized routine SQL without repeated prompts, identified the original 44 families as demo data, and explicitly approved clearing those demo cases after the verified backup/rehearsal and applying the upgrade. That transaction is complete. Preserve the 54 resources and all existing accounts. Never change the owner's existing password. Synthetic mail tests are authorized only for the owner inbox named in the chat; no school invitations. No paid plan or live-secret rotation is authorized.

Background only: no foreground apps, visible tabs, file/review/preview panels or chat navigation. Use hidden/headless tools. All seven CaseLink local Supabase services remain stopped with data preserved; keep unrelated services/port 3000 untouched. Heavy checks run in remote CI. The one-time continuation already ran; do not create a recurring automation. Use Ponytail full, normal security/correctness review and a separate deletion pass. Preserve unrelated AGENTS/design/skill/output files and stage exact paths only. Commit/push each completed item; use `HUSKY=0 git push` to keep heavy pre-push checks off the workstation, then inspect remote CI.

## Completed and verified

- App candidate **`7c9af9e572e33fcf72b3f6354740977269b50738`**: PDF pagination (`07544c5`), removal of all application MFA (`323314c`), Settings locale/timezone hydration fix (`7c9af9e`). Exact candidate CI `38661759322`, CodeQL `38661759321`, release preflight and hosted workflow pass.
- Hosted staging: password-only staff/admin, minimal intake, live generation/action refinement/full-plan refinement/assistant, recovered unsaved edit, preserved action identities/dates/progress, review, PDF preview/download byte parity, logout and **zero browser errors**. Both downloaded PDF pages visually inspected. Staging has no resource catalog; production catalog usefulness remains to be tested.
- Hosted account flow: expired invitation, renewed invitation, deliberate confirmation, pre-password denial, password mismatch, initial password/login, independent-browser recovery, old browser/JWT/password denial, replacement password and one-time link pass. Actual owner-inbox recovery receipt passed; existing password unchanged. All disposable fixtures removed.
- Recovery: encrypted original-project backup at `2026-10-15T00:43:58.149Z`; isolated restoration reproduced **56 tables / 4,286 rows** with exact hashes. All scratch databases removed. Operator `scripts/recover-backup.ts` recovered the real archive with matching hash and private permissions; PostgreSQL read it successfully, then temporary plaintext was deleted. Two crypto regressions/typecheck/lint pass. The encrypted recovery point is in the operator's private `~/.local/share/caselink/backups/`; key is in macOS Keychain (`CaseLink database backup`). Provider-owned default grants were excluded from the drill; ongoing/off-machine backup is not established.
- Original project **`zpfypkizsapvsxeykmdq`**: approved transaction removed 44 demo families and linked data, applied 21 missing migrations, checked 67 constraints and reconciled 40 migration records through `20261014230221`. Preserved all 54 resources, 11 application accounts, 13 Auth accounts and original retained fields/identities. Independent read-back: no public table without RLS, no anonymous privileged-function execution, zero factors/scratch databases. Two standard disposable staff/cases passed ownership isolation, foreign-write denial, offboarding/reassignment, refresh/sign-in denial and retained-token denial after logout; all fixtures removed.
- Production Auth/email: invitation-only, secure changes, 14-character mixed passwords, 15-minute/eight-digit email codes, exact www origin/callback, refresh rotation, password-only policy. Passkeys/SMS/AAL1 deadline disabled; actual standard-staff TOTP enrollment rejects with `mfa_totp_enroll_not_enabled`. All 13 templates saved/reloaded and seven notices enabled. Existing Resend SMTP works; actual owner-inbox recovery mail passed SPF/DKIM and correct fragment-only link. No existing credential changed.
- Production environment: eight Config settings verified, existing production OpenAI Secret retained, `SUPABASE_SERVICE_ROLE_KEY` and obsolete PDF flag removed from future web deployment configuration. Staging has separate branch-scoped database/AI/SMTP. No Secret value printed or rotated. Old deployment snapshots still exist.
- Later checkpoint **`1217e1d`** passed full CI **`38665144461`** and CodeQL **`38665144419`**: **686 unit/component tests**, seven browser scenarios, database/Auth/restore/legacy/PDF checks. Commits after the app candidate add only recovery tooling and evidence; no app runtime changes. Subsequent documentation commits have their own CI runs.

Full CI **38666170553** and CodeQL **38666170540** subsequently passed at **123b74e**. A staging routing rollback from that deployment to the verified `7c9af9e` and back also passed health/login, sign-in enforcement, HSTS and the staging connection boundary. The production alias stayed unchanged. See `docs/verification/2026-10-15-staging-rollback.json`; production rollback compatibility is still distinct.

## Latest: production-directory defect found and fixed

The user explicitly approved existing authenticated testing access. It succeeded without any protection changes/new bypass secret. The candidate `7c9af9e` then failed plan creation: the saved resource catalog included phone/email identifiers, correctly rejected by database privacy checks. The shared snapshot now strips those contact values; existing source/version checks and database canonicalization restore exact contacts on step save. A before-fix regression failed; 103 focused tests, typecheck/lint and a disposable standard-staff production database regression passed. Full remote CI and a new exact-source hosted candidate are required. Do not promote `7c9af9e`. See the two `2026-10-15-production-*-regression/failure` records and CL-23.

## Live release is still pending

Production candidate **`dpl_2bGrr5VGVTrqdRtwRzGq2tu57zpi`** is READY at `https://case-link-p0ljvv1lh-will-sanzs-projects.vercel.app`. It is a Git-source build of exact app commit `7c9af9e`, **target production**, made with `autoAssignCustomDomains: false`.

The canonical **`www.thecaselink.com`** still points to **`dpl_4ZDwYiPntxhM6NUnmBud6dJ3yRnW`**, old source `e0cb389feaa0096175b33f05602ed72f0041c467`. The database is upgraded but the old application has not been certified against it. Do not tell the user the live site is fixed or the pilot is ready. Do not blindly roll back to that old build after release.

The candidate's headless entry failed because the staging OIDC testing path does not authorize protected Production. It stopped before any account or application request. Automatic approval review then rejected the official CLI test-access-cookie probe before execution. The user subsequently approved that exact existing-access method; the probe and login passed. No protection settings or bypass secrets changed. The subsequent plan-start failure supersedes the original candidate readiness.

Automatic review separately rejected creating a synthetic administrator in production. That step was removed from the prepared runner; safer standard-staff verification passed. Administrator tests remain in staging/CI. Do not restore the rejected production-admin step.

## Next actions after the directory fix

1. Check full remote CI and create a new exact-source production candidate without canonical-domain assignment, then use the authorized existing Vercel access only. Check the official CLI probe first; do not create a new bypass secret if none exists. The prepared probe is `/tmp/caselink-production-protection-probe.mjs`. Its output is allowlisted metadata only. Do not print cookies/tokens or inject them into unrelated origins.
2. Update the prepared **standard-staff-only** `/tmp/caselink-production-workflow.mjs` to use the approved access method and run it against the immutable production candidate. It uses disposable accounts/cases, preserves resources, checks current source contacts, exercises all four live AI paths and downloads a reviewed PDF. Inspect actual output and rendered PDF; record failures honestly, clean only those fixtures. The first blocked attempt is under `/tmp/caselink-production-workflow/result.json`.
3. Promote only after production checks pass; verify canonical headers/routing/core workflow, inspect sanitized errors and observe 30 minutes. Establish/test a compatible rollback candidate without reversing the upgraded database or reviving old secret snapshots. Never promote the staging Preview.
4. Record exact evidence in tracker/release doc, update draft PR, commit/push and inspect final CI. Leave school/resource/AI-usefulness acceptance and external operational gaps explicit.

## Provider limits and remaining outside decisions

Free Supabase does not allow the runbook's 12-hour timebox/2-hour idle limits or leaked-password screening. Access tokens expire in one hour; refresh rotation is enabled; explicit logout and offboarding revoke database access immediately. No upgrade purchased. Production advisors return **31 warnings**: 29 intended authenticated/guarded RPCs, disabled MFA per user choice, and the unavailable leaked-password check. Their dispositions are recorded; this is not a zero-warning result.

Recurring/off-machine backups, provider budgets/alert delivery, historical secret exposure/rotation, named support/privacy owners and school approval of de-identified data/resource accuracy/AI usefulness are not proven by engineering tests. Do not add a platform overhaul to resolve these. Report the concrete limits and keep real school invitations closed.

## Tool locations and sensitive handling

- Vercel CLI: `/Users/willsanz/.npm/_npx/67eb4586ca667318/node_modules/vercel/dist/index.js`; team `team_wwXXIa3JR9qMrIBopTUBsG5J`, project `prj_1zxzzKu8eljHJvPd6gFY3LhyxwWc`.
- Supabase CLI: `/Users/willsanz/.npm/_npx/ee16f90ef32459c3/node_modules/supabase/dist/supabase.js`; fixed operator workdirs `/tmp/caselink-production-operator` and `/tmp/caselink-staging-operator`. Use official signed-in CLI; keys stay only in memory. Do not redirect destructive local suites to hosted projects.
- Staging project `umnbyupudhunyccqhyrp`; stable preview `https://case-link-git-codex-school-pilot-readiness-will-sanzs-projects.vercel.app`. Original staging owner and Family 901 preserved.
- Native PostgreSQL clients `/opt/homebrew/opt/libpq@17/bin/`; CA `/tmp/caselink-supabase-ca.crt`; TLS verification stays enabled. Docker was not restarted.
- Read `docs/verification/production-release.md` and dated JSON evidence before rerunning completed work. Temporary operator scripts hold no literal secrets; do not publish raw provider responses or backup contents.
