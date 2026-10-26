# CaseLink: parent food support and utility assistance

CaseLink's current product direction is direct-to-parent food support and utility assistance with maximum useful AI independence. After minimum intake and one informed authorization, AI chooses and pursues supported programs, handles permitted paperwork/submissions, follows up, and brings in a person only for a real necessary step. The finished release must be a complete, polished product families can use.

**Implementation status:** the parent app is implemented locally on `main` with verified-email accounts, scoped household data, consented documents, durable service jobs, source-backed AI tools, permission controls and current/exact-packet PDF exports. Local automated and production-build UI/UX checks passed; no hosted deployment or real-family processing has been enabled. Live partner transports and final release evidence remain explicit gates in [implementation progress](docs/parent-support-progress.md).

The original CaseLink identity, linked ChatGPT Futures recognition and published policy/contact substance carry into the parent workflow. The owner approved [Option 2, Family Panorama](docs/parent-brand-options.md). [Existing-account support](docs/parent-shared-accounts.md) reuses the same email/password identities through reviewed configuration and an additive migration; it preserves school sessions and records. The localhost preview remains synthetic. [Production readiness](docs/parent-production-readiness.md) records the exact hosted activation and operational evidence still needed.

## Current product documents

- [Detailed parent-support MVP PRD](docs/parent-support-mvp-prd.md): scope, end-to-end journeys, agent authority, consent, partner contracts, privacy, states, acceptance criteria and launch gates.
- [Phased implementation plan](docs/parent-support-implementation-plan.md): current-app change map, dependencies, complete-coverage milestones, autonomy/quality gates and verification. The earlier narrow-product time estimate is superseded; full-product estimates follow feasibility work.
- [AGENTS.md](AGENTS.md): project instructions and product north star.
- [Documentation index and precedence](docs/README.md): current requirements versus legacy runtime instructions and historical evidence.

The parent PRD and implementation plan supersede the school case-manager product roadmap. Historical records remain available for understanding existing behavior and preserving operational safeguards.

## Intended MVP experience

1. Choose food, utilities, or both; receive verified urgent help immediately when needed.
2. Complete minimum adaptive intake or provide supported documents with processing consent. Reuse reliable current facts; allow Not sure and manual entry.
3. Review a short understandable mandate naming permitted programs/recipients, actions, data, limits and preferences. Click **Start getting support** once to authorize the bounded service.
4. GPT-6.1 Sol chooses useful compatible routes, prepares/completes supported forms, executes permitted submissions/referrals/scheduling, checks status and follows up. In-scope routine work proceeds without another approval click.
5. Participate only for genuinely necessary facts, new permissions, required personal authentication/signature/attestation, consequential choices or qualified assistance. The agent prepares that step and resumes afterward.
6. Return to **My support** for meaningful progress, control of the mandate, useful notices/receipts and attributed outcomes. Durable authorized work continues without an open browser.

Finished scope covers immediate food, SNAP new/renewal/pending/routine issues, relevant WIC journeys, electricity/gas/water affordability/arrears/shutoff/disconnection and combined needs within verified geography. Early single-route slices are internal milestones. Every advertised journey needs a real completion contract, with honest autonomous/assisted capabilities; the completed product cannot end at links or referrals. Existing listed resources are partners; program fit, capacity, automation/delegation permission, transport and updates still need verification.

Preparation, referral sending, partner acceptance, agency submission, assistance approval and actual support received are different events. A model response or opened link does not prove any external action succeeded. PDFs support preparation and handoff; completion of a document is not the service outcome.

## Existing application and architecture

| Layer | Current foundation | Parent-MVP direction |
| --- | --- | --- |
| Application | Next.js App Router, React, TypeScript, Tailwind | Reuse components and create the focused parent journey |
| Identity/data | Supabase Auth/Postgres with staff roles, password-session checks and family RLS | Reuse existing verified identities in reviewed shared mode; add owned parent households and scoped permissions without inheriting school records |
| AI | Server-side OpenAI Responses API; local defaults already gpt-6.1-sol; validated text outputs, budgets and privacy checks | Add a judgment/tool-capable coordinator with food/utility playbooks, source-backed facts, standing mandates and permitted execution |
| Work execution | Persisted stages advanced by browser requests | Add verified durable server execution, recovery, waits and duplicate prevention |
| Directory | Existing partner resources and import pipeline | Add reviewed program/route contracts, provenance, freshness and explicit unknowns |
| PDF | @react-pdf/renderer and pdf-lib, reviewed-plan and family-takeaway tests | Reuse for supported forms, useful summaries and exact attempted/submitted packets/receipts |
| Hosting | Managed Vercel and Supabase school deployment; synthetic staging | Separate parent service environment and synthetic staging; retain legacy isolation |

