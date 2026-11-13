# Cross-request ordinary routing reuse

November 13, 2026, America/New_York. First implementation piece of the owner's [WIC/utility expansion](parent-wic-utility-extension-2026-11-13.md). Implemented and tested locally; not deployed to the hosted service and not a family-release claim.

## Family behavior and information boundary

New ordinary requests automatically fill an eligible saved household ZIP, with its original date and an editable manual alternative. Existing account language/contact defaults continue. Late results never overwrite typing or a cleared field. No extra reuse approval is added: the existing start mandate names the new programs and authorized information use.

Only the ordinary ZIP is copied in this piece. Household size/income definitions and periods differ across programs; private SNAP answers, names, rosters, health facts, account identifiers, documents and signatures are not imported into a different purpose. Their existing storage and execution gates remain. No profile table or general connector framework was added.

Server-owned lineage records the original request/date and a bounded expiry. The client sends only source ID/version; it cannot supply freshness or a verified-source flag. Reuse-of-reuse is excluded. Multiple conflicting current ordinary ZIPs stop automatic selection and invalidate affected copied routing. An independent exact-need answer remains usable for its own need even when the borrowed generic value expires.

The target's current mandate authorizes new use. Successful/other explicitly non-withdrawal closure of the source ends its old execution authority without making the ordinary fact unavailable. Cancellation, parent-chosen closure, deletion, removed household permission and unavailable accounts stop reuse. The original confirmation plus 45 days and applicable source retention bound reuse; reading, renewal or a new request cannot advance those original limits.

Known unrestricted source corrections stop superseded queued work and propagate the current ZIP without asking for retyping. Paused targets remain paused. Withdrawal/deletion/conflict/expiry removes the copied current ZIP; stored intake supports that missing value, while new input/corrections still require a genuine five-digit ZIP. Closed/cancelled target cleanup does not change its closure-retention clock. Previously attempted immutable packets and receipts retain their separate history/retention rules.

## Complete affected flow

`intake-defaults` → authenticated owned-source RPC → intake auto-fill → existing Start/mandate → dedicated transactional reuse RPC → source-bound stored intake → shared TypeScript/database current-fact projections → existing operation/form guards.

The migration also wires source changes/deletion, household conflicts, assistant source metadata and existing independent retention cleanup. It changes no provider capability, real-family processing control, school role, shared Auth identity or private SNAP collection purpose.

A source changed before creation produces a distinct HTTP 412 only after the transaction proves no request was created. The UI refreshes once and retries with the same key and mandate. Unknown creation results retain the exact attempt and never trigger a blind rebase/new request. A source locked by a concurrent correction fails before creation (`NOWAIT`); the bounded recovery handles that case without a deadlock or bypass.

## Review and verification

Independent normal review found and resolved three initial issues: independent same-value answers being hidden by expired lineage, cached defaults reappearing after rejection, and household conflicts not reaching existing copies. A separate simplicity pass removed an unused index. A further autonomy review corrected the distinction between completed service and withdrawal. No remaining must-fix findings were reported.

- Full parent regression run: **4,598 passed, 16 explicit skips**, zero failures, across 164 files. Evidence: `tmp/parent-verification/reuse-parent-tests.json`. The later completion/withdrawal addition separately passed the 65-case routing/current-fact run; counts are not added together.
- Actual native local PostgreSQL security run: **229 assertions plus bounded budget checks**, with concurrent starts/correction, exact retries, completed-source reuse/new grant versus closed old grant, legacy/account isolation and cleanup. Temporary processing controls and role memberships restored exactly.
- Actual local email Auth → headless browser → Next API → PostgreSQL/Storage: **146 assertions**, including automatic reuse without typing, source-only POST metadata, original dates/expiry, queued version/no provider operation, source withdrawal/redaction, API return and an accessibility scan. Existing SNAP, grouped answers, documents, exports, accounts and recovery checks also pass. Evidence: `tmp/parent-verification/actual-auth/results.json`.
- Production test build, type checking, affected lint and whitespace checks pass. The web test runtime has no model/operator/provider secrets and no background worker or enabled transport; no model/provider call was made.
- The additive migration passed native transaction/rollback rehearsal, then was installed only on the isolated local test database at port 55322. It was not applied to the original hosted project. The local API schema cache was refreshed.

Full regression exposed expired fixed-date test mandates/viewers and a mock that counted every unknown GET as a create attempt. Narrow test-only date/route repairs preserve all assertions and runtime expiry. Historical-schema replay tests remove the new trigger only inside their isolated reconstruction of the older schema. The native Auth script now uses the actual checklist navigation and preserves sanitized completed assertions on failure; earlier failed attempts remain dated diagnostics, not successful checks.

## Autonomy checkpoint and remaining work

**Family work removed:** typing an already permitted current ZIP on another ordinary request; retyping a known unrestricted correction; routine approval for compatible reuse. Completion of an old case does not create a new ZIP question.

**Remaining prompts:** the existing informed start mandate and genuinely missing/conflicting routing information. Unavailable optional defaults retain manual entry. No additional routine prompt was introduced. Private program fields still require their actual purpose/consent and compatibility before reuse; no data is collected speculatively to fill that gap.

**Routine human work:** engineering/review/rehearsal remains developer work. WIC/utility private projection, accepted personal acts, permitted execution and status/outcome connections are still unimplemented; those gaps are not excluded from autonomy measurement or hidden behind an operator.

**Outcome proved:** controlled local information reuse and its failure/recovery boundaries, not a WIC appointment, utility application, agency receipt or support received. Next is the source-backed WIC information/preparation contract, then its protected lifecycle integration and preserved PECO work. Real provider proof still needs a legitimate case/accepted channel and the applicable actual data/operating gates. No hosted capacity, scheduled deployed erasure or real-family readiness is claimed.
