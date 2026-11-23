import assert from "node:assert/strict";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";

// Shift source windows only in the archived source used by the native synthetic stack.
const checkout = realpathSync(resolve(import.meta.dirname, ".."));
const fixture = realpathSync(process.argv[2]);
assert.ok(fixture !== checkout && !fixture.startsWith(checkout + sep) &&
  !checkout.startsWith(fixture + sep), "Use a separate archive for native form fixtures.");

const paths = [
  "data/verified-forms/wic-pa-preapplication-2026-11-13.json",
  "data/verified-forms/pgw-crp-2026-11-13.json",
  "src/lib/parent/peco-application-fields.ts",
  "src/lib/parent/water-application-fields.ts",
  "supabase/migrations/20261113192838_parent_wic_private_application_details.sql",
  "supabase/migrations/20261113200717_parent_peco_private_application_details.sql",
  "supabase/migrations/20261113220718_parent_utility_preparation_document_scope.sql",
  "supabase/migrations/20261113221224_parent_water_private_application_details.sql",
  "supabase/migrations/20261113222134_parent_pgw_private_application_details.sql",
  "supabase/migrations/20261118035851_parent_wic_application_reaffirmation.sql",
];
const reviewedDates = /2026-11-(?:13|20)T(?:18:57:45\.283|20:06:00(?:\.000)?|21:39:43(?:\.000)?|22:09:11\.918)Z/g;
const offset = Date.now() - Date.parse("2026-11-19T12:00:00.000Z");
const changes = paths.map(path => {
  const input = readFileSync(resolve(checkout, path), "utf8");
  const output = realpathSync(resolve(fixture, path));
  assert.ok(output.startsWith(fixture + sep), "Fixture files must stay within the archive.");
  assert.equal(readFileSync(output, "utf8"), input, "Archive must contain the original source.");
  const dates = [...input.matchAll(reviewedDates)].map(([date]) => date);
  assert.ok(dates.some(date => date.startsWith("2026-11-13")) &&
    dates.some(date => date.startsWith("2026-11-20")), `Missing the reviewed source window in ${path}`);
  const staged = input.replace(reviewedDates, date => new Date(Date.parse(date) + offset).toISOString());
  return { output, staged };
});

for (const { output, staged } of changes) writeFileSync(output, staged);
console.log("Staged current synthetic form windows with unchanged lengths in the native test archive.");
