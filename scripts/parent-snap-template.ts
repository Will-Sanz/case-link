import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { SNAP_DRAFT_CONTRACT } from "../src/lib/parent/snap-draft";
import { SNAP_PREVIEW_TEMPLATE_ID, SNAP_PREVIEW_TEMPLATE_VERSION } from "../src/lib/parent/snap-application-snapshot";

export function snapTemplateRecord(bytes: Uint8Array, now: Date, profile: "zip-draft" | "application-preview" = "zip-draft") {
  const form = SNAP_DRAFT_CONTRACT;
  assert.ok(Number.isFinite(now.getTime()) && now.getTime() >= Date.parse(`${form.sourceCheckedAt}T00:00:00Z`) && now.getTime() < Date.parse(form.verifiedUntil), "The official form needs a current review.");
  assert.equal(bytes.length, form.byteLength, "The official form differs from its reviewed source.");
  assert.equal(createHash("sha256").update(bytes).digest("hex"), form.sha256, "The official form differs from its reviewed source.");
  return {
    id: profile === "application-preview" ? SNAP_PREVIEW_TEMPLATE_ID : form.id,
    version: profile === "application-preview" ? SNAP_PREVIEW_TEMPLATE_VERSION : form.version, program_id: "snap-pa", needs: ["snap_new"],
    content_sha256: form.sha256, object_path: `snap-pa/${form.version}.pdf`,
    field_map: profile === "application-preview" ? {} : { ZIP: "zip" }, required_acts: [],
    required_fields: profile === "application-preview" ? [] : ["zip"], personal_fields: [],
    source_url: form.sourceUrl, verified_until: form.verifiedUntil, preparation_only: true,
  };
}

export function snapTemplateLocalTarget(value: unknown) {
  const status = value as Record<string, unknown>;
  assert.equal(status?.API_URL, "http://127.0.0.1:55321", "Use the isolated local API.");
  assert.equal(typeof status.DB_URL, "string", "Use the isolated local database.");
  const database = new URL(status.DB_URL as string);
  assert.ok(["postgres:", "postgresql:"].includes(database.protocol) && database.hostname === "127.0.0.1" &&
    database.port === "55322" && database.pathname === "/postgres" && database.username === "postgres" &&
    !database.search && !database.hash, "Use the isolated local database.");
  assert.ok(typeof status.SERVICE_ROLE_KEY === "string" && status.SERVICE_ROLE_KEY.length >= 20, "A local setup credential is required.");
  return { apiUrl: status.API_URL, databaseUrl: status.DB_URL as string, storageKey: status.SERVICE_ROLE_KEY };
}

async function main() {
  const profile = process.argv[2] ?? "zip-draft";
  if (!["zip-draft", "application-preview"].includes(profile) || process.argv[3] !== undefined) throw new Error("Choose a reviewed local SNAP profile.");
  const cli = process.env.CASELINK_SUPABASE_CLI;
  assert.ok(cli, "Set the installed local Supabase CLI path.");
  const target = snapTemplateLocalTarget(JSON.parse(execFileSync(cli, ["status", "--workdir", resolve("tmp/parent-runtime"), "--output", "json"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15000,
  })));
  const bytes = readFileSync("data/verified-forms/snap-pa600fs-2019.pdf");
  const record = snapTemplateRecord(bytes, new Date(), profile as "zip-draft" | "application-preview");
  const storage = createClient(target.apiUrl, target.storageKey, { auth: { persistSession: false, autoRefreshToken: false } }).storage.from("parent-known-forms");
  // An existing source is never overwritten; its exact stored bytes must match.
  await storage.upload(record.object_path, bytes, { contentType: "application/pdf", upsert: false });
  const stored = await storage.download(record.object_path);
  assert.ok(!stored.error && stored.data && stored.data.size === bytes.length, "The stored official form could not be verified.");
  assert.equal(createHash("sha256").update(new Uint8Array(await stored.data.arrayBuffer())).digest("hex"), record.content_sha256, "The stored official form could not be verified.");
  const db = new Client({ connectionString: target.databaseUrl, connectionTimeoutMillis: 3000, statement_timeout: 10000 });
  await db.connect();
  try {
    await db.query("begin");
    if (profile === "application-preview") assert.ok((await db.query(
      "select to_regprocedure('parent_private.parent_register_snap_application_preview(uuid,uuid,integer,uuid,text,text)') configured",
    )).rows[0].configured, "Apply the reviewed private preview migration before selecting this profile.");
    await db.query(`insert into parent_private.form_templates(id,version,program_id,needs,content_sha256,object_path,field_map,required_acts,required_fields,personal_fields,source_url,verified_until,preparation_only,active)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,false) on conflict(id,version) do nothing`, [
      record.id, record.version, record.program_id, record.needs, record.content_sha256, record.object_path,
      JSON.stringify(record.field_map), record.required_acts, record.required_fields, record.personal_fields, record.source_url, record.verified_until,
    ]);
    const existing = (await db.query("select * from parent_private.form_templates where id=$1 and version=$2 for update", [record.id, record.version])).rows[0];
    for (const [key, value] of Object.entries(record)) {
      const actual = key === "verified_until" ? new Date(existing[key]).toISOString() : existing[key];
      assert.deepEqual(actual, value, "The existing template contract differs; no record was replaced.");
    }
    await db.query("update parent_private.form_templates set active=true where id=$1 and version=$2", [record.id, record.version]);
    await db.query("commit");
  } catch (error) {
    await db.query("rollback").catch(() => {});
    throw error;
  } finally { await db.end(); }
  process.stdout.write(`The reviewed ${profile} template is installed locally for unsigned preparation only. No submission capability is enabled.\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve("scripts/parent-snap-template.ts"))
  void main().catch(() => {
    process.stderr.write("The local unsigned SNAP template could not be installed. Check its current source, private local setup and preparation-only schema. No credential or family detail is logged here.\n");
    process.exitCode = 1;
  });
