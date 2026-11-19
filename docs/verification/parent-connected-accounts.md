# Existing-account connection and homepage verification

Verified October 26, 2026, on `main`, using a background-only production build at `http://127.0.0.1:3200`. No visible browser, public deployment, model call or partner submission was used for this check.

[Sanitized aggregate results](parent-connected-account-results.json) retain the actual UI assertions, fixture-cleanup counts, original-record preservation outcome and approved deadline without identities, credentials or private integrity fingerprints.

## Result and approved scope

The owner selected **reuse existing CaseLink accounts**, then explicitly approved a **two-hour localhost connection and a temporary synthetic staff test**. The parent app uses the original provider, `https://zpfypkizsapvsxeykmdq.supabase.co`; passwords and identities were not migrated to another project.

The database approval expires at **2026-10-26 18:08:45.988922 UTC / 2:08 p.m. EDT**. Its existing-identity cutoff is **2026-10-26 16:08:46.084231 UTC**. Only preexisting eligible identities can obtain their own parent workspace; verification, bans, active school-account status, signed password authentication for school identities, current sessions, household ownership and mandate checks still apply. Expiry closes parent access even while the local server keeps running. Renewing approval or widening enrollment requires owner authorization.

New email-code enrollment is absent from this profile and rejected before calling Auth. The shared provider's global enrollment rules, hooks, SMTP settings, callback allowlist and recovery site remain unchanged. Password recovery hands off to `https://www.thecaselink.com/forgot-password`; it adds no localhost callback. No background AI worker, email worker, broker, retention scheduler or partner transport was activated.

## Database preparation and preservation

- Read-only preflight found **16 Auth identities, 14 staff records and 2 school families**; one Auth identity was banned. No existing account's password, verification or status was changed.
- Before DDL, encrypted logical schema and data backups were made with AES-256-GCM. Decryption round trips matched the source bytes. Protected SQL was never written as a plaintext backup. This verifies backup encryption, not a full database restore exercise or an off-device backup policy.
- The exact ten additive parent migrations were reviewed, rehearsed in one rolled-back transaction, then applied together with their exact migration-history rows in one committed transaction. This avoids the transient access window that per-file commits could create before the later processing-gate migration. Rehearsal and committed-upgrade checks preserved original identity, password/status, staff and school-record fingerprints. A final CLI dry run reports the remote history up to date, with no migrations, roles or seeds pending.
- Before the separately approved activation, processing and shared-account flags were false, the cutoff was null, every parent table had RLS, and worker group roles had no login, superuser or RLS-bypass privilege. The only private-schema function executable by parents is the intentional `owns_request(uuid)` policy helper; no worker operation was exposed. Actual Storage had only the three reviewed parent policies and private parent buckets.
- Security advisors reported **zero ERROR findings**. Authenticated security-definer warnings increased from 30 to 50 with the intentional authenticated parent RPCs; their authorization/RLS boundaries were reviewed and tested. Existing leaked-password-protection and insufficient-MFA warnings remain unchanged and need an environment-owner decision before public release.
- After the connected test, the exact disposable synthetic Auth/staff/parent records, its private upload and its generated local credential file were removed. Final integrity checks returned to **16 / 14 / 2**, with original identity/password/status, staff records, school records and Auth configuration exactly unchanged. No real person's credentials or school-family contents were used in the browser.

Private backups, SQL, integrity fingerprints, generated credentials and raw operator evidence stay in ignored access-restricted runtime folders. No such values are included in this report or committed to Git.

## Actual connected workflow evidence

`scripts/test-parent-connected.ts` used an operator-created, confirmed, synthetic existing identity with an active synthetic school role. It used real browser → parent API → original Auth/Data API/Storage calls, with **no API interception or scripted fallback/retry**; SDK automatic transport retries were not independently counted. **21 recorded checks passed**:

- Exact-provider browser policy; existing-password entry; exact authenticated subject and owned account; HttpOnly/SameSite cookies and private uncached account responses.
- Three-step food intake with a preparation-only mandate that excludes external execution.
- File selection unavailable before document consent; actual private PDF upload and byte confirmation.
- Persisted pause, resume and cancellation states; sign-out; retained old parent-cookie rejection.

Story: an existing CaseLink user enters a password in the parent sign-in screen, authenticates with the original provider, obtains only their own parent workspace, saves a preparation-only request and private document, controls permission and signs out.

| Boundary        | Result | Evidence                                                                                         |
| --------------- | ------ | ------------------------------------------------------------------------------------------------ |
| UI renders      | Pass   | Exact-provider policy and password-only entry in the actual connected build; responsive captures |
| Client → API    | Pass   | Actual password POST, successful intake/upload/control responses; no intercepted API calls       |
| API → data      | Pass   | Original Auth subject, owned parent household, stored mandate and confirmed private object       |
| Data → response | Pass   | Saved paused/active/cancelled states, private uncached account response                          |
| Response → UI   | Pass   | My support/request navigation, completed controls and return to sign-in; retained cookie denied  |

Separate database checks confirmed exactly one synthetic owned household, no synthetic school family, a cancelled request with its mandate revoked, zero runnable jobs, zero enabled external capabilities and zero external operations. Separate actual localhost HTTP checks passed code-enrollment denial, exact original-site recovery handoff and anonymous account denial. A preliminary actual password-provider check succeeded while the closed parent gate denied workspace access, confirming that authentication alone did not bypass processing closure.

The automated actual-migration cutoff regression covers before/equal/after-cutoff and missing creation dates, staff and nonstaff identities, RLS, durable grants/notices, OTP restrictions, offboarding, bans, unverified identities and dead sessions. It also verifies that a null cutoff retains ordinary separately approved enrollment behavior and parents cannot edit the cutoff. This uses embedded PostgreSQL; the connected smoke does not claim every hosted denial variant was replayed.

## UI and regression evidence

The approved Option 2 Family Panorama, original palette, typography, logo and recognition remain. Header, headline and support-sheet content edges align. Headline/CTA spacing is tighter, the panorama is capped at 1600×400, and both desktop support choices fit in the initial screen. Phones retain the stacked layout and direct urgent access.

- **1,183 tests across 149 files passed**, with all three migration-backed SQL suites included.
- Production connected build, TypeScript, full lint and tracked-secret checks passed.
- **31 responsive captures and 28 interaction-state captures** passed with zero detected axe AA violations or horizontal overflow. These use explicit synthetic API fixtures, separately from the 21 actual connected checks. The wide home is now covered at 1920×934; laptop, phone and narrow reflow checks remain.
- The interaction runner exercises code-error recovery when codes are enabled and password-error recovery in this password-only profile. Help content uses the same enrollment setting as sign-in and the API.
- Independent normal correctness/security/privacy/accessibility and separate Ponytail reviews approved the connected boundary, cutoff, help and homepage. Independent visual inspection approved desktop, phone and wide-screen captures.

## Remaining limits

This proves the bounded existing-account localhost workflow with synthetic records. It does not establish every person's password, complete hosted recovery-email delivery/callback/reset, simultaneous old-school and parent sessions, a public signup flow, scheduled retention, a full restore exercise, family observation, Spanish financial grounding, legal compliance or live program completion. Existing session-isolation, local signup/email/Storage, model/parser/PDF and concurrency evidence remains separately recorded in the [progress ledger](../parent-support-progress.md).

Public deployment and real-family release remain unapproved. External program transports and AI workers are disabled in this connected preview. No further paid model calls were made; the earlier approved 30-call evaluation budget remains exhausted.
