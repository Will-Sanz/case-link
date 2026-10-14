# CaseLink: Family Support Planning

CaseLink helps school case managers create a family support plan, review it, and download a professional black-and-white PDF for records or manual use in the school's required system.

## Pilot workflow

1. An invited staff member signs in. Administrators enroll and verify an authenticator.
2. Create a family with a non-identifying label and one or more barriers. A short description is optional.
3. Generate a plan organized by goals and specific target dates. Review suggested resources and verify their suitability.
4. Edit the draft, confirm responsibility and dates, and record progress. Waiting actions use their next follow-up date.
5. Mark the current plan reviewed, preview the PDF, and download it. A material edit requires another review.

The case manager decides what becomes official and handles any submission outside CaseLink. Blank-PDF upload, field detection, form filling, direct CitySpan integration, automatic submission, district analytics, and broader school operations are deferred.

## School demo and acceptance

Use synthetic information until the [pilot checklist](docs/school-pilot-fix-tracker.md) and hosted launch gates are signed off. Show the complete workflow above, including one manual date edit, one selected AI wording change, a waiting follow-up, a saved meeting outcome, and a reviewed PDF. Reopen the family and verify those changes persist. Demonstrate a recoverable AI failure without losing edits. Do not demonstrate uploaded-form filling.

The pilot supports a few staff at one school, with one dedicated deployment. Real case circumstances must be de-identified: use family labels, omit names, birth dates, contact details, addresses, student IDs, and other identifying narrative. Automated checks cannot guarantee de-identification; staff practice and the school's approval remain required.

## Architecture

| Layer | Technology |
| --- | --- |
| Application | Next.js App Router, React, TypeScript, Tailwind |
| Identity and database | Supabase Auth and Postgres, with row-level security |
| AI | Server-side OpenAI Responses API; allowed models and validated task outputs |
| PDF | Browser rendering with `@react-pdf/renderer`; finalization with `pdf-lib` |
| Hosting target | Managed Vercel application and a dedicated Supabase project |

Interactive requests use the signed-in user's database permissions. Privileged service credentials belong only to protected operator jobs. AI drafting, refinement, and the case assistant use family-scoped context and explicit human review. Generation is staged and persisted; failures must remain visible and retryable. There is no legacy rules fallback presented as an AI-generated plan.

PDFs are generated from the reviewed plan in the browser. CaseLink does not accept PDF uploads or send PDF bytes to OpenAI. Downloaded files become the user's responsibility under school policy.

## Development and verification

Use a supported, patched Node 24.x release (`.nvmrc`), matching CI and hosting, and install the locked dependencies with `npm ci`. Use `.env.example` as the configuration reference, then start the app with `npm run dev`. Read `AGENTS.md` and the installed Next.js guides before changing framework code.

- `npm run verify`: lockfile/resource/secret checks, typecheck, lint, unit and component tests, and production build. The pre-push hook runs it.
- `npm run test:auth-security`: real local Auth lifecycle and session/MFA tests.
- `npm run test:db-security`: real local database authorization, concurrency, rollback, and audit tests.
- `npm run test:restore`: isolated synthetic backup/restore and authorization rehearsal; no hosted database changes.
- `npm run test:e2e`: production-build browser account/casework, accessibility and download checks against local Supabase.
- `npm run test:pdf`: extracted source-content and rendered PDF placement/monochrome checks; requires Python and Poppler.
- `npm run verify:release -- <exact-commit-SHA>`: confirm required trusted repository checks for that commit; this does not deploy or replace hosted/school approval.
- `npm run test:ai-contracts -- --live`: opt-in provider format check with eight small synthetic requests. Supply an operator test-project `OPENAI_API_KEY` through the environment; it is excluded from normal CI and prints only pass/fail metadata.

Local Supabase uses Docker to isolate synthetic development/test data. Docker is a local testing tool; staff do not install it, and this does not select production hosting. See the [operations runbook](docs/production-operations-runbook.md) for environment separation and required hosted rehearsals.

The resource CSV shipped in the repository is synthetic. An approved, verified school directory is a separate launch gate; see [data/README.md](data/README.md).

## Current requirements and launch status

- [Current pilot requirements and historical PRD](docs/intervention-planning-prd.md)
- [Pilot fix tracker and launch gates](docs/school-pilot-fix-tracker.md)
- [Production operations runbook](docs/production-operations-runbook.md)
- [Deferred PDF research](docs/agentic-pdf-service-research.md)
- Privacy and terms are available at `/privacy` and `/terms`.

A passing build is not pilot approval. Hosted email, permissions, backup restoration, school data approval, resource verification, and staff acceptance must be evidenced before invitations are sent for real use.
