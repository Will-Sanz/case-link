/**
 * Applies `plans.generation_state` if your Supabase project is missing it.
 *
 * Option A — Supabase Dashboard (no deps): SQL Editor → paste contents of
 *   supabase/migrations/20260328120000_plans_generation_state.sql
 *
 * Option B — This script: add a Postgres connection string to .env.local, e.g.
 *   DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
 *   (use the URI from Project Settings → Database; prefer “Session” or “Direct” for DDL.)
 *
 * Usage: pnpm exec tsx scripts/apply-plans-generation-state-column.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import { Client } from "pg";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const url = process.env.DATABASE_URL?.trim() || process.env.DIRECT_URL?.trim();

const migrationPath = join(process.cwd(), "supabase/migrations/20260328120000_plans_generation_state.sql");

async function main() {
  const sql = readFileSync(migrationPath, "utf8").trim();

  if (!url) {
    console.log(
      "No DATABASE_URL or DIRECT_URL in .env.local — paste into Supabase → SQL Editor:\n\n" + sql + "\n",
    );
    process.exit(0);
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(sql);
    console.log("OK: plans.generation_state column ensured.");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
