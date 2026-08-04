# CaseLink Product Redesign Plan

**Status:** Scope reset for the first useful product  
**Current wedge:** Family intake → barriers → intervention plan → required paperwork

## 1. What CaseLink must accomplish now

CaseLink should do one repeated job exceptionally well for school case managers:

1. Create a family support case.
2. Capture the family's relevant context and barriers.
3. Generate and edit a structured intervention plan.
4. Upload a blank required PDF.
5. Draft form entries from approved family and plan information.
6. Show missing or uncertain answers rather than inventing them.
7. Let the case manager review and edit every populated field.
8. Download the completed PDF for manual submission to CitySpan.

The product is successful when a case manager spends materially less time reconstructing the same information in required paperwork while retaining full control of the plan and final form.

## 2. Product boundaries

### Included

- Public Home and Product + About pages
- Request a Demo as the public conversion action
- Private Families list and new-family flow
- One family workspace with Profile, Barriers, Intervention Plan, and Paperwork
- Human-reviewed AI plan generation
- Blank PDF upload, field mapping, review, editing, and download
- Plain-language privacy and data-handling explanations

### Not included

- District operations dashboards
- General caseload analytics
- Calendar or broad task management
- Global AI-review inboxes
- Supervisor workload monitoring
- Direct CitySpan integration or submission
- Additional school-operation workflows

These may enter discovery later. They should not appear in navigation or marketing until evidence justifies them.

## 3. Product surfaces

### Public Home

**Goal:** A district or school administrator understands the narrow problem, four-step workflow, human-review boundary, and next action within a few minutes.

**Primary action:** Request a Demo.

### Product + About

**Goal:** Explain the complete workflow, demonstrate the actual interface, clarify what CaseLink does and does not automate, and tell the honest origin story.

### Families

**Goal:** Let a case manager create a family or reopen an existing family without passing through a dashboard.

### Family Workspace

**Goal:** Keep all work for one family inside four stable steps: Profile, Barriers, Intervention Plan, and Paperwork.

### Paperwork Review

**Goal:** Make every populated, uncertain, and missing field visible; keep its source traceable; and require review before download.

## 4. Delivery phases

### Phase 0 — Validate the paperwork workflow

Actions:

- Collect the exact blank CitySpan PDFs used by the first pilot case managers.
- Document the current manual sequence, repeated fields, edge cases, and average effort without treating estimates as public claims.
- Classify every required field and identify which fields come from intake, barriers, or the intervention plan.
- Resolve whether identifying data is stored, processed temporarily, or entered only during export.
- Confirm city, district, school, and vendor authorization requirements.

Success:

- One approved pilot form and field map.
- A documented privacy and retention decision.
- A safe synthetic test fixture and an agreed review policy.

### Phase 1 — Establish the focused product shell

Actions:

- Redesign the public Home and Product + About pages around the paperwork workflow.
- Replace public self-signup with Request a Demo.
- Reduce private navigation to Families, account access, and help.
- Establish reusable typography, color, spacing, form, table, tabs, dialog, upload, document-review, status, and error-state components.

Success:

- A visitor can accurately describe the product and its CitySpan boundary.
- A case manager reaches Families immediately after authentication.
- Desktop and mobile layouts meet accessibility and responsive acceptance criteria.

### Phase 2 — Perfect the existing case workflow

Actions:

- Simplify family creation and progressive profile entry.
- Make barrier capture fast and understandable.
- Strengthen structured plan generation, editing, source traceability, approval, and failure recovery.
- Consolidate family navigation into Profile, Barriers, Intervention Plan, and Paperwork.

Success:

- A case manager can create a family and approve an intervention plan without training.
- AI output is always visibly a draft and fully editable.
- The critical flow has keyboard, loading, empty, error, retry, and automated-test coverage.

### Phase 3 — Build paperwork preparation

Actions:

- Upload and safely parse one approved blank PDF template.
- Detect fields and map only approved source information.
- Present filled, uncertain, and missing fields separately.
- Let the case manager select a source, enter an answer, edit a value, or leave it blank.
- Render and download a reviewed PDF without directly submitting to CitySpan.

Success:

- The test form is populated accurately from known sources.
- Missing information is never fabricated.
- Every generated value is traceable and reviewable.
- The exported PDF preserves the original form and opens correctly in standard PDF viewers.

### Phase 4 — Run a limited pilot

Actions:

- Onboard a small number of case managers with a few-click guided flow.
- Compare the old and new paperwork process using defined measures.
- Record edits, failures, unsupported form patterns, and privacy concerns.
- Improve the single workflow before adding adjacent features.

Success:

- Case managers can complete the workflow independently.
- Measured administrative effort decreases without reducing form completeness or review quality.
- The pilot produces evidence strong enough to decide whether to expand, revise, or stop.

## 5. Design and component policy

- Use familiar, accessible interaction primitives; do not invent novel controls for common actions.
- Use a table or simple list for Families, not a dashboard.
- Keep the four family steps stable across the workspace.
- Show AI as a draft state with sources, missing information, and explicit approval.
- Use a familiar split document-review pattern for PDF work.
- Never use color as the only status signal.
- Do not show identifying data in demos or mockups.

## 6. Decision filter

Before adding a feature, ask:

1. Does it directly improve intake, barrier capture, plan creation, or required paperwork?
2. Does it remove repeated work the first pilot case managers actually perform?
3. Can it fit inside Families or the existing family workspace?
4. Does the case manager retain final authority?
5. What privacy or authorization decision does it introduce?
6. What evidence will show that it worked?

If the first two answers are unclear, defer the feature.

## 7. Immediate next step

Approve or revise the connected page mockups, then obtain one representative blank CitySpan PDF and map its fields to the existing family and intervention-plan data. Do not implement generalized dashboards before that form workflow is validated.
