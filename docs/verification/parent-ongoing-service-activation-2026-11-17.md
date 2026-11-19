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

## Completed approved host rollout

The owner then explicitly approved visible Azure browser use. The existing Penn Azure account signed in without a new credential or MFA handoff. Installation ran through the VM's normal Run Command UI, in a separate browser tab, with no new host credential or external connection.

The actual installed web, shared private-service and worker releases were read first. All three original launcher-file hashes matched the known baseline. The disabled sender alone retains its original pilot domain and incomplete carrier configuration; neither was changed or made usable. Seven enabled profiles retain their original canonical public domain.

The one-time operator is `deploy/parent-vm/activate-ongoing-host-2026-11-17.py`, deployed from commit `599d74007cb49926426521da13b689bd607fd7ec`, SHA-256 `8ecfd4bbab0399d8198c78263df27447e6b72f20807b5db76fd789b80c5d260e`. Its four automated tests cover unchanged profile scope, sender disablement, exact private rollback-copy reuse, private atomic replacements and symlink rejection. Actual staged checks passed eight own-profile reads and all 56 cross-profile denials, checked explicit ongoing operation at a future date and matched the existing public build fingerprint. No production profile or service changed during staging.

Only the three reviewed runtime files from `f5b5de90a9c27fffc06251e6d3bb659411d01566` were installed in copies of the existing releases:

| Service lineage | Active release under `/opt/caselink/releases/` |
| --- | --- |
| Web | `d6e9e9e19aed1d7421d6964cafca9409dd2d0b3c-www-20261117-ongoing-20261117` |
| Frontdoor, broker, review, sender and both cleanup services | `5900b9404b0ac8f20e8fe71c6d18327fc979f9ca-www-20261110-r3-ongoing-20261117` |
| Worker | `636373b4625b92780983ffa49cabfd7a7bbe4a23-worker-assistant-20261117-ongoing-20261117` |

Installed dependencies, package manifests, the compiled Next build, application source and the worker's account-context fix are preserved. Build ID remains `nyxPsJhgoIGCZaxbcfB2N`. Actual per-unit working-directory overrides select these copies; the shared current symlink and historical releases were not overwritten. The independent cleanup units use the corresponding shared copy.

Each of the eight owner-only profiles now has `approvedUntil: null` and the named ongoing operating reference. Independent postflight compared each entire JSON profile with its private rollback copy: only those two operating fields differ. All eight profile files remain 0600 under the original service owner and private directory. The rollback copies stay 0600 in the same per-service directories. No credential, origin, provider setting, recipient, enabled/collection/sending flag, account scope or retention duration changed. The sender remains both disabled in configuration and stopped in systemd.

An initial activation encountered a systemd reset error involving unused instances and restored the original profiles and release overrides. The operator was corrected to reset only actual failed services, and its exact private rollback-copy reuse was regression-tested. The successful retry passed readiness before being marked active. Earlier staging checks also caught the disabled sender's preserved pilot domain, the host's absolute runuser path and service readability of the public build marker under a restrictive umask; each was corrected before live activation. No private directory/profile was made broadly readable.

Independent live postflight confirmed:

- All eight profiles match their approved transformation and all eight actual service working directories select the staged runtime.
- All six existing restricted database credentials successfully authenticate as their exact original login. No password was displayed or passed on the command line.
- Web, frontdoor, document broker, protected review and worker are active. Public HTTPS sign-in succeeds, with the same build ID.
- Protected cleanup completed successfully at 2026-11-18 01:08:13 UTC, exit status 0; ordinary cleanup completed at 01:08:14 UTC, exit status 0. Both existing independent schedules were resumed.
- The worker publishes fresh planning-ready and assistant-ready health. Its queued permitted work resumed under existing mandates and model limits; reservations advanced from 25 to 27 against the unchanged 28-call cap. No manual paid chat test was added during this rollout. Sending was not enabled and no agency filing was made.

The application runtime source passed full CI and CodeQL on `ee801dbc2758e2a8175cf16986ec95bf3fcb73ae`, including real isolated database/Auth/restore/legacy checks, parent Chromium workflow/accessibility checks, PDFs, build and dependency audit. The later operator-only changes have their four runnable Python tests and actual staged/rollback/postflight evidence; full CI on those follow-up commits is separate and may still be running. The 127 focused source/SQL cases and candidate TypeScript/lint remain passing evidence for the runtime change.

Normal review covered private atomic replacement, exact source/dependency/build hashes, concurrent-change guards, per-service identity and role checks, independent maintenance schedules, bounded invocations, readiness and rollback. The separate simplicity/deletion pass retains the existing profile field, native PostgreSQL infinity and existing systemd units; the one-time stage/activate phases serve this actual rollout and introduce no new runtime dependency, worker platform, automatic renewal or family step.

Administrative expiry removal is complete for the six database logins, two SNAP processing approvals and eight server profiles. All family mandates, tokens, provider/source verification, protected identifiers, item-retention limits, original account restrictions and model-spending limits remain independent. The remaining one-call AI allowance is a separate test-budget limit, not an expiry. This rollout proves ongoing operating configuration and currently healthy services; it does not establish an unrestricted family launch, renewed provider route evidence or a fresh application-submission outcome.

Family effort removed: repeated administrative operating-window renewal. No new family prompt was added. Necessary personal steps and family mandate renewal remain as recorded. Routine background work and cleanup resumed; no operator was substituted for a family outcome.
