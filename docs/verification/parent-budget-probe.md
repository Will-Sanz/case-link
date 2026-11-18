# Non-consuming database budget verification

Verified November 3, 2026. Root independently reviewed the security script's budget change for correctness/security and then ran a separate Ponytail pass; no blockers. No native database, hosted configuration, real reservation or paid model call was changed by these verification runs.

The two `parent_reserve_ai_call` sites in `scripts/test-parent-database-security.ts` now share one transaction. The probe holds the existing model-cap advisory lock, reads the configured remaining capacity using the same maximum of reservation count versus execution-plus-assistant counts, and reserves at most the lesser of that capacity and the request's 12-call allowance. The next call must be denied, including when capacity was already zero. A savepoint rollback removes every probe insert and restores the original role; an assertion compares all three call/reservation counts before and afterward. The outer transaction always rolls back, including on failure. No deletion, refund or cap increase is used.

The independently installed PGlite module was `@electric-sql/pglite` 0.3.14 at `tmp/parent-sql-runtime/node_modules/@electric-sql/pglite/dist/index.js`. Its databases were fresh, in-memory instances. Commands ran from the repository root:

```sh
CASELINK_PARENT_SQL_FIXTURE_MODULE="$PWD/tmp/parent-sql-runtime/node_modules/@electric-sql/pglite/dist/index.js" npm run parent:test:db
CASELINK_PARENT_SQL_FIXTURE_MODULE="$PWD/tmp/parent-verification/budget-probe/capped-fixture.mjs" CASELINK_TEST_BUDGET_USED=2 npm run parent:test:db
CASELINK_PARENT_SQL_FIXTURE_MODULE="$PWD/tmp/parent-verification/budget-probe/capped-fixture.mjs" CASELINK_TEST_BUDGET_USED=12 npm run parent:test:db
```

The temporary diagnostic fixture module subclasses that PGlite module and, before the script's first `select to_regclass('public.parent_requests') configured`, seeds only its new in-memory database with `model_call_limit=12`, `model_budget_started_at=now()-interval '1 minute'`, and 2 or 12 synthetic rows in `parent_private.model_call_reservations`. It never opens a native connection or changes shared test configuration. This wrapper is diagnostic input, not a second shipping test framework; the assertion-based security script remains the runnable verification.

## Explicit local reservation amendment · November 3, 9:12 p.m. EST

The original isolated window had 12 retained reservation rows: two actual planning calls and ten rows from the old security fixture, which made no model calls. The rows have no individual operation identity and were retained. After independent normal/security and separate Ponytail review, the local launcher accepts a maximum of 22 reservation slots. Its 33 focused configuration/lifecycle tests cover exact window preservation, rejection above that ceiling and denial at exhaustion.

One explicit local administrative amendment changed the isolated database limit and owner-only runtime metadata from 12 to 22. Both counts remained exactly 12 reservations, two planning calls and zero assistant calls. This leaves at most ten further actual calls, preserving the original intended total of twelve actual calls while accounting for the ten test reservations. No row was deleted, no counter reset, no model call made and no service started.

The original budget start remains `2026-11-03T22:16:48.925Z`; processing approval still expires `2026-11-04T21:11:25.432Z`. Every other processing control was compared before/after and remained identical. The runtime file remains 0600 with unchanged credentials. This is a documented one-time local amendment under the owner's authorization to complete the work, not a fixture behavior or hosted/pilot renewal. Content-free evidence is retained in `tmp/parent-verification/local-model-reservation-amendment.json`.

| Fixture | Available successes | Next call | Counts after rollback | Full script |
| --- | ---: | --- | --- | --- |
| Uncapped | 12 | Denied by request allowance | Unchanged | 179 recorded assertions passed |
| Cap 12, two prior reservations | 10 | Denied by global capacity | Unchanged | 179 recorded assertions passed |
| Cap 12, already full | 0 | Denied immediately | Unchanged | 179 recorded assertions passed |

Changed-file ESLint, shared TypeScript checking and whitespace checks also passed. PGlite does not prove multi-connection races or native Supabase Auth/Storage behavior. Root review precedes a separate authorized native rerun; these results do not refund previously committed reservations.
