# Reproducing the parent AI evaluation

The versioned corpus in `tests/fixtures/parent-evaluation.ts` contains 60 four-turn synthetic journeys: six scenario families across all 10 supported needs, both advertised languages and all 8 listed programs. It covers named routing, permitted actions, existing application history, preparation-only grants, pause/cancellation, unknown delivery and reconciliation, exact-packet personal acts, source-backed values, targeted parent corrections and adversarial data. Selected cases combine independent needs.

Run the deterministic checks without credentials or external calls:

```sh
npm run test:run -- scripts/parent-ai-evaluation.test.ts
node --import tsx scripts/run-parent-ai-evaluation.ts
```

The runner writes `docs/verification/parent-ai-evaluation-deterministic.md` and a JSON report containing every turn/check, intervention reasons, usage, harness duration and source fingerprint. The deterministic coordinator and provider capabilities/receipts are explicit synthetic fixtures. They exercise actual service and policy code; they do not evaluate Sol’s decisions or prove real integration permission, production autonomy, family comprehension, hosted latency or cost. Language variants set actual intake language; deterministic English service copy is not evidence of Spanish quality.

Optional live evaluation calls the existing Sol Responses coordinator while keeping every execution/receipt synthetic. Nothing is submitted to programs. It is disabled unless **all** of these are deliberately supplied by the operator:

- `CASELINK_PARENT_RUN_LIVE_EVALS=1`.
- A separate project-scoped test key in `CASELINK_PARENT_EVAL_OPENAI_API_KEY`; ordinary `OPENAI_API_KEY` is ignored.
- `CASELINK_PARENT_EVAL_PROJECT_ID` and an identical `CASELINK_PARENT_EVAL_APPROVED_PROJECT_ID`, with `CASELINK_PARENT_EVAL_SYNTHETIC_PROJECT=1` attesting that the project is approved for this synthetic-only run. The harness does not independently certify the account or vendor retention settings.
- `CASELINK_PARENT_EVAL_CASE_IDS`: an explicit comma-separated subset of 1–10 corpus IDs.
- `CASELINK_PARENT_EVAL_MAX_CALLS`: an integer 1–30 hard cap across the complete run, including multi-call coordinator turns. Exhaustion fails the affected journey; no automatic retry or unlimited continuation occurs.

Then run the same runner. Reports use a timestamped live filename, preserve model/settings and source fingerprints, and record provider-reported tokens even when a later call exhausts the cap. Project usage/invoice evidence is still required for actual cost; the harness does not embed unverified current pricing. Credentials and account identifiers are not written to reports. The only approved network endpoint is Responses; redirects are rejected.

Every report starts with human review pending and model-quality approval not established. A service owner must review at least 60 complete model-run cases for V-01, read each case’s criteria, record reviewer/date/model/settings/source fingerprints, judge appropriate route and language, source fidelity, necessary versus avoidable interventions, edits/recovery, latency and cost, and resolve every critical failure. The bounded live subset is a spending safeguard; multiple separately approved runs may be needed to cover the corpus. A mechanical pass cannot sign off prose, judgment or family readiness. Missing real connectors and routine operator work remain in the product’s eventual autonomy denominator.

The corpus currently tests the coordinator’s implemented program-selection responsibility. Document extraction, forms, concrete provider transports, callbacks, hosted persistence and notifications have separate tests and launch rehearsals. Expand representative model-run cases when those AI responsibilities or enabled contracts change; do not turn a synthetic transport into a claimed integration to obtain a passing score.

## Separately approved direct routing smoke

On October 26, 2026 the owner explicitly approved a capped synthetic-only run with the existing configured OpenAI key. No separate evaluation project ID could be established from configuration or the model-access response. That approval permits this narrow direct routing check; it does not establish a dedicated test project, processor retention configuration, or completion of the full live corpus above.

That approval is now exhausted: the routing smoke used 28 calls and the [actual document-processing supplement](verification/parent-live-document-review.md) used the remaining two. The combined evidence records **30/30 Responses calls**, 15,550 input / 930 output tokens. Any new live run requires a separately approved budget; do not retry the one-time document runner or treat these commands as permission for additional calls.

The opt-in runner uses the unchanged application coordinator and 10 individual need variants from the versioned corpus, two combined need sets, a preparation-only minimized context, an alternate named recipient and two server guard cases. It records actual provider tool selections, ignored model text, provider token usage and exact source hashes. It checks the tool selections themselves so the server's fallback route cannot conceal a model omission. It makes at most **30 Responses calls**, including continuations, stops on the first failure, rejects redirects and never contacts a partner. The two routing guards require no model call. Ordinary CI and merely having an OpenAI key do not enable it.

Reproduce only after explicit approval for that existing key and its project:

```sh
CASELINK_PARENT_RUN_LIVE_SMOKE=1 \
CASELINK_PARENT_LIVE_SMOKE_APPROVED_EXISTING_KEY=1 \
node --env-file=.env.local --import tsx scripts/run-parent-live-smoke.ts
```

Offline checks for the opt-in requirement, true model-selection coverage, omitted selections and the continuation budget:

```sh
npm run test:run -- scripts/run-parent-live-smoke.test.ts
```

This runner checks one routing decision per case. It does not run the corpus's four-turn service journeys, evaluate live document extraction, prove real provider execution or sign off Spanish copy. The coordinator consumes routing facts rather than generating the family-facing prose; a Spanish intake preference alone is not a Spanish-language quality evaluation. The [recorded review](verification/parent-live-ai-review.md) separates mechanical checks, agent judgment and outstanding human/family validation.
