# Production release — October 15, 2026

**Live:** [www.thecaselink.com](https://www.thecaselink.com) now serves the approved production build. The complete candidate and canonical-site synthetic workflows pass. The required **30-minute observation is in progress**; its final result is still required before closing this release checkpoint.

This completes the actual publishing step for the user's narrow scope: corrected PDF pagination, password-only CaseLink accounts, verified invitation/recovery and core casework, and production configuration. School acceptance of real-case use remains separate. No school staff were invited, paid service purchased or live secret rotated.

| Item | Verified state |
| --- | --- |
| Live source | `9e7d0e29aa556eb780b96e04e6d4c5ef8511e19b` |
| Exact-source checks | CI **38753128811**, CodeQL **38753128797**, release preflight before build and again before promotion |
| Test coverage | 686 unit/component tests; seven browser scenarios; database/Auth/concurrency/restore/legacy-upgrade/rendered-PDF checks |
| Production deployment | `dpl_8BAZJwJQEqFG7RkjykwuwyrXGEU8`, READY, production environment |
| Immutable candidate | `https://case-link-5r6jnsdzo-will-sanzs-projects.vercel.app` |
| Canonical promotion | Alias read-back confirms the exact build; updated **15:01:54.806 UTC** |
| Vercel team/project | `team_wwXXIa3JR9qMrIBopTUBsG5J` / `prj_1zxzzKu8eljHJvPd6gFY3LhyxwWc` |
| Production database | `zpfypkizsapvsxeykmdq`, **41 migrations**, latest `20261015143343` |
| Separate staging | `umnbyupudhunyccqhyrp`, same 41 migrations, synthetic cases and separate AI/SMTP credentials |
| Canonical cleanup | 0 families/plans, 54 resources, 11 application accounts, 13 Auth accounts, 0 MFA factors/scratch databases |
| Access read-back | No public table without RLS; no anonymous privileged-function execution |
| Branch and PR | `codex/school-pilot-readiness`; [PR #15](https://github.com/Will-Sanz/case-link/pull/15) remains draft/unmerged |

The build was created without assigning production domains, tested at its immutable address, then promoted after the user's explicit approval. It is a production build, not the staging Preview. Evidence-only commits after `9e7d0e2` do not change the live source. [Promotion](2026-10-15-production-promotion.json), [source checks](2026-10-15-snapshot-fix-checks.json), [authorization](2026-10-15-production-approval-gate.json).

## What passed on the live site

The canonical browser test ran **15:02:52.672–15:04:14.052 UTC** with a disposable standard-staff account and synthetic family. It passed real password login, five Settings reloads, minimal intake, live plan generation using the preserved directory, three plan reloads, unsaved edit recovery, action and full-plan AI refinement, exact preservation of action identities/dates/progress, human review, PDF preview/download, assistant and logout. Automated accessibility checks and browser-error checks passed. Test fixtures were removed, and an independent aggregate query verified retained counts and permissions. [Complete evidence](2026-10-15-canonical-workflow.json).

| Canonical measurement | Result |
| --- | --- |
| Live generation | 24.045 seconds |
| Action / full-plan refinement | 3.446 / 4.984 seconds |
| Assistant | 7.425 seconds |
| Two human saves | 858 / 855 ms |
| Five Settings loads | 2.438 / 2.753 / 1.670 / 0.925 / 0.700 seconds |
| Three plan reloads | 0.930 / 1.166 / 0.603 seconds |
| Reviewed PDF | 2 pages; 8,480 bytes; preview/download SHA-256 identical; both pages visually inspected |

Public checks confirm health/login 200, anonymous Families access redirects to sign-in, public signup redirects to request-demo, apex redirects to www, and HSTS/nosniff/frame restrictions/CSP use the production database boundary. The test browser needed no Vercel bypass credential at the canonical address. [Routing and headers](2026-10-15-canonical-public-checks.json).

The AI sample asked for priorities, consent, language and safe contact, respected the saved Waiting state/date and did not claim eligibility or completed referrals. The sparse-input canonical plan selected no contacts; separate production validation checked a selected contact against its actual matched source, and database regressions verify canonical contact persistence. These samples do not establish school usefulness or a population latency percentile.

The full staging and protected production-candidate workflows also pass. Earlier hosted invitation/recovery checks cover expired/renewed invitations, deliberate confirmation, initial password setup, cross-browser recovery, old-session/password denial and one-time links. Actual owner-inbox recovery mail passed SPF/DKIM and the correct canonical link without changing the owner's password. Administrator coverage is from staging/CI; the production browser runs used standard staff only. [Staging](2026-10-15-hosted-snapshot-fix.json), [candidate](2026-10-15-production-snapshot-workflow.json), [account setup/recovery](2026-10-15-hosted-account-recovery.json).

## Reliability work and retained failures

A representative four-step/twelve-action query showed each action evaluated eight times. The narrow migration materializes only the already-filtered authorized snapshot. Under live staff permissions, the same output and review hashes now require twelve action reads instead of 96; measured execution dropped from about 214 ms to about 31 ms. Five sequential and nine concurrent production reads passed after application. The regression counts executed action rows instead of enforcing a machine-dependent speed threshold. Function ownership, grants, SECURITY INVOKER, search path, RLS and existing records are unchanged. Normal security/correctness review and the separate Ponytail deletion pass found no broader rewrite necessary. [Measurement](2026-10-15-plan-snapshot-measurement.json), [production migration](2026-10-15-production-snapshot-migration.json), [production reads](2026-10-15-production-snapshot-reads.json).

The original directory generation failure was fixed by removing directory phone/email from the durable generation input snapshot. The existing database provenance check supplies exact current contacts when saving steps. A failing-before-fix regression and 103 focused tests established that repair; no privacy or source-freshness guard was weakened.

Failures remain part of the record:

- An overnight production plan read hit PostgreSQL `57014`, and a separate Settings navigation timed out at 30 seconds. The repeated-evaluation measurement demonstrates excess work, not the sole cause of every earlier delay. [Plan-read failure](2026-10-15-production-plan-read-timeout.json), [navigation failure](2026-10-15-production-navigation-timeout.json).
- The first current-candidate test stopped at Playwright's default five-second assertion while the page showed Saving. Its cleanup aborted the request and removed the synthetic account; an authentication error followed. The measured rerun used an explicit bounded 30-second save assertion and passed with 883/845 ms saves. No application timeout, security control or assertion was removed. [Failed test cutoff](2026-10-15-production-save-test-cutoff.json).
- A Settings navigation before logout in the successful candidate run took **10.561 seconds**. The canonical repeat loads were faster. Intermittent hosted latency remains an operating observation; these tests are not sustained-load certification.
- The Supabase log connector denied access during this continuation. No claim is made that its database logs were clear. Vercel error/fatal scans for the successful candidate and canonical windows returned no entries. The earlier cleanup-associated error is retained separately.

The initial automatic review rejected the production migration until separate production authorization was supplied. The user then explicitly approved the database fix and release; execution followed that approval. A previously rejected synthetic production-administrator grant was never executed. No protection setting was disabled or new bypass secret created.

## Recovery boundary

This is the **first verified production baseline**. For a future application regression, first verify compatibility with then-current schema and secrets, then deliberately promote this exact known-good deployment. Do not reverse migrations blindly. The old `e0cb389` deployment and superseded candidates are not certified rollback targets: they predate current privacy/schema controls or retain older environment snapshots. No duplicate build was manufactured to label it a rollback.

Staging alias rollback and restoration passed previously. The original pre-cleanup encrypted backup restored **56 tables / 4,286 rows** with exact hashes; the real archive was also recovered through the checked-in recovery utility. This establishes a recoverable historical point, not a recurring/off-machine backup or provider-settings restore. [Staging switching](2026-10-15-staging-rollback.json), [backup](2026-10-15-hosted-backup.json), [restore](2026-10-15-hosted-restore.json), [operating procedure](../production-operations-runbook.md).

## Remaining operating and school gates

School approval of de-identified information, resource accuracy, AI usefulness, staff access and support contacts remains open. Recurring/off-machine backup, provider budget/alert delivery and historical-secret exposure/rotation are not established. Free Supabase does not provide configurable session timebox/inactivity limits or leaked-password screening. These limits remain in the tracker; no paid plan or key rotation was performed. The production deployment does not authorize identifiable student/family records or substitute for school sign-off.

The 30-minute release observation is still running. The one-time continuation automation is paused; it must not recur daily.
