# November 17 demo readiness and ongoing availability

The owner requested the broadest reliable 2 p.m. demonstration, reported the parent sign-in denial, then explicitly directed removal of normal-service demo windows and authorized applying the change live. **The database access cutoff was removed live at approximately 12:29 p.m. EST. Independent readback confirms processing enabled, an ongoing deadline and the same eligible owner account. Actual browser sign-in still needs the owner's retry.**

## Sign-in diagnosis and deployment

The reported message, “Parent support is unavailable for this sign-in,” is emitted only after successful password authentication when `parent_ensure_account` returns SQL permission denial `42501`. After the owner connected the correct organization, the live read confirmed `enabled=true`, `approved_until=2026-11-11T05:00:00Z` and `processing_available=false`. The expired global access approval was therefore confirmed. Local private service profiles remain separately expired.

The earlier Supabase connection exposed only the unrelated inactive project `qmnaftioxpmvohxujwvu`. The new connection exposes the original production project `zpfypkizsapvsxeykmdq` and actual staging project `umnbyupudhunyccqhyrp` in the same organization, both healthy. The tested activation transaction was then applied to the original production project. Postflight at `2026-11-17T17:29:48.985111Z` confirms `approved_until=infinity`, `processing_available=true`, the original identity cutoff unchanged, one permitted account and one eligible permitted account. A further aggregate check confirms one active parent account and zero matching deletion tombstones. The transaction changes only the global enablement/approval/deadline/update fields; no cohort, credential, deployment, model ledger or provider configuration changed. Direct shell networking and browser navigation remain unavailable in this task.

The applied [activation transaction](../../deploy/parent-vm/enable-ongoing-access.sql) uses PostgreSQL's native `infinity` under the existing database predicate, requiring no schema migration. It verifies the existing owner-scoped deployment and preserves its account list, identity cutoff, program controls and model budget. Account/cookie authentication, bans, ownership and mandate checks still apply. The owner was asked to retry public-site sign-in; that browser result is not yet recorded.

Hosted profiles support explicit `approvedUntil: null`; the service launcher then has no demo shutdown timer. Missing fields remain invalid. Finite internal tests still stop at their deadline. Each ongoing retention invocation remains bounded to one minute, and document/key expiry remains unchanged. The host needs the reviewed source, updated private profiles and actual restricted-login expiry reconciliation before ongoing background operation can be claimed.

## Verification

- Fixed two preexisting test-code build blockers: the unsafe-header table's TypeScript inference and an unused extraction-callback argument. The affected 41 tests, TypeScript and lint pass.
- Initial complete regression: 6,890 tests passed with embedded PostgreSQL migrations enabled, 29 explicit skips and 50 local HTTP/process cases blocked by listener/IPC permissions. No blocked test was weakened or removed.
- After the availability change, the broader run covered 338 files: 6,908 passed, 29 skipped, and two bundled-worker cases timed out during the concurrent production build. That entire worker file then passed all 25 cases on an isolated rerun. The final focused ongoing-availability/profile/retention run passed 132 cases, including the actual activation SQL. The three network-dependent files remain explicitly excluded from this restricted-session rerun.
- Embedded PostgreSQL security: 327 recorded assertions plus model-budget checks passed. This does not emulate actual Supabase Auth/Storage or concurrent connections.
- Isolated production build using the supported Webpack build, full TypeScript and full lint pass. The existing demo build was preserved.
- PDF checks pass for five summary/packet/form pages, 15 PECO pages, 25 PGW pages and 10 conspicuously local-test water pages. Checks cover source text, bounds, rendering and program-specific assertions. No provider submission or issued City water form is established.
- The existing 60-second full-screen SNAP video matches its recorded SHA-256 `bda8f5e8bd0536d9bc7c6cb9dc9e63cf7397a94c809b72be14f08836979bd243`. It shows the earlier saved fictional flow and free fax emulator result, not a fresh live application or agency receipt.

Normal review traced password → account RPC → processing/cohort/RLS checks, hosted profiles → child environments → process shutdown, and independent maintenance authority → bounded cleanup. The separate simplicity pass used native PostgreSQL `infinity` and removed the initially unnecessary schema migration. No platform, new dependency, authorization bypass or UI-only workaround was added.

## Demo scope and autonomy checkpoint

The current local code covers public urgent-food lookup, SNAP intake/saved answers/documents/application viewing, progress/history and controls, saved ZIP reuse, WIC private preparation and utility preparation. UI/component and database tests establish these code paths; they do not establish current hosted readiness. WIC, PECO, PGW and water additions are local work beyond the earlier hosted tour. Water remains explicitly a local test harness. Genuine provider receipt, agency registration, benefits approval and support received stay distinct.

Ongoing availability removes routine operator renewals that could otherwise lock families out. It adds no family prompt and does not extend a family's mandate, document retention, source validity, cost budget or provider authority. Routine provider work and real program outcomes remain subject to their existing route evidence. The next smallest live step is an actual owner sign-in, followed by isolated service-profile/login checks and a real authenticated walkthrough. The saved film provides a separate fallback while those checks are blocked.

Local logs, build copy and rendered evidence: `tmp/demo-readiness-2026-11-17/`. They contain no new real-family records or live credentials.
