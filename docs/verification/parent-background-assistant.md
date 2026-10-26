# Background planning and family assistant checkpoint

Verified October 26, 2026. Implementation is paused at the owner's request after this checkpoint. This records tested behavior, not public-launch certification. The earlier [account rehearsal](parent-connected-accounts.md) remains historical evidence for its original two-hour approval.

## Current private preview

The background-only preview uses `http://127.0.0.1:3200` and original CaseLink email/password identities. It copies no school family records. Separately approved services run planning, request-scoped questions, a private file broker and scheduled parent-purpose retention. Public signup, partner transports and sensitive-identifier submission remain disabled.

- Processing approval expires **October 27, 2026, 12:54:27 p.m. EDT**, `2026-10-27T16:54:27.009Z`. The launcher stops private services at that deadline; current-grant checks independently enforce closure. Password expiry alone does not terminate open database connections.
- The existing-identity cutoff is `2026-10-26T17:29:15.717757Z`. This is a timestamp condition, not a named identity allowlist. New parent enrollment remains closed in the web profile.
- Combined planning/chat project ceiling: **100 reserved model calls**, plus narrower request/account/day limits. Anonymous reservations survive parent deletion so erasure does not refund the project ceiling.
- Three separate expiring SQL logins have only their corresponding worker, broker or retention group. Actual verified-TLS connections passed privilege checks and denied school-table SQL access. The web runtime receives no model, database, storage-admin or email secrets.
- Broker and retention retain a privileged project-wide Storage/HTTP key. SQL restrictions do not constrain its separate Auth/Data/Storage authority. Those processes remain trusted administrative boundaries; shared-provider compromise isolation remains a public-release concern. See [shared-account controls](../parent-shared-accounts.md).

The owner separately approved scheduled cleanup after automatic review required explicit authorization for its broader scope. Restricted retention erased **three synthetic private objects and one synthetic parent membership**. No partner submission or support email was sent.

## Actual connected verification

`scripts/test-parent-connected.ts` passed **21 assertions** through real browser → parent API → original Auth/Data API/Storage with a disposable marked synthetic account. Existing-password sign-in, parent cookies, three-stage preparation-only intake, upload consent/private bytes, pause/resume/cancel, sign-out and retained-cookie denial passed.

`scripts/test-parent-connected-ai.ts` passed **24 assertions**, without intercepted parent/model APIs or fabricated provider responses. [Sanitized results](parent-background-ai-results.json):

- Real combined food/SNAP/electricity intake recorded bounded preparation permission and healthy queued/running progress. Closing every browser page did not prevent the independent worker from saving a plan.
- The real model answered a consented request question after its page closed. Reopening displayed the saved answer and attributed sources. Verification required the actual preparation-only permission statement, not an arbitrary negative word.
- Four original safe UESF/PECO/PWD records and actual City food sites for ZIP 19104 loaded. Availability remained unconfirmed; no fake fallback was used.
- The exact private synthetic bill passed isolated parsing, model extraction and original-source checks. Its own exported document retained `peco`, **145.67** and the exact synthetic due date, with document/page/source evidence.
- Current chat guards rejected an SSN-shaped test value before persistence/model use. Question cancellation, history export, unknown-request denial and an anonymous conversation read returning 401 passed. An unknown UUID is not a hosted cross-household test; separate earlier real-local and migration-backed ownership evidence remains applicable.

The subsequent actual Account-screen deletion test stopped parent access immediately. Restricted retention erased the workspace and all three private objects, completed its tombstone and preserved its shared Auth/staff identity. Only afterward did exact fixture cleanup separately erase that marked synthetic Auth identity. Final original identity/password/status, staff and school fingerprints matched the pre-change values: **16 Auth identities / 14 staff records / 2 school families**. No original person's password was used or changed.

Eight standalone real `gpt-6.1-sol` assistant cases also passed: background truth, necessary next step, SNAP guidance, cancelled-request questions, hostile invented-approval instructions, submission versus approval, parent-reported attribution and secure-channel guidance. They used `store:false`, **8,370 input / 502 output tokens**. [Results](parent-assistant-live-results.json). The connected probe reserved **11 planning/extraction + 2 assistant calls**. Including the eight standalone calls, at most **21 of the separately approved 30 synthetic validation calls** were consumed/reserved. Reservations are conservative accounting, not independently instrumented provider receipts. Pilot capacity is separate. No further paid validation was performed after this checkpoint.

## Automated and visual checks

- **1,278 tests across 169 files passed**, including all migration-backed SQL suites with explicitly selected embedded PostgreSQL. Embedded tests do not emulate Auth, Storage or real concurrency.
- Connected production build, TypeScript, full lint and whitespace checks passed. The final retention-only guard was included in the last full suite and does not change the compiled web UI.
- **45 responsive screens and 36 interaction states** passed with zero detected overflow or automated WCAG 2.2 A/AA findings. Desktop, phone, 320px reflow, tablet and wide home were inspected. These synthetic UI checks are separate from actual-service verification. [UI summary](parent-background-ui-review.json).
- Permission/next-step spacing, status hierarchy and Help card spacing were corrected. Long conversations follow the newest reply internally while preserving a parent reading earlier history; browser checks cover both.
- Independent normal correctness/security/privacy/accessibility and separate Ponytail reviews passed. A connection-query override loophole was fixed through parameter allowlisting and duplicate rejection. Standalone connected retention reuses that guard before creating either privileged client.

Three additive migrations through `20261026163028_parent_partner_directory.sql` were backed up with authenticated encryption, rehearsed with rollback and applied atomically with exact history entries. Original fingerprints matched after rehearsal, upgrade and cleanup. Private backups/evidence remain ignored and protected. Encryption round trips do not establish a full restore exercise. Full hosted Auth settings and security-advisor reports were not freshly re-run for this checkpoint; no Auth configuration mutation was performed, and earlier findings remain separately recorded.

## Limits and next evaluation

External application execution remains absent. The actual COMPASS guest path needs no initial account, but provider verification returned a genuine error/CAPTCHA boundary. No application or official receipt was produced. [SNAP evidence](parent-snap-browser-feasibility.md). A controlled verification handoff, permitted transport, required personal certifications and protected identifier handling remain needed.

Required SSNs are now a conditional product requirement, with protected manual entry and optional consented Plaid Layer prefill specified in [sensitive identity handling](../parent-sensitive-identity.md). No Plaid connection, vault, protected capture field or sensitive submitter is implemented. Existing chat/general-record guards remain; uploaded originals can still contain sensitive information. Do not call the requirement complete.

The next evaluation should reconcile the full PRD against connected behavior/evidence, rank missing end-to-end routes, decide provider/identity/Storage boundaries and produce concrete phased next steps. These checks do not establish legal compliance, complete Spanish quality, hosted signup/recovery, every lifecycle outcome, family comprehension, production monitoring or zero breach risk. No public deployment or release approval was made.
