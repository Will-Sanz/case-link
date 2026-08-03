# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

CaseLink is used day to day by school case managers, counselors, social workers, student-support staff, and their supervisors. The primary buyer and public-site audience is a district administrator evaluating tools for student-support operations.

Assume evaluators and users have no prior technical knowledge. Product language, setup, navigation, and help must be understandable without software or AI expertise.

## Product Purpose

CaseLink is an AI-assisted workspace for school case managers. Its first service helps a case manager create a family profile, identify barriers, generate a structured intervention plan, and use that plan to prepare required paperwork for review and submission.

AI reduces repetitive administrative work by organizing intake information, drafting the intervention plan, and mapping reviewed information into a blank PDF. Case managers retain control over every decision and edit. Success means less time copying information between systems and forms, without changing the city-mandated system of record.

## Positioning

CaseLink is a focused preparation layer alongside required systems such as CitySpan. It is not an autonomous counselor, a generic chatbot, a replacement for CitySpan, or an immediate operating system for every school workflow. The near-term product succeeds by making one common family-support and paperwork workflow excellent. Broader school-operations expansion remains a possibility, not the current product promise.

## Operating Context

- A district administrator first encounters CaseLink through the public website and a request-a-demo journey.
- The authenticated starting page is a simple list of the case manager's families, not an analytics dashboard or district-monitoring console.
- A district administrator's product surfaces are separate and permissioned around evaluation, setup, access, and appropriately scoped reporting.
- Schools and districts are expected to onboard through an invitation or guided setup rather than public self-signup.
- Initial setup should require only a few understandable choices and clicks.
- A case manager creates a family, records the information needed for the case, selects or describes barriers, and generates a structured intervention plan.
- Inside a family workspace, the case manager can review and edit the profile, barriers, intervention plan, and paperwork.
- The paperwork workflow accepts a blank PDF, maps family and plan information into it with AI assistance, allows the case manager to review and edit the result, and produces a completed PDF for the case manager to upload to CitySpan manually.
- District procurement and technology-adoption requirements need further discovery; the product must not assume buyers already understand AI or case-management software.

## Capabilities and Constraints

- The current application is a Next.js 16 App Router product using React, TypeScript, Tailwind CSS, Supabase Auth/Postgres/RLS, and OpenAI server-side integrations.
- Existing capabilities include family-centric case records, barriers, notes, resource matching, 30/60/90 plans, tasks, calendar-oriented work, exports, and AI assistance.
- Previous planning assumed the first release would not hold identifiable student or family information. Automated CitySpan-form completion may conflict with that assumption because mandated forms may contain identifying fields. Data classification, processing, retention, encryption, model handling, and deletion behavior must be resolved before this workflow is built or piloted.
- Until that decision is approved, product mockups and demonstration data use de-identified family case labels rather than names.
- CaseLink does not submit directly to CitySpan in the initial scope. The case manager downloads the reviewed PDF and uploads it through the required CitySpan workflow.
- Consequential or externally visible AI-generated work requires explicit human review under the applicable workflow policy.
- Public acquisition centers on Request a Demo. Login is a private customer entry point, and public self-signup is not part of the intended journey.
- The interface must not imply direct CitySpan integration, automatic submission, district analytics, workflow monitoring, or other capabilities that have not been built and validated.

## Brand Commitments

- Product name: CaseLink.
- The product should feel polished, funded, credible, and appropriate for institutional daily work.
- Five dashboard and SaaS interface references supplied on August 2, 2026 are binding inputs to the redesign exploration, not layouts to copy literally.
- Avoid presenting AI as magic or substituting it for professional judgment.

## Evidence on Hand

- The current working product and repository.
- Collaboration and early product context connected to case managers at Alain Locke School in Philadelphia.
- Acceptance into the 2026 ChatGPT Futures class and a grant, as stated by the founder. Public usage and exact attribution language remain undecided.
- No approved testimonials, quantified outcomes, district customers, security certifications, or procurement claims are currently documented. Future work must not fabricate them.

## Product Principles

- Automate repetitive coordination and documentation, not human judgment or relationships.
- Make the current family-workflow step and required human review obvious.
- Earn trust through clarity, traceability, least-privilege access, and honest product claims.
- Make first use and onboarding understandable within a few clicks for nontechnical users.
- Perfect the family intake → barriers → intervention plan → paperwork workflow before expanding into broader school operations.

## Accessibility & Inclusion

The web product must support keyboard navigation, semantic structure, readable contrast, responsive layouts, clear focus, understandable language, and assistive-technology labeling as part of normal acceptance—not as a later polish pass. Workflows should not require technical vocabulary or prior familiarity with AI systems.
