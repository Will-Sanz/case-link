# SNAP milestone B: manual verification and the first household screen

Observed October 26, 2026 (America/New_York), after the independently reviewed [authenticated connection-test checkpoint](parent-snap-connection-checkpoint.md), commit `6ddad66`.

## Actual observation

The owner explicitly approved a brief visible manual-verification inspection. A separate official COMPASS tab was opened in the in-app browser. The agent navigated the public citizen/guest introduction without entering applicant information or creating an account, then stopped at Family Safety. The owner clicked through the provider step and reported reaching the blank form. The agent then inspected that same tab and confirmed:

- URL: `https://www.compass.dhs.pa.gov/intake/#/applynow/household/householdDetails`.
- COMPASS navigation showed **Household, step 2 of 8**, Getting Started complete and Household in progress.
- Heading: “Let's start by filling out details for the first person in the household.”
- The first-person fields below were present and empty. No field was filled, no household Next control was pressed, no signature/certification was made and no filing was attempted.

| Observed field | DOM identifier | Required here | Other observed metadata |
| --- | --- | --- | --- |
| First Name | `firstName` | Yes | Text input, `maxlength=11` |
| Middle Initial | `midName` | No | Text input, `maxlength=1` |
| Last Name | `lastName` | Yes | Text input, `maxlength=14` |
| Suffix | `suffix` | No | Select control |
| Date of Birth | `dob-datepicker-date` | Yes | Text/date-picker input, `maxlength=10`; MM/DD/YYYY guidance |
| Sex | `gender_male`, `gender_female` | Yes | Radio options Male and Female, shared group |
| Has ever been known by another name? | `othername_yes`, `othername_no` | No required attribute | Yes/No radio options |

The metadata limits are attributes of this observed screen, not legal name rules or permission to shorten names. Future filling must preserve accurate applicant facts; a valid name exceeding a provider control needs a provider-accepted resolution, never silent truncation or a made-up nickname. Dynamic internal date-picker identifiers are not stable integration targets.

No SSN field was present on this first screen. That does not establish that SSNs are optional throughout the application or that every household member’s SSN should be collected. The complete conditional SNAP-only field contract remains uninspected beyond this screen.

Only public labels, identifiers, types and required/max-length metadata were recorded. No input values, hidden field contents, cookies, tokens or agency session credentials were exported. Local screenshots of the public handoff and blank form are in ignored `tmp/parent-verification/snap-manual-verification-handoff.jpg` and `snap-manual-blank-household.jpg`. The inspection tab was closed afterward; normal development returned to the background.

## What the observation proves—and what it does not

A real person could advance the official guest entry in a normal visible browser, and the agent could inspect the expected next screen in the same tab. The precise provider mechanism was not observed: do not assert that an interactive CAPTCHA was solved, that a particular browser configuration bypasses a control, or that every applicant needs the same personal step.

This was a development-tool inspection, not a released CaseLink-family handoff. The in-app-browser tab is separate from the private authenticated Chromium service. No browser session, cookie or identity credential was transferred between them. The private automated viewer still stops at its provider barrier and cannot resume the owner’s separate tab. Its `canControl:false` and blocked state remain accurate.

## Narrow implementation and checks

`compass-household-entry.ts` recognizes only this exact official URL, visible heading and required public input definitions. It reads no field values or hidden inputs and does not infer identity proof, signature, eligibility, completion or submission. The private runner and public-readiness script use the same check before claiming the first household screen was reached. A household-like URL with unknown fields is an unconfirmed result; the private runner closes the context and exposes no protected form screenshot.

Tests replay the observed blank form metadata and reject a foreign origin, different household route, altered URL, missing/hidden heading and changed required/type definitions. They spy on input-value access and verify hidden controls stay outside the collected metadata. Runner regressions preserve the no-screenshot/no-entry boundary for both recognized and changed household pages. The fixture is a labeled test replay, not live provider behavior or proof of field submission.

The main agent passed all 28 focused browser tests across six files, TypeScript and scoped lint; the final selector-aware fixture rerun passed all 15 helper/runner tests. The independent reviewer passed 22 focused tests after correcting a test fixture that previously ignored its supplied selector. Normal correctness/security/privacy/regression review and the separate Ponytail deletion pass cleared this narrow checkpoint. No application entry or execution capability was enabled by that decision.

## Next dependent piece and acceptance gate

Implement a genuinely parent-controlled verification handoff in the **same authenticated, household-isolated service session**. Choose an actual browser/delegation route whose provider, security and operating requirements can be met. It must have a real human interaction surface, observe the expected next screen, recheck current parent/request authority and enforce cancellation/expiry. Verify it against the real provider before calling it resumable. A separate link, copied browser credential, fabricated callback or model confidence score is not confirmation.

Until that gate passes, do not enable ordinary intake collection of names, birth dates or SSNs for delegated filing, create a generic identity vault, send applicant fields, or claim automatic submission/status tracking. Later conditional fields, protected data delivery, genuine certification, permitted filing and actual receipts/status each retain their own tested/reviewed work package.
