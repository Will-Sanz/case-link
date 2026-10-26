# Resource directory seed CSV

**Parent-support pivot — October 25, 2026:** the product owner confirmed that existing listed resources are partners. Preserve this network and use it to build the food-support and utility-assistance routes in the [current PRD](../docs/parent-support-mvp-prd.md) and [implementation plan](../docs/parent-support-implementation-plan.md). The committed sample below is still synthetic and is never a real partner.

Partner membership does not establish a program's current availability, eligibility, accepted information, referral transport, integration access, or response time. Review each enabled launch route and record sources, field/document requirements, recipient, acknowledgement and escalation in the restricted operational record. Distinguish organizations from specific programs and similarly named programs such as water CAP and PECO CAP. Confirm immediate-food coverage before advertising it; the prior source review did not identify a dedicated pantry route from exported names/descriptions.

**Autonomy/coverage revision:** map the complete PRD coverage across immediate food, SNAP/WIC and electricity/gas/water, including new applications, continuing/pending support and urgent needs. For each program/action record actual preparation, known-form, submission, document-supplement, scheduling, status and follow-up capability; delegation permission, required personal acts, named recipients/data/purpose, factual freshness and fallback. AI can choose and pursue enabled actions within an informed standing mandate. A new recipient or purpose needs consent; routine in-scope packet updates do not need another parent approval. A missing API is a feasibility question for permitted secure/browser/partner channels, not an automatic deletion of that service journey.

- **`resources-seed.sample.csv`** — Safe to commit. Synthetic “Sample … (Demo)” rows for local demos and CI checks.
- **`resources-seed.private.csv`** — Gitignored. Place a full real export here for imports; never commit partner PII.

`npm run db:import` uses **`resources-seed.private.csv` when it exists**, otherwise **`resources-seed.sample.csv`**. You can always pass an explicit path to override.

```bash
# Default (private → else sample)
npm run db:import

# Explicit file
npx tsx scripts/import-resources.ts path/to/your.csv
```

Sanity check (no database): `npx tsx scripts/verify-resource-seed-paths.ts`

Keep the existing directory and enrich verified program/action contracts in delivery phases until the complete release coverage is supported. A later reviewed CSV can update it; do not replace the network with a speculative catalog or treat the first working route as finished scope. The committed sample remains synthetic, and programs/offices marked `(Demo)` are excluded from matching, manual selection, and AI context. Do not import the sample over an existing real catalog. This documentation update did not inspect or change hosted catalog rows.

Imports update entries by their stable import key. They preserve an existing entry's `active=false` setting; reactivate only after the resource owner checks it. Removing a row from a CSV does not delete or disable the stored entry: explicitly disable discontinued programs. Review renamed programs for duplicates. Import summaries omit contact values and full local file paths. Failed batches return a failing exit status; fix the source/connection and rerun the same file.

Before parent launch, name a resource owner and verify selected food/utility programs, service area, requirements, contact and handoff. Record who checked each fact and when, with approved source references; private contacts and agreements stay in the restricted operational record. Repeat review before imports and after source changes or reported errors. The app's **Directory updated** date records a database update/import, not proof that a program, capacity or contact was verified. The PRD requires explicit Unknown states and prevents unreviewed facts from changing external-action behavior. Private CSVs, partner contact details and agreements must remain outside public source control. Historical school source reviews remain dated evidence and do not establish present capacity.
