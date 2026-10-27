# CaseLink documentation

**Current product decision: October 27, 2026.** CaseLink is one parent-owned family-support service. R1 launches confirmed food access and one adult career-support booking lifecycle; R2 retains complete food/utility C-01; R3 expands across the original catalog. Existing parent foundations are implemented locally on `main`; the new routes and family release gates remain open. Preserve the school baseline, original identities and separate parent ownership. See [implementation progress](parent-support-progress.md) and [connected-account verification](verification/parent-connected-accounts.md) for exact tested evidence and time-bounded localhost approval.

The latest revision freezes a staged launch direction without restarting engineering. It supersedes all-C-01-before-first-family-release while preserving full C-01 as R2, maximum useful AI independence, necessary participation only, privacy and polished family-facing behavior. Internal slices remain tests, not launches; a failed provider connection changes a route dependency rather than the product, Auth or theme. No current route becomes active merely from a plan.

## Current product authority

1. [Parent support MVP PRD](parent-support-mvp-prd.md): product scope, parent journeys, required behavior, trust boundaries, acceptance and launch gates.
2. [Parent launch and expansion plan](parent-launch-and-expansion-plan.md): dated route research, R1 milestones L0–L6, owners/critical dependencies, conditional estimate, launch acceptance and complete catalog expansion order.
3. [Parent support implementation plan](parent-support-implementation-plan.md): existing-source change map, reusable engineering phases, preserved PECO/SNAP work, autonomy/quality gates and test evidence; L0–L6 define current R1 working order.
4. [AGENTS.md](../AGENTS.md): working instructions, review/testing discipline and product north star.
5. [Repository README](../README.md) and [partner data guide](../data/README.md): development/status entry points and directory handling.

The PRD defines intended behavior; source code and exact-release verification establish what is implemented. Phase status changes only with evidence. Product requirements do not grant runtime permissions or establish partner integration access.

[Owner needs](parent-owner-needs.md) keeps the running list of partner access and release decisions while independent engineering continues. [Shared-data milestones](verification/parent-shared-data-authority.md) records the current L1 implementation and its exact verification limits.

The original [background/assistant checkpoint](verification/parent-background-assistant.md) retains its October 27, 12:54:27 p.m. EDT pilot deadline and processing limits. The [SNAP/PECO comparison](verification/parent-snap-peco-route-selection.md) and [unsigned preparation piece](verification/parent-peco-cap-preparation.md) are preserved R2 evidence, with the [income/certification checkpoint](verification/parent-peco-income-certification.md) recording reviewed readiness logic and remaining data/signing/delivery gates. Current MVP work follows L0–L6; no restart or new processing approval is inferred. [Sensitive identity handling](parent-sensitive-identity.md) records required SSN support and optional Plaid Layer prefill as requirements; those integrations are not implemented.

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
