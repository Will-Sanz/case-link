# CaseLink: parent food support and utility assistance

CaseLink's current product direction is direct-to-parent support for food access and utility assistance. Parents provide a small amount of information, start AI preparation, review the relevant facts and sharing, and receive help through a supported partner handoff and continued follow-up.

**Implementation status:** the repository still contains the staff-oriented case-manager application. The parent experience, signup, private document processing, agent tools, partner execution, and durable follow-up below are requirements to implement, not live capabilities. This documentation update does not change a hosted deployment or authorize real parent data processing.

## Current product documents

- [Detailed parent-support MVP PRD](docs/parent-support-mvp-prd.md): scope, end-to-end journeys, agent authority, consent, partner contracts, privacy, states, acceptance criteria and launch gates.
- [Phased implementation plan](docs/parent-support-implementation-plan.md): current-app change map, dependencies, proposed effort ranges, phase deliverables and verification.
- [AGENTS.md](AGENTS.md): project instructions and product north star.
- [Documentation index and precedence](docs/README.md): current requirements versus legacy runtime instructions and historical evidence.

The parent PRD and implementation plan supersede the school case-manager product roadmap. Historical records remain available for understanding existing behavior and preserving operational safeguards.

## Intended MVP experience

1. Choose food, utilities, or both; receive verified urgent help immediately when needed.
2. Answer a short adaptive intake, with Not sure and manual-entry paths. A supported utility bill/notice upload can reduce typing after that capability is implemented and approved.
3. Click **Find my support**. GPT-6.1 Sol coordinates research and preparation using reviewed partner facts and scoped tools.
4. Confirm extracted facts and review exactly what would be shared, with which program, and why.
5. Approve a supported partner handoff or complete the agency's required steps. Signatures, identity checks, required attestations and government submission remain parent-led in the MVP.
6. Return to **My support** for acknowledgements, missing information, reminders and an attributed outcome. Durable authorized work continues without an open browser.

Launch scope is one rehearsed benefits path and one utility path, with verified human assistance for other detected intents and an immediate-food route confirmed before it is advertised. Existing listed resources are partners, as confirmed by the product owner; exact program fit, capacity, accepted data, transport and updates still need route-specific verification.

Preparation, referral sending, partner acceptance, agency submission, assistance approval and actual support received are different events. A model response or opened link does not prove any external action succeeded. PDFs support preparation and handoff; completion of a document is not the service outcome.

## Existing application and architecture

| Layer | Current foundation | Parent-MVP direction |
| --- | --- | --- |
| Application | Next.js App Router, React, TypeScript, Tailwind | Reuse components and create the focused parent journey |
| Identity/data | Supabase Auth/Postgres with staff roles, password-session checks and family RLS | Add verified parent accounts, household ownership and scoped partner/operator permissions in an isolated environment |
| AI | Server-side OpenAI Responses API; local defaults already gpt-6.1-sol; validated text outputs, budgets and privacy checks | Add one tool-capable coordinator with food/utility playbooks, confirmed extraction and approval-bound execution |
| Work execution | Persisted stages advanced by browser requests | Add verified durable server execution, recovery, waits and duplicate prevention |
| Directory | Existing partner resources and import pipeline | Add reviewed program/route contracts, provenance, freshness and explicit unknowns |
| PDF | @react-pdf/renderer and pdf-lib, reviewed-plan and family-takeaway tests | Reuse for optional reviewed preparation/handoff summaries |
| Hosting | Managed Vercel and Supabase school deployment; synthetic staging | Separate parent service environment and synthetic staging; retain legacy isolation |

The existing app has invitation-only staff access, de-identified family planning, edited/dated actions, reviewed PDFs and family takeaways. It has no parent accounts or supported upload/referral execution. Read the [legacy operations runbook](docs/production-operations-runbook.md) before operating that deployment; those school settings must not be relaxed to make the parent prototype work.

The current code is preserved on **codex/case-manager-baseline-2026-10-25**, commit **700bb46**. Main was fast-forwarded to this baseline before the parent documentation changes. The original codex/school-pilot-readiness branch remains intact. These are local Git states; remote publication and hosted deployment are separate operations. Existing untracked design assets and temporary outputs remain outside the preservation commit.

## Development and verification

Use a supported, patched Node 24.x release (.nvmrc), matching CI and hosting, and install locked dependencies with `npm ci`. Use .env.example as the current runtime configuration reference, then `npm run dev`. Read AGENTS.md and installed Next.js guides before framework changes. New parent-mode configuration belongs to the implementation plan; .env.example and current environment validation still encode the school baseline.

Existing commands below verify the implemented school application until explicitly extended for parent workflows. A passing existing suite does not certify the proposed parent service.

- `npm run verify`: lockfile/resource/secret checks, typecheck, lint, unit/component tests and production build; the pre-push hook runs it.
- `npm run test:auth-security`: real local Auth lifecycle, password-session and role-access tests.
- `npm run test:db-security`: real local database authorization, concurrency, rollback and audit tests.
- `npm run test:restore`: isolated synthetic backup/restore and authorization rehearsal.
- `npm run test:e2e`: production-build browser account/casework, accessibility and download checks against local Supabase; requires Playwright Chromium and Poppler.
- `npm run test:pdf`: extracted source-content and rendered PDF placement/monochrome checks; requires Python and Poppler.
- `npm run test:ai-quality`: existing opt-in AI-quality corpus under its configured test environment; inspect the harness before a provider-backed run.
- `npm run verify:release -- <exact-commit-SHA>`: required trusted repository checks for that commit; does not deploy or replace hosted release approval.
- `npm run test:ai-contracts -- --live`: optional provider format checks using small synthetic requests and an operator test-project key; excluded from normal CI.

The parent plan requires these layers to grow with new behavior: real parent/partner/legacy isolation, document and consent boundaries, durable retries, exact-packet approval, handoff evidence, accessibility, AI failure/injection evaluations, rendered exports and operational recovery. Do not remove existing guards or tests merely because a parent path does not yet fit the school model.

Local Supabase uses Docker for isolated synthetic development/test data. Never connect a parent preview to the school's production database. Do not include family content, private partner contacts, credentials, prompts or raw documents in Git, logs or public verification artifacts.

## Partner data and historical operations

The committed resource CSV is synthetic; the real partner network is maintained separately. Preserve the existing directory and enrich only the verified launch routes. See [data/README.md](data/README.md).

The [school-pilot tracker](docs/school-pilot-fix-tracker.md), [school operations runbook](docs/production-operations-runbook.md), [release handoff](docs/pilot-readiness-handoff.md) and docs/verification preserve historical findings and the existing deployment's controls. Their school approvals and passing tests do not establish parent-product readiness.

Before real parent use, implement and verify the new ownership, consent, data processing, partner handoff, retention/deletion, messaging, restore and operator coverage requirements in the current PRD. Existing /privacy and /terms pages also need to change alongside the parent behavior before launch.
