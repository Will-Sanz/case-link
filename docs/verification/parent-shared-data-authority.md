# Shared data and permission milestones

Evidence date: October 27, 2026. Work is local on `main`, under L1 in the [launch plan](../parent-launch-and-expansion-plan.md). These changes enable no new data purpose, provider, transport, enrollment or pilot window. R1 remains confirmed food access plus an adult career-support booking lifecycle; the complete L1 and R1 gates remain open.

## Affected flow and reuse map

| Boundary | Existing implementation | Rule carried into R1 |
| --- | --- | --- |
| Intake and permission | `domain.ts`, request API, `data.ts`, `mutations.ts`, guarded parent RPCs | Strict typed fields, owned requests, named recipients, bounded actions/data/duration; provider-specific new fields wait for the actual contract. |
| Saved facts and documents | `answers.ts`, correction RPCs, private documents and broker | Retain subject/purpose, provenance, freshness and permitted retention; corrections invalidate queued uses. School records and raw protected identifiers are not ordinary parent facts. |
| Agent context and planning | `coordinator.ts`, `assistant.ts`, `planning.ts` | Project only authorized request information and verified program sources; a program listing grants no execution access. |
| Preparation and execution | `policy.ts`, `application-readiness.ts`, `execution.ts`, `service.ts`, `worker-runtime.ts`, guarded operation/form RPCs | Bind every operation to its exact requested need, named program, current mandate, permitted fields/documents and real provider authority. Preserve leases, immutable packets and idempotency. |
| Evidence and recovery | Operation receipts, events, progress, exports, retention | Preparation, transport, provider acceptance and received support remain different; cancel/revoke/correct stops future superseded work. |

This map identifies actual extension points; it does not create a generic connector platform or authorize speculative career/food intake.

## Piece 1 — exact requested purpose

The application guard previously accepted a named program even when its operation purpose was absent from the request or unsupported by that program. Two database preparation routines also used a nullable compatible-need array: an explicit incompatible purpose could escape a SQL conditional when the array was empty. Form registration did not independently require the named recipient and `prepare` action.

The shared policy now requires the operation need to belong to both the request and program. An omitted need remains supported only when exactly one compatible need exists. Malformed, unknown, incompatible and ambiguous purposes fail closed. Readiness treats this as a service-owned authority failure, without inventing a family approval step.

Forward migration `20261027135314_parent_operation_purpose_binding.sql` makes preparation/form compatibility arrays non-null, checks form recipient/preparation permission, and repeats exact-purpose enforcement at dispatch. It blocks previously prepared invalid rows rather than assuming all historic preparation was valid. Existing function signatures, privileges, grants, lease checks, packet validation, artifact identity, personal acts and delivery recovery are preserved.

### Verification and independent review

- Before the fix, 15 focused application regressions failed and eight of the initial ten database cases failed, reproducing acceptance/dispatch failures.
- After the fix, **1,650 tests across 186 files passed**, including all migration-backed SQL suites. The restricted run first blocked four temporary-localhost HTTP tests; the full rerun with loopback permission passed all four as well.
- The existing database security script passed **164 assertions plus bounded-budget checks** against embedded PostgreSQL with the ordered forward migration. Coverage includes household/legacy isolation, correction, current/revoked grants, cancellation, retention and immutable operations. The new exact-purpose suite adds 12 cases, including legitimate uniquely inferred work and `prepare_only` forms.
- Independent reviewer reran **54 focused tests**, mechanically compared the three replacement SQL function bodies with their predecessors, and cleared normal correctness/security/privacy/accessibility/performance/regression review plus a separate Ponytail deletion pass.
- TypeScript, scoped lint, whitespace and secret checks passed.

Reproduce migration-backed checks explicitly; an ordinary run without this environment setting skips those suites:

```sh
CASELINK_PARENT_SQL_FIXTURE_MODULE=/private/tmp/caselink-parent-sql-check/node_modules/@electric-sql/pglite/dist/index.js npm run test:run
CASELINK_PARENT_SQL_FIXTURE_MODULE=/private/tmp/caselink-parent-sql-check/node_modules/@electric-sql/pglite/dist/index.js npm run parent:test:db
```

The module is an independently installed local test runtime, not a product dependency. Embedded PostgreSQL exercises real SQL/roles/RPC behavior, but does not establish Supabase Auth/Storage behavior or concurrent multi-connection safety. This migration has not been applied to the hosted database or running connected preview. No provider/model call, family data, external submission or visual change was involved.

### Autonomy checkpoint

No family work or routine operator task is added. Valid, uniquely inferable authorized operations still proceed automatically; a service scope error is resolved by the service rather than asking the parent to reapprove it. This piece proves an authority boundary, not food allocation or a career booking. The next smallest shared piece is permission/data parity at request mutation and execution boundaries. New provider-specific fields and real side effects still depend on L0's accepted food allocation and adult-host contracts.
