<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Product north star

CaseLink's first product is a focused family-support planning and paperwork workflow for school case managers. The case manager creates a family profile, records barriers, generates and edits a structured intervention plan, uploads a blank required PDF, reviews the AI-populated draft, and downloads the completed form for manual submission to CitySpan. CaseLink does not replace CitySpan or the case manager's judgment. Broader school-operations automation is a future possibility, not the current product promise.

Use this north star when making product, design, and technical decisions:

- Prioritize the family intake → barriers → intervention plan → paperwork workflow.
- Automate repetitive plan and form preparation, not human judgment, relationships, or final submission.
- Prefer one simple Families page and one coherent Family workspace over dashboards or speculative navigation.
- Do not imply direct CitySpan integration, autonomous submission, district analytics, or unsupported capabilities.
- Build the narrow casework wedge cleanly so it can expand later without prematurely becoming a generic school-management suite.
- Treat student and family information as sensitive by default; favor least-privilege access, traceability, and explicit human approval for consequential actions.
