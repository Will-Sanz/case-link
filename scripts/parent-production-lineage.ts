import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import type { WorkerDatabase } from "../src/lib/parent/worker-runtime";

type Source={name:string;sha256:string};
type ObservedFunction={signature:string;owner:string;securityDefiner:boolean;searchPath:string[];acl:string[];sha256:string};
export type ProductionLineage={version:string;sourceBase:string;recordedMigrationHistory:{version:string;name:string}[];baselineSources:Source[];pendingSources:Source[];
  fixtureSql:{path:string;sha256:string};legacyFixtureSha256:string;functions:ObservedFunction[];
  controlledSchema:{tables:{schema:string;name:string;owner:string;acl:string[];rls:boolean;forceRls:boolean}[];columns:Record<string,unknown>[];constraints:Record<string,unknown>[];indexes:Record<string,unknown>[];triggers:Record<string,unknown>[];policies:unknown}};
export const lineageHash=(value:string|Buffer)=>createHash("sha256").update(value).digest("hex");
const fixturePath="tests/fixtures/parent/production-lineage-2026-11-18.sql";
const remoteOnly=["20261110141330","20261110161631","20261117183830","20261117190812","20261118004147"];
export function validateProductionLineage(value:ProductionLineage) {
  assert.equal(value.version,"parent-production-lineage-2026-11-18.v1");
  const names=readdirSync("supabase/migrations").filter(name=>name.endsWith(".sql")).sort();
  const versions=new Set(value.recordedMigrationHistory.map(row=>row.version));
  assert.equal(versions.size,100);assert.equal(value.recordedMigrationHistory.length,100);
  assert.equal(lineageHash(JSON.stringify(value.recordedMigrationHistory)),"49f7440455f9c463d8e51ee8aaa92b0b4dabc53ccda1d060f24296ea6f4a4dd7","Observed migration history must stay exact");
  assert.deepEqual([...versions].filter(version=>!names.some(name=>name.startsWith(version+"_"))).sort(),remoteOnly);
  assert.equal(value.pendingSources.length,38);
  assert.deepEqual(value.pendingSources.map(source=>source.name),names.filter(name=>!versions.has(name.slice(0,14))));
  const missingEarlier=["20260802120000_demo_requests.sql","20260802143000_replace_family_barriers_rpc.sql"];
  assert.deepEqual(value.baselineSources.map(source=>source.name),names.filter(name=>versions.has(name.slice(0,14))&&(missingEarlier.includes(name)||name>="20260804173443")));
  for(const source of [...value.baselineSources,...value.pendingSources]){
    assert.match(source.name,/^\d{14}_[a-z0-9_]+\.sql$/);assert.equal(lineageHash(readFileSync(`supabase/migrations/${source.name}`)),source.sha256,`Changed migration source: ${source.name}`);
  }
  assert.equal(value.fixtureSql.path,fixturePath);assert.equal(lineageHash(readFileSync(fixturePath)),value.fixtureSql.sha256);
  assert.equal(lineageHash(readFileSync("tests/fixtures/legacy-schema-2026-10-14.sql")),value.legacyFixtureSha256);
  assert.equal(value.functions.length,25);assert.equal(new Set(value.functions.map(f=>f.signature)).size,25);
  assert.equal(value.controlledSchema.columns.length,82);assert.equal(value.controlledSchema.triggers.length,3);
  return value;
}
export function loadProductionLineage(){return validateProductionLineage(JSON.parse(readFileSync("tests/fixtures/parent/production-lineage-2026-11-18.json","utf8")));}

