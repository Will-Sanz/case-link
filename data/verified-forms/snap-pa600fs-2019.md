# Pennsylvania SNAP-only preparation contract

The PDF is the unmodified official English PA 600 FS (SG) 9/19 still linked by Pennsylvania DHS on November 3, 2026. Its exact source URL, byte length, SHA-256, review window, page count and preparation limits are pinned in the adjacent JSON contract. The renderer rejects a different source or expired review; source availability does not establish delegated filing permission.

`src/lib/parent/snap-draft.ts` preserves all 12 original pages and rights text in a clearly marked **INCOMPLETE UNSIGNED PREPARATION - NOT SENT** copy. It never enters signatures, dates of signatures, SSNs, CAO-only decisions, optional race/ethnicity or voter choices. No eligibility calculation uses the old printed policy amounts. The source has no AcroForm fields; drawing coordinates were inspected against the exact official form.

The production-facing `current_scoped_facts` input accepts only the existing ZIP, language, household-size and aggregate-income inventory. ZIP and language can fill their actual fields. A count cannot become a roster, and aggregate/pay-period income cannot become a person's income source, receipt date or this-month total. Those known but unmappable values remain explicitly identified in readiness; the formatter invents no names or income conversions.

The separate `synthetic_rehearsal` input proves deterministic placement for supplied applicant/address/contact details, the eight printed household rows, five identified income rows, and supplied screening, history and expense answers. Missing answers stay blank. Overflow and contradictory/unsupported inputs fail rather than truncate. This branch is an offline formatter proof, **not** new permission to collect, persist, extract or transmit those private fields. A worker must construct the narrow scoped projection itself; an API must not accept a user-selected formatter mode.

Every result remains incomplete for submission. Required protected identifiers, genuine exact-packet personal certifications, recipient/channel permission, delivery and actual agency receipt need their own implemented and tested boundaries. Paper preparation does not certify identity, establish an authorized representative, sign an application, file it, retrieve agency status or complete food access.

Runnable verification:

```sh
npm run test:run -- src/lib/parent/snap-draft.test.ts
CASELINK_PYTHON_BIN=/path/to/python-with-pdfplumber-and-pypdfium2 npm run test:run -- src/lib/parent/snap-draft.test.ts
```

The second command adds three real-source PDF cases, exact text-region assertions, six protected-region pixel comparisons and six rendered page images under ignored `tmp/parent-verification/snap-drafts/`. Full source and rendered request/rights pages were visually inspected. These tests prove formatting boundaries, not live-provider or legal readiness.
