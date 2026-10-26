# Parent localhost UI/UX review

Reviewed October 25, 2026 (America/New_York), with a final production-build rerun after the polish fixes. The preview runs on `http://127.0.0.1:3200` in the background; no visible browser or window was opened.

## Result

**28 desktop/phone states passed with zero detected axe AA violations and zero horizontal overflow.** Separate interaction assertions passed for keyboard skip navigation, explicit stale-answer recovery and permission-editor focus handoff. An independent reviewer completed the normal correctness/accessibility review and a separate Ponytail simplification pass, inspected the rebuilt captures and found no material visual regression. Their design disposition was “ship” for this bounded polish pass.

The chosen navy, teal and soft-lemon identity uses self-hosted Geist, clear labels, generous controls and quiet task surfaces. Review found this calm, consistent and appropriate for a family service. The existing direction was retained; an illustration or new theme was unnecessary to explain these workflows.

## Coverage and fixes

Each of these states was reviewed at 1440 × 1000 and 390 × 844 CSS pixels: home, need selection, household details, initial permission review, support detail, answer error, recovered answer, permission editor, document consent, combined utility accounts, permission handoff, account, sign-in recovery and help.

The review drove these changes:

- Necessary parent actions appear before secondary service-owned waiting; urgent help and early-access status appear near the entry action.
- Utility questions name the affected account, including separate electricity and gas questions.
- A request for expanded permission opens and focuses the correct editor directly.
- Stale answers preserve the draft until the parent explicitly loads the current question; recovery then focuses the updated question and submits its current version.
- Permission choices wrap on phones, with clearly separated controls and accurate named-recipient counts.
- Duplicate program names were removed, definition-list semantics corrected and the main content made a working keyboard skip target.

The earlier responsive batch additionally checked six surfaces at 320 CSS pixels, alongside 390 and 1440, with zero detected AA violations or horizontal overflow.

## Reproduction and artifacts

Build using the clean parent verification environment, then start `npm run parent:preview` and run `npm run parent:test:ux`. See [runtime instructions](../parent-support-runtime.md) for isolated settings and the broader verification commands.

The runner is [tests/parent/ux-review.mjs](../../tests/parent/ux-review.mjs). It saves screenshots and `results.json` under `tmp/parent-verification/production-ux/`; local generated captures are intentionally outside the commit. Separate keyboard assertions verify the real skip link. Screenshot-only styling hides its already-offscreen resting state to avoid Chromium stitching it into tall captures; application styles are unchanged.

## Evidence limits

These are actual production UI components with explicit synthetic API interception in the headless test. No live Auth session, model call, partner delivery or family record was used. Server-authenticated navigation has separate component tests; a synthetic screenshot is not evidence of a real signed-in service session.

This review does not establish real-family usability, full screen-reader compatibility, consequential Spanish-language quality, hosted latency or production completion. Full Supabase Auth/Storage and isolated OCR-container rehearsal were unavailable because the Docker daemon was not running. Program transports remain disabled until verified real protocols and authority are configured. The [progress ledger](../parent-support-progress.md) records those release requirements.
