# Agentic PDF filling service research

**Status:** Execution capabilities deferred; reviewed preparation is the first step
**Decision date:** October 15, 2026

## Pilot and next steps

For the October 20 school pilot, CaseLink prepares plans and outreach drafts for staff review. The assistant can help draft an email, prepare a call script, or identify proposed changes from a non-identifying meeting update. Staff use their approved systems to contact people and record the outcome. Drafting does not establish consent, send anything, or mark work complete.

The next product decision should come from observing where staff repeatedly copy approved information or spend time preparing outreach. Prefer one specific repeatable task over a general autonomous case manager.

| Capability | First useful version | Evidence required before execution |
| --- | --- | --- |
| Meeting follow-up | Propose changes to existing actions from a brief note, showing the source and before/after values | Conflicting and older notes, stale plans, completed work, selection-only application, atomic save and rollback |
| Email | Draft subject and body from an explicitly selected action; staff confirm content and recipient in their approved email system | Approved account integration; recipient allowlist; family consent/safe-contact scope; exact preview including attachments; explicit send approval bound to that preview; delivery receipt; duplicate prevention |
| Calls | Prepare opening, questions, constraints and an outcome checklist for a staff-led call | School/privacy approval of provider, disclosure and any recording; approved recipient and calling window; family consent; human handoff; immediate stop control; voicemail rules; bounded duration/cost; verified outcome |
| Forms | Populate one school-approved template from an explicitly reviewed plan, leaving unknowns blank; export for manual submission | Field-level provenance, required-field validation, revision check, visual and extracted-value verification, correction before export, private processing and deletion |

For a later execution tool, the model may propose an action but cannot authorize it. The server must recheck staff access, source revision, approved recipient/destination, permitted fields and current consent immediately before execution. Approval expires when any material field changes. Keep drafts separate from executed outcomes and preserve an audit of who approved which exact content.

Use idempotency keys and provider receipts. After an ambiguous timeout, check delivery/call status before retrying; never resend merely because the first response was lost. Revoke pending execution when the case is archived, access is removed, or consent changes. Treat instructions embedded in documents, web pages or provider replies as untrusted data. Do not feed identifying records into the current de-identified planning pipeline.

Release each capability behind its own acceptance gate: synthetic sandbox rehearsal, permission-denial and stale-approval tests, injected instructions, timeout/duplicate callbacks, cancellation, audit inspection and a staff-observed trial. Sending, calling and submitting remain unavailable in the current pilot. A model or framework upgrade alone does not satisfy these gates.

## Existing PDF investigation

## Capability evaluated

The desired workflow was: upload an arbitrary blank PDF, detect its writable areas, fill them from a reviewed CaseLink plan, let the case manager correct every value in the PDF, and download a still-editable copy.

The supplied test PDFs were flat three-page documents with no AcroForm fields or widget annotations. A viable service therefore needs to detect writing regions and create real editable fields, not only place static text over a page.

## Services and approaches considered

| Option | What was evaluated | Result |
| --- | --- | --- |
| Anvil | Hands-on service trial by the product owner | Worked reasonably well and is the best hands-on result so far. No CaseLink integration was completed. |
| Extend | API research and an integration prototype | Promising managed editing workflow, but not validated end to end against the required arbitrary flat-PDF and editable-download acceptance test. |
| Reducto | Official API research and a partial adapter | Documentation described vision-based field detection, returned form schemas, and unflattened output. A live acceptance test was not run because account access was unavailable. |
| EmbedPDF with pdf-lib | Local browser-editor prototype | Could edit genuine fields, but arbitrary flat PDFs still required dependable field detection and field creation. This left too much custom engineering for the current product stage. |

## Current decision

- Remove arbitrary PDF upload, AI field mapping, in-browser form editing, and provider integration from the product.
- Remove uploaded-form browser storage and provider API configuration.
- Keep the professional black-and-white PDF download of the reviewed intervention plan.
- Do not select or integrate another form-filling provider until user conversations confirm that this workflow should be a product priority.

## Revisit only when

1. Case managers confirm that arbitrary form filling is a repeated, high-value need.
2. A provider account and trial environment are available.
3. One flat synthetic PDF and one native fillable PDF can pass a single acceptance test: correct placement, real editable fields, human correction in the browser, editable redownload, and provider-side deletion.
4. Privacy, retention, school authorization, and expected per-document cost are understood.
