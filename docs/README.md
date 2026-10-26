# CaseLink documentation

**Current product decision: October 25, 2026.** CaseLink is pivoting to parent-owned food support and utility assistance. The parent product is implemented locally on `main`; live release gates remain open. The school baseline is preserved. An additive parent schema and an explicitly approved, time-bounded localhost connection reuse its original account provider while preserving school records and Auth settings. See [implementation progress](parent-support-progress.md) and [connected-account verification](verification/parent-connected-accounts.md) for exact evidence, expiry and open gates.

The latest revision requires maximum useful AI independence from one informed standing authorization and a polished family-ready release across complete food/utility journeys. Earlier preparation-only approval loops and the one-route launch ceiling are superseded. Single-route slices remain useful internal delivery steps; forms, permitted submissions, supported browser work, follow-up and complete product quality belong to the finished scope.

## Current product authority

1. [Parent support MVP PRD](parent-support-mvp-prd.md): product scope, parent journeys, required behavior, trust boundaries, acceptance and launch gates.
2. [Parent support implementation plan](parent-support-implementation-plan.md): dependencies, source change map, full-coverage phase deliverables, autonomy/quality gates and test evidence; full-product effort is estimated after feasibility work.
3. [AGENTS.md](../AGENTS.md): working instructions, review/testing discipline and product north star.
4. [Repository README](../README.md) and [partner data guide](../data/README.md): development/status entry points and directory handling.

The PRD defines intended behavior; source code and exact-release verification establish what is implemented. Phase status changes only with evidence. Product requirements do not grant runtime permissions or establish partner integration access.

Implementation is paused after the October 26 [background/assistant verification checkpoint](verification/parent-background-assistant.md). It records the current pilot deadline, real service checks, cleanup/preservation, final visual review and remaining execution limits. The next session is a full evaluation and structured next-step decision. [Sensitive identity handling](parent-sensitive-identity.md) records required SSN support and optional Plaid Layer prefill as reviewed requirements; those integrations are not implemented.

[Localhost UI/UX review](verification/parent-ui-ux-review.md) records the production-build visual review, fixes and remaining usability checks. [AI evaluation](parent-ai-evaluation.md) distinguishes deterministic orchestration evidence from live model-quality approval.

[Brand options and approval](parent-brand-options.md) records the five imagegen explorations and the owner's explicit Option 2 selection. [Existing accounts](parent-shared-accounts.md) defines safe reuse of the old email/password identities. [Production readiness and continuity](parent-production-readiness.md) maps preserved branding/policies to current research and outstanding release evidence.

[Privacy and regulatory review](parent-privacy-regulatory-review.md) records the October 25 legal applicability research, processor retention distinctions and required launch decisions. It is an engineering assessment for the privacy owner and counsel; it does not certify compliance.

## Existing school deployment and historical evidence

The case-manager baseline is preserved on `codex/case-manager-baseline-2026-10-25` at `700bb46`. Parent work proceeds on `main` from that code state. Branches do not isolate databases or reverse an external operation.

| Document | How to use it after the pivot |
| --- | --- |
| [Production operations runbook](production-operations-runbook.md) | Operate/preserve the existing invitation-only school deployment; do not apply its data/signup assumptions to the parent product |
| [School-pilot tracker](school-pilot-fix-tracker.md) | Historical findings, prior scope and release evidence; reusable safeguards need fresh parent tests |
| [Pilot handoff](pilot-readiness-handoff.md) and [verification records](verification/production-release.md) | Dated release/rollback evidence for their exact code, schema and environment |
| [Intervention-planning PRD](intervention-planning-prd.md) | Superseded school product requirements and research |
| [V1 service definition](v1-service-definition.md) and [product redesign plan](product-redesign-plan.md) | Superseded school workflow and roadmap |
| [PDF/agentic research](agentic-pdf-service-research.md) | Historical research; does not expand current MVP to arbitrary form filling |
| [Architecture audit](architecture-audit.md), [hardening audit](production-hardening-audit.md) and [remediation](production-hardening-remediation.md) | Dated technical findings; verify applicability before acting |
| [Design research](design-research.md) and [visual baseline](visual-redesign-baseline.md) | Earlier audiences/layouts; current parent experience governs new design work |

Retain historical evidence unchanged except for explicit scope banners/corrections. Do not treat an old Current heading as the current product decision. Parent release operations and actual test commands must be documented as implemented, with a separate real-data and go/no-go record before launch.
