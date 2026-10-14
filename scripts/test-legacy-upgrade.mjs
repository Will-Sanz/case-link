import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { Client } from "pg";

// No remote override: only disposable databases inside CaseLink's local/CI test container.
const container = "supabase_db_caselink";
const address = name => `postgresql://postgres:postgres@127.0.0.1:54322/${name}`;
const database = `caselink_upgrade_${randomUUID().replaceAll("-", "")}`;
const admin = new Client({ connectionString: address("postgres") });
const client = new Client({ connectionString: address(database) });
const docker = (args, input) => execFileSync("docker", ["exec", "-i", container, ...args], { input, maxBuffer: 30_000_000, stdio: ["pipe", "pipe", "pipe"] });
const sql = input => docker(["psql", "-X", "-U", "supabase_admin", "-d", database, "-v", "ON_ERROR_STOP=1"], input);
const hash = value => createHash("sha256").update(value).digest("hex");
const quote = name => '"' + name.replaceAll('"', '""') + '"';
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const encode = value => JSON.stringify(canonical(value));
const sections = snapshot => Object.fromEntries(Object.entries(snapshot).map(([key, rows]) => [key,
  (rows ?? []).map(canonical).sort((a, b) => encode(a) < encode(b) ? -1 : encode(a) > encode(b) ? 1 : 0),
]));
const fingerprints = snapshot => Object.fromEntries(Object.entries(sections(snapshot)).map(([key, rows]) => [key, { count: rows.length, sha256: hash(encode(rows)) }]));
const inventorySql = readFileSync("scripts/legacy-schema-inventory.sql", "utf8");
const dataPreflightSql = readFileSync("docs/verification/legacy-data-preflight.sql", "utf8");
async function preflight() {
  return Object.fromEntries((await client.query(dataPreflightSql)).rows.map(row => [row.check_name, Number(row.violating_rows)]));
}
async function inventory(connection) {
  await connection.query("set search_path=public");
  return (await connection.query(inventorySql)).rows[0].schema_snapshot;
}
const migrationNames = readdirSync("supabase/migrations").filter(name => name.endsWith(".sql")).sort();
// These two earlier objects are absent in the observed schema; the case-progress migration is present.
const missingEarlier = ["20260802120000_demo_requests.sql", "20260802143000_replace_family_barriers_rpc.sql"];
const upgradeNames = migrationNames.filter(name => missingEarlier.includes(name) || name >= "20260804173443");
const migrationSource = name => readFileSync(`supabase/migrations/${name}`, "utf8");
const bundle = upgradeNames.map(name => `-- ${name}\n${migrationSource(name)}`).join("\n");
const staff = randomUUID(), other = randomUUID(), operator = randomUUID();
const session = randomUUID(), otherSession = randomUUID(), operatorSession = randomUUID();
const family = randomUUID(), otherFamily = randomUUID(), plan = randomUUID(), step = randomUUID();
const action = randomUUID(), resource = randomUUID(), demoResource = randomUUID();
let created = false, evidence;
const startedAt = new Date();
async function asUser(id, sid, run, aal = "aal1") {
  await client.query("begin");
  try {
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
      [id, JSON.stringify({ sub: id, role: "authenticated", session_id: sid, aal, amr: [{ method: "password" }] })]);
    return await run();
  } finally { await client.query("rollback"); }
}
async function upgrade() {
  await client.query("begin");
  try {
    await client.query("set local lock_timeout='5s'; set local statement_timeout='60s'");
    for (const name of upgradeNames) await client.query(migrationSource(name));
    // Replacing an immutable validation function does not recheck existing CHECK constraints.
    const checks = (await client.query(`select c.relname as table_name, con.conname,
      pg_get_expr(con.conbin,con.conrelid) as expression from pg_constraint con
      join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and con.contype='c' order by c.relname,con.conname`)).rows;
    for (const check of checks) {
      const invalid = (await client.query(`select count(*)::int n from public.${quote(check.table_name)} where not (${check.expression})`)).rows[0].n;
      if (invalid) throw Object.assign(new Error(`Existing rows violate ${check.table_name}.${check.conname}`), { code: "23514" });
    }
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; }
}
async function oldRows(baseline) {
  const result = {};
  for (const table of baseline.tables) {
    const columns = baseline.columns.filter(c => c.table === table.name).map(c => c.name);
    const qualified = table.name.split(".").map(quote).join(".");
    const rows = (await client.query(`select row_to_json(legacy_row) as data from (select ${columns.map(quote).join(",")} from ${qualified}) legacy_row`)).rows.map(row => row.data);
    // The existing demo-tag migration intentionally updates only labelled demo resources.
    for (const row of rows) if (table.name === "public.resources" && row.id === demoResource) delete row.updated_at;
    result[table.name] = rows.map(encode).sort();
  }
  return result;
}

