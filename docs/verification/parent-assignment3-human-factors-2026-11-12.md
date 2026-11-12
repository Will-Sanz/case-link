# Assignment 3: application status, next steps and decision support

November 12, 2026. This is a focused interface change on the reviewed hosted SNAP baseline `b1719d6`. It is not a family launch, a renewed processing approval, or evidence of any agency submission or benefits outcome. School access, protected entry, the mandate, exact PDF, personal acts and Submit authorization remain in place. No model, provider, database or enrollment configuration changes are included.

## Three changes and course connection

| Change | Observable behavior | Course rationale | What remains unproved |
| --- | --- | --- | --- |
| Explicit state, next actor, personal action, next check and trigger | A missing schedule says no automatic check is scheduled. Unavailable evidence stays unknown. A recorded Submit removes only its stale parent handoff; another necessary personal step remains. Expired or stopped permission cannot promise scheduled work. | Situation Awareness slides 10 and 27: perception, comprehension and projection; transparent current/projected actions. Wickens et al., chapter 7: prospective memory. | Reduced monitoring, improved comprehension and lower workload require observation of representative families. |
| One evidence-based SNAP status across list, header, checklist, overview, review and receipts | Preparation, personal Submit decision, unknown delivery, transport, partner receipt/acceptance, agency submission, agency outcome and actual receipt remain distinct. Earlier versions and evidence sources are explicit. Only a current verified `provider_api` emulator receipt can say the fictional endpoint completed; it cannot imply an agency filing. Non-SNAP route labels remain unchanged. | Situation Awareness slides 24–27: automation levels, out-of-loop errors and transparency. Decision Making slide 37: automation bias. Wickens et al., chapter 12: automation feedback and calibrated trust. | The screenshots establish displayed distinctions, not calibrated trust or fewer user errors. |
| Compact, packet-bound decision summary beside the exact PDF | Validated current saved facts show household/applicant count, county/ZIP, income period and language. Unresolved issues and the exact meaning of Submit are explicit. Invalid, stale or mismatched facts fall back to the PDF; expiry/replacement removes the old summary. Viewer recovery preserves the saved application. | Decision Making slide 22: bounded rationality; slides 35–37: confirmation/automation bias. Wickens et al., chapters 7, 8 and 11: memory, decision making and workload. Human approval remains at the actual Submit decision. | No measured reduction in decision time, effort or bias; a short summary may still be misunderstood and is not a substitute for the exact PDF. |

Sources: supplied course PDFs `09_Situation Awareness.pdf` and `10 Decision Making.pdf`; Wickens, Hollands, Banbury and Parasuraman, *Engineering Psychology and Human Performance*, fourth edition (first published 2013; Routledge edition 2016). The supplied PDF filename's 2012 date is not the edition date. A future evaluation should predeclare comprehension accuracy, time, missed next steps, unnecessary interventions and family effort; reserve-capacity measures may supplement rather than replace task performance.

## Implementation and review

The existing operation projection moved to `support-activity.tsx` and is shared rather than copied into each surface. Existing request-scoped reads supply the list and decision summary. The summary validates the stored snapshot schema, provenance/freshness, request, revision and current permission before showing facts; it adds no stored information or writes. It excludes names, dates of birth, street addresses and protected identifiers. Exact PDF and submission authorization checks remain server-authoritative.

Normal correctness/security/privacy/accessibility/performance review covered stale and mismatched versions, missing and truncated history, unverified and fictional receipts, scope/expiry/replacement, failed reads, non-SNAP routes, keyboard access, responsive layout and viewer failure. A separate deletion/over-engineering pass retained the existing validation and removed the duplicate status implementation. No dependency, general platform or extra approval step was added. My support adds two bounded existing reads per SNAP card; no claim of fleet capacity or large-history load testing is made.

Visual review caught and corrected a narrow mobile summary caused by the shared notice flex style. Automated accessibility review caught a completed application's scrollable panel with no keyboard entry point; the panel now has a named, focusable region. An additional consistency review caught stale retry copy after a verified fictional emulator completion; its next-step explanation now explicitly distinguishes the finished test endpoint from real-agency work.

Synthetic SQL fixtures used an expired November 10 default mandate. Six test files now derive their permission from the test clock, preserving explicit expiry tests and all production dates. The constructed-packet test now expects the existing deterministic continuation to use zero planning calls and zero sends before review; the prepared packet and required Submit assertions remain.

## Verification evidence

- Native parent regression run: 164 files, 4,626 checks passed; seven environment-dependent skips. Includes isolated PostgreSQL-compatible fixtures and native local HTTP checks. Final UI-only corrections have separate focused tests and the complete pre-push verification.
- TypeScript, lint and synthetic production builds passed during implementation. Final exact commit checks and deployment are recorded below when complete.
- Evidence root: `/private/tmp/caselink-assignment3-evidence-20261112`. Original assignment before captures remain untouched.
- Public baseline `before-top/manifest.json`: 60 desktop/mobile screenshots across nine deterministic states. `before-review-retry/manifest.json` preserves the earlier full set. Both use actual public HTML/assets with fictional browser-only GET replies and a clearly labeled synthetic twelve-page PDF.
- Candidate `local-final/manifest.json`: 60 matching states with no page errors or horizontal overflow; superseded by final captures after the small accessibility/finished-test corrections. Intermediate failures and logs are retained rather than overwritten.
- Every capture blocks non-GET parent API requests, intercepts protected bytes with synthetic PDF data, and asserts zero writes. They prove interface rendering, not authentication, real backend state, form validity, agency transport or user performance.

## Autonomy checkpoint

Family work removed: remembering whether preparation, Submit or delivery has happened; searching for the next actor/time; reassembling a few decision facts across screens; repeating a completed Submit after a stale handoff. New prompts: none. Required personal review/Submit and unresolved indispensable facts remain. Service-connection and real-agency follow-up work still require the existing engine/provider route and are not disguised as family tasks. Outcome proved here is interface behavior under synthetic evidence. The next smallest autonomy step remains actual permitted route completion and attributed outcome verification under separately approved processing authority.

## Release and rollback

Prepared for a public-web-only release on the existing Azure host. This change must not restart or reconfigure private workers, renew expired processing/collection/sending windows, admit another account, reset a budget or perform a provider send. No database migration is needed for this UI change. Keep the public profile, source/build binding, Caddy connection limit and original recovery origin. Record the exact live source, public build marker and successful fresh-browser asset checks before claiming deployment. Rollback selects the previous public release and matching build marker and restarts only web; retain private service paths, credentials, permissions and evidence.

Release status: pending final GitHub checks and authorized host access. No deployment is claimed by this record.
