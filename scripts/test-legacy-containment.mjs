import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { Client } from "pg";

// Local-only synthetic reproduction of the observed legacy account permissions.
const database = `caselink_legacy_${randomUUID().replaceAll("-", "")}`;
const address = name => `postgresql://postgres:postgres@127.0.0.1:54322/${name}`;
const admin = new Client({ connectionString: address("postgres") });
const client = new Client({ connectionString: address(database) });
const staff = randomUUID(), owner = randomUUID(), operator = randomUUID(), unprovisioned = randomUUID();
let created = false;
async function asUser(id, run) {
  await client.query("begin");
  try {
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
    return await run();
  } finally { await client.query("rollback"); }
}
const startedAt = new Date();
try {
  await admin.connect();
  await admin.query(`create database "${database}" template template0`); created = true;
  await client.connect();
  // Only uid() and the account FK are needed for this SQL permission reproduction.
  await client.query(`create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth, public to authenticated, anon, service_role;
    grant execute on function auth.uid() to authenticated, anon;`);
  for (const migration of ["20260321000000_init_schema", "20260321120000_family_rls", "20260321160000_family_intake_rpc", "20260325200000_app_users_profile"])
    await client.query(readFileSync(`supabase/migrations/${migration}.sql`, "utf8"));
  await client.query("grant all on all tables in schema public to authenticated, anon, service_role; grant execute on all functions in schema public to authenticated, anon;");
  for (const id of [staff, owner, operator, unprovisioned]) await client.query("insert into auth.users(id) values($1)", [id]);
  for (const id of [staff, owner, operator]) await client.query("insert into public.app_users(id,email,role) values($1,$2,$3)", [id, `${id}@example.test`, id === operator ? "admin" : "case_manager"]);
  await client.query("insert into public.families(name,created_by_id) values('Synthetic own case',$1),('Synthetic unrelated case',$2)", [staff, owner]);
  await asUser(staff, async () => {
    assert.equal((await client.query("select id from public.families")).rowCount, 1);
    await client.query("update public.app_users set role='admin' where id=$1", [staff]);
    assert.equal((await client.query("select id from public.families")).rowCount, 2, "legacy self-promotion crosses family access");
  });
  await asUser(unprovisioned, async () => {
    await client.query("insert into public.app_users(id,email,role) values($1,'unprovisioned@example.test','admin')", [unprovisioned]);
    assert.equal((await client.query("select public.is_app_admin() allowed")).rows[0].allowed, true);
  });
  const before = (await client.query("select row_to_json(u) data from public.app_users u order by id")).rows;
  await client.query(readFileSync("docs/verification/legacy-access-containment.sql", "utf8"));
  assert.deepEqual((await client.query("select row_to_json(u) data from public.app_users u order by id")).rows, before, "containment preserves every account field");
  for (const column of ["role", "email", "id"]) {
    const value = column === "role" ? "admin" : column === "email" ? "changed@example.test" : owner;
    await assert.rejects(asUser(staff, () => client.query(`update public.app_users set ${column}=$1 where id=$2`, [value, staff])), { code: "42501" });
  }
  await assert.rejects(asUser(unprovisioned, () => client.query("insert into public.app_users(id,email,role) values($1,'unprovisioned@example.test','admin')", [unprovisioned])), { code: "42501" });
  await asUser(staff, async () => {
    await client.query("update public.app_users set display_name='Synthetic profile' where id=$1", [staff]);
    assert.equal((await client.query("select display_name from public.app_users where id=$1", [staff])).rows[0].display_name, "Synthetic profile");
    assert.equal((await client.query("select id from public.families")).rowCount, 1);
  });
  await asUser(operator, async () => assert.equal((await client.query("select public.is_app_admin() allowed")).rows[0].allowed, true));
  for (const signature of ["public.is_app_admin()", "public.can_access_family(uuid)", "public.create_family_intake_row(text,text,public.family_urgency,text,public.family_status)"])
    assert.equal((await client.query("select has_function_privilege('anon',$1,'execute') allowed", [signature])).rows[0].allowed, false);
  assert.deepEqual((await client.query("select proconfig from pg_proc where oid='public.set_updated_at()'::regprocedure")).rows[0].proconfig, ['search_path=""']);
} finally {
  await client.end();
  if (created) await admin.query(`drop database "${database}" with (force)`);
  await admin.end();
}
mkdirSync("tmp/legacy-containment", { recursive: true });
writeFileSync("tmp/legacy-containment/latest.json", JSON.stringify({ startedAt, completedAt: new Date(), syntheticOnly: true, localOnly: true, legacySelfPromotionReproduced: true, legacyAdminSelfProvisioningReproduced: true, roleAndIdentityChangesDeniedAfterPatch: true, selfProvisioningDeniedAfterPatch: true, accountsUnchanged: true, profileEditingAndOwnedCaseAccessPreserved: true, existingAdminPreserved: true, anonymousRpcDenied: true, cleanupPassed: true, limits: "Minimal local Auth uid fixture and original account/family schema. No hosted account exploit, no full legacy upgrade, no email or real family data." }, null, 2) + "\n");
console.info("Legacy privilege escalation reproduced locally; containment denies it and preserves legitimate access. Isolated database removed.");
