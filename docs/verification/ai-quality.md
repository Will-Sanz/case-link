# Synthetic AI evaluation and school review

This gate evaluates CaseLink's four text features: complete-plan generation, one-goal refinement, whole-plan refinement, and case assistant. It does not authorize a model to approve a plan, determine eligibility, submit records, or replace a school safeguarding procedure. Existing unfinished drafts retain their older staged recovery path; new drafts use one coherent response.

## Reproduce

Use the existing operator-provided OpenAI key in the environment or local ignored environment file. The harness reads only that key, not local database or administrative credentials. Every case is synthetic. Requests use the application's task-specific model settings, strict structured output and `store: false`. That flag prevents response storage; it does not establish zero provider retention or replace the school's data-policy approval.

```
CASELINK_LIVE_AI=1 CASELINK_EVAL_SPLIT=development npm run test:ai-quality
CASELINK_LIVE_AI=1 CASELINK_EVAL_SPLIT=held-out npm run test:ai-quality
CASELINK_LIVE_AI=1 CASELINK_EVAL_SPLIT=pilot CASELINK_EVAL_DATE=2026-10-15 npm run test:ai-quality
```

Use `CASELINK_EVAL_CASE=<fixture-id>` to reproduce a failure within its split. `CASELINK_EVAL_LIMIT` may shorten a smoke test; a shortened run cannot close the release gate. Generated results go to ignored `tmp/ai-evaluation/<run-id>`; selected final synthetic results and historical failure summaries are versioned with the release evidence. No production case narrative belongs in this directory or the repository.

The existing 50 fixtures contain 25 development and 25 previously held-out cases. Ten additional pilot cases cover pending applications, changing preferences, private outreach, unknown provider hours, urgent safety, language choice, unsuitable services, missing history, minimal intake and completed work. Each now runs one complete draft, two refinement paths and one assistant answer. Two cases run concurrently. Generation uses the same compact contract and one-attempt policy as the application. The request-scoped database budget is replaced only in this standalone harness; the real shared limits are separately exercised by database integration tests. The production client, immutable case snapshot, outbound privacy check, prompts, structured schemas, directory grounding, and human-selection merger remain in use.

The runner reads each successful network response body once for token metadata and returns the identical bytes to the production parser. Failed HTTP bodies are never logged. Recorded costs are estimates from returned token usage, not invoices or a provider-enforced spending cap. It records the requested and returned model, reasoning setting, service tier, cached/input/output/reasoning tokens and latency. It reserves a conservative request-cost allowance before dispatch and stops before its configured budget or 400 attempted requests. Unknown charges remain reserved. Use `CASELINK_EVAL_MAX_USD` to set the run ceiling; use `CASELINK_EVAL_MODEL` and `CASELINK_EVAL_REASONING_EFFORT` for controlled comparisons. Keep the same fixed date, fixtures and source hash across compared runs. Preserve failures when rerunning after a correction.

## What is checked

- Valid schemas, record IDs, exact calendar dates within the proposed plan window, and resource IDs limited to current allowed sources.
- Contact values copied from the directory rather than generated in prose; inactive, dismissed and demo sources excluded.
- Sparse cases produce a manageable workload. Earlier proposed tasks are not evidence that a referral or application happened.
- Refinements require explicit selection and preserve human dates, Waiting follow-up, IDs, assignments, progress, outcomes and completed records. A title-only request should change only that title.
- No injected marker from copied case, directory or historical conversation text; no representative identifying/contact data in generated prose.
- A regression probe for a target date incorrectly described as a completion date. The assistant now explicitly receives unknown completion dates.
- Non-mutating evaluation, safe rejected requests, latency and token cost. Offline provider-failure/privacy/authorization tests supplement the live set, including identifiers rejected before network or budget use.

These deterministic checks are deliberately limited. They cannot certify all prose as factual, respectful or useful. Engineering review must identify remaining unsupported assumptions and unnecessary work; case managers must assess fit for real practice.

## October 14 results and corrections

