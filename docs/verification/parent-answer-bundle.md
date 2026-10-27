# One-action factual answers

October 27, 2026. Background implementation on `main`, using existing fields, purposes and account boundaries. No hosted migration, provider action, real-family intake or renewal of the expired connected preview is authorized. The [owner-needs list](../parent-owner-needs.md) retains actual partner and release dependencies.

## Piece 1 — atomic database operation

Forward migration `20261027174125_parent_atomic_factual_answers.sql` adds one authenticated factual-answer operation, bounded to the existing 30-question ceiling and 40 KB payload. It locks the owned request, checks the original version, rejects duplicate fields/partial income/extra properties, and invokes the existing validated single-answer operation in one transaction. Provider corrections execute before that account's other answers. Any failure rolls back facts, source metadata, jobs, versions and events together. Existing per-fact version/event behavior remains; workers see only the committed final version. No signature, permission expansion or booking choice is treated as a fact.

Two narrow shared-recorder corrections support the bundle: new facts use actual capture time after a same-transaction account reset, and a genuine paired income answer resolves its amount/frequency questions. Existing facts/source dates are not rewritten. [PostgreSQL's timestamp definitions](https://www.postgresql.org/docs/17/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT) distinguish transaction-start time from actual clock time; the new timing is verified through real committed account-evidence and assistant consumers.

Independent review also reproduced six accepted invalid null/unknown-provider inputs across bundle/single calls. The shared factual recorder now rejects JSON null, unknown factual provider and nested null income frequency. Packet-level unknown-provider support is unchanged. The first missing-RPC baseline established unimplemented functionality, not dozens of distinct bugs.

The final suite passed **45 actual SQL cases**; root's focused bundle/runtime run passed 38 before the extra null cases, and independent normal security/privacy/correctness/performance/regression plus separate Ponytail review passed **86 cases across four SQL suites** and a 16-input validator probe. An exact dry run preceded applying only this migration to isolated native PostgreSQL on port 55322. Its security suite passed **177 assertions plus budget/concurrency checks**, including two simultaneous complete bundles with one winner and one stale-version rejection, and restored controls/role memberships exactly. The embedded script passed 178 assertions plus budget checks before the final additional denial cases. No hosted records changed.

Autonomy: all already-known facts can commit together rather than create sibling-question conflicts. A genuine conflicting edit still requires reviewing the current request. This does not submit a program application or complete a partner workflow.

## Piece 2 — strict API path

The existing fact-value schema and refinements now serve both the unchanged single-answer contract and a strict canonical bundle. Bundle income is always one amount/frequency pair; aliases, duplicates, unknown keys, invalid values and empty/oversized arrays are rejected before mutation. One authenticated RPC handles the whole bundle. The request endpoint retains same-origin checks, bounded JSON, private/no-store responses and safe authentication/processing/conflict errors.

The valid new route first returned 400 before implementation. The completed schema/mutation/API test set passed **33 cases** independently; root passed **80 schema/API/projection cases**, and independent normal security/privacy/correctness/regression plus separate Ponytail review passed **92 cases across five suites**. Valid-prefix/invalid-last and valid JSON with oversized whitespace both produce no RPC. Existing single-answer, mandate and control tests remain.

## Next piece

Connect one family-facing form for current known factual questions. Preserve current scoped defaults, zero income, typed drafts, conflict recovery, per-need account-reset handling and existing separate personal/permission/booking steps. Test and independently review the UI before declaring this feature complete. Hosted execution and family launch remain unproved.
