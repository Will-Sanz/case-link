# Pilot readiness continuation — October 14, 2026

The user asked on October 13 evening to finish the intake-to-plan bug, save the remaining work, and continue tomorrow. Resume at 9:00 a.m. America/New_York on October 14. Finish all authorized engineering work, check and iterate after each item, and commit/push each item. Do not equate a repository checkpoint with a production-ready pilot.

## Starting point

- Repository: `/Users/willsanz/homelessness-project`; branch `codex/school-pilot-readiness`.
- Draft [PR #15](https://github.com/Will-Sanz/case-link/pull/15) is already attached to this chat. Update its description after the remaining work, keeping it draft until launch gates are evidenced.
- [The main tracker](school-pilot-fix-tracker.md) is the source of truth: 32 closed records, nine required open records, and one optional Decisions evaluation. Closed engineering records still require final candidate regression evidence.
- Follow AGENTS.md: full Ponytail, normal correctness/security/privacy/accessibility review, separate deletion review, and runnable regression tests for non-trivial changes. Read installed Next.js guides before edits. No subagents have been requested.
- Preserve unrelated untracked design/skill files and artifacts. Stage explicit paths. Do not edit while the push verification hook is running.
- User approved continuing with the current resource directory and updating its CSV later. Do not require a replacement. The committed seed is explicitly synthetic; preserve it, exclude labelled Demo/inactive rows from real recommendations, and do not claim contact validation from a seed alone.

## Tonight's completed fix and test checkpoint

Intake used labels that did not exactly match the planning presets, so a newly created family arrived with its barriers silently dropped. The shared workflow mapper now displays unmatched saved labels as additional barriers; known intake labels keep their exact resource-matching keys on save. It does not convert a general health barrier into a mental-health/substance-use diagnosis. Newline separates custom barriers; punctuation remains part of a label. Overlong labels return a recoverable error rather than silently losing their ending.

- 17 added unit/rendered regression cases failed before the fix; all 26 focused cases pass afterward.
- Local production-build browser invitation → initial password → sign-in → separate-browser password reset → old-session denial → one-time-link rejection passes.
- Local production-build browser intake with all twelve presets → generation → persisted plan passes, with every original label and matching key retained.
- CL-08 remains open; the latest broader-browser failure is recorded below.

### Browser harness

`tests/e2e/run.mjs` builds with local/synthetic configuration and launches Next on **127.0.0.1:3100**. `tests/e2e/local-stack.mjs` rejects nonlocal database/auth/mail targets. The test app gets no service-role/database credential; test-only provisioning uses the isolated stack. `provider-fixture.mjs` is a Node preload for the test command, never an application feature flag. It checks strict output and `store: false`, blocks external outbound requests, and returns deterministic AI contracts. These tests do not establish live-model quality.

`auth.spec.ts` and `intake.spec.ts` pass. `workflow.spec.ts` is the next active investigation. It now passes interruption/resume with two tabs, recovery of an unsaved edit after refresh, a persisted Waiting task, and title-only AI proposal/application. It then fails its scoped assertion for the Waiting explanation after application (`workflow.spec.ts:56`). The accessibility snapshot still shows the Waiting status and the exact explanation, so investigate the selector/article scope and actual DOM before assuming data loss. Review confirmation/focus, identical preview/download bytes, and assistant checks later in this test have not run. Its unfinished assertions must be completed, not skipped to make a release green.

The run also emitted one sanitized “permission denied for table families” error after an earlier test completed. Check for background prefetches racing synthetic-user cleanup and close browser pages before deleting their accounts if confirmed. Do not weaken authorization to silence it.

Local mail is configured for port 3000. The test asserts the delivered canonical origin and maps only the port to 3100 for the dedicated browser server. Real hosted-domain/redirect and school-mail-scanner checks remain CL-16/CL-41. Do not stop the unrelated application already using port 3000.

```sh
# Start only CaseLink's isolated local stack if it is stopped.
npx --yes supabase@2.111.0 start

# Browser runner builds before testing; optional filename selects a focused run.
npm run test:e2e
npm run test:e2e -- auth.spec.ts intake.spec.ts

# Regression and security gates; use a separate production build after browser work.
npm run test:run -- src/app/actions/barrier-workflow.test.ts src/features/families/family-lite-workspace.test.tsx
npm run test:db-security
npm run test:auth-security
npm run test:pdf
npm run verify
```

On this Mac, `CASELINK_SUPABASE_CLI` may point to `/Users/willsanz/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase` to reuse CLI 2.111.0. Docker socket operations require the existing escalation path. Do not dump Supabase status/start output: it contains local credentials. Browser logs/results are ignored under `tmp/e2e`; synthetic screenshots only. Earlier metadata-only PDF and AI evidence is versioned under `docs/verification`.

## Remaining work, in order

1. **CL-08 — complete browser and accessibility release coverage.** Start with `workflow.spec.ts`; distinguish a bad test assumption from an application defect before fixing. Complete intake → plan → edit → human review → actual PDF download. Cover interrupted generation, returning users, concurrent/stale edits, stale PDF after another tab changes the plan, session expiry, safe same-account draft recovery and account-switch clearing, MFA enrollment/challenge, keyboard focus, errors/labels, narrow viewport and 200% zoom. Add CI browser execution only when the independent suite is reliable; never hide a failing scenario. Existing database/Auth tests do not replace browser evidence.
2. **CL-34 — repeatable live AI safety/usefulness evaluation.** Version the first 25 synthetic development cases and at least 50 performance cases with held-out cases; cover generation, both refinement paths, and assistant. Deterministically check schema/IDs/dates, source-backed contacts, privacy, protected edits, failure behavior, and human approval. Include sparse/resource-poor, long/contradictory context, completed/Waiting work, contact restrictions, prompt injection, and high-risk synthetic cases. Record actual latency/token cost and failure cases against the PRD targets. Existing 8- and 10-case live API contract checks are not a usefulness evaluation. School reviewers must assess usefulness and editing effort; do not manufacture their scores.
3. **CL-36 — operations and recovery.** Reconcile the export-only runbook, including the stale uploaded-PDF rejection check at its current line 64. Prepare and run a safe synthetic local restore rehearsal; collect hosted backup/retention/restore and alert evidence where access permits. Record migration/settings inventory, incidents/support owners, dependency health, recovery targets and vendor/data controls. Local recovery does not establish hosted recovery.
4. **CL-41 — managed hosting and release controls.** Verify existing Vercel projects before creating anything. Align Node/runtime expectations (CI uses Node 20; inspected Vercel project used 24). Verify isolated synthetic staging, required checks on the exact candidate, rejected-check behavior, the hosted auth-to-PDF journey, and compatible rollback. Check current dependency advisories, including newly installed test tools. Prefer Vercel + Supabase for this pilot; Kubernetes remains unnecessary.
5. **CL-42 — production secret isolation and recovery.** Finish the non-secret inventory and verify environment boundaries, least-privileged operator access, client/log/build leakage checks, and synthetic rotation/revocation rehearsal. Runtime web requests should not receive service-role/database admin credentials. Do not print `.env.local`, pull production secrets into a dev build, or rotate live credentials without an authorized concrete rollout.
6. **CL-16 — actual hosted account email.** Local templates, link confirmation, delivery, recovery, secure changes, expiry/resend and browser behavior are implemented. Still verify actual hosted templates, SMTP, canonical HTTPS origin/redirects, synthetic school mailbox and its link scanner. Do not send real staff invitations before release approval.
7. **CL-38 — hosted authorization and one-school boundary.** Local retained-token, offboarding, MFA, RLS/grants, transactions and scale checks passed. Re-run on an isolated hosted candidate with synthetic accounts, verify its migration state and least-privilege assignments, and record dedicated-school separation. Do not claim local evidence proves production configuration.
8. **CL-01 and CL-33 — school approval and directory acceptance.** Engineering privacy controls and resource administration/provenance are implemented. Obtain/record the approved data examples, retention/access/vendor/incident decisions, training and resource owner, geographic coverage and current contacts. Continue using the existing directory per the user's instruction. These external decisions remain launch gates, not fabricated engineering checkmarks.
9. **CL-40 — optional Decisions API experiment.** The user meant the newly released Decisions API, not Responses. Verify current official documentation/account access; compare an offline synthetic, human-labelled advisory experiment against deterministic checks and existing workflow. Record adopt/defer reasoning, calibration, missed defects, false alarms, latency/cost and endpoint-specific data handling. It must never silently approve or mutate a plan. This optional experiment does not block the pilot.
10. **Final release audit.** Run complete unit/component, database/Auth, browser/a11y, AI evaluation, rendered-PDF, dependency, secret, type/lint and build checks on the candidate. Reconcile every tracker record and the PR description. Record hosted/school blockers explicitly; do not label the pilot ready before required gates pass. Commit and push each item with evidence. Stop only CaseLink local services at the end.

## Environment facts and boundaries

- Local Supabase API 54321, database 54322, mail 54324; project ID `caselink`. Last clean reset included `20261014012912_contact_provenance.sql`. Database security suite and advisors passed afterward; Auth passed after the CL-33 reset. Re-run both on the final candidate.
- Last completed PDF record: `19f2c5f` (CL-35), 650 unit/component tests and full build passed. The four-case corpus checked 368 source fields across 15 pages with text/layout/monochrome checks and visual inspection. Unsupported glyphs fail safely; multilingual font expansion needs explicit scope.
- PDF verification needs Python and Poppler; on this Mac, use the bundled workspace runtimes if absent from PATH. Previous runs used `/tmp/caselink-fonts.conf` for font configuration. Keep PDF test intermediates out of commits.
- Vercel project previously inspected: `prj_1zxzzKu8eljHJvPd6gFY3LhyxwWc`, team `team_wwXXIa3JR9qMrIBopTUBsG5J`. Hosted Supabase `zpfypkizsapvsxeykmdq.supabase.co` was unreachable to read-only checks; the connector exposed only an unrelated inactive project. Establish the correct accessible project before hosted checks or mutations.
- `.env.local` contains real provider credentials. Never print it. Do not capture raw account links/tokens or real narratives in test output. Never use real family data for evaluation.
- Production deployment/promotion, paid purchases, live secret rotations, hosted migrations/settings and real staff invitations have not been performed. Complete reviewable preparation first; preserve the authorized scope and distinguish access/approval needs from code defects.
- Preserve unrelated Docker containers (including pace-mini-db and saybase services) and the unrelated application on port 3000. Stop only CaseLink with the project-specific Supabase CLI after verification, preserving local data.

## Final checkpoint results

- Full browser command: **two passed, one failed** (37.1 seconds), from `/tmp/caselink-e2e-checkpoint.log`. The failing workflow remains enabled and is the first task tomorrow; its snapshot is in `tmp/e2e/results/workflow-case-intake-throu-a9b22--and-the-exact-PDF-download-chromium/error-context.md`.
- Full `npm run verify` passed: lockfile/resource-seed/secret checks, typecheck, lint, **667 unit/component tests across 75 files**, and production build. Log: `/tmp/caselink-cl08-checkpoint-verify.log`. The push hook requires the same gate again; this gate currently does not include the unfinished browser suite.
- CaseLink's isolated local Supabase services were stopped with their data preserved. Docker and unrelated project services were left running. Restart only the CaseLink stack for tomorrow's database/browser work.
- One-time in-thread continuation automation: `finish-caselink-pilot-readiness`, scheduled for October 14 at 9 a.m. America/New_York. Do not create a duplicate recurring task.
