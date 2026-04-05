/**
 * Upsert resource directory rows from CSV into Supabase `public.resources`.
 * Requires SUPABASE_SERVICE_ROLE_KEY (server-only; never commit).
 *
 * Usage:
 *   npx tsx scripts/import-resources.ts [path/to/file.csv]
 *
 * Default CSV (when no path arg): `data/resources-seed.private.csv` if that file exists,
 * otherwise `data/resources-seed.sample.csv` (synthetic rows safe to commit).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });
import { createClient } from "@supabase/supabase-js";
import { parseResourceCsvFromPath } from "../src/lib/db/resource-import/parse-resource-file";
import { parsedResourceToDbRow } from "../src/lib/db/resource-import/to-db-row";
import {
  RESOURCE_SEED_PRIVATE_BASENAME,
  RESOURCE_SEED_SAMPLE_BASENAME,
  resolveDefaultResourceSeedCsvPath,
} from "../src/lib/db/resource-import/resolve-seed-csv-path";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const argPath = process.argv[2];
  let filePath: string;
  if (argPath) {
    filePath = path.resolve(argPath);
  } else {
    const resolved = resolveDefaultResourceSeedCsvPath(repoRoot);
    if (!fs.existsSync(resolved.absolutePath)) {
      console.error(
        [
          "No default resource seed CSV found.",
          `  Prefer (local, gitignored): data/${RESOURCE_SEED_PRIVATE_BASENAME}`,
          `  Fallback (repo sample):     data/${RESOURCE_SEED_SAMPLE_BASENAME}`,
          "Or pass an explicit path: npx tsx scripts/import-resources.ts path/to/file.csv",
        ].join("\n"),
      );
      process.exit(1);
    }
    filePath = resolved.absolutePath;
    console.info(`Using default resource seed (${resolved.source}): ${filePath}`);
  }

  console.info(`Reading CSV: ${filePath}`);
  const parsed = parseResourceCsvFromPath(filePath);

  if (parsed.issues.length > 0) {
    console.warn(`\nParse warnings / skipped rows (${parsed.issues.length}):`);
    for (const issue of parsed.issues.slice(0, 50)) {
      console.warn(
        `  Row ${issue.rowNumber}: ${issue.message}${issue.rawPreview ? ` | ${issue.rawPreview}` : ""}`,
      );
    }
    if (parsed.issues.length > 50) {
      console.warn(`  … and ${parsed.issues.length - 50} more`);
    }
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: runRow, error: runErr } = await supabase
    .from("resource_import_runs")
    .insert({
      source_path: filePath,
      row_count: parsed.rows.length + parsed.issues.length,
      success_count: 0,
      error_count: parsed.issues.length,
      error_log: parsed.issues.slice(0, 200),
    })
    .select("id")
    .single();

  if (runErr) {
    console.error("Failed to create import run record:", runErr.message);
    process.exit(1);
  }

  const runId = runRow.id as string;
  const batchSize = 75;
  let upserted = 0;
  let upsertErrors = 0;

  for (let i = 0; i < parsed.rows.length; i += batchSize) {
    const slice = parsed.rows.slice(i, i + batchSize);
    const payload = slice.map((r) => parsedResourceToDbRow(r));
    const { error } = await supabase.from("resources").upsert(payload, {
      onConflict: "import_key",
    });

    if (error) {
      console.error(`Batch ${i / batchSize + 1} failed:`, error.message);
      upsertErrors += slice.length;
    } else {
      upserted += slice.length;
    }
  }

  const { error: finErr } = await supabase
    .from("resource_import_runs")
    .update({
      finished_at: new Date().toISOString(),
      success_count: upserted,
      error_count: parsed.issues.length + upsertErrors,
      error_log: parsed.issues.slice(0, 200),
    })
    .eq("id", runId);

  if (finErr) {
    console.error("Failed to finalize import run:", finErr.message);
  }

  console.info(
    `\nDone. Upserted: ${upserted}, parse issues: ${parsed.issues.length}, batch failures (rows): ${upsertErrors}, import_run id: ${runId}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
