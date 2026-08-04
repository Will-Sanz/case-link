# CaseLink V1 Service Definition

**Status:** Product scope for visual redesign  
**Primary user:** School case manager  
**Buyer:** District or school administrator

> **Scope update — August 4, 2026:** V1 downloads the reviewed intervention plan as a professional PDF. Uploading and filling arbitrary PDF forms is deferred. The earlier workflow below is retained as research context. See `docs/agentic-pdf-service-research.md`.

## The job to be done

Help a case manager move from learning about a family's needs to producing reviewed paperwork for the city-mandated system with much less repetitive copying and formatting.

CaseLink is a preparation workspace beside CitySpan, not a replacement for it and not a direct integration in V1.

## The complete V1 workflow

1. **Create a family**
   - Start a new de-identified family support case.
   - Enter only the information needed for planning and paperwork.
2. **Capture barriers**
   - Select and describe the barriers affecting the family.
   - Preserve the case manager's language and context.
3. **Generate an intervention plan**
   - Produce a structured plan from the approved family information and barriers.
   - Let the case manager edit every part before accepting it.
4. **Prepare required paperwork**
   - Upload a blank PDF template.
   - Identify its fields and map approved family and plan information into a draft.
   - Show uncertain or missing fields instead of guessing.
5. **Review and export**
   - Let the case manager edit the completed form and compare it with the source plan.
   - Require explicit review before export.
   - Download the finished PDF for manual upload to CitySpan.

## Product surfaces

### Public

- **Home:** the problem, the focused promise, a four-step product demonstration, trust boundary, and Request a Demo.
- **Product + About:** the workflow in detail, what AI does and does not do, the relationship to CitySpan, privacy posture, and the origin story.

### Private

- **Families:** search, create a family, and open an existing family. No charts or generalized dashboard widgets.
- **Family workspace:** one stable shell with Profile, Barriers, Intervention Plan, and Paperwork. The active step changes the working surface without adding top-level pages.

## Explicitly out of scope for V1

- A district-wide operations dashboard
- Caseload analytics and performance reporting
- Calendar, scheduling, and general task management
- A global AI-review inbox
- Autonomous decisions or autonomous submission
- Direct CitySpan login, integration, or upload
- Broad counseling, special education, facilities, or district paperwork workflows

## Required trust behavior

- AI-generated plans and form entries are drafts until the case manager approves them.
- Missing information remains visibly missing; the system does not invent answers.
- Every populated form field should be traceable to a family-profile or intervention-plan source.
- Blank templates, generated drafts, and exported forms need clear lifecycle and deletion rules.
- No claims of CitySpan partnership, endorsement, or integration should appear without written authorization.

## Privacy decision required before implementation

The PDF workflow may need to process identifying family information even though earlier scope excluded it. Before building, decide:

- Which CitySpan forms and fields are in the first pilot
- Whether identifying data is stored, processed ephemerally, or entered only during export
- Whether uploaded and generated PDFs are retained, and for how long
- Which model and document-processing services receive form contents
- Encryption, access control, audit, deletion, incident response, and consent requirements
- Whether the city, district, or school must approve the workflow

The visual concepts use synthetic, de-identified family labels until these decisions are complete.
