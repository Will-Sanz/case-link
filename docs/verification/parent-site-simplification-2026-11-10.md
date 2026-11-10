# Parent site simplification — November 10, 2026

Local UI changes on main at baseline `8c7264c`. The owner reviewed the localhost changes and approved publishing them to GitHub and the live site on November 10. Other ongoing source and documentation work is preserved.

## Scope and behavior

- Remove utility service choices from the homepage and new-request questionnaire, including old utility query-string preselection and dead intake questions. Keep direct urgent utility resources, existing requests, SNAP expense fields and all utility preparation/server work intact.
- Remove the homepage FAQ and general early-access/launch banners. Preserve actual connection failures, processing boundaries, language availability and evidence-based application status.
- Widen public/task layouts within the approved CaseLink identity. Case detail fills the viewport with a left section menu on desktop and horizontally scrollable section navigation on phones. Show one section at a time, retain mounted forms and unsaved input, support section links/history/focus, and keep the right-hand content centered with compact accessible buttons.
- Group application review, documents, program progress, activity/receipts and details/controls into their sections. Detailed work status uses a native disclosure. Privacy/contact links remain available in controls on mobile. Print styling includes all retained sections.

## Verification

- Parent regression run: 3,469 passed; 1,060 opted-in integration cases skipped without their service environment. Its two localhost-port suites initially could not bind in the restricted runtime; all 46 cases passed when rerun with port permission. The added history/navigation regression and subsequent affected checks passed separately.
- Final affected workspace/detail suite: 160 passed, including draft retention, exact submission evidence, corrections, permission focus, personal-step navigation and section history.
- Final account/intake/help/terms checks: 54 passed. Brand and other parent suites passed in the broader regression run.
- TypeScript, lint, diff checks and isolated production build passed.
- Production visual checks: 65 screens across phone, 320px reflow, tablet, laptop and wide homepage; no document overflow or axe accessibility violations.
- Production interaction checks: 56 screens, including grouped answers/recovery, permission handoff, document consent, request-scoped chat and synthetic account-deletion recovery; no document overflow or axe accessibility violations. The capture helper waits for asynchronously rendered route titles before accessibility inspection.
- Exact read-only review preview: all eight case sections reachable; final desktop/phone images inspected. Temporary local fixture proxy uses sample data, rejects mutations and does not connect to household/provider records. Its source is under tmp and is not release code.

## Separate reviews

Correctness/security/privacy/accessibility/performance pass: traced both ApplicationWorkspace callers, hash links and required personal-step callbacks; mounted forms retain their existing authorization, expiry, correction and error handling. No service activation, data migration, sending or new processing permissions.

Ponytail deletion pass: removed the FAQ, unsupported utility entry/questions, redundant saved-facts checklist and orphaned styles. Reused the existing sections, CSS modules, native links/history/details and installed tests. No dependency or generalized workspace platform added.

## Family-service autonomy checkpoint

Family work removed: scanning a long stack of repeated statuses to locate a document, receipt, next step or control. Navigation preserves drafts instead of requiring re-entry. No new information prompts, permission prompts, personal acts or operator tasks were introduced. Existing indispensable personal steps and current service/provider blockers retain their actual reasons. This proves presentation and navigation only; no new family outcome or provider readiness is claimed. The owner's localhost review is complete. Release coordination preserves the separately owned signing/fax work.

## Owner review refinements

The owner requested smaller headers and consistent page layouts after viewing localhost. The site header is now a compact 56px row. Case back navigation, title and actual status share one compact row; phone navigation keeps the back link accessible by name with an icon. Section headings and excess top margins are reduced. Both parent and legacy public shells show recognition only when explicitly requested by the homepage; normal task/help/policy routes omit it.

How it works and Help now share the same wide, centered 1440px frame, a balanced heading/introduction row and two-column desktop sections, with one-column phone reflow. The official program directory uses aligned columns; obsolete narrow overrides were removed from intake/account/not-found. No new family prompts, processing permissions or operator steps were added.

The refined banner/header/help contract passed 92 focused tests; the 65-screen visual suite passed the explicit homepage-only recognition, compact-header, centered-frame, overflow and axe checks. Final spacing received a separate targeted phone/320px/desktop confirmation. Production build, typecheck and lint passed. The owner subsequently approved publishing the reviewed changes; the temporary review endpoint stays read-only.
