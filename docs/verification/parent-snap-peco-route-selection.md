# First execution route: SNAP and PECO CAP comparison

Decision date: October 26, 2026 (America/New_York). Owner authorized the portfolio comparison and the start of the strongest route. This selects implementation order, not public activation, real-family collection, signing, provider submission or new processor access. No outreach was sent; the owner's preference against DHS outreach remains in effect.

## Comparison through the complete lifecycle

| Boundary | SNAP official form/fax | PECO CAP |
| --- | --- | --- |
| Family outcome | SNAP application, interview/evidence follow-up, decision and benefits received | CAP application, missing-evidence follow-up, decision and account/bill outcome |
| Source form | Currently linked general PA600 or SNAP-only form; SNAP-specific applicability and one form selection still needed | Current two-page 2026 official CAP form, actual blank bytes and both pages inspected |
| Required information | Household-specific facts and required identifiers need exact mapping; minimum name/address/qualifying-signature filing must remain available | Account/contact/address, household members/DOB/relationship/income sources and applicable income evidence; five rows including SELF, extra sheet allowed; SSN/ITIN explicitly optional and omitted |
| Personal act | Genuine required certification/signature; faxed handwritten signatures have express federal support, our implementation still needs verification | Genuine applicant signature and certification of the exact packet; a PDF text widget does not establish accepted electronic signing |
| Destination | County/district intake recipient for the actual household remains unproved; do not infer the headquarters or LIHEAP fax | One explicit CAP fax destination in the official form; online, email and mail also published. Public destination alone does not establish secure automated transport |
| Receipt and retry | No CaseLink agency-registration proof; transport receipt alone is insufficient; reconcile unknown delivery before retry | Same gap; published fax/email options do not establish CaseLink receipt, safe retry or actual program registration |
| Status/follow-up | Official no-account tracker is promising, but actual authorized lookup, protected last-four entry and matching a fax-filed case remain unproved | Opt-in text updates or mail are explicit. No CaseLink-readable automated status contract verified. A published help number is not a machine interface |
| Current runtime | Public discovery and tested connection mechanisms; real COMPASS verification returned rejection 1053, underlying cause unknown | Existing safe partner-directory mapping; no active form or external application transport |

Sources: [DHS benefits applications](https://www.pa.gov/agencies/dhs/programs-services/apply-for-benefits), [SNAP filing/signature rules, 7 CFR 273.2](https://www.ecfr.gov/current/title-7/subtitle-B/chapter-II/subchapter-C/part-273/subpart-A/section-273.2), [DHS county directory](https://www.pa.gov/agencies/dhs/contact/cao-information), [official application tracker](https://www.pa.gov/services/dhs/track-your-liheap-medicaid-snap-and-tanf-applications), and [official PECO 2026 CAP application](https://www.peco.com/cdn/assets/v3/assets/blt1b5616c79bacadb4/blt9d4fc50508d00567/69f41a34626de91f304d9b8f/PECO_CAP_Application_2026_v2.pdf?branch=prod_alias). Detailed SNAP evidence remains in [alternative routes](parent-snap-alternative-routes.md) and [the verification investigation](parent-snap-verification-investigation.md).

## Selection and explicit stop conditions

**Select PECO CAP for the first non-sending application-preparation piece.** Its smaller official form, optional identifiers, explicit recipient and existing partner mapping reduce initial uncertainty. This is an evidence-based engineering choice, not a measured prediction of approval rates or proof that PECO accepts our automation. Both routes still lack complete receipt and status contracts. A successful packet cannot close the full-lifecycle gate.

Keep SNAP feasibility independent of PECO implementation and preserve SNAP as required release coverage. Urgent food and utility options remain accessible while applications are prepared. After one complete lifecycle is proved, add a different supported route to test actual reuse; do not build a general fax/browser platform or all connectors in parallel. If accepted signing, secure delivery or real follow-up cannot be established, record that dependency and reassess selection before enabling execution. Do not replace missing status with fabricated progress or an undisclosed operator filing process.

## First piece: source-bound unsigned PECO preparation

Public source retrieved October 27, 2026 at 01:15 UTC / October 26 at 9:15 p.m. EDT:

- SHA-256: `87d4a25f808eac9e79eaf49197bb38c1e375d22b18ce0533995eca81698099cc`.
- 269,140 bytes; two 612-by-792-point pages with no rotation; modification metadata April 21, 2026. Metadata/filename is not a permission or policy guarantee.
- Direct inspection found **48 page widgets but only three canonical fields**, plus unnamed overlapping City/Cell widgets. The applicant-signature area is an ordinary text widget, not a PDF signature field. No blind field-tree repair or visual-only filling claim is acceptable.

Acceptance for the first bounded code piece:

1. Use only the exact inspected source bytes and explicit reviewed field positions; fail closed if source changes. A deliberately static **unsigned preparation draft** avoids stale or orphaned interactive values. Preserve both official pages and certification text; do not flatten a signed document or invent a signature.
2. Use strictly validated synthetic inputs only in the offline rehearsal. Populate account/contact/address and all household rows; handle overflow without dropping people. Income sources are text, not invented income-amount fields. Leave optional identifiers and the applicant signature empty. Do not infer LIHEAP income-sharing permission or select SMS/outreach preferences without supplied evidence.
3. Preserve legibility, exact dates, non-English characters supported by the actual font and all checked/unchecked choices. Reject unsupported/oversized text rather than clipping or silently changing it. Put the applicant name/account on every generated page, respecting the official fax instruction. Supporting-evidence attachment/wrapping requires a separately tested next piece; do not call this draft a complete signed submission packet.
4. Test source mutation, invalid/missing facts, unknown identifier/signature input, exact logical output, no hidden widgets/values, blank personal fields, page/field bounds, long inputs, household overflow and rendered output. Tests make no model calls or external requests. Independent normal and Ponytail review must clear the piece before widening it.
5. No active template registration, live intake fields, migration, new API, browser/fax provider, new keys or external capability. Preserve original form/identifier guards, school isolation and the approved localhost runtime. Production preparation will later reuse the existing lease/mandate/artifact/RLS/hash controls once the required family-field and signature channels are supported.

## Following milestones

After the preparation proof, establish exact required-information/evidence handling and accepted packet-bound personal certification, including account-holder/other-adult authority. Only then connect a vetted delivery route, test a controlled recipient or approved sandbox, and prove actual receipt/reconciliation. Follow with permitted status access, missing evidence, correction, decision and bill/outcome checks. Do not transmit fabricated government/utility applications as a test.

Family work removed, prompts and reasons, internal/operator work, outcome actually proved and next autonomy step are recorded at each review. This selection removes neither required personal acts nor the complete food/utility release scope.

## Milestone 1 review

The independent normal product/evidence/privacy/accessibility review and separate Ponytail pass cleared the PRD, implementation-plan revision and this comparison before code work. The reviewer resolved all 34 relative links across those three documents; the diff whitespace check passed. PECO is selected for the bounded unsigned preparation proof, with no provider activation or new data authority. Live signature acceptance, transport, receipt and status were not tested by this documentation milestone.
