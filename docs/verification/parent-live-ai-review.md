# Parent live AI review — October 26, 2026

The approved direct routing smoke **passed all 16 cases**. Fourteen cases called the live `gpt-6.1-sol` Responses coordinator; two correctly stopped at the server's routing guards without a model call. This is evidence for the implemented coordinator's bounded program-selection responsibility. It is not the 60-case, four-turn live evaluation or a family-launch sign-off.

The [separate document supplement](parent-live-document-review.md) subsequently used the two remaining approved calls to verify actual isolated PDF parsing, live structured extraction and source grounding. The approved aggregate is now **30/30 calls**, 15,550 input / 930 output tokens. The original routing report below remains unchanged; no further call or retry is covered by this approval.

## Run evidence

Recorded at `2026-10-26T04:24:54.604Z` (October 26 in America/New_York). The [machine-readable report](parent-live-smoke-2026-10-26T04-24-54-604Z.json) includes every case, actual provider tool selections and ignored message content, HTTP/response status, token usage, request duration, resulting server-owned plan and required-action reasons, and the exact source manifest.

| Measure | Observed result |
| --- | --- |
| Responses calls / hard limit | **28 / 30**, including every tool continuation |
| Provider model | `gpt-6.1-sol` on every response |
| Settings | `reasoning.effort: medium`, `store: false`, `max_output_tokens: 3000`, parallel tool calls disabled |
| Provider result | 28 HTTP 200 responses; all response statuses `completed` |
| Provider-reported input tokens | **14,874**; reported cached input tokens 0 |
| Provider-reported output tokens | **620**; reported reasoning tokens 0 |
| Missing usage records | 0 |
| Recorded routing failures | 0 |
| Time for a case that called the model | 3.03–5.78 seconds; 55.73 seconds across the entire sequential smoke |
| Partner submissions, real family records or uploads | **0** |
| Actual invoice/project cost verification | Not performed; no inferred price is reported |

These timings include the local coordinator and network requests. They do not establish production job latency, program response time or time to receive assistance.

## Coverage and agent judgment

The implementation agent inspected the actual tool arguments and server-generated plans for every case on October 26. This is an agent review, not service-owner or family review. No model bug required a product-code change during this run.

| Case | Actual selected program / guard | Agent review |
| --- | --- | --- |
| Immediate food, English preference | Philadelphia food and meal finder | Fits immediate food routing; plan remains prepared and warns that hours/availability need checking. |
| New SNAP, Spanish preference | Pennsylvania SNAP | Fits the new application need; no eligibility or submission claim. |
| SNAP renewal, English preference | Pennsylvania SNAP | Renewal context remains in the server-owned steps; no new application is represented as submitted. |
| Pending SNAP, Spanish preference | Pennsylvania SNAP | Existing journey is retained; this smoke does not establish a live application-status lookup. |
| SNAP problem, English preference | Pennsylvania SNAP | Compatible benefit-problem route; no unsupported resolution claim. |
| New WIC, Spanish preference | Pennsylvania WIC | Appropriate specialist route; no clinical eligibility judgment or appointment claim. |
| Continuing WIC, English preference | Pennsylvania WIC | Continuing need retained; required specialist assessment remains explicit. |
| Electricity, Spanish preference | PECO assistance programs | Matches the synthetic PECO context and individually named permission. |
| Gas, English preference | PGW financial support | Matches the synthetic PGW context and named permission. |
| Water, Spanish preference | Philadelphia water assistance | Correct City route; no claim that documents were emailed or an application received. |
| Combined six needs, English preference | Food finder, SNAP, WIC, PECO, PGW and City water | A single selection batch covers every independent need without dropping or adding one. |
| Combined six needs, Spanish preference | Same six programs, with SNAP renewal/new WIC | Every need is retained with the corresponding journey context. |
| Preparation-only, household data only | PECO | Income, utility provider, shutoff date and account authority are absent from the actual outgoing model context; nothing is submitted. |
| Alternate named electricity recipient | UESF utility assistance | The model respects this allowed recipient and does not select unauthorized PECO instead. |
| No electricity recipient authorized | No model call; expanded-permission question | Necessary scope question appears; no recipient is silently added. |
| ZIP outside Philadelphia service area | No model call; unresolved route with official-help guidance | The app does not recommend this as a supported CaseLink coordination route. |

All model-selected needs/programs were requested, known, compatible and explicitly authorized. Each live case used one `select_programs` batch followed by one completed continuation. The model's final message text was empty in every case; the product uses validated selections and server-owned copy, so no generated prose changed authority, delivery or outcomes. The observed plans stay `prepared` and disclose the unconfigured service connection. No already-authorized case asked the parent for routine reapproval. The missing-recipient case correctly asks for expanded permission.

Full-mode requests retain an operator-owned service-connection hold because production transports remain unconfigured. This is real unfinished execution work, not successful autonomy. The smoke cannot remove that dependence from the product's eventual autonomy denominator.

## Credential, privacy and reproducibility boundaries

The owner explicitly approved the existing configured key for this capped synthetic-only run. The key was loaded into process memory from local configuration; it was not printed or written into the report. No school family record, actual parent identity, personal document or partner credential was used. The runner contacts only the reviewed Responses URL and rejects redirects.

Configuration and the read-only model-access preflight did not establish a separate evaluation project ID. Responses did include a project header, but its identifier was not captured or persisted by this smoke. The report therefore does not claim verified project identity or a dedicated synthetic project. The stricter full-corpus harness remains unchanged. Use the opt-in instructions in [the evaluation guide](../parent-ai-evaluation.md); merely setting `OPENAI_API_KEY` does not enable this runner or any paid CI test.

`store: false` was checked in every request. It does not certify Zero Data Retention or remove the vendor's default abuse-monitoring retention. The actual project's processor settings, agreements and any required approvals still need owner verification before real-family processing. See [OpenAI's current data controls](https://developers.openai.com/api/docs/guides/your-data) and [API authentication/project guidance](https://developers.openai.com/api/reference/overview/), checked October 26, 2026.

## What remains unverified by this run

- The full 60 live, four-turn corpus and its service-owner review gate remain open. The smoke reuses lifecycle case definitions only for their first routing decision; it does not relabel them as completed live journeys.
- No live document extraction, known-form transport, personal identity/signature completion, partner receipt, assistance award, notification delivery or autonomous follow-up was exercised here. Those require their own current permissions and end-to-end rehearsals.
- English/Spanish are intake preferences in these cases. The coordinator receives routing facts and does not generate localized family-facing explanations. This is not evidence of Spanish-language quality, translated legal notices or family comprehension.
- The narrow authorized program sets make this a routing and scope smoke, not a broad comparison of discretionary program choice or a statistical reliability estimate. Actual availability and eligibility require current authoritative evidence.
- No human service-owner review, family observation, production load test or legal-compliance certification is implied. The PRD's family-ready acceptance gates remain in force.
