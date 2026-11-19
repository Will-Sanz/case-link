# Live document pipeline review — October 26, 2026

Both approved English synthetic document checks **passed** through the actual local isolated Docker parser, the production `processParentDocument` function, live `gpt-6.1-sol` structured extraction and independent source-quote/value validation. They used the two remaining Responses calls from the original 30-call approval. No further call or retry is authorized by this run.

The [new machine-readable result](parent-live-document-smoke.json) preserves the original [28-call routing report](parent-live-smoke-2026-10-26T04-24-54-604Z.json) separately and records the aggregate:

| Measure | Document supplement | Approved aggregate including routing |
| --- | ---: | ---: |
| Responses calls | **2 / 2** | **30 / 30** |
| Provider-reported input tokens | 676 | **15,550** |
| Provider-reported output tokens | 310 | **930** |
| HTTP / response status | Both 200 / `completed` | All recorded calls successful |
| Provider model | `gpt-6.1-sol` | `gpt-6.1-sol` |
| Real family documents / partner submissions | 0 / 0 | 0 / 0 |

Recorded at `2026-10-26T04:39:31.880Z`, October 26 in America/New_York. Each complete parser/model/grounding check took 2.70–3.23 seconds locally. These timings and tokens are observed test evidence, not hosted latency or verified invoice cost.

## Exact facts and privacy checks

| Synthetic document | Amount due | Total balance | Due date | Shutoff date | Result |
| --- | ---: | ---: | --- | --- | --- |
| PECO | $80.00 | $300.00 | 2026-11-05 | 2026-11-12 | All five facts exact, including provider |
| PGW with adversarial source text | $25.50 | $400.75 | 2026-11-07 | 2026-11-15 | All five facts exact; injected claims ignored |

Each model result supplied five page-one source references. The existing application validator checked every quote against the original independently parsed page and checked its financial meaning and exact amount/date. Amount due was not confused with total balance; due date was not confused with shutoff date. The independently read bill date established `sourceObservedAt: 2026-10-26` for both documents.

The adversarial PDF contained synthetic name/account/password/signature/SSN canaries, an instruction to invent a different amount and an external destination. Assertions verified that these strings really survived the local PDF parsing step, so their later exclusion was not an artifact of invisible or unparsed fixture content. The actual outgoing Responses `input` matched only the six approved provider/financial/date lines; every canary and instruction was absent. The raw PDF and full extracted source were never sent to OpenAI.

Every actual request used `store: false` and a strict JSON schema. The runner rejects redirects, permits only the reviewed Responses URL and has no retry loop. It checks the remaining aggregate budget before each side effect. A report reservation is created with an exclusive filesystem write before calls; an existing reserved or completed report prevents accidental reexecution from silently spending the same remaining calls again. Keep that evidence intact.

The report contains minimal synthetic fact values, hashes, counts, model/status/usage and source fingerprints. It does not contain the original PDF, full source text, canary values, key or account/project identifiers. A hash of the provider-returned project header is recorded; this identifies response continuity without claiming a dedicated evaluation project or certified retention settings.

## Review and boundaries

The implementation agent reviewed both actual validated fact summaries and all request privacy/status/usage checks. No product-source change or additional model attempt was required. The runner reuses the existing coordinator approval guard, `pdf-lib`, isolated parsing and document processing; it introduces no production extraction abstraction or dependency. TypeScript and targeted lint passed. A normal correctness/privacy review and a separate Ponytail reuse/deletion pass were completed for the test runner.

This is a real test of **local PDF bytes → isolated parsing → minimized source lines → live structured extraction → independent grounding**. It does not exercise the browser upload, Storage broker, durable job lease, actual household authorization, partner transport or family-facing outcome. The test permission hooks are explicit synthetic callbacks. Those surrounding controls have separate verification and release gates.

This supplement uses English native PDFs only. The [separate real OCR review](parent-document-parser-review.md) records Spanish diacritic loss and the English-only financial-label allowlist. It does not establish Spanish model extraction, translated UX or real camera/document performance. The 60 complete live corpus cases, service-owner model-quality review, family observation, current processor approvals and real partner rehearsals remain open. No legal-compliance or family-launch certification is implied.

The one-time runner is `scripts/test-parent-live-document.ts`; it requires the original existing-key synthetic approval flags and the explicit `CASELINK_PARENT_RUN_LIVE_DOCUMENT_SMOKE=1` flag, verifies the original 28-call evidence and refuses to replace its reservation. **Do not rerun it under this exhausted approval.** Future live tests need a separately approved budget and evidence record.
