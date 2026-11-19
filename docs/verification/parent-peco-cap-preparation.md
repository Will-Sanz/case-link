# PECO CAP unsigned preparation checkpoint

October 26, 2026. Follows the independently reviewed [SNAP/PECO selection](parent-snap-peco-route-selection.md). **Internal synthetic preparation only:** no family intake, active template, new API, provider transport, signature capture or status connection was enabled. The localhost preview and its original approval/deadline were not changed.

## Piece implemented

`src/lib/parent/peco-cap-draft.ts` prepares a static unsigned draft from the exact inspected official PECO source. The source fixture is unchanged at SHA-256 `87d4a25f808eac9e79eaf49197bb38c1e375d22b18ce0533995eca81698099cc`. Its 48 widgets/three canonical fields and overlapping City/Cell widgets prevent relying on the generic interactive filler. Read-only inspection established no populated/default widget values, meaningful text appearances, active scripts or attachments; the one separate published mail link is preserved. Existing generic form and sensitive-data guards remain unchanged.

The renderer preserves both printed pages, uses verified text positions, leaves signatures/optional identifiers/outreach choices blank, selects SMS only when explicitly requested with a supplied cell number, and includes every household member on continuation sheets. Original pages are embedded at 94% on Letter pages with separate draft/identity bands. Every page says **UNSIGNED PREPARATION DRAFT - NOT SENT** and carries applicant/account identity. No evidence documents are attached yet; blank optional phone fields are not a provider waiver or completeness claim.

Strict synthetic input rejects unknown private-channel fields, invalid/future birth dates, a minor applicant, unsupported/control characters and text that cannot fit. Generic errors exclude supplied values. LIHEAP-sharing claims are excluded because this input cannot establish the two necessary permissions. No real private information was used, stored or sent. There are no runtime callers; production use still requires the existing reviewed household/mandate/purpose/artifact controls and a supported information channel.

## Verification and findings

- **108 tests across eight focused files passed**, including 28 new PECO cases plus existing form/download, worker, service, policy, execution and readiness regression coverage. The final longer-name fixture also passed all 28 PECO cases.
- The normal `parent:test:pdf` command now includes the official-form rehearsal. Existing summary/packet/known-form checks passed (five pages), then three real-template synthetic drafts passed (one-person/two pages, five-person/two pages, and 29-person/four pages).
- Independent Python checks verify exact source-field regions, names/dates/relationships/income on both continuation sheets, all original printed lines, blank signatures/identifier columns/outreach choices, SMS choice, Letter geometry, page bounds, identity/draft text and the preserved link. No hidden AcroForm/widgets remain. Eight color and eight 200-dpi monochrome PECO page renders were generated; visual checks cover readable source instructions and populated fields. Monochrome rendering is a legibility rehearsal, not a real fax-carrier test.
- TypeScript without incremental writes, scoped ESLint, the secret scan (1,628 files) and diff whitespace checks passed. No UI, Auth/database, model decision or public provider behavior changed, so no new browser/Auth/AI evaluation was claimed.
- Independent review found that alternate LIHEAP-sharing wording could pass the first guard. The guard and punctuation/wording regressions were corrected and retested. The first Python field-region assertion included an adjacent printed label; glyph-center selection fixed the independent verifier without changing form values. Both issues remain recorded rather than counting the first attempts as successful.
- The public source causes pdf-lib's **invalid object 52** warning. It is not hidden or called fixed. Source/output text, source-preservation and independent same-engine font metrics/ink checks passed; font names and weights were retained, with printed-phrase ink variation attributable to antialiasing. Source acceptance and future reader/transport behavior remain separate release checks.

## Reproduce without runtime credentials or network

```sh
NODE_ENV=test ./node_modules/.bin/vitest run src/lib/parent/peco-cap-draft.test.ts src/lib/parent/forms.test.ts src/app/api/parent/form-download.test.ts
npm run parent:test:pdf
```

The PDF check uses the existing `CASELINK_PYTHON_BIN` override when its Python packages are in a bundled runtime. Generated synthetic PDFs/PNGs stay in ignored `tmp/parent-verification/peco-cap-drafts/`; no production credential or external request is needed. The fixture notes retain the official source URL and exact reproduction geometry.

## Autonomy checkpoint and next piece

- **Potential family work removed:** repeated clerical entry into the actual official form and manual overflow sheets. No real-family effort or application outcome has yet been measured; this formatter is not connected to family intake.
- **Prompts:** no new product approval loops. Necessary missing facts, exact personal certification and account/other-adult authority remain later route-specific work. The internal non-sending rehearsal is not a required family step.
- **People's work:** developer verification and the provider/processor operating contract remain service setup. No hidden operator filing is counted as AI execution.
- **Outcome proved:** source-bound, unsigned form preparation with tested exact values, overflow, private-error behavior and readable rendering. No signing, complete evidence packet, delivery, program registration, decision or bill change is proved.
- **Next smallest step:** exact applicable income-evidence/completeness and protected information-use contract, followed by accepted packet-bound personal certification and delivery/reconciliation. Keep actual receipt/status/follow-up feasibility active; reassess the route if those contracts cannot be established. Agency waiting time does not stop safe independent engineering work.

The final independent normal and separate Ponytail review **cleared this internal preparation milestone** after the recorded corrections. The reviewer independently reran 31 focused tests, verified all three drafts/eight pages, checked dynamic glyph visibility and same-engine printed-font fidelity, and resolved all 100 relative links across seven current milestone documents. No further code/scope changes were required. Actual provider signing/delivery/registration/status, screen-reader PDF use and real-family handling were not verified. This cannot close the full-lifecycle or family-release gates.
