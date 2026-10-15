# Production release checkpoint — October 15, 2026

The narrow PDF, password-only account and Settings hydration fixes are implemented. The complete hosted staging workflow and account/recovery checks pass. The production database, email templates and future-deployment settings are upgraded. The live application has **not** been switched.

| Item | Recorded state |
| --- | --- |
| App source | `7c9af9e572e33fcf72b3f6354740977269b50738` |
| Exact source checks | CI `38661759322`, CodeQL `38661759321`, release preflight passed |
| Hosted staging workflow | [Passed, zero browser errors](2026-10-15-hosted-candidate-workflow.json) |
| Hosted setup/recovery | [Passed](2026-10-15-hosted-account-recovery.json) |
| Vercel team/project | `team_wwXXIa3JR9qMrIBopTUBsG5J` / `prj_1zxzzKu8eljHJvPd6gFY3LhyxwWc` |
| Production candidate | `dpl_2bGrr5VGVTrqdRtwRzGq2tu57zpi`, READY, `iad1` |
| Candidate URL | https://case-link-p0ljvv1lh-will-sanzs-projects.vercel.app |
| Build mode | Production environment; Git-source exact SHA; `autoAssignCustomDomains: false` |
| Canonical live alias | `https://www.thecaselink.com` still maps to `dpl_4ZDwYiPntxhM6NUnmBud6dJ3yRnW` |
| Old live source | `e0cb389feaa0096175b33f05602ed72f0041c467`; not certified against the upgraded schema |
| Original database | `zpfypkizsapvsxeykmdq`, upgraded to 40 migrations; [preservation/access evidence](production-demo-upgrade.md) |
| Separate staging database | `umnbyupudhunyccqhyrp`; synthetic accounts/cases, separate AI/SMTP credentials |

A staging routing rollback rehearsal now passes: the stable preview moved from `123b74e` to the previously verified `7c9af9e` deployment and back. Both passed health/login, anonymous workspace denial, HSTS and the staging-only connection boundary. Alias read-back confirmed each target and the unchanged production domain. App, dependencies, hosting config and migrations are identical across that pair. No data or protection rules changed. [Evidence and limits](2026-10-15-staging-rollback.json). Full CI `38666170553` and CodeQL `38666170540` also passed at `123b74e`.

## Immediate remaining release work

1. Obtain the pending approval for Vercel's authenticated testing access to the protected candidate. The initial short-lived OIDC attempt failed at entry before account creation or application requests. Automatic approval review rejected the proposed official-CLI cookie probe before execution because that specific access method was not approved. Do not disable protection, create a new bypass secret, or use an indirect workaround.
2. After approval, test the exact production candidate with disposable **standard staff** and cases: password login, intake, the preserved 54-resource directory, live AI generation/refinements/assistant, edits, human review and actual PDF. Check saved contacts against current matched directory sources and inspect the PDF. Production administrator creation was separately rejected and removed from the runner; staging/CI already cover administrators. Preserve every pre-existing account/resource and clean up only the test fixtures.
3. Promote this production build only after those checks pass. Never promote the staging Preview, which contains staging credentials. Verify the canonical site's headers/routing and synthetic workflow, inspect content-free error logs and observe at least 30 minutes. Record the actual deployment ID and exact source.
4. Establish a compatible application recovery candidate and verify switching behavior. Do not blindly roll back to the old live build or reverse the database upgrade. It predates the new schema/guards and retains old environment snapshots. The verified encrypted database recovery point is separate from app rollback.

The user authorized the controlled release but has not yet answered the specific protected-test-access question. No promotion or app rollback has occurred. Do not claim that the live site is fixed or the pilot is launched. No school staff are invited.

## Remaining operating/school decisions

School approval of allowed de-identified information, resource accuracy, AI usefulness, staff access and support contacts remains separate. The current Free database plan lacks configurable timebox/inactivity limits and leaked-password screening. Recurring/off-machine backups, provider budgets/alert delivery and historical-secret exposure/rotation are not established by the successful local and hosted tests. These are recorded limits; no paid service or live key rotation was performed.