Version 7 completed all 50 synthetic cases and accepted **299 of 300 initial tasks**. One urgent-case follow-through response was incomplete and safely rejected after 27.3 seconds; it was not applied. A separate retry of that case passed all six tasks. The initial failure remains in the evidence. Completed outputs had zero failures in the deterministic critical checks. See the [summary](2026-10-14-ai-quality.json), [development outputs](ai-quality/development.json), [held-out outputs](ai-quality/held-out.json), and [targeted retry](ai-quality/urgent-retry.json).

Successful first-phase latency was p75 4.15s / p95 4.69s; successful full drafts (49 of 50) were p75 14.15s / p95 16.14s; step rewrite p75 was 2.83s. These successful service-only distributions meet their corresponding targets, but exclude the failed complete-draft attempt and do not establish browser/hosting targets. Initial-run estimated cost was $0.1852, plus $0.0034 for the retry. The source hash binds the evaluated source; the recorded Git commit is its parent because the fixes were still uncommitted during evaluation.

Earlier runs exposed real defects: excessive speculative work for sparse intake, dates outside the plan window, a target date described as a completion date, slow full drafts, and invented claims that no referral/submission had happened merely because no history was saved. Dates are now enforced before application, completion dates are explicitly unknown, sparse drafts are constrained, and shared prompts distinguish proposals and missing records from outside events. Narrow refinements preserve unrelated text and human records. Automated regressions cover these behaviors. The actual v5/v6 unsupported claims and [earlier run summaries](ai-quality/earlier-run-summaries.json) are retained in [semantic failures](ai-quality/semantic-failures.json); two apparently perfect automated runs still required manual corrections. Earlier sandbox connectivity and response-reader instrumentation failures are also preserved, not counted as product passes.

Engineering review inspected nine risk-focused assistant outputs and sparse/urgent generation, including eligibility uncertainty, completed work, private contact, injection and immediate safety. The reproduced unsupported-absence claims are corrected and urgent concerns call for an immediate responsible human. This is not school usefulness scoring. Repeated use during fixes means the original held-out split is now a regression corpus; a fresh, unseen school-reviewed set is still required before closing CL-34.

Normal correctness/security/privacy/regression and separate Ponytail deletion reviews found no additional blocking defect in this patch for the few-staff workload. The shared prompt and prior-phase formatter reuse existing production paths; no SDK or production dependency was added. Full local verification passed 694 tests in 83 files, with database/Auth, browser and PDF suites separately passing. After the user reported workstation slowdown, CaseLink's local services were stopped and final commit verification moved to GitHub CI; no additional local build is required merely to push the evidence.

## Review with school staff

Use synthetic cases only. For each selected case, compare the case facts, generated draft and assistant answer with a manually prepared plan. Score factual support, relevance, actionability, clarity and family voice from 1 (unusable) to 5 (ready after light editing). Record the number of substantive corrections, minutes to an accepted reviewed plan, and whether a mandatory human escalation or unknown was handled correctly. Mark any invented fact, ignored contact restriction, inappropriate determination or changed human record individually; an average score cannot conceal it.

Proposed acceptance remains zero critical defects and at least 90% of representative tasks scoring 4/5 or better. The school must agree those thresholds and the data policy. Reviewer identity, date, manual comparison, scores and editing time are **pending**, not inferred from automated results. Review both typical and adverse cases, including the empty directory, family-declined option, completed/Waiting history, urgent safety concern and sparse intake.

Service-only timings exclude browser rendering, database persistence, network conditions at school and hosting overhead. Compare them with the PRD targets without presenting them as end-to-end results: first progress p95 ≤2s; first useful action p75 ≤5s/p95 ≤10s; full draft p75 ≤15s/p95 ≤30s; step rewrite p75 ≤6s. First progress and hosted end-to-end timing require the candidate browser rehearsal.

The harness follows task-specific and held-out evaluation guidance. OpenAI's hosted Evals platform is being retired, so this repeatable repository harness does not depend on it. [OpenAI evaluation guidance](https://developers.openai.com/api/docs/guides/evaluation-best-practices). Rates used in the evidence were checked on October 14, 2026. [OpenAI pricing](https://developers.openai.com/api/docs/pricing).
