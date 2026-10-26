# Parent implementation progress

Implemented locally on `main` from the preserved school baseline, `codex/case-manager-baseline-2026-10-25` at `700bb46`. Product authority: [PRD](parent-support-mvp-prd.md) and [implementation plan](parent-support-implementation-plan.md). No hosted deployment, live migration, family records, external applications or messages were used.

The product owner's priority is completing the MVP. Privacy research and external decisions remain recorded launch work; they do not stop synthetic development, visual iteration or implementation. Concrete security defects are fixed as part of the product.

## Implemented

| Area | Local implementation and evidence |
| --- | --- |
| Parent experience | Public food/utility entry, urgent official help, email-code sign-in, adaptive three-stage intake, one bounded mandate, My support, request detail, account/preferences/recovery, help/privacy/terms, responsive navigation and purposeful loading/error/waiting states |
| Ownership and authority | Five forward migrations; separate parent identity/households, current grants, immutable mandate/packet versions, referral-scoped trusted access, no inherited school roles, direct-API processing gate and Auth hook, revocation/correction/deletion propagation |
| Autonomous service | Responses coordinator using GPT-6.1 Sol, independent need routes, targeted personal steps, exact-packet personal-act evidence, verified-form preparation, atomic dispatch, idempotency, unknown-delivery reconciliation, repeated follow-ups, automatic resumption and attributed closure |
| Documents and privacy | Explicit consent, bounded quarantine upload and confirmed-byte resumption, isolated parser/OCR container, source-backed financial facts, per-account corrections, freshness, private broker access and monitored-retention runtime; public-file deletion cannot bypass invalidation |
| Evidence and communication | Exact packet/receipt PDFs, current summaries, prepared-form downloads with byte hashes, attributed parent/program reports, private safe-copy notification outbox, actual configured email transport, quiet hours and bounded final-outcome notice |
| Design | Scoped navy/teal/lemon parent system with self-hosted Geist; legacy context archived. Parent action precedes service waiting. Account-specific questions, direct permission handoff, explicit stale-answer recovery, wrapping consent choices and early urgent-help access |

A registered production program transport is still required for each permitted external route. `PARENT_TRANSPORTS` is empty until actual protocols and permission are verified; synthetic execution adapters are confined to tests. The application reports preparation and service-owned connection waits honestly. This is not a claim that every partner currently accepts autonomous submissions.

## Verification

- Full clean-environment verification passed: lockfile/resource/secret checks, TypeScript, lint, **1,095 tests across 129 files**, including the actual-migration worker lifecycle, and production build. The explicitly selected embedded PostgreSQL runtime enabled the SQL integration test; none was silently skipped in this run.
- Embedded PostgreSQL 18.6/PGlite 0.5.11: **141 recorded authorization/retention/resumption assertions**, plus bounded AI-budget checks. Exact RPC signatures, source-period persistence, genuine personal acts, two distinct follow-ups, final closure and one final consented notice are exercised. This does not emulate real Supabase Auth/Storage or concurrent database connections.
- Deterministic evaluation: **60 synthetic cases / 240 turns**, all ten needs, eight program routes and EN/ES variants, with no failed assertions. **Zero model calls and zero human-reviewed model cases**; model-quality approval remains unestablished. See [report](verification/parent-ai-evaluation-deterministic.md) and [reproduction guide](parent-ai-evaluation.md).
- PDF checks render a three-page combined summary, exact packet/receipt and a known fillable form. Exact values, page bounds and personal signature fields are verified; the reliable existing PDF footer helper is reused.
- Initial and refreshed headless responsive batches cover six surfaces at 1440, 390 and 320 CSS pixels: **18 captures with zero detected axe AA violations or horizontal overflow**.
- The additional user-requested production-localhost UX review covers intake through permission, request progress, documents, stale-answer recovery, combined accounts, account, sign-in recovery and help. Its first pass exposed invalid definition-list semantics and a keyboard skip target; both were corrected. **Final production run: 28 desktop/phone states, zero detected axe AA violations or horizontal overflow; keyboard skip navigation, explicit answer recovery and permission focus handoff pass.** The independent review confirmed the concrete design fixes and coherent professional identity. See [UI/UX review](verification/parent-ui-ux-review.md).
- Independent normal security/correctness review plus a separate Ponytail deletion pass cleared the implemented fixes. The review found and drove the direct-API gate, canonical-origin isolation, withdrawn-document scope, immutable uploads, exact-account facts, packet-specific personal acts and resumption improvements. The unused execution categorizer was removed; no speculative framework or general agent platform was added.

Evidence files are synthetic and local under `tmp/parent-verification`; reproducible commands and isolated runtime settings are in [the runtime guide](parent-support-runtime.md). No successful local test is represented as a deployment or legal certification.

## External readiness ledger

| Gate | Evidence still needed | Owner | Effect |
| --- | --- | --- | --- |
| Program execution | Current accepted fields/forms, automation/delegation permission, actual secure transport/status protocol, receipt meanings, escalation and completion rehearsal for each advertised route | Product/resource owner + partners | Live autonomous transport remains disabled; source preparation and independent development continue |
| Parent infrastructure | Separate approved hosted projects; actual Auth hook/Storage policies, concurrent cancellation/dispatch tests, worker/broker/parser deployment and schedules | Engineering/operator | No real-household processing on school production; Docker daemon was unavailable in this session |
| Vendor/privacy operations | Actual processor/account controls, agreements, justified retention/backups/restore, incident owner/privacy contact and role-specific legal decisions | Service/privacy owners | Record decisions before real-family processing; [dated research](parent-privacy-regulatory-review.md) is an engineering applicability assessment |
| Model and language quality | Reviewed live model cases, actual usage/cost/latency, consequential Spanish review | Product/service owners | Mechanical synthetic results do not approve model judgment or advertise a translated interface |
| Family release | Family observation, real completion contracts, staffed exceptions, hosted monitoring/recovery and exact deployed-candidate review | Product/service + engineering | A local implementation is not a family-release verification |

## Local preview

`npm run parent:preview` serves the production build on loopback port 3200 with synthetic environment settings. `npm run parent:test:ux` uses explicit test-only API interception in a hidden browser; it does not alter application routes, establish live Auth or enable external delivery. The preview is left running after the requested review without opening a window or changing the user's active work.
