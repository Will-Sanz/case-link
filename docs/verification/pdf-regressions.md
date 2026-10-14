# Reviewed-plan PDF verification

Run `npm run test:pdf` after installing Python 3 and Poppler (`poppler-utils` on Ubuntu, `poppler` on Homebrew). CI runs the same command. It needs no credentials, database, provider, or network access. `CASELINK_PYTHON_BIN`, `PDFTOTEXT_BIN`, and `PDFTOPPM_BIN` can point to existing installations.

The four synthetic cases in `tests/fixtures/pdf-plans.ts` cover Waiting/follow-up, pending, started, completed and withdrawn tasks; missing completed dates and a leap day; sourced directory contacts; eight goals and forty tasks; maximum-length descriptions, notes and outcomes; a 486-character unbroken filename; and Western European accents, including decomposed Unicode.

The verifier compares extracted source fields and their repeated-word inventory, checks every page's footer, printable margins, overlapping text, goal-heading placement, and RGB equality for black-and-white output. It fails on internal status markers, omitted text, obsolete Waiting dates, or incorrect completion counts. Rendered-component tests cover the same preview/download bytes, approval before/after generation and before download, failed rendering/finalization and retry, late requests, unavailable authorization, URL cleanup, and accessible status/error messages.

Set `CASELINK_PDF_RENDER_PNG=1` to render page images too. Files and a machine-readable `verification.json` are written to `tmp/pdfs/export-regressions/` (or `CASELINK_PDF_EVIDENCE_DIR`). Inspect every numbered page after changing layout. Automated geometry checks complement visual review; they cannot establish reading quality. Keep only synthetic content in fixtures and evidence. Actual authenticated browser/download verification belongs to CL-08; school acceptance belongs to CL-34.

The document uses built-in Helvetica, with no external font download. Supported Western European text is normalized to NFC. Unsupported glyphs (including emoji and non-Latin scripts) stop export with a clear message and preserve the saved plan. Broader language support requires an embedded font and new rendered cases; never silently remove or transliterate reviewed content to make a PDF pass.

October 13, 2026: the corpus reproduced exposed internal notes, a clipped long filename, and an orphaned goal heading. The fixes preserve human notes, wrap long words, and keep headings with their first task. Visual inspection also identified withdrawn tasks being counted as completed; shared progress counts now distinguish them. Final corpus results are recorded in `2026-10-14-pdf-regressions.json`.