/** Same whole-file transaction semantics on native PostgreSQL and the existing embedded query-only fixture. */
export async function executeLineageSql(db:WorkerDatabase,source:string){
  assert.ok(!source.includes("$lineage_source$"));
  await db.query("do $lineage$ begin execute $lineage_source$"+source+"$lineage_source$;end $lineage$");
}
export function transactionalLineageSource(name:string){
  const source=readFileSync(`supabase/migrations/${name}`,"utf8"),boundaries=[...source.matchAll(/^(begin|commit|rollback);[ \t]*$/gm)].map(value=>value[1]);
  if(name==="20261106051250_parent_food_journey_boundaries.sql"){
    assert.deepEqual(boundaries,["begin","commit"]);return source.replace(/^begin;\n/m,"").replace(/\ncommit;\s*$/,"\n");
  }
  assert.deepEqual(boundaries,[],`${name} must retain one caller-owned transaction`);return source;
}
export async function installObservedProductionSchema(db:WorkerDatabase,lineage=loadProductionLineage()){
  await executeLineageSql(db,readFileSync(lineage.fixtureSql.path,"utf8"));
  await assertObservedProductionSchema(db,lineage);
}
export async function assertObservedProductionSchema(db:WorkerDatabase,lineage=loadProductionLineage()){
  await db.query("set search_path=public");
  for(const expected of lineage.functions){
    const actual=(await db.query("select pg_get_functiondef(p.oid) definition,pg_get_userbyid(p.proowner) owner,p.prosecdef, to_jsonb(p.proconfig) config,to_jsonb(p.proacl) acl from pg_proc p where p.oid=$1::regprocedure",[expected.signature])).rows[0];
    assert.ok(actual,`Missing observed function ${expected.signature}`);assert.equal(lineageHash(String(actual.definition)),expected.sha256,`Observed definition differs: ${expected.signature}`);
    assert.equal(actual.owner,expected.owner);assert.equal(actual.prosecdef,expected.securityDefiner);assert.deepEqual(actual.config,expected.searchPath);assert.deepEqual((actual.acl as string[]).sort(),[...expected.acl].sort());
  }
  for(const expected of lineage.controlledSchema.tables){
    const actual=(await db.query("select pg_get_userbyid(c.relowner) owner,to_jsonb(c.relacl) acl,c.relrowsecurity rls,c.relforcerowsecurity force_rls from pg_class c where c.oid=$1::regclass",[`${expected.schema}.${expected.name}`])).rows[0];
    assert.equal(actual.owner,expected.owner);assert.equal(actual.rls,expected.rls);assert.equal(actual.force_rls,expected.forceRls);assert.deepEqual((actual.acl as string[]).sort(),[...expected.acl].sort());
  }
  const columns=(await db.query(`select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',a.attname,'ordinal',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid),'acl',to_jsonb(a.attacl))) columns
    from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum where c.oid=any($1::regclass[]) and a.attnum>0 and not a.attisdropped`,[lineage.controlledSchema.tables.map(table=>`${table.schema}.${table.name}`)])).rows[0].columns as Record<string,unknown>[];
  const order=(a:Record<string,unknown>,b:Record<string,unknown>)=>`${a.schema}.${a.table}`.localeCompare(`${b.schema}.${b.table}`)||Number(a.ordinal)-Number(b.ordinal);
  assert.deepEqual(columns.sort(order),[...lineage.controlledSchema.columns].sort(order));
  for(const expected of lineage.controlledSchema.constraints){const actual=(await db.query("select pg_get_constraintdef(oid,true) definition,convalidated validated from pg_constraint where conrelid=$1::regclass and conname=$2",[`${expected.schema}.${expected.table}`,expected.name])).rows[0];assert.deepEqual(actual,{definition:expected.definition,validated:expected.validated});}
  for(const expected of lineage.controlledSchema.indexes){const actual=(await db.query("select pg_get_indexdef(indexrelid) definition from pg_index where indexrelid=to_regclass($1)",[`${expected.schema}.${expected.name}`])).rows[0];assert.deepEqual(actual,{definition:expected.definition});}
  for(const expected of lineage.controlledSchema.triggers){
    const actual=(await db.query("select pg_get_triggerdef(t.oid,true) definition,t.tgenabled enabled from pg_trigger t where t.tgrelid=$1::regclass and t.tgname=$2",[`${expected.schema}.${expected.table}`,expected.name])).rows[0];
    assert.deepEqual(actual,{definition:expected.definition,enabled:expected.enabled});
  }
  assert.equal((await db.query("select count(*)::int n from pg_policy where polrelid='parent_private.snap_controlled_tests'::regclass")).rows[0].n,0);
}
export async function applyPendingProductionSources(db:WorkerDatabase,lineage=loadProductionLineage()){
  const applied:Source[]=[];
  for(const source of lineage.pendingSources){
    await db.query("begin");
    try{await db.query("set local lock_timeout='5s'");await db.query("set local statement_timeout='60s'");await executeLineageSql(db,transactionalLineageSource(source.name));await db.query("commit");applied.push(source);}
    catch(error){await db.query("rollback");throw new Error(`Production-lineage upgrade stopped at ${source.name}`,{cause:error});}
  }
  return applied;
}
