import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { Client } from "pg";

// Local-only: no environment-selected host, existing database writes, external email or AI.
const container = "supabase_db_caselink";
const databaseUrl = name => `postgresql://postgres:postgres@127.0.0.1:54322/${name}`;
const suffix = randomUUID().replaceAll("-", "");
const source = `caselink_restore_source_${suffix}`, target = `caselink_restore_target_${suffix}`;
const schemas = ["public", "auth", "private", "extensions", "supabase_migrations"];
const schemaFlags = schemas.map(schema => `--schema=${schema}`);
const created = [], clients = [];
const admin = new Client({ connectionString: databaseUrl("postgres") });
const docker = (args, input) => execFileSync("docker", ["exec", "-i", container, ...args], { input, maxBuffer: 30_000_000, stdio: ["pipe", "pipe", "pipe"] });
const sql = (database, input) => docker(["psql", "-X", "-U", "supabase_admin", "-d", database, "-v", "ON_ERROR_STOP=1"], input);
const hash = value => createHash("sha256").update(value).digest("hex");
async function connect(name) {
  const client = new Client({ connectionString: databaseUrl(name) });
  await client.connect(); clients.push(client); return client;
}
async function inventory(client) {
  const tables = (await client.query("select schemaname,tablename from pg_tables where schemaname=any($1::text[]) order by 1,2", [schemas])).rows;
  const records = [];
  for (const { schemaname, tablename } of tables) {
    const qualified = [schemaname, tablename].map(value => '"' + value.replaceAll('"', '""') + '"').join(".");
    const rows = (await client.query(`select row_to_json(t)::text as value from ${qualified} t order by row_to_json(t)::text`)).rows.map(row => row.value);
    records.push({ table: `${schemaname}.${tablename}`, rows: rows.length, sha256: hash(rows.join("\n")) });
  }
  return records;
}
const user = randomUUID(), stranger = randomUUID(), session = randomUUID(), otherSession = randomUUID();
const family = randomUUID(), plan = randomUUID(), step = randomUUID(), action = randomUUID();
async function asUser(client, id, sessionId, run) {
  await client.query("begin");
  try {
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)", [id, JSON.stringify({ sub: id, role: "authenticated", session_id: sessionId, aal: "aal1", amr: [{ method: "password" }] })]);
    const result = await run(); await client.query("commit"); return result;
  } catch (error) { await client.query("rollback"); throw error; }
}
const startedAt = new Date();
let evidence;
try {
  await admin.connect();
  // Only definitions and migration IDs come from the existing local database.
  const schema = docker(["pg_dump", "-U", "supabase_admin", "-d", "postgres", "--schema-only", ...schemaFlags, "--no-publications", "--no-subscriptions"]);
  const migrations = (await admin.query("select version from supabase_migrations.schema_migrations order by version")).rows.map(row => row.version);
  for (const name of [source, target]) {
    await admin.query(`create database "${name}" template template0`); created.push(name);
    if (name === source) sql(name, "drop schema public;");
  }
  sql(source, schema);
  sql(source, 'create extension pgcrypto with schema extensions; create extension "uuid-ossp" with schema extensions;');
  const original = await connect(source);
  await original.query("insert into private.production_controls(singleton,ai_enabled) values(true,false)");
  for (const version of migrations) await original.query("insert into supabase_migrations.schema_migrations(version) values($1)", [version]);
  for (const [id, sid] of [[user, session], [stranger, otherSession]]) {
    await original.query("insert into auth.users(id,aud,role,email,created_at,updated_at) values($1,'authenticated','authenticated',$2,now(),now())", [id, `restore-${id}@example.test`]);
    await original.query("insert into auth.sessions(id,user_id) values($1,$2)", [sid, id]);
    await original.query("insert into public.app_users(id,email,role) values($1,$2,'case_manager')", [id, `restore-${id}@example.test`]);
  }
  await original.query("insert into public.families(id,name,created_by_id) values($1,'Synthetic restore family',$2)", [family, user]);
  await original.query("insert into public.plans(id,family_id,version,generation_source) values($1,$2,1,'manual')", [plan, family]);
  await original.query(`insert into public.plan_steps(id,plan_id,phase,title,description,sort_order,details) values($1,$2,'30','Confirm school travel','Discuss preferences',0,'{"expected_outcome":"Next step agreed"}')`, [step, plan]);
  await original.query("insert into public.plan_step_action_items(id,plan_step_id,title,week_index,sort_order,target_date) values($1,$2,'Confirm the next conversation',1,0,current_date+7)", [action, step]);
  const revision = await asUser(original, user, session, async () => {
    const snapshot = (await original.query("select public.get_family_plan_snapshot($1) snapshot", [family])).rows[0].snapshot;
    await original.query("select public.mark_plan_reviewed($1,$2,$3,true)", [family, plan, snapshot.plan.review_revision]);
    return snapshot.plan.review_revision;
  });
  const expected = await inventory(original);
  const backupAt = new Date();
  const backup = docker(["pg_dump", "-U", "supabase_admin", "-d", source, "--format=custom", "--no-publications", "--no-subscriptions"]);
  assert.throws(() => docker(["pg_restore", "--list"], Buffer.from("invalid synthetic backup")), "corrupt backups fail");
  const restoreStartedAt = new Date();
  docker(["pg_restore", "-U", "supabase_admin", "-d", target, "--single-transaction", "--exit-on-error"], backup);
  const restored = await connect(target);
  assert.deepEqual(await inventory(restored), expected, "all synthetic table rows restore exactly");
  assert.equal(await asUser(restored, user, session, async () => (await restored.query("select public.is_reviewed_plan_revision($1,$2,$3) allowed", [family, plan, revision])).rows[0].allowed), true);
  assert.equal(await asUser(restored, stranger, otherSession, async () => (await restored.query("select id from public.families where id=$1", [family])).rowCount), 0, "unassigned user remains denied");
  await restored.query("update public.plan_step_action_items set title='Changed after restore' where id=$1", [action]);
  assert.equal(await asUser(restored, user, session, async () => (await restored.query("select public.is_reviewed_plan_revision($1,$2,$3) allowed", [family, plan, revision])).rows[0].allowed), false, "stale review remains denied");
  assert.equal((await restored.query("select ai_enabled from private.production_controls where singleton")).rows[0].ai_enabled, false);
  // Enable the database-only budget fixtures; neither temporary database has an API service.
  await restored.query("update private.production_controls set ai_enabled=true where singleton");
  // The complete existing RLS/password-session/transaction/export suite runs only against the new target.
  const regression = execFileSync(process.execPath, ["--import", "tsx", "scripts/test-database-security.ts"], { env: { ...process.env, CASELINK_DB_SECURITY_TEST_URL: databaseUrl(target) }, encoding: "utf8", maxBuffer: 5_000_000 });
  assert.match(regression, /Database security integration checks passed/);
  evidence = { startedAt, completedAt: new Date(), syntheticOnly: true, source: "local CaseLink schema; newly seeded isolated database", migrationCount: migrations.length, latestMigration: migrations.at(-1), schemaSha256: hash(schema), backupSha256: hash(backup), backupBytes: backup.length, backupAt, restoreStartedAt, recoverySeconds: (Date.now() - restoreStartedAt.getTime()) / 1000, syntheticDataLossSeconds: 0, restoredTables: expected, corruptBackupRejected: true, reviewedRevisionPreserved: true, unauthorizedReadDenied: true, staleExportDenied: true, fullDatabaseRegressionPassed: true, limits: "Local logical app/Auth restore using existing cluster roles. Does not test hosted PITR, storage objects, SMTP, provider configuration, role recovery, or real outage RPO/RTO." };
} finally {
  await Promise.allSettled(clients.map(client => client.end()));
  for (const name of created.reverse()) await admin.query(`drop database "${name}" with (force)`);
  await admin.end();
}
mkdirSync("tmp/restore", { recursive: true });
writeFileSync("tmp/restore/latest.json", JSON.stringify({ ...evidence, cleanupPassed: true }, null, 2) + "\n");
console.info("Synthetic backup/restore, access, reviewed-export and complete database regression checks passed; isolated databases removed.");
