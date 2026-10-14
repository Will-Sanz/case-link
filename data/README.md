# Resource directory seed CSV

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

For this pilot, keep the existing directory as requested by the product owner. A later CSV can update it; no replacement catalog is required now. The committed sample remains synthetic, and programs/offices marked `(Demo)` are excluded from matching, manual selection, and AI context. Do not import the sample over the school's existing catalog. The hosted catalog has not yet been reachable for verification.

Imports update entries by their stable import key. They preserve an existing entry's `active=false` setting; reactivate only after the resource owner checks it. Removing a row from a CSV does not delete or disable the stored entry: explicitly disable discontinued programs. Review renamed programs for duplicates. Import summaries omit contact values and full local file paths. Failed batches return a failing exit status; fix the source/connection and rerun the same file.

Before launch, name a school resource owner and review coverage for the common barriers, location, eligibility, and contact details. Record who checked each program and when in the school's controlled resource record. Repeat that review before each import and whenever staff report outdated information. The app's **Directory updated** date records a database update/import, not proof that a program or contact was verified. Staff must confirm current availability before referring a family. Resource source/verification records and private CSVs must remain outside public source control.
