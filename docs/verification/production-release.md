# Production release checkpoint — October 15, 2026

**Release held at the user's requested stopping point:** candidate `8ace965` includes the directory snapshot fix and passes full CI, CodeQL, exact-source release preflight and the complete hosted staging workflow. The production candidate builds and generates a plan using the preserved resource directory. A subsequent plan read failed with a database statement timeout; another attempt timed out navigating to Settings. These failures are recorded below and must not be erased by a successful retry. The canonical site has not been switched. **Do not promote the superseded `7c9af9e` candidate.**

The narrow PDF, password-only account and Settings hydration fixes are implemented. The complete hosted staging workflow and account/recovery checks pass. The production database, email templates and future-deployment settings are upgraded. The live application has **not** been switched.

| Item | Recorded state |
| --- | --- |
| App source | `8ace965e86fc556844d63318680b255ca57cbff9` (runtime fix `8c614d0`; final commit corrects test synchronization) |
| Exact source checks | CI `38676628477`, attempt 2; CodeQL `38676628671`; release preflight passed |
| Hosted staging workflow | [Passed, zero browser errors, PDF visually checked](2026-10-15-hosted-directory-fix.json) |
| Hosted setup/recovery | [Passed](2026-10-15-hosted-account-recovery.json) |
| Vercel team/project | `team_wwXXIa3JR9qMrIBopTUBsG5J` / `prj_1zxzzKu8eljHJvPd6gFY3LhyxwWc` |
| Production candidate | `dpl_7TyYy3KhJREBvVer5YY4x6rLnmNh`, READY |
| Candidate URL | https://case-link-oxq4j9up0-will-sanzs-projects.vercel.app |
| Build mode | Production environment; Git-source exact SHA; `autoAssignCustomDomains: false` |
| Canonical live alias | `https://www.thecaselink.com` still maps to `dpl_4ZDwYiPntxhM6NUnmBud6dJ3yRnW` |
| Old live source | `e0cb389feaa0096175b33f05602ed72f0041c467`; not certified against the upgraded schema |
| Original database | `zpfypkizsapvsxeykmdq`, upgraded to 40 migrations; [preservation/access evidence](production-demo-upgrade.md) |
| Separate staging database | `umnbyupudhunyccqhyrp`; synthetic accounts/cases, separate AI/SMTP credentials |

A staging routing rollback rehearsal now passes: the stable preview moved from `123b74e` to the previously verified `7c9af9e` deployment and back. Both passed health/login, anonymous workspace denial, HSTS and the staging-only connection boundary. Alias read-back confirmed each target and the unchanged production domain. App, dependencies, hosting config and migrations are identical across that pair. No data or protection rules changed. [Evidence and limits](2026-10-15-staging-rollback.json). Full CI `38666170553` and CodeQL `38666170540` also passed at `123b74e`.

## Latest failures and verification

