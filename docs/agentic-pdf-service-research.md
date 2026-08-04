# Agentic PDF filling service research

**Status:** Deferred
**Decision date:** August 4, 2026

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