try {
  await admin.connect();
  const authSchema = docker(["pg_dump", "-U", "supabase_admin", "-d", "postgres", "--schema-only", "--schema=auth", "--schema=extensions", "--no-publications", "--no-subscriptions"]);
  await admin.query(`create database ${quote(database)} template template0`); created = true;
  sql(authSchema);
  sql('create extension if not exists pgcrypto with schema extensions; create extension if not exists "uuid-ossp" with schema extensions;');
  await client.connect();
  await client.query("grant usage on schema public to anon, authenticated, service_role");
  await client.query(readFileSync("tests/fixtures/legacy-schema-2026-10-14.sql", "utf8"));
  const baseline = await inventory(client);
  const expectedBaseline = JSON.parse(readFileSync("docs/verification/2026-10-14-legacy-schema-fingerprints.json", "utf8")).sections;
  assert.deepEqual(fingerprints(baseline), expectedBaseline, "fixture must reproduce the actual hosted definitions and privileges");
  for (const [id, sid, role] of [[staff, session, "case_manager"], [other, otherSession, "case_manager"], [operator, operatorSession, "admin"]]) {
    await client.query("insert into auth.users(id,aud,role,email,created_at,updated_at) values($1,'authenticated','authenticated',$2,now(),now())", [id, `upgrade-${id}@example.test`]);
    await client.query("insert into auth.sessions(id,user_id) values($1,$2)", [sid, id]);
    await client.query("insert into public.app_users(id,email,role) values($1,$2,$3)", [id, `upgrade-${id}@example.test`, role]);
  }
  await client.query("insert into public.families(id,name,created_by_id) values($1,'Synthetic legacy family',$2),($3,'Other legacy family',$4)", [family, staff, otherFamily, other]);
  await client.query("insert into public.family_case_managers(family_id,user_id) values($1,$2)", [family, operator]);
  await client.query("insert into public.family_barriers(family_id,label) values($1,'School transportation')", [family]);
  await client.query("insert into public.family_goals(family_id,label) values($1,'Agree a travel plan')", [family]);
  await client.query("insert into public.family_members(family_id,display_name,relationship) values($1,'Child A','Child')", [family]);
  await client.query("insert into public.case_notes(family_id,author_id,body) values($1,$2,'Discussed travel preferences')", [family, staff]);
  await client.query(`insert into public.plans(id,family_id,version,generation_source,client_display) values($1,$2,1,'manual','{"reviewedAt":"2026-08-01","reviewedById":"legacy-review"}')`, [plan, family]);
  await client.query(`insert into public.plan_steps(id,plan_id,phase,title,description,sort_order,details) values($1,$2,'30','Agree a travel option','Discuss preferences',0,'{"expected_outcome":"Preferred option recorded"}')`, [step, plan]);
  await client.query("insert into public.plan_step_action_items(id,plan_step_id,title,week_index,sort_order,target_date) values($1,$2,'Confirm travel preference',1,0,current_date+7)", [action, step]);
  await client.query("insert into public.plan_step_activity(plan_step_id,family_id,actor_user_id,action) values($1,$2,$3,'legacy.note')", [step, family, staff]);
  for (const [id, title] of [[resource, "Community transport"], [demoResource, "Synthetic option (Demo)"]])
    await client.query("insert into public.resources(id,slug,import_key,program_name,office_or_department) values($1,$2,$2,$3,'Synthetic office')", [id, `upgrade-${id}`, title]);
  await client.query("insert into public.resource_matches(family_id,resource_id,match_reason,score) values($1,$2,'Travel support',10)", [family, resource]);
  await client.query("insert into public.plan_step_resources(plan_step_id,resource_id) values($1,$2)", [step, resource]);
  await client.query("insert into public.referrals(family_id,resource_id,organization_label) values($1,$2,'Community transport')", [family, resource]);
  await client.query("insert into public.tasks(family_id,title,created_by_id,plan_step_id) values($1,'Confirm the next conversation',$2,$3)", [family, staff, step]);
  await client.query("insert into public.case_progress_updates(family_id,plan_id,author_id,occurred_on,summary) values($1,$2,$3,current_date,'Discussed available options')", [family, plan, staff]);
  await client.query("insert into public.resource_import_runs(source_path,row_count,success_count) values('synthetic.csv',2,2)");
  await client.query("insert into public.activity_log(family_id,actor_user_id,action,entity_type,entity_id) values($1::uuid,$2,'legacy.created','family',$1::uuid::text)", [family, staff]);
  await client.query("insert into public.barrier_plan_records(owner_user_id,reference_id,family_id,selected_barriers,generated_plan_json) values($1,'synthetic-upgrade',$2,'[]','{}')", [staff, family]);
  const before = await oldRows(baseline);
  assert.equal(Object.values(before).filter(rows => rows.length > 0).length, 20, "every legacy application table has preservation coverage");
  const compatible = await preflight();
  assert.equal(Object.keys(compatible).length, 59, "all observed legacy compatibility checks execute");
  assert.ok(Object.values(compatible).every(count => count === 0), "compatible synthetic records pass the read-only preflight");
  await client.query("begin");
  try {
    await client.query("update public.plan_step_action_items set description='Call 202-555-0188' where id=$1", [action]);
    await client.query("update public.plan_steps set description='Email support@example.test' where id=$1", [step]);
    await client.query("update public.resource_matches set plan_step_id=$1,family_id=$2 where resource_id=$3", [step, otherFamily, resource]);
    await client.query("update public.plan_step_activity set family_id=$1 where plan_step_id=$2", [otherFamily, step]);
    await client.query("update public.tasks set family_id=$1 where plan_step_id=$2", [otherFamily, step]);
    await client.query("update public.case_progress_updates set family_id=$1 where plan_id=$2", [otherFamily, plan]);
    const incompatible = await preflight();
    for (const name of ["plan_step_action_items_no_direct_identifiers_check", "plan_steps_no_direct_identifiers_check",
      "resource_matches_family_consistency", "plan_step_activity_family_consistency", "tasks_family_consistency", "case_progress_updates_family_consistency"])
      assert.equal(incompatible[name], 1, `preflight identifies ${name} without exposing record contents`);
    assert.equal(Object.values(incompatible).reduce((sum, count) => sum + count, 0), 6);
  } finally { await client.query("rollback"); }
  for (const label of ["blocked@example.test", "name: john smith"]) {
    const invalid = randomUUID();
    await client.query("insert into public.families(id,name,created_by_id) values($1,$2,$3)", [invalid, label, staff]);
    assert.equal((await preflight()).families_no_direct_identifiers_check, 1, "preflight uses the strengthened detector before migrations");
    await assert.rejects(upgrade(), { code: "23514" }, "initial and strengthened privacy checks must reject the entire upgrade");
    assert.deepEqual(fingerprints(await inventory(client)), expectedBaseline, "a failed upgrade restores every original definition and grant");
    assert.equal((await client.query("select id from public.families where id=$1", [invalid])).rowCount, 1, "failure never deletes incompatible data");
    await client.query("delete from public.families where id=$1", [invalid]);
    assert.deepEqual(await oldRows(baseline), before, "failed upgrade preserves all existing content");
  }
  const oldFactor = randomUUID();
  await client.query("insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at,secret) values($1,$2,'totp','verified',now(),now(),'SYNTHETIC_ONLY')", [oldFactor, staff]);
  await assert.rejects(upgrade(), /Remove enrolled CaseLink factors/, "a password-only upgrade must not strand existing factor-protected accounts");
  assert.deepEqual(fingerprints(await inventory(client)), expectedBaseline, "factor preflight failure rolls back the whole upgrade");
  assert.equal((await client.query("select id from auth.mfa_factors where id=$1", [oldFactor])).rowCount, 1, "the upgrade never deletes an Auth credential");
  await client.query("delete from auth.mfa_factors where id=$1", [oldFactor]);
  await upgrade();
  assert.deepEqual(await oldRows(baseline), before, "successful upgrade preserves legacy columns, relationships and history");
  const target = await inventory(client), fresh = await inventory(admin);
  const targetSections = sections(target), freshSections = sections(fresh);
  for (const key of Object.keys(targetSections)) assert.deepEqual(targetSections[key], freshSections[key], `upgraded ${key} must match a fresh install`);
  assert.equal((await client.query("select count(*)::int n from public.app_users where is_active")).rows[0].n, 3);
  assert.equal((await client.query("select is_demo from public.resources where id=$1", [resource])).rows[0].is_demo, false);
  assert.equal((await client.query("select is_demo from public.resources where id=$1", [demoResource])).rows[0].is_demo, true);
  await asUser(staff, session, async () => {
    assert.equal((await client.query("select id from public.families")).rowCount, 1);
    const snapshot = (await client.query("select public.get_family_plan_snapshot($1) snapshot", [family])).rows[0].snapshot;
    const revision = snapshot.plan.review_revision;
    assert.equal((await client.query("select public.is_reviewed_plan_revision($1,$2,$3) allowed", [family, plan, revision])).rows[0].allowed, false, "legacy approval cannot authorize a new export");
    await client.query("select public.mark_plan_reviewed($1,$2,$3,true)", [family, plan, revision]);
    assert.equal((await client.query("select public.is_reviewed_plan_revision($1,$2,$3) allowed", [family, plan, revision])).rows[0].allowed, true);
  });
  await asUser(other, otherSession, async () => assert.equal((await client.query("select id from public.families where id=$1", [family])).rowCount, 0));
  await asUser(operator, operatorSession, async () => assert.equal((await client.query("select id from public.families")).rowCount, 2, "legacy administrator retains password-only school access"));
  await assert.rejects(asUser(staff, session, () => client.query("update public.app_users set role='admin' where id=$1", [staff])), { code: "42501" });
  await client.query("delete from auth.sessions where id=$1", [session]);
  await asUser(staff, session, async () => assert.equal((await client.query("select id from public.families")).rowCount, 0, "retained claims fail after session revocation"));
  const regression = execFileSync(process.execPath, ["--import", "tsx", "scripts/test-database-security.ts"], { env: { ...process.env, CASELINK_DB_SECURITY_TEST_URL: address(database) }, encoding: "utf8", maxBuffer: 5_000_000 });
  assert.match(regression, /Database security integration checks passed/);
  evidence = { startedAt, completedAt: new Date(), syntheticOnly: true, localOnly: true, fixtureMatchesHostedDefinitions: true,
    legacyTableCounts: Object.fromEntries(Object.entries(before).map(([name, rows]) => [name, rows.length])),
    appliedMigrations: upgradeNames.map(name => ({ name, sha256: hash(migrationSource(name)) })), bundleSha256: hash(bundle),
    aggregateDataPreflightPassed: true, incompatibleDataRollbackPassed: true, oldColumnsAndRelationshipsPreserved: true, schemaMatchesFreshInstall: true,
    legacyReviewRequiresApproval: true, administratorPasswordAccessVerified: true, retainedSessionDenied: true, fullDatabaseRegressionPassed: true,
    limits: "No production rows, live upgrade, migration-history repair, backup verification, hosted Auth tokens or operator approval. Live preflight must be repeated against the unchanged definitions and approved backup." };
} finally {
  await client.end();
  if (created) await admin.query(`drop database ${quote(database)} with (force)`);
  await admin.end();
}
mkdirSync("tmp/legacy-upgrade", { recursive: true });
writeFileSync("tmp/legacy-upgrade/latest.json", JSON.stringify({ ...evidence, cleanupPassed: true }, null, 2) + "\n");
console.info("Legacy schema, preservation, failed-upgrade rollback and full database regression checks passed; isolated database removed.");
console.info("Legacy upgrade evidence: " + JSON.stringify({ ...evidence, cleanupPassed: true }));
