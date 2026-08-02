# CaseLink Visual Redesign Baseline

**Status:** Step 1, first checkpoint  
**Scope:** Public positioning, visual system, application structure, and priority redesign surfaces

## Executive assessment

The current product is a functional early-stage case-management application, but its presentation does not yet communicate the scope, confidence, or operational maturity of the new CaseLink vision. The redesign should not be constrained to reskinning the existing pages. The public website, application shell, core case workspace, and design system all need substantial rework around the student-support operating-system north star.

## Current-state findings

### Public website

- The homepage is a long, primarily text-based explanation of the Alain Locke School use case. It communicates the origin story but not the larger product vision.
- The page lacks a conversion journey: there is no clear product exploration path, request-a-demo action, product preview, trust story, or audience-specific entry point.
- The current public navigation contains only Home. Login and signup are not linked from the homepage today, which is directionally consistent with the new intent, but the direct signup route still exists and the broader invitation/onboarding policy remains unresolved.
- The visual identity is generic: an initial-based blue mark, Inter typography, neutral panels, and limited imagery or product proof.
- The mobile homepage currently overflows horizontally and clips important text at a narrow viewport. Responsive behavior needs to become an explicit acceptance criterion.

### Private product

- The current application language and structure are family-centric rather than organized around a scalable student-support operations model.
- The primary sidebar exposes Home, Families, and Profile. Dashboard, Calendar, and Barriers currently redirect rather than providing durable product destinations.
- Case-level navigation is divided into Overview, 30/60/90 Plan, Resources, and Case Assistant. This is useful prototype coverage, but it does not yet present one unified operational picture.
- Visual hierarchy relies heavily on repeated bordered white containers, slate text, and blue actions. Status and priority are present, but the system does not yet have a distinctive or comprehensive interaction language.
- Shared UI primitives exist, but many feature screens still compose bespoke Tailwind patterns. A stronger design system is needed before widespread page redesign.

### Trust and maturity signals

- Privacy and terms exist, but trust is not yet communicated as a core product capability.
- AI appears as individual generation and assistant features rather than a consistent, reviewable work system.
- Organization setup, school identity, role context, supervision, and accountable AI review are not visible in the current information architecture.
- The current experience does not yet show enough of the product to support a confident school onboarding decision.

## Proposed visual direction: District operations console

The first concept direction is deliberately calm, structured, and operational. It should feel like a well-funded modern enterprise product that a district administrator can understand without training, while avoiding the visual language of a generic analytics dashboard or an “AI magic” demo.

Characteristics:

- Cool-neutral, restrained surfaces with a focused cobalt primary accent
- Distinctive but simple CaseLink mark and typography
- Strong editorial hierarchy on the public site
- Real product UI as the main visual proof
- Compact but quiet data density inside the application
- Status conveyed through language and structure, not color alone
- Clear separation between staff-authored facts, AI-prepared work, and approved records
- Minimal decorative effects; polish comes from proportion, typography, spacing, and state quality

## Proposed public information architecture

1. Homepage
2. Product
3. For schools
4. Trust and safety
5. Our story
6. Request a demo

Existing-customer authentication remains a direct, private entry point shared through onboarding and customer communications. Public self-signup should not be part of the intended acquisition journey.

## Proposed application information architecture

1. Families
2. Profile / account access

Within a family support case:

1. Profile
2. Barriers
3. Intervention Plan
4. Paperwork

The private product should not introduce dashboard, calendar, reports, resources, or global AI-review destinations until a validated workflow requires them.

## Priority visual surfaces

The first concept set covers:

- Public homepage with product positioning and Request a Demo as the primary action
- Families list as the default authenticated destination
- Unified family workspace for profile, barriers, intervention plan, and paperwork

The next concept checkpoint should add:

- Product explanation page
- Request-a-demo flow
- Trust and safety page
- Caseload list and filters
- Support plan detail
- AI review inbox
- School administration and onboarding
- Mobile treatments for the public homepage, work queue, and case workspace

The earlier dashboard comparison is superseded by the narrower V1 service definition. The next mockup set covers one connected public and private journey: Home, Product + About, Families, Family Workspace, and PDF Review.

## Decisions to validate before implementation

- Whether the primary record is named Student, Case, Student Case, or Support Case in each context
- The first pilot roles and their access boundaries
- Whether the public site should mention the ChatGPT Futures grant and how prominently
- Whether Alain Locke School remains the central origin story or becomes one proof point within a broader narrative
- Who receives demo requests and what the follow-up workflow should be
- Whether invited users authenticate with password, magic link, or school SSO during the first pilot

## Decisions already made

- The district administrator is the primary public-site buyer and demo audience.
- The case manager is the primary authenticated user. Their starting page is a simple family list rather than a dashboard.
- District-administrator setup and reporting are separate, permissioned product surfaces.
- The first release will not hold identifiable student or family information. Staff identity required for access is handled separately.
- Onboarding must assume no technical knowledge and reach a useful pilot workspace in a few understandable clicks.
- Public acquisition uses Request a Demo; public self-signup is not part of the journey.

## Initial acceptance criteria

- A public visitor can understand the product category, users, core value, AI boundary, and next action without reading a long narrative.
- Request a Demo is the single dominant public conversion action.
- Login and signup are not promoted in public navigation; self-signup behavior matches the approved onboarding policy.
- Public and private experiences share a recognizable brand but use layouts appropriate to their jobs.
- Priority authenticated screens make ownership, urgency, timing, review state, and next action immediately legible.
- All redesigned priority screens have explicit mobile, keyboard, loading, empty, error, and restricted-access states.
- The new design system is implemented through reusable tokens and primitives rather than page-specific styling.
