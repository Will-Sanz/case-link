# Running the parent service

This implementation runs locally on `main`; it has not been deployed or enabled for real families. The user’s priority is finishing the MVP. Use synthetic data to keep implementation, design and tests moving while partner, vendor and legal decisions are recorded separately. The school baseline remains on `codex/case-manager-baseline-2026-10-25` at `700bb46`.

## Application and background processes

The Next application serves the parent experience and authenticated, uncached parent API routes. Supabase verifies adult email accounts and enforces household ownership independently of the web app. Separate private tables store bounded service grants, jobs, exact operations, documents, form artifacts, receipts and notification work. School roles do not inherit parent access.

The isolated service worker runs one due authorized turn per invocation. It calls Sol through Responses, reads only scoped broker-approved objects, prepares verified forms, executes registered provider transports, reconciles uncertain deliveries, records attributed events and schedules the next turn. Run it periodically in a protected worker service; browser polling only reads progress. Ordinary sign-out does not revoke a standing mandate. Corrections, scope changes, pause, cancellation, deletion, expiry and account holds invalidate affected work.

`PARENT_TRANSPORTS` in `src/lib/parent/worker-runtime.ts` is intentionally empty until an actual partner protocol and automation permission have been verified. Adding a row to the capability registry does not implement a transport. A model response, generated form, partner listing or test adapter never proves delivery. Families see preparation and a service-owned connection wait where appropriate.

The storage broker holds protected Storage access in a separate process. The worker receives a 30-second scoped download URL or broker upload grant; it receives no storage-admin credential or parent refresh token. Upload grants verify exact PDF bytes and current authority again. The broker binds to loopback; a hosted worker needs an authenticated private service connection or an approved HTTPS reverse proxy to that listener. Never expose an unauthenticated broker port.

Documents are quarantined by the web API. Full PDF/image decoding, text extraction and OCR run in the restricted parser container: no network, read-only root, no credentials or host mounts, non-root user, bounded memory/CPU/processes/time. Selected financial/provider/date source lines go to structured AI extraction; independent parser text validates every accepted quote/value. Do not run native file parsers inside the web process.

Retention is a separate isolated process: first remove exact eligible private objects, then acknowledge eligible parent-purpose database cleanup. It never deletes the reused Auth identity or school records. Schedule and monitor it; expiry metadata alone is not proof of erasure. Reapply parent-purpose deletion tombstones during a restore before reopening processing.

Existing CaseLink email/password identities can be reused with `CASELINK_PARENT_ACCOUNT_MODE=existing`, the additive shared-account migration and reviewed processing controls. See [the exact activation guide](parent-shared-accounts.md); do not substitute the isolated local Auth hook for a shared project's global enrollment policy. The synthetic localhost preview has no live account connection.

The separately approved existing-account localhost profile uses `npm run parent:connected:build`, then `npm run parent:connected`, with `CASELINK_PARENT_CONNECTED_APPROVED=1`, the exact approved provider in `CASELINK_PARENT_PRODUCTION_SUPABASE_URL`, and its original HTTPS recovery site in `CASELINK_PARENT_RECOVERY_SITE_URL`. It binds only `127.0.0.1:3200`, hashes the approved build/runtime profile, excludes private credentials and disables email-code enrollment. Existing identity cutoff and time-bounded database approval still apply. The October 26 approval expires at **18:08:45 UTC / 2:08 p.m. EDT**; expiry closes parent access independently of the running server. Do not silently renew it. [Actual evidence and remaining limits](verification/parent-connected-accounts.md).

## Local synthetic setup

