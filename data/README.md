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