The existing app has invitation-only staff access, de-identified family planning, edited/dated actions, reviewed PDFs and family takeaways. Its school routes remain alongside the separate parent implementation; school deployment approvals do not enable parent processing. Read the [legacy operations runbook](docs/production-operations-runbook.md) before operating that deployment; those school settings must not be relaxed to make the parent prototype work.

The current code is preserved on **codex/case-manager-baseline-2026-10-25**, commit **700bb46**. Main was fast-forwarded to this baseline before the parent documentation changes. The original codex/school-pilot-readiness branch remains intact. These are local Git states; remote publication and hosted deployment are separate operations. Existing untracked design assets and temporary outputs remain outside the preservation commit.

## Development and verification

Use a supported, patched Node 24.x release (.nvmrc), matching CI and hosting, and install locked dependencies with `npm ci`. Read AGENTS.md and installed Next.js guides before framework changes. Parent environment examples, isolated background services and test commands are in [the parent runtime guide](docs/parent-support-runtime.md). The older `.env.example` and production runbook describe the preserved school environment.

Run `npm run parent:verify` for the clean synthetic parent verification path. The focused `parent:test`, `parent:test:db`, `parent:test:pdf` and `parent:test:visual` commands distinguish unit/SQL/PDF/browser evidence. Source tests and a successful build do not certify live provider execution or family readiness.

Legacy commands remain available while school routes are retained:

- `npm run verify`: lockfile/resource/secret checks, typecheck, lint, unit/component tests and production build; the pre-push hook runs it.
- `npm run test:auth-security`: real local Auth lifecycle, password-session and role-access tests.
- `npm run test:db-security`: real local database authorization, concurrency, rollback and audit tests.
- `npm run test:restore`: isolated synthetic backup/restore and authorization rehearsal.
- `npm run test:e2e`: production-build browser account/casework, accessibility and download checks against local Supabase; requires Playwright Chromium and Poppler.
- `npm run test:pdf`: extracted source-content and rendered PDF placement/monochrome checks; requires Python and Poppler.
- `npm run test:ai-quality`: existing opt-in AI-quality corpus under its configured test environment; inspect the harness before a provider-backed run.
- `npm run verify:release -- <exact-commit-SHA>`: required trusted repository checks for that commit; does not deploy or replace hosted release approval.
- `npm run test:ai-contracts -- --live`: optional provider format checks using small synthetic requests and an operator test-project key; excluded from normal CI.

The parent plan requires these layers to grow with new behavior: parent/partner/legacy isolation, comprehensible mandates, source/fact freshness, document permissions, in-scope automatic decisions, necessary intervention, durable retries, exact operation policy/evidence, accessible polished states, AI failure/injection evaluations, forms/exports and operational recovery. Measure family/operator effort and freeze autonomy denominators; missing connectors or manual routine completion cannot be hidden as exclusions. Preserve existing safeguards while implementing the new parent-specific boundary.

Local Supabase uses Docker for isolated synthetic development/test data. Never connect a parent preview to the school's production database. Do not include family content, private partner contacts, credentials, prompts or raw documents in Git, logs or public verification artifacts.

## Partner data and historical operations

The committed resource CSV is synthetic; the real partner network is maintained separately. Preserve it and verify the complete food/utility program/action coverage in delivery phases. See [data/README.md](data/README.md).

The [school-pilot tracker](docs/school-pilot-fix-tracker.md), [school operations runbook](docs/production-operations-runbook.md), [release handoff](docs/pilot-readiness-handoff.md) and docs/verification preserve historical findings and the existing deployment's controls. Their school approvals and passing tests do not establish parent-product readiness.

Before any real parent pilot, verify ownership/acting authority, mandate/consent, data processing, permitted execution, retention/deletion, messages, restore and operating coverage. A broader family-ready release also requires complete journey coverage, visual/accessibility/language quality and measured autonomy/outcomes. Existing /privacy and /terms pages must change alongside actual parent behavior.
