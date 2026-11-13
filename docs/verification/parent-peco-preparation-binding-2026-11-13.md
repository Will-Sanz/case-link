# PECO preparation identity and source binding

November 13, 2026. A focused extension of the existing [CAP income/certification work](parent-peco-income-certification.md), following the [WIC/utility plan](parent-wic-utility-extension-2026-11-13.md). Offline preparation only; no private intake, worker connection, signing, sending or provider status is enabled.

## Change and concrete regression

The existing renderer accepted independent form values alongside scoped income evidence. Matching household/adult counts did not bind a printed person's name, birth date or PECO account to that evidence: substituting another adult of the same age or another account still produced a packet. Three new tests failed against that behavior before the fix.

Packet rendering now requires a strict immutable preparation snapshot and the expected ID/revision/digest already recorded by the trusted income projection. The renderer checks exact household/request/version/account/program/purpose, applicant and complete unique subject set, each linked person's age metadata, original confirmation and validity/retention limits. Printed values come only from the parsed snapshot. A changed snapshot is accepted only with its actual newly trusted revision/reference; the previous reference cannot silently authorize changed names or an account.

The manifest records only the reference/digest alongside existing scope evidence. Final validity is bounded by the original snapshot and all existing evidence/consent/mandate deadlines; reading or rendering does not renew them. Inputs and buffers are captured before asynchronous PDF work. Income assessment can still run before a complete form exists; packet creation requires the expected snapshot reference.

This hash is an integrity binding, **not authentication of client data**. All current callers are offline tests/rehearsals. A future production adapter must resolve the owned current snapshot and expected reference on the server under the actual account and purpose authority. No browser-supplied hash establishes that trust, and this piece does not implement that adapter.

## Review and checks

- **187 focused PECO tests passed**, including unchanged source/consent/original-proof/certification coverage and new identity/account substitution, wrong scope/reference, duplicate or reordered subjects, mismatched adult metadata, expiry and corrected-revision cases.
- Native PDF verification passed for **13 output pages** across single-person, five-person, overflow and five-page bound income packets. Source fields/instructions, blank optional identifiers/signature, exact source/proof hashes, proof page ranges, snapshot digest, geometry, footer identity and final pagination pass. Python independently recomputes the snapshot digest.
- A November 13 read-only GET of the [official 2026 CAP application](https://www.peco.com/cdn/assets/v3/assets/blt1b5616c79bacadb4/blt9d4fc50508d00567/69f41a34626de91f304d9b8f/PECO_CAP_Application_2026_v2.pdf?branch=prod_alias) returned HTTP 200, 269,140 bytes and SHA-256 `87d4a25f808eac9e79eaf49197bb38c1e375d22b18ce0533995eca81698099cc`, matching the existing pinned source. No form data was entered or sent.
- Rendered color and monochrome pages were inspected. The existing source PDF invalid-object-52 warning remains; source bytes are pinned and retained. An apparent clipped header in one tool preview was checked against actual PNG pixels: all five top bands are identical and enlarged native crops show the full draft label; no PDF modification was made for a preview artifact.
- Type checking, affected lint and whitespace checks pass. Root's independent normal and separate simplicity review found no must-fix issue in the complete changed call path. No new dependency or generic projection platform was introduced.

Evidence is local under `tmp/parent-verification/peco-cap-drafts/`; those fictional PDF/image artifacts are not agency receipts and are not committed as family records.

## Autonomy checkpoint

**Family work removed:** none from a released utility workflow in this slice. The integrity boundary permits future authorized reuse without asking a family to recheck an already validated person/account merely because a PDF was assembled.

**Remaining prompts and their reasons:** actual missing fields and evidence, subject/account authority, necessary personal certification and meaningful financial choices. No new routine review or confirmation click was added.

**Routine work still unimplemented:** live owned private projection, document/person/account matching, accepted personal completion, permitted dispatch, unknown-delivery reconciliation, provider receipt/status and attributed assistance. These are counted gaps, not work silently assigned to operators or excluded from autonomy measures.

**Outcome proved:** exact offline preparation cannot be transplanted to a different printed family/account under the same trusted reference. No eligibility, signature, application receipt, payment assistance or shutoff protection was established. Next is the minimum purpose-bound private capture/projection that can supply this reference, followed by the actual provider execution contract.
