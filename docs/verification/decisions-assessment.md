# Decisions API: defer production integration

October 14, 2026 — CL-40, optional. Keep Responses for drafting plans, reviewed edits and assistant answers. Keep deterministic authorization, privacy, ID/date validation, source-backed contacts and review/export controls authoritative. Do not add a Decisions request to every staff interaction yet.

The current [Decisions guide](https://developers.openai.com/api/docs/guides/decisions) describes a separate `/v1/decisions` endpoint with `gpt-6-luna` and named predicate, choice and score questions. It evaluates supplied content; it does not replace structured text generation. Probabilities require application-specific calibration. Endpoint data handling must be checked separately from Responses and `store: false`.

One synthetic access/response-contract probe succeeded on the existing provider account: HTTP 200, model `gpt-6-luna`, 256 ms, 202 input tokens and no output tokens. A clearly unsupported approval claim received predicate probability 1. [Exact metadata](2026-10-14-decisions-access.json). At the documented $0.10/million input-token rate, that request is about $0.0000202 before applicable premiums. This is one obvious example, **not** a quality, calibration or reliability benchmark. [Pricing](https://developers.openai.com/api/docs/pricing).

The probe sent synthetic text only, made no application/database change, and was not wired into production. No school reviewer labels, held-out agreement, false-alarm rate or missed-defect rate exist yet. No approved zero-retention or school vendor sign-off follows from account access.

## Reconsider after school review

Use the CL-34 saved synthetic drafts and school-labelled defects. Compare the smallest advisory check with existing deterministic checks and staff review. Predefine unsupported factual claims, ignored preferences and unhelpful actions; calibrate on development cases and retain a fresh held-out set. Record missed critical defects, false alarms, reviewer agreement, latency and cost.

If that comparison shows a practical benefit, add a small separately typed client. Validate answer names, types, finite ranges and missing/refused/error responses; apply privacy, budget, timeout and redacted logging controls; show “check unavailable” instead of passing uncertain output. Tests must prove enabling or disabling it cannot approve or mutate a plan. School reviewers remain responsible for the final plan. No framework, autonomous action or PDF-filling feature is justified by this probe.

Decision: **defer the production feature**. The optional calibrated assessment remains open until labelled examples and endpoint-specific data approval are available; it is not a launch prerequisite.
