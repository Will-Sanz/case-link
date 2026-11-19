# SNAP public-browser connection: actual boundary

Verified October 26, 2026, using a separate headless browser against Pennsylvania's actual public COMPASS site. This was a navigation/readiness check, not an application test. No household name, address, birth date, income, SSN, credentials or document was entered. No account was created, CAPTCHA solved or bypassed, certification made, or application submitted. No model call was used.

The [sanitized live result](parent-snap-browser-readiness.json) records the actual entry stages and provider response. It deliberately says `executionReady: false`. The application runtime still has no registered SNAP submission transport; a link or a successful readiness check must never be counted as an autonomous application.

## What worked

The [public COMPASS entry](https://www.compass.dhs.pa.gov/intake/#/getstarted) starts without a login. Clicking its actual Apply Now control initializes the eight-stage application. Cold-opening the deeper `/applynow/gettingstarted` route initially returned a request error. CaseLink exposes the working entry only for new-SNAP requests, including while preparation is pending. The general official program link remains available for all SNAP needs; renewal, pending-case and benefit-problem journeys are not redirected to a new application.

The live screens reached Getting Started, the tutorial, the privacy notice, referral selection, the WIC notice, applicant-type selection, the existing-account question and Family Safety. Choosing the citizen/family route and answering No to an existing account continued without requiring registration. Separately, the community-organization option requested an actual organization name and type; neither was invented or submitted.

The current [citizen guide](https://www.compass.dhs.pa.gov/assets/documents/pdf/CompassCitizenQRG.pdf), pages 7–9, documents the no-account path and the later household, benefit, income, expense and review stages. That guide describes possible SSN, date-of-birth and other application information; this check did not verify current conditional fields beyond the first stage. Existing-benefit renewal, document access and tracking may require different identification or authenticated access. A new guest application is not a substitute for a renewal or an already pending case.

## Where the actual portal stopped

After Family Safety, the application navigated to its CAPTCHA step and then returned to Family Safety with this message:

> We were unable to verify your information at this time. You can try again.

A Google reCAPTCHA frame was present. The check stopped there. It did not change browser fingerprints, solve a challenge, call a hidden application endpoint or otherwise bypass the control. The opt-in runner independently reproduced the same boundary at 16:55 UTC / 12:55 p.m. EDT. Its classification requires the actual visible DHS error; an ordinary invisible reCAPTCHA iframe alone cannot establish a necessary parent step.

This is a specific provider-verification barrier in the actual guest flow, not evidence that every family needs a Community Partner account, that all browser assistance is prohibited, or that a public API is mandatory. It also does not establish that a genuine parent could not continue in their own normal browser. Later fields, certification, receipt, status and correction behavior remain unverified.

## Work required for a real autonomous application

1. Provide a reviewed, household-isolated browser handoff in which the parent can complete the provider's own verification directly. CaseLink currently has no such session handoff. Do not treat a link opening as a resumed agent session.
2. Inspect the remaining actual SNAP-only flow with accurate, authorized applicant information. Ask only the fields genuinely required for that household and preserve their provenance. Do not create a new application for a renewal or pending case.
3. Keep SSNs, provider passwords and other protected identity values out of chat, model context, browser traces, screenshots, general facts, packets, exports and logs. Prefer direct agency entry. An opaque, separately secured identifier channel would require its own implementation and security review before delegated entry; it does not exist now.
4. Confirm the route's current terms, identity and certification requirements. Collect genuine applicant assent and any required personal act; do not fabricate a signature or claim the software is a human authorized representative. The [Community Partner guide](https://www.compass.dhs.pa.gov/assets/documents/pdf/CompassCPQRG.pdf), pages 10–12, describes a distinct delegated-signing process with applicant certification and CP initials. That is not permission to invent a CP identity or force every guest applicant through a CP account.
5. Enforce the current mandate at each permitted external operation, retain the exact non-secret operation/identity-channel references and actual confirmation, reconcile uncertain delivery before any retry, and continue through required documents/interview and attributed outcome. A browser click, draft, transport acknowledgment and agency filing are separate states.

These are remaining full-product work, not a reduced definition of done. The current useful step connects the genuine no-account entry and accurately explains required verification and direct sensitive entry. It does not finish the requested end-to-end SNAP execution.

## Reproduce without an applicant

Run `CASELINK_SNAP_READINESS_APPROVED=1 node --import tsx scripts/check-parent-snap-readiness.mjs`. It uses the installed headless browser, fixed official origin and only public routing choices, then stops at verification or the first empty household screen. It never fills a text field, saves browser state, creates an account or clicks Review/Submit. Its local report is written under ignored `tmp/parent-verification/`; only the sanitized result is retained here. Portal changes or outages fail the check instead of producing a synthetic result.

All 77 targeted program, planning and request-detail checks passed, including four new-application versus continuing-journey UI cases and access before a plan exists. Targeted lint and the mechanical UI detector passed. Normal and separate Ponytail reviews cover this narrow change; no paid evaluation, family application, final agency receipt or ongoing status check is certified by it. No design or architecture can guarantee zero breach risk.
