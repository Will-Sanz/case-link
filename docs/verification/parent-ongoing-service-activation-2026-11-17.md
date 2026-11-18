# Ongoing operating permissions — November 17, 2026

After receiving the live expiry inventory, the owner said: “Ok just get rid of these. There's no need for a lot of these to expire it's fine”. The implementation removes administrative service/demo cutoffs while retaining family mandates, authentication/token expiry, private data-retention limits, current provider/source verification and separate collection/sending enablement.

## Concrete operating change

The guarded transaction in `deploy/parent-vm/enable-ongoing-existing-services.sql` changes exactly six existing restricted database logins to PostgreSQL `VALID UNTIL 'infinity'`, and the two already-enabled SNAP purpose approval deadlines to `infinity`. No login password, privilege, membership, account cohort, original identity cutoff, source/provider verification, retention period or model ledger changes.

| Existing login | Required sole membership |
| --- | --- |
| `caselink_parent_pilot_worker_20261026` | `parent_worker` |
| `caselink_parent_pilot_broker_20261026` | `parent_storage_broker` |
| `caselink_parent_pilot_finalizer_20261109` | `parent_snap_finalizer` |
| `caselink_parent_pilot_retention_20261026` | `parent_retention_worker` |
| `caselink_parent_pilot_ordinary_retention_20261109` | `parent_retention_worker` |
| `caselink_parent_pilot_sender_20261109` | `parent_snap_sender` |

The separate purpose fields are `processing_controls.snap_details_approved_until` and `processing_controls.snap_protected_approved_until`. The sender remains disabled; removing its database login expiry neither starts it nor authorizes an agency send. Every operation still checks its current scoped authority. Access lasts until explicitly revoked or disabled instead of expiring at a demo date.

The transaction requires the exact observed prior deadlines, one existing owner cohort, enabled existing-account mode, a recorded original identity cutoff and no elevated/inherited or additional role memberships. It fails atomically if those settings have changed. The existing global parent-processing deadline is already `infinity` and is not changed by this transaction.

## Matching host configuration

The existing reviewed implementation accepts `approvedUntil: null` explicitly; omitted or malformed values reject. `enabled`, the named approval reference, exact site/project/TLS boundary and collection/sending flags remain required. Ongoing operation schedules no demo shutdown. Finite internal tests retain their shutdown behavior. Each ongoing maintenance invocation remains bounded to one minute and preserves all item/key retention deadlines.

The three runtime files are `scripts/parent-hosted-profile.ts`, `scripts/parent-support-retention.ts` and `src/lib/parent/hosted-service.ts`. Use their deployed-lineage versions, which retain the existing controlled-sender/emulator schema. Do not copy current main wholesale or replace the worker's application implementation.

After approval, the host rollout must first read actual per-unit working directories and snapshot private-profile hashes, service state, build marker and source hashes. Stage the three reviewed runtime files in copies of those existing releases, preserving installed dependencies, public build and worker/context fixes. Use each service's existing owner-only profile and atomically set only `approvedUntil` to `null` and its named operating reference. Preserve all enabled/collection/sending flags, credentials, recipients and program settings. The disabled sender is not started. Web/frontdoor and already-enabled worker/broker/review services then use the staged runtime; existing independent cleanup timers use their corresponding staged release. Verify the real unit paths, profile ownership/modes, website fingerprint/health, restricted database connections and both cleanup runs. Keep the old releases, private rollback profiles and prior database deadlines for recovery. No full fresh SNAP flow or filing is implied by service health.

## Validation and separate reviews

127 focused cases pass on the isolated deployed-source candidate: 125 hosted-profile/service-boundary/retention regressions plus two SQL activation/restoration tests. The SQL test replays the exact activation transaction against embedded PostgreSQL; it rejects an unrestricted cohort and an extra role membership, proves only the six login expiries change, and compares all other role attributes and processing controls. The older bounded-restoration regression remains intact. Candidate TypeScript and scoped ESLint pass.

Normal correctness/security/privacy/regression review traced every launcher caller, finite and ongoing deadlines, the Next build fingerprint, database role boundaries, per-operation authority, maintenance timeouts and shutdown cleanup. It confirmed that ongoing service permission does not extend a family mandate, provider verification, item retention or model budget. No runtime UI, PDF rendering or model behavior changes in this patch; those remain on the deployed and previously tested application lineage.

The separate simplicity/deletion review keeps the existing profile field and native PostgreSQL expiry mechanism. It adds no scheduler, dependency, credential, new worker, automatic renewal or family prompt. Only explicit null/ongoing handling and the exact operational transaction are needed. No additional simplification finding remains.

## Actual result and remaining blocker

Automatic approval review rejected the November 17 activation attempt: permanently changing six production service logins and two SNAP authorization deadlines to infinity was considered a persistent-access change without sufficiently explicit approval for that exact scope. The rejection described the scope as irreversible; the prepared recovery plan retains the prior dates, but no retry or alternate execution was attempted. Independent live readback confirmed all six original login deadlines and both SNAP purpose deadlines remain unchanged. The worker's temporary deadline was November 17 at 21:07:45 UTC and has passed. No paid model call or agency action was made.

The background browser inventory is now empty and creating the previously supported hidden Azure browser reports unavailable. There is no Azure CLI installed. No visible browser was opened and no active user window was taken over. Server activation is also unperformed; background access must be restored or the owner must authorize visible Azure use before that installation.

Family effort the prepared change removes: repeated administrative demo-window renewal. Remaining family mandates and necessary personal program steps are unchanged. Outcome proved: guarded, tested ongoing-operation support and a verified no-change readback after rejection. Ongoing live availability remains blocked pending exact operating approval and server installation.

## Explicit approval and successful database activation

The owner subsequently explicitly approved non-expiring access for the existing worker, broker, protected-review, sender and two cleanup accounts, both SNAP processing approvals and their server profiles until revoked, while keeping sending disabled. This supplies the exact scope missing from the earlier rejected attempt.

With that new approval, the unchanged tested transaction was accepted by `apply_migration` as `parent_existing_services_ongoing_operation_20261117` on the original project `zpfypkizsapvsxeykmdq`. Readback at 2026-11-18 00:42:46 UTC confirmed all six restricted login expiries and both SNAP purpose deadlines are now `infinity`. Every login remains NOINHERIT, without elevated flags and with the same sole scoped membership. The owner cohort remains one, the original identity cutoff is retained, protected retention remains 2,592,000 seconds, the model cap remains 28 and its original October 26 budget start is unchanged. SNAP provider submission/follow-up verification deadlines remain November 11 at 04:00 UTC; this operating change does not certify those routes or enable filing.

No host profile or service was changed. The newly checked browser inventory still exposes no background browser, so host installation remains pending. No active browser/window was taken over. The owner approved the operating settings but did not separately approve visible browser use requested in the previous reply. The remaining prerequisite is background Azure access or permission to briefly use the visible Azure browser. Thus the database part is complete; server profiles, runtime rollout, service health and cleanup verification remain pending. Sending was not enabled and no paid model call or agency action was made. CodeQL passes on `f5b5de90a9c27fffc06251e6d3bb659411d01566`; full CI was still running at this checkpoint.
