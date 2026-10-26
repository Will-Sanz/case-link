# Real isolated document parser review — October 26, 2026

The local Docker integration suite passed **23/23 functional checks** using the actual `extractIsolatedDocument` production entry point and image `caselink-document-parser:local`, ID `sha256:8d40b107157d4ba9bd60d6633c34b963ae1167187bd6afbf8f04bab5a146f90f`. The image's configured user was verified as `65534:65534`. No production source changed during this verification.

The [aggregate result](parent-document-parser-local.json) records each check, timing, page/character counts, image identity, source fingerprints and three explicit Spanish diacritic warnings. It contains no source text, document images, account identifiers or credentials. Synthetic PDF, PNG and JPEG fixtures were generated in memory and were not written to disk. No OpenAI request, real family document or partner transport was used.

| Coverage | Result |
| --- | --- |
| English native PDF, including independent page order | Passed |
| Spanish native PDF, including accented text | Passed |
| English PNG, JPEG and image-only PDF OCR | Passed; provider, amount, date and financial label matched |
| Spanish PNG, JPEG and image-only PDF OCR | Financial provider/amount/date/label matched exactly; **accent warning below** |
| Five-page PDF maximum | Accepted with correct source order |
| Six-page and zero-page PDF | Rejected as unreadable |
| Malformed PDF, PNG and JPEG | Rejected as unreadable |
| PDF/image MIME mismatches and unsupported media type | Rejected as unreadable |
| Empty file and file above 10 MiB | Rejected as unreadable |
| Image exceeding the 20-million-pixel decode limit | Rejected as unreadable |
| PDF with an active opening action or embedded attachment | Rejected as unreadable |

The original strict-text run passed 20/23 checks: all three Spanish OCR cases lost the accent in a non-financial Spanish word. That [first-pass evidence is preserved](parent-document-parser-first-pass.json). The diagnostic check confirmed that the provider, amount, ISO date and Spanish financial label were already exact; only the accent differed. The final runner therefore requires the financial values and labels and records accent loss separately rather than representing OCR as character-perfect Spanish. No original source or extracted value is rewritten or normalized by application code.

Spanish remains a launch-quality gate. OCR language loading is not proof of end-to-end Spanish document support: the current financial-source allowlist and semantic value grounding recognize English financial labels. They must be deliberately extended and tested before claiming Spanish financial extraction. This review does not approve translated product copy, family comprehension or consequential Spanish processing.

The existing production launch arguments and unit tests enforce the no-network, read-only, non-root container, no host mounts/credentials, capped memory/CPU/processes, private temporary filesystem and bounded runtime. This integration run proves that the built container can execute the tested fixtures under those actual entry-point constraints. It does not replace a malicious-file corpus, container/base-image vulnerability review, production infrastructure checks, real camera/low-quality document observation or live AI extraction evaluation.

Reproduce explicitly after building the isolated image and starting the local Docker engine:

```sh
docker build -f docker/parent-document-worker.Dockerfile -t caselink-document-parser:local .
npm run parent:test:parser
```

The command opts into real local container execution; ordinary unit tests and production builds do not run it. The script itself refuses execution without `CASELINK_PARENT_TEST_REAL_PARSER=1`. Its assertions verify the parser's actual output and error classification. Source text and parser diagnostics are never logged or included in the aggregate report. Keep the existing isolated-parser unit tests for launch flags, missing configuration, bounded output/runtime and forced cleanup.

The implementation agent completed a correctness/privacy pass and a separate Ponytail deletion/reuse pass. The runner reuses `pdf-lib`, `sharp`, the existing fixture limits and the actual isolated entry point; it adds no dependency or production parser abstraction. TypeScript and the targeted lint check passed.
