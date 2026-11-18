import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createParentSqlFixture } from "./parent-sql-fixture";
import { executeLineageSql, installObservedProductionSchema, assertObservedProductionSchema, loadProductionLineage, validateProductionLineage, applyPendingProductionSources } from "./parent-production-lineage";
import { rehearseParentProductionUpgrade } from "./parent-production-lineage-cases";
import { assertNativeLineageTarget, runNativeParentProductionLineage, schoolInventory } from "./test-parent-production-lineage";

const modulePath=process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
let fixture:Awaited<ReturnType<typeof createParentSqlFixture>>;
beforeAll(async()=>{if(modulePath){fixture=await createParentSqlFixture(modulePath,"20261109182712_parent_pilot_account_scope.sql");await installObservedProductionSchema(fixture.admin);}});
afterAll(async()=>{await fixture?.admin.end();});
it.each(['history name','history omission','unknown remote version','source omission','source hash','source path','fixture path','fixture hash','helper omission'])("rejects changed %s before a database or native cluster is touched",kind=>{
  const m=structuredClone(loadProductionLineage());
  if(kind==='history name')m.recordedMigrationHistory[0].name='changed';
  if(kind==='history omission')m.recordedMigrationHistory.pop();
  if(kind==='unknown remote version')m.recordedMigrationHistory[0].version='99999999999999';
  if(kind==='source omission')m.pendingSources.pop();
  if(kind==='source hash')m.pendingSources[0].sha256='0'.repeat(64);
  if(kind==='source path')m.pendingSources[0].name='../../.env';
  if(kind==='fixture path')m.fixtureSql.path='../../.env';
  if(kind==='fixture hash')m.fixtureSql.sha256='0'.repeat(64);
  if(kind==='helper omission')m.functions.pop();
  expect(()=>validateProductionLineage(m)).toThrow();
});
it.each(['postgresql://postgres:postgres@db.example.invalid:5432/postgres','postgresql://postgres:postgres@127.0.0.1:54322/postgres','postgresql://postgres:postgres@localhost:58422/postgres','postgresql://postgres:postgres@127.0.0.1:58422/other_database','postgresql://postgres:postgres@127.0.0.1:58422/postgres?sslmode=require'])("rejects a non-owned native target %s",url=>{expect(()=>assertNativeLineageTarget(url)).toThrow();});
it("has a key-free native dry plan and does not accept a caller's database override",async()=>{
  expect(assertNativeLineageTarget('postgresql://postgres:postgres@127.0.0.1:58422/postgres')).toContain('127.0.0.1:58422');
  expect(await runNativeParentProductionLineage(['--dry'])).toMatchObject({mode:'dry',pendingFiles:35,observedFunctions:25,observedColumns:82,modelCalls:0,providerCalls:0});
  await expect(runNativeParentProductionLineage(['--synthetic-approval','--db-url','postgresql://remote.invalid/private-credential'])).rejects.toThrow('Only --dry or --synthetic-approval is supported; a database URL cannot be supplied.');
});
it("keeps school policies while excluding new parent policies from the school-only fingerprint",()=>{
  const school={schemaname:'public',tablename:'families',policyname:'school_owner'},parent={schemaname:'public',tablename:'parent_requests',policyname:'parent_owner'};
  expect(schoolInventory({policies:[school,parent]})).toEqual({policies:[school]});
});
it("rolls back a failed migration and never executes its dependent source",async()=>{
  let ddl=0;const query=vi.fn(async(sql:string)=>{if(sql.startsWith('do $lineage$')&&++ddl===2)throw new Error('synthetic DDL rejection');return{rows:[]};});
  await expect(applyPendingProductionSources({query})).rejects.toThrow('Production-lineage upgrade stopped at');
  expect(ddl).toBe(2);expect(query.mock.calls.at(-1)?.[0]).toBe('rollback');expect(query.mock.calls.filter(([sql])=>sql==='commit')).toHaveLength(1);
});
it("rejects a source escaping its fixed SQL frame before dispatch",async()=>{const query=vi.fn();await expect(executeLineageSql({query},'$lineage_source$')).rejects.toThrow();expect(query).not.toHaveBeenCalled();});
it.skipIf(!modulePath)("reproduces the installed controlled-test production schema before applying pending source",async()=>{
  expect((await fixture.admin.query("select to_regclass('parent_private.snap_controlled_tests')::text name")).rows[0].name).toBe("parent_private.snap_controlled_tests");
});
it.skipIf(!modulePath)("refuses an observed schema missing the one-enabled-controlled-test index",async()=>{
  await fixture.admin.query('begin');
  try{await fixture.admin.query('drop index parent_private.parent_one_snap_controlled_test');await expect(assertObservedProductionSchema(fixture.admin)).rejects.toThrow();}
  finally{await fixture.admin.query('rollback');}
});
it.skipIf(!modulePath)("upgrades all35 pending files from the observed parent lineage",async()=>{
  expect(await rehearseParentProductionUpgrade(fixture.admin,{embedded:true})).toMatchObject({observedFunctions:25,ongoingInfinityPreserved:true,preSubmitReviewWithoutDispatch:true,publicDirectoryAndMixedIsolation:true,modelCalls:0,providerCalls:0});
});