1. Install the locked Node 24 dependencies with `npm ci`. Copy `parent.env.example` to a private environment file and supply the **local parent** publishable key. Do not edit or import the school environment file.
2. Set `CASELINK_SUPABASE_CLI` to an installed Supabase executable and run `node scripts/parent-local-stack.mjs start`. Docker must already be available in the background. The isolated profile uses API 55321, database 55322 and test mail 55324. `reset` resets this profile only; inspect it before using that destructive local command.
3. Apply the repository migrations in the isolated profile. Its `before_user_created` Auth hook points to `public.parent_before_user_created`; the database processing control defaults closed. For synthetic local work only, an operator can set `parent_private.processing_controls.enabled=true`, a synthetic approval reference and a short `approved_until`. Never copy a local enablement into a hosted environment.
4. Start Next with the explicit parent environment and a separate port, normally 3200. Next also reads local environment files: keep school secrets out of the process. A missing/unsafe parent configuration returns an honest unavailable state; do not relax school guards to bypass it.
   For a production-build visual preview with synthetic environment settings, run `npm run parent:preview`; it listens only on `http://127.0.0.1:3200`. The default uses a placeholder public key and does not establish working Auth. For actual isolated local services, set `CASELINK_SUPABASE_CLI`, build with `node scripts/verify-parent.mjs --local-services --build`, then start `node scripts/serve-parent.mjs --local-services`. Both privately read and validate only the local public key; the web runtime receives no operator/model secrets. The headless `parent:test:ux` runner uses explicit API fixtures; `parent:test:auth` uses real local services with no API interception.

5. Build the parser with `docker build -f docker/parent-document-worker.Dockerfile -t caselink-document-parser:local .`. Pin the approved base-image digest when recording a release candidate. The parser script’s default image name must match the built image.
6. Provision dedicated database LOGIN roles with `NOINHERIT`, no superuser/BYPASSRLS/role-creation powers, and membership in exactly one matching group: `parent_worker`, `parent_storage_broker` or `parent_retention_worker`. The group roles themselves are NOLOGIN. Each process checks the login and uses `SET ROLE`; never give a worker `postgres`, `service_role`, an owner role or a parent session.
7. Run the broker, service worker and retention commands with **separate protected environments**. Each command refuses unsafe project isolation or privileged identity. Do not supply these settings to Next.

| Runtime | Required protected settings |
| --- | --- |
| Service worker | `CASELINK_PARENT_WORKER_DATABASE_URL`, `CASELINK_PARENT_WORKER_SUPABASE_URL`, `CASELINK_PARENT_STORAGE_BROKER_ORIGIN`, `CASELINK_PARENT_STORAGE_BROKER_SECRET`, `OPENAI_API_KEY` for model work |
| Storage broker | `CASELINK_PARENT_STORAGE_BROKER_DATABASE_URL`, `CASELINK_PARENT_STORAGE_BROKER_SUPABASE_URL`, `CASELINK_PARENT_STORAGE_BROKER_STORAGE_KEY`, `CASELINK_PARENT_STORAGE_BROKER_SECRET`, its private `CASELINK_PARENT_STORAGE_BROKER_ORIGIN` |
| Retention | `CASELINK_PARENT_RETENTION_DATABASE_URL`, `CASELINK_PARENT_RETENTION_SUPABASE_URL`, `CASELINK_PARENT_RETENTION_STORAGE_KEY` |
| Parent email delivery | Isolated worker only: `CASELINK_PARENT_NOTIFICATIONS_APPROVED=1`, `RESEND_API_KEY`, verified `CASELINK_PARENT_EMAIL_FROM`, exact HTTPS `NEXT_PUBLIC_SITE_URL` |

Remote processes additionally require their explicit `*_APPROVED=1` flag and approved school/parent project origins. These flags do not replace the database processing control, actual permissions, service isolation or release evidence. Protect database connections with verified TLS and platform-managed secrets. Do not put keys in command history, URLs printed to logs, test fixtures or browser bundles.

Email uses fixed generic copy and a sign-in link, with no program, benefit status, financial amount or document in the preview. The outbox rechecks current consent and quiet hours before sending. A provider acceptance reference is transport evidence, not proof a family read or received the email. Unknown sends require reconciliation; never blindly replay them. Provider provisioning and approved sender/domain configuration are still external launch work. Connected Marketplace discovery was unavailable in this session; no provider account was installed and no external support notifications were sent. Local Auth test messages use only the isolated test inbox.

