<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Coding and review discipline

Ponytail is installed for this project. Use the `ponytail` skill in full mode for every coding, fixing, refactoring, and implementation-design task. Follow its ladder: understand the complete affected flow, reuse existing project patterns, prefer standard-library and native platform behavior, use installed dependencies before adding new ones, and write the smallest correct change.

For every code review, run both:

1. the normal correctness, security, privacy, accessibility, performance, and regression review; and
2. `ponytail-review` for a separate over-engineering and deletion pass.

Ponytail never permits simplifying away input validation, authorization, row-level security, privacy controls, accessibility, data-loss prevention, error recovery, or explicitly requested behavior.

Every non-trivial logic change must include the smallest runnable automated test that would fail if the behavior regressed. Product workflows require appropriate unit, integration, end-to-end, accessibility, AI-evaluation, and PDF-rendering tests as defined in `docs/intervention-planning-prd.md`. Do not treat compilation or a happy-path browser check as sufficient verification.

# Product north star

CaseLink's first product is a focused family-support planning and PDF-export workflow for school case managers. The case manager creates a family profile, records barriers, generates and edits a structured intervention plan, reviews it, and downloads a professional PDF for records or manual use in the school's required system. CitySpan is one current example, not the general product definition. CaseLink does not replace the required system or the case manager's judgment. Broader school-operations automation is a future possibility, not the current product promise.

Use this north star when making product, design, and technical decisions:

- Prioritize the family intake → barriers → intervention plan → PDF export workflow.
- Automate repetitive plan preparation and export, not human judgment, relationships, or final submission.
- Prefer one simple Families page and one coherent Family workspace over dashboards or speculative navigation.
- Do not imply direct CitySpan integration, autonomous submission, district analytics, or unsupported capabilities.
- Build the narrow casework wedge cleanly so it can expand later without prematurely becoming a generic school-management suite.
- Treat student and family information as sensitive by default; favor least-privilege access, traceability, and explicit human approval for consequential actions.

Current product decisions:

- Family creation requires only a non-identifying label and one or more selected barriers. The short description is optional.
- Plans are organized by goals and exact target dates, not Do next / Upcoming / Waiting / Later buckets.
- Every reviewed open action has a case-manager-confirmed target date; Waiting uses the next follow-up or review date.
- The Core release downloads the reviewed intervention plan as a professional black-and-white PDF.
- Agentic blank-PDF upload, field detection, and form filling are deferred pending user validation and a suitable service; they are not part of the current product.
- CaseLink never submits files automatically.
