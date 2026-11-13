# WIC private preparation implementation

November 13, 2026. Implements the WIC information pieces of the [extension plan](parent-wic-utility-extension-2026-11-13.md), after [ordinary routing reuse](parent-cross-request-routing-reuse-2026-11-13.md). Provider sending, callback receipt, appointment booking, enrollment and support received remain unimplemented. No live collection or hosted operating window is enabled.

## Family flow and scope

The separately gated, single Pennsylvania WIC initial route presents its notice before private inputs. It groups contact/address/birth-date questions, explicit new/reapplying/transfer status, mother/children selection and appointment preference. Relevant maternal and child branches follow the checked public form. Unknown answers stay blank; partial drafts are identified as partial. No invented names, household count, aggregate income, clinical eligibility thresholds, optional demographics, identifiers or signatures are collected.

Eligible ordinary household routing is reused with its original dates. Contact postal ZIP is independently supplied; routing is not proof of that postal address. An explicit same-person choice can reuse contact name and birth date for the mother, without inferring identity from similar names. Stable internal child IDs preserve correction provenance.

One informed start permission names Pennsylvania WIC and includes authority for everyone named. Each genuine Save changes action makes the declaration for that exact revision without another routine checkbox. This records a declaration, not independently verified guardianship. The current processing/source deadline closes new fields; raw unsaved drafts stay in memory for recovery rather than browser persistent storage. Existing saved answers can be reopened without retyping.

The existing request checklist contains the WIC answers view. Owner reads, empty/loading/error states, correction, immutable history, paused saves, exact uncertain-save retries and closed-purpose history use the established parent patterns. Mixed and continuing needs retain their distinct ordinary journeys and direct official access; this does not silently create another WIC application.

## Data and execution boundary

Separate default-off database controls require the actual WIC approval reference, notice and expiry in addition to overall parent processing. Current account/request ownership, named program, preparation permission, subject declaration and request version are checked at each write. Start and initial private revision commit atomically. The client cannot supply provenance, source freshness, consent actor or an accepted provider receipt.

Private revisions preserve original per-field dates and server-bound actor/notice/revision/subjects/detail digest evidence. In-scope corrections invalidate queued use, while paused work stays stopped. Raw values are excluded from ordinary request facts, chat, worker claims and routine packets/PDFs. The owned comprehensive JSON export includes all revisions and their evidence. Ordinary request cleanup/deletion cascades through them without deleting a shared Auth identity.

Ordinary WIC-only document upload and AI reading remain closed separately: the API rejects before parsing, database registration/confirmation are denied, Storage insertion has an additional restrictive policy, and the broker refuses raw-document processing, including previously stored bytes. Known forms, existing owner history/deletion and other-need document rules remain. Mixed requests do not acquire permission to upload WIC health material through their other-need document route.

The [actual data/processor assessment](parent-wic-data-assessment-2026-11-13.md) records plaintext JSON database/hosting/admin/backup exposure, health-related routing inferences, the unresolved WIC retention disposition, rights during overall closure and operating/incident evidence. These records are not represented as separately envelope-encrypted application bytes or as a legal-compliance finding.

The official pre-application means later contact to arrange specialist help. The offline fictional formatter maps its checked controls and leaves acknowledgment/sending/appointment/enrollment unconfirmed. No real family's answers are relabeled fictional. The runtime does not create a government PDF, call ValidateChild/SavePreapplication, authenticate to the Family Portal, claim a provider acknowledgment or bypass specialist participation.

## Review, verification and current limits

Independent normal and separate simplicity reviews cleared the private backend, narrow postal/expiry amendments, family UI and separate document boundary. Reviews resolved an expiry-RPC privilege issue, notice layout/retention wording, unrelated utility-field clearing, exact-attempt recovery, checklist reachability and the extra single-program checkbox found by native browser rehearsal. No permission/table grant was widened to fix those issues.

- Backend/source checks: 141 focused tests passed, including actual embedded PostgreSQL ownership/RLS/RPC, source, consent, retention and correction cases.
- UI review: 159 tests across seven focused suites passed; the later single-checkbox correction separately passed 59 intake/reuse tests. Type checking and affected lint/whitespace checks passed before subsequent PECO integration.
- Separate document boundary: 11 API/PostgreSQL tests passed, independently reviewed. The confirmation case uses real matching synthetic Storage metadata, so its denial proves the new boundary rather than the older missing-object guard.
- Native local database: all four WIC/PECO additive migrations passed transaction/rollback rehearsal and were installed only at local test port 55322, with original controls unchanged. The final combined security run passed **333 assertions plus budget/concurrency checks**. Repetition exposed a genuine shared routing lock cycle; a controlled regression proved its foreign-key edge, the reviewed household lock correction preserves start serialization, and the final native run includes that deterministic regression. See the [routing checkpoint](parent-cross-request-routing-reuse-2026-11-13.md).
- Actual local email Auth → headless browser → Next API → PostgREST/PostgreSQL/Storage: **247 assertions passed**, with no API interception. WIC and PECO each cover intake, saved review, correction and closed-purpose retained history at 320px and 1280px, with no overflow or automated WCAG A/AA violations. WIC cases prove atomic start and exact replay, owned and foreign-token access, independent postal ZIP, immutable corrections and paused saves, closed-purpose history/export, document denial, no provider operation and exact control restoration. SNAP, ordinary reuse and legacy-account regression remain in this same run. Evidence: `tmp/parent-verification/actual-auth/results.json`; no family data or credentials are committed.
- Full repository regression: **6,103 passed, 16 existing explicit skips, zero failures across 303 files**. A later small PECO helper deletion/error-case replacement separately passed 59 affected tests. Production test build, type checking, affected lint and whitespace checks passed. Independent normal and separate simplicity reviews cleared the final error handling and the two-line disclosure hit-area correction found by actual mobile accessibility testing.

No real provider, model call or government submission was made. The public source expires November 20 at 18:57:45.283 UTC and needs genuine review before collection can remain available. Native/browser software checks do not establish real-family observation, deployed processor/retention/rights operation, accepted delegation, receipt/status recovery, a booked appointment or enrollment.

## Autonomy checkpoint

**Family work removed in the implemented path:** repeated household routing entry, repeated owned private answers on return/correction, duplicate maternal identity entry after an explicit same-person choice, irrelevant income/count questions and routine repeat approval. No released-family autonomy rate is claimed from these tests.

**Remaining prompts and reasons:** actual missing facts, the one informed mandate/subject authority, genuine provider personal acts or specialist assessment, a meaningful choice or expanded purpose. Engineering reviews and rehearsal pauses are developer work, not provider-required family participation.

**Routine work still missing:** actual permitted delivery, uncertain-result reconciliation, callback/appointment lifecycle, changes and attributed enrollment/support follow-up. These gaps are counted; there is no hidden operator submission/status workaround.

**Outcome proved:** closed, owned preparation and correction through the actual local app, authentication, APIs and database, not WIC assistance received. Next is the exact operating/route evidence before activating any real collection or execution. The broader SNAP, utility and staged food-access/adult-booking commitments remain intact.