## Verification

| Command | What it proves |
| --- | --- |
| `npm run parent:verify` | Clean synthetic parent environment: existing integrity checks, TypeScript, lint, all unit/component tests and production build |
| `npm run parent:test` | Parent policy, service, parser boundaries, runtime ports, UI and API regression cases |
| `npm run parent:test:db` | Isolated real PostgreSQL/Supabase database authorization checks when the local stack exists; inspect the script’s target guard |
| `CASELINK_SUPABASE_CLI=/absolute/path/to/supabase npm run parent:test:auth` | Actual local browser, Auth, test-email, Data API and private Storage checks; requires the migrated isolated stack, bounded synthetic processing approval and actual-local-services build |
| `CASELINK_SUPABASE_CLI=/absolute/path/to/supabase npm run parent:test:browser` | Actual isolated Auth/RLS/private-browser HTTP checks on an ephemeral loopback port, with exact synthetic fixture cleanup and local-control restoration; does not restart the current preview or launch Chromium |
| `CASELINK_SUPABASE_CLI=/absolute/path/to/supabase CASELINK_SNAP_READINESS_APPROVED=1 npm run parent:test:browser` | Adds one real public COMPASS navigation through the actual authenticated private service; proves masked frame delivery and a confirmed stop boundary, never applicant entry, CAPTCHA solving or filing |
| `npm run parent:test:parser` | Actual isolated Docker PDF/image/OCR and malformed-file checks; builds no image and makes no model calls |
| `CASELINK_PARENT_SQL_FIXTURE_MODULE=/absolute/path/to/pglite/dist/index.js npm run parent:test:db` | Embedded PostgreSQL serial migration/RLS/RPC tests; **not** real Auth/Storage or concurrent connections |
| `npm run parent:test:pdf` | Synthetic summary/packet/form fidelity, page bounds and rendered images; provide `CASELINK_PYTHON_BIN` for Python with bundled `pypdfium2` |
| `npm run parent:test:ux` | Production localhost intake/permission/document/account/recovery UX captures with synthetic API fixtures; includes keyboard skip-link, axe and responsive checks |
| `npm run parent:test:visual` | Hidden/headless local browser, responsive layouts and axe AA checks using synthetic API fixtures; not live account/backend integration |

The actual database runner snapshots and restores local processing controls and operator SET-role memberships. It requires existing direct ADMIN membership before temporarily enabling SET; it never provisions a worker login or weakens production roles. Only its own metadata-only Storage fixtures use a transaction-local deletion exception; the normal Storage guard is verified afterward.

The worker lifecycle, correction and existing-identity cutoff integration tests require `CASELINK_PARENT_SQL_FIXTURE_MODULE`; without it they are explicitly skipped. Set this variable for the full unit run to include the actual migrations and catch SQL argument, enum, correction and transaction mismatches. Real Supabase and concurrent-connection checks remain separate. Generated local secrets and evidence stay under ignored, access-restricted `tmp/parent-runtime/` and `tmp/parent-verification/`. Do not publish CLI status output or copy credentials into reports.

No test sends a live application or uses real family records. The user approved a capped synthetic live-AI run separately; ordinary tests do not enable paid calls. See [progress and evidence](parent-support-progress.md) for the exact verified candidate and remaining checks.

## Before a family release

Record per-program accepted data, recipient identity, permission/delegation, current source/form version, personal acts, transport, status references, receipt meanings, follow-up and exception owner. Rehearse each advertised route through its real permitted completion contract. Enable only those tested capabilities; do not call a preparation-only route autonomous completion.

Complete real Auth/Storage/concurrent worker and parser-container tests, model evaluation/review, operational scheduling/recovery/restore, approved notices/processor settings, family usability observation and reviewed consequential language. These are deployment and release facts, not reasons to stop local MVP development. The [dated privacy assessment](parent-privacy-regulatory-review.md) records legal applicability questions without certifying compliance.
