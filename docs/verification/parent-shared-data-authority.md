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

No family work or routine operator task is added. Valid, uniquely inferable authorized operations still proceed automatically; a service scope error is resolved by the service rather than asking the parent to reapprove it. This piece proves an authority boundary, not food allocation or a career booking. The next shared piece checked permission changes against saved assistant context, below. New provider-specific fields and real side effects still depend on L0's accepted food allocation and adult-host contracts.

## Piece 2 — permission and correction boundaries for assistant context

Current request facts already respected the mandate's data categories, but the assistant's history did not. The database returned previous answers from every version of the request, and the model input included their text. After permission was narrowed, an old income answer could be transmitted again; after a correction, old location text could reappear.

Forward migration `20261027140357_parent_assistant_context_authority.sql` limits claimed conversation context to the current request version and returns that version with each history item. The application independently drops old, future, missing or malformed version metadata before selecting its four history turns. Current-version conversation still works. The owner-visible conversation, exports and retention are unchanged; this is not erasure or an extension of retention. Saved facts are rebuilt through the current-permission projection and existing per-fact freshness checks, so this does not ask the family to re-enter them.

The existing integration sends bounded context explicitly with `store: false`; no persistent provider conversation or new API/dependency was introduced. [OpenAI's conversation-state documentation](https://developers.openai.com/api/docs/guides/conversation-state) distinguishes explicit input history from provider-managed conversation state. This patch changes only the application's choice of eligible history, not processor retention or contract settings.

### Verification and independent review

- The new application test first reproduced income text leaving through a captured synthetic Responses request. Two database cases also failed before the fix after real permission-narrowing and correction RPCs.
- **1,656 tests across 187 files passed**, including the new five-case database suite and all previous migration-backed suites. The focused assistant/worker/UI/API/export regression passed **81 tests across 11 files** without live model calls.
- Independent normal and separate Ponytail reviews cleared the complete affected flow; the reviewer independently reran **40 focused tests**, including piece 1's SQL guards. The SQL replacement mechanically changes only the history projection and version filter.
- Both reviewed forward migrations were dry-run checked and applied **only to the isolated local PostgreSQL 17.11 database on port 55322**. Its existing security regression then passed **159 assertions plus bounded-budget checks and concurrent cancellation/dispatch**. The fixture verified exact restoration of processing controls and role memberships.
- TypeScript, scoped lint, whitespace and secret checks passed. Neither the hosted account provider nor the running connected preview was migrated or restarted.

The new purpose/history regressions use embedded PostgreSQL role/RPC execution. The separate local-server regression establishes existing concurrent security behavior after applying both migrations; it is not a claim that each new history case was run through real Auth/Storage or that hosted deployment is verified. No real family record, provider transaction, model call or expansion of family-processing authority was involved.

### Autonomy checkpoint

Family prompts added: **zero**. Routine operator tasks added: **zero**. The family keeps its conversation and validated saved facts. The service stops reusing historical text after its authority or facts change, rather than requiring another routine consent click. This is a shared privacy prerequisite for reliable autonomous service; it still proves no food allocation or appointment. Next: finish the scoped data/permission inventory and implement only additional demonstrated shared gaps while L0's actual route contracts are obtained.

## Piece 3a — source dates for existing intake

Forward migration `20261027141312_parent_intake_source_dates.sql` records server-owned, timestamp-only metadata for the existing strict intake keys. Existing rows are conservatively dated from `created_at`, not a recent `updated_at`. New captures use server time. Full-form correction stamps only values that actually changed, including changes to/from null. Reads, no-op corrections, renewal, booking preferences, pause and resume do not refresh unchanged source dates or retention.

This is **capture only**. It adds no family question, private value, retention extension, freshness policy or execution permission. An explicit same-value factual answer keeps its existing exact-need `confirmedAt`/`asOf` evidence; it does not reconfirm all intake. The new map is not yet consumed for model/packet freshness.

Seven migration-backed tests pass, including an isolated recreation of the legacy schema followed by the exact migration to prove conservative backfill. Six initial main-fixture cases failed before the column/trigger existed. **27 tests across six affected SQL suites** passed, and the independent reviewer passed **78 tests** spanning provenance, prior authority, policy and service behavior. Normal correctness/security/privacy/retention/regression review and separate Ponytail review cleared the piece. TypeScript, scoped lint, whitespace, document-link and secret checks passed. This third migration has not yet been applied to a service database.

### Autonomy and next increment

Family prompts and operator tasks added: **zero**. The dates prepare the service to reuse current information instead of treating renewal as new evidence. They do not prove source scope by themselves: `parent_answer_fact` currently mirrors some exact-need answers into shared intake, and removing that need can delete the fact while retaining its mirrored value. Before consuming source dates for reuse, preserve that origin or remove the mirror safely. The next independently reviewed piece must test answer → need removal → reuse so an unrelated need cannot inherit the answer. No unrelated income question or new R1 private-data collection is introduced.

## Piece 3b — preserve exact-need origin restrictions

Forward migration `20261027142357_parent_intake_need_scope.sql` adds a narrow server-owned restriction set for the four fields that factual answers can mirror into shared intake: ZIP, household size, income amount and income frequency. A changed exact-need answer marks only the changed mirrored fields as requiring exact-need facts; the fact already carries the need, value and date, so no duplicate source-history system is added.

The restriction survives removal of its originating need/fact, no-op corrections, same-value answers and mandate renewal. A genuine household-level change clears only that changed field's restriction. The trigger and factual-answer RPC run within the existing locked transaction, so another session cannot observe an unrestricted intermediate mirror. Paired income marks only components actually changed. Existing values whose historical source can no longer be established are conservatively restricted, not erased; display/export remain intact. This must never become a blanket four-question reconfirmation: only a selected route's indispensable current field may require a new answer.

This is **restriction capture**, not consumer enforcement. No new field value, family prompt, provider operation or retention change is enabled. The next piece must pass dates/restrictions through the assistant snapshot and enforce them in the actual model/packet projection; missing metadata is unknown, not an empty restriction set.

Nine new SQL cases pass; eight failed in the main fixture before this behavior existed. Tests include the actual answer → remove originating need/fact → unchanged edit/renewal sequence and an exact-migration legacy replay. **1,672 tests across 189 files** passed, including all migration-backed suites, and the embedded security script passed **164 assertions plus bounded-budget checks**. Independent normal review and separate Ponytail review passed **69 focused tests** and mechanically verified that the factual-answer routine changes only by its seven-line restriction update. TypeScript, scoped lint, whitespace and secret checks passed. Migrations 3a/3b are not yet applied to service databases.

### Autonomy checkpoint

Family prompts and routine operator tasks added: **zero**. A fresh original shared answer is not downgraded by an unchanged need-specific answer. Unknown historical origin remains visible as a source limitation rather than invented permission. Current exact-need facts remain available for the upcoming consumers. No food allocation/booking outcome is proved by this piece.

## Piece 3c — current-source model and packet projection

One pure `currentIntakeFields` helper now resolves only the four mirrored fields. It checks allowed categories, server source dates, sticky restrictions, validated exact-need parent answers and the existing inclusive 45-day reuse ceiling. Missing restriction metadata is unknown; invalid/null/future dates, impossible calendar dates and timezone-free timestamps do not become fresh through a fallback. Valid offset timestamps retain their own calendar-date validation. Income stays a complete usable unrestricted pair or a validated paired answer; an incompatible one-component answer cannot silently supply the other component. Zero income remains valid.

Service packets use that projection, and the coordinator now receives the provenance-bearing request rather than stripped intake/permission arguments. Its model input contains only usable shared fields and explicitly need-scoped differences. Existing validated-document utility-provider/shutoff projection is preserved; it is not relabelled as a new parent capture. Owner request reads/exports and forward migration `20261027144122_parent_intake_projection.sql` carry both metadata fields into the assistant snapshot.

The assistant uses the same projection and source dates. Prior model context retains only answer paragraphs exactly matching **current permitted evidence**, in the current request version; raw prior questions and unverifiable old answer text are omitted. This also prevents same-version history from reviving a source that aged out after its answer was saved. The owner-visible transcript/export is unchanged. Routine service still uses current saved facts rather than asking the family to re-enter them.

Review found one reachable inconsistency: changing a utility account hid still-current household income/ZIP from chat although correction logic deliberately preserved those facts. A red regression reproduced it; the assistant now excludes superseded account evidence only for utility-specific facts, while household/income use the shared source projection. Old account balances remain excluded.

**1,723 tests across 190 files passed**, with migration-backed suites included. The helper has **46 cases**; focused consumer/worker/snapshot/data/export/evaluation checks passed, and the independent reviewer passed **145 tests across eight files** after the consistency fix. Normal correctness/privacy/security/accessibility/performance/regression and separate Ponytail reviews cleared the piece. TypeScript, scoped lint, whitespace and secret checks passed. Tests captured model payloads with synthetic fetchers; no live model call was used. The new snapshot metadata case failed before the forward migration and passes afterward.

### Autonomy and next increment

No blanket confirmation or new information category is introduced. When a verified form actually needs a value without a usable current source, its existing necessary-answer path requests that indispensable fact; a fresh exact-need answer resumes work without another approval. Current original answers and valid zero-income pairs proceed automatically. This ceiling is a generic reuse safeguard, **not** proof of program eligibility or the provider's exact evidence period.

This piece filters model/packet consumers. Final TypeScript/database source checks at preparation/form registration/dispatch and current per-need ZIP recovery remain the next reviewed piece. It does not claim that old prepared packets are already blocked by source age. Migrations 3a–3c have not yet been applied to service databases; the hosted provider and running preview remain untouched.

## Remaining L1 dependencies and bounded review findings

The additional shared-path review found no further demonstrated normal-path disclosure or execution bypass in its bounded scope. Exact provider-field restrictions remain enforced by SQL; the application's broader category-only policy remains a fail-late limitation, not evidence of a tested transport bypass. This is not a complete security audit or compliance certification.

- **Actual route contracts:** the original resources establish intended food/Resume Lab support and the owner's partnership decision, but not reservation stock, organizer calendar access, exact required questions or accepted confirmation/change/fulfillment evidence. Obtain the actual food-allocation owner and adult booking host's instructions before new route fields or side effects. Preserve direct walk-in food access; do not invent reservable stock. The owner does not yet have these instructions and asked to keep a running needs list while independent engineering continues; no outreach was sent.
- **Source-age/readiness:** pieces 3a–3c capture and consume dates/restrictions for the four mirrored fields. Final execution/database checks and per-need ZIP recovery remain open. Other fields retain their existing controls and need their actual route's freshness/evidence assessment before enablement. A renewed mandate must not make old values current. Preserve unrelated corrections; reads and renewal cannot refresh source age. Do not add irrelevant income questions to a minimal adult/food route merely to exercise an R2 dependency.
- **Exact new data and retention:** adult routing and protected execution fields remain closed until the selected route establishes required fields, purpose, subject/household, recipient, personal acts, policy coverage and retention. These shared changes neither authorize a new schema purpose nor complete L1.
- **Deployment:** hosted migration and exact release-candidate Auth/Storage/end-to-end checks are still required before operational activation. The existing localhost approval is not renewed; no public enrollment or live provider transport was enabled.

Continue independently with the demonstrated source-age gap for existing fields; new route-specific fields follow an actual contract. Do not add irrelevant R1 income prompts or new private-data collection. Test and independently review each piece before dependent execution. No app, theme, identity or provider-platform restart is needed.