- The initial production-directory plan-start failure is fixed by removing directory phone/email values from durable generation snapshots. Existing database provenance validation supplies exact current contacts when saving steps. A before-fix regression failed, 103 focused tests passed afterward, and the real snapshot → start → append → canonical-contact assertion passes in the full database suite and an isolated production fixture. No privacy guard, RLS policy or source-freshness check was weakened.
- Full final-source checks pass: 686 unit/component tests, seven browser scenarios, database/Auth/restore/legacy-upgrade/PDF checks. The first remote database job failed during infrastructure setup (registry rate limit/occupied port), before tests; retrying only that failed job passed. No gate was removed. A separate Vercel test timing failure was fixed by waiting for React's existing effect cleanup; no product behavior or assertion was removed. [Exact candidate evidence](2026-10-15-final-candidate-checks.json).
- Final staging generation/refinement/assistant timings were 22.164 / 3.428 / 6.514 / 3.853 seconds. The two-page reviewed PDF matches its preview byte-for-byte and was visually inspected. All disposable fixtures were removed. This staging directory is empty, so it is not evidence for production resource usefulness.
- The production candidate generated three saved steps in about 25 seconds, with 24 matches from the 54-resource catalog. Reopening the plan then hit PostgreSQL `57014` in `get_family_plan_snapshot` (edge origin 12,837 ms). A separate one-step fixture passed five direct snapshot reads in 273–411 ms. A later browser attempt passed login but timed out loading Settings; the matching provider log window contains no database cancellation or Vercel runtime error. Its cause is unresolved. [Plan-read failure](2026-10-15-production-plan-read-timeout.json), [Settings navigation failure](2026-10-15-production-navigation-timeout.json).
- The final bounded production attempt **passed** at 04:19:51–04:21:51 UTC: password login/Settings, minimal intake, four saved steps, live generation and both refinements, recovered edits, exact action identity/date/progress preservation, human review, byte-identical preview/download, assistant and logout. Three full plan reloads took **1.853 / 1.143 / 1.070 seconds**. AI timings were **24.024 / 3.941 / 14.120 / 4.873 seconds**. Both PDF pages were visually inspected with no clipping, overlap or blank pages. There were no HTTP 4xx/5xx responses, unhandled browser errors or Vercel runtime errors in its window; navigation-aborted requests are counted separately. All fixtures were removed. [Complete retry evidence](2026-10-15-production-candidate-workflow.json).

The final sparse-input AI sample selected no directory contacts; it proposed clarification and follow-up rather than claiming a referral or eligibility. The assistant used the saved Waiting state and asked about priorities, consent, language and safe contact. The 24 matches prove use of the preserved directory; exact selected-contact persistence is demonstrated by the separate database regression. This is still not school usefulness sign-off or a representative latency percentile. Password token issuance took 7.312 seconds and full-plan refinement 14.120 seconds in the final run; performance remains part of the timeout follow-up.

These observations do not justify increasing global timeouts, weakening access controls or guessing at an index/query rewrite. Obtain representative execution timings and a bounded reproduction before changing the database. The official authenticated testing access is approved and works; no protection change or new bypass credential is needed.

## Immediate remaining release work

1. Resolve or adequately bound the observed production timeouts using the existing exact-source candidate. Preserve their failure evidence. If a code/query fix is needed, include a regression, run the exact new SHA's checks and rebuild a production candidate without canonical-domain assignment. Do not disable protection or create a new bypass secret.
2. Complete the representative production-candidate reliability check with disposable **standard staff** and cases: password login, intake, the preserved 54-resource directory, all four AI paths, repeated reads, saved edits, review and actual PDF. Check selected contacts against current matched sources and inspect the PDF. Production administrator creation was separately rejected and removed from the runner; staging/CI cover administrators. Preserve every pre-existing account/resource and clean up only test fixtures.
3. Promote this production build only after those checks pass. Never promote the staging Preview, which contains staging credentials. Verify the canonical site's headers/routing and synthetic workflow, inspect content-free error logs and observe at least 30 minutes. Record the actual deployment ID and exact source.
4. Record the first verified production baseline and its recovery procedure. Staging switching has been rehearsed; the old production build is not a certified rollback candidate because it predates the new schema/guards and retains old environment snapshots. Do not reverse the database upgrade or manufacture a duplicate deployment merely to label it a rollback. The verified encrypted database recovery point is separate from app rollback.

The user authorized the controlled release and explicitly approved the protected-test-access method. No promotion or app rollback has occurred. Do not claim that the live site is fixed or the pilot is launched. No school staff are invited.

## Remaining operating/school decisions

School approval of allowed de-identified information, resource accuracy, AI usefulness, staff access and support contacts remains separate. The current Free database plan lacks configurable timebox/inactivity limits and leaked-password screening. Recurring/off-machine backups, provider budgets/alert delivery and historical-secret exposure/rotation are not established by the successful local and hosted tests. These are recorded limits; no paid service or live key rotation was performed.
