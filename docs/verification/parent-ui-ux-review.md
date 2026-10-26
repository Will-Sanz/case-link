# Parent localhost UI/UX review

Reviewed October 26, 2026, on the production build at `http://127.0.0.1:3200`. All browsers were headless; no active window or browser tab was taken over.

## Approved design and result

The owner selected imagegen **Option 2, Family Panorama**. The implementation restores the original CaseLink lavender/navy/violet tokens and Newsreader/Geist pairing, with a shared connected-link logo, factual linked ChatGPT Futures recognition, original family illustration, one overlapping food/utility entry sheet and consistent policy/contact links. [Design options and the recorded decision](../parent-brand-options.md) preserve all five explorations.

**31 responsive surface captures and 28 interaction-state captures passed with zero detected axe AA violations and zero horizontal overflow.** These are automated findings, not an accessibility certification. The independent reviewer inspected desktop/phone/narrow/wide layouts, approved the selected design and completed normal correctness/security/accessibility and separate Ponytail reviews. Checklist wrapping and account-entry help were fixed; the latest pass tightens homepage spacing, aligns content edges and caps the panorama so both desktop choices fit in the initial screen. The shared-account profile omits unsupported code instructions in both sign-in and help.

## Coverage

The responsive batch covers home, intake, My support, request detail, account, sign-in, How it works, help, privacy and terms at 1440, 390 and 320 CSS pixels, plus home at 1920×934. It verifies that the actual panorama loads, Newsreader is applied, desktop content edges align, support choices fit and checklist text stays beside its markers at each width.

The interaction batch covers home, need selection, household details, initial permission review, support detail, stale-answer error and recovery, permission editor, document consent, combined utility accounts, permission handoff, account, sign-in recovery and help at desktop and phone sizes. Separate assertions verify working keyboard skip navigation, explicit stale-answer recovery and permission-editor focus handoff.

The review and regression work preserve these behaviors:

- Necessary parent actions precede secondary service waits. Urgent official help remains available before account entry and near the phone entry action.
- Questions identify the affected utility account. Saved answers can be reviewed and corrected, including while work stays paused; unrelated household edits preserve those answers.
- Provider changes invalidate the affected account's stale facts and evidence. Parents can correct WIC household answers and see attributed outcome details.
- Permission choices wrap on phones, identify recipients and limits, and focus the right editor when expanded permission is necessary.
- Stale answers remain drafts until the parent explicitly loads the current question. Repeated corrections use the returned current version.
- Account entry supports existing credentials and eligible email codes, with accurate recovery guidance, explicit retry states and safe return paths.
- Header, footer, logo, recognition, illustration, typography, controls and policy pages use the same identity. Reduced-motion preferences suppress animated transitions and smooth scrolling.

## Reproduction and artifacts

See [runtime instructions](../parent-support-runtime.md). Build and start the synthetic production preview, then run:

```sh
PARENT_TEST_ORIGIN=http://127.0.0.1:3200 npm run parent:test:visual
npm run parent:test:ux
```

The runners save generated screenshots and aggregate JSON under ignored `tmp/parent-verification/`, including `visual-results.json` and `production-ux/results.json`. Screenshot-only styling hides the already-offscreen resting skip link to avoid Chromium stitching artifacts. Its actual keyboard behavior is tested separately; application styles are unchanged.

## Evidence boundaries

These batches render actual production components with explicit synthetic API responses. They do not establish a real Auth session, model response or partner delivery. The separate [actual-service account rehearsal](parent-actual-auth-stability.json), [live AI review](parent-live-ai-review.md), [parser review](parent-document-parser-review.md) and [progress record](../parent-support-progress.md) carry their own evidence and limitations.

The later [connected-account rehearsal](parent-connected-accounts.md) separately verifies original-provider password/Storage behavior with a disposable synthetic identity. This UI review does not substitute for those integration and preservation checks.

No family observation, full manual screen-reader review, complete Spanish experience, hosted performance or partner completion is established by these screenshots. Production transports remain disabled until verified protocols and authority are configured. No local visual result certifies a family launch.
