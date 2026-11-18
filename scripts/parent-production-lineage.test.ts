import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { AssertionError } from "node:assert";
import { createParentSqlFixture } from "./parent-sql-fixture";
import { lineageHash, executeLineageSql, installObservedProductionSchema, assertObservedProductionSchema, loadProductionLineage, validateProductionLineage, applyPendingProductionSources } from "./parent-production-lineage";
import { rehearseParentProductionUpgrade } from "./parent-production-lineage-cases";
import { assertNativeLineageTarget, runNativeParentProductionLineage, schoolInventory, fingerprint, withNativeLineageRoleAccess, nativeLineageAssertionLocation } from "./test-parent-production-lineage";

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
  expect(await runNativeParentProductionLineage(['--dry'])).toMatchObject({mode:'dry',pendingFiles:36,observedFunctions:25,observedColumns:82,modelCalls:0,providerCalls:0});
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
it.skipIf(!modulePath)("upgrades all36 pending files from the observed parent lineage",async()=>{
  expect(await rehearseParentProductionUpgrade(fixture.admin,{embedded:true})).toMatchObject({observedFunctions:25,ongoingInfinityPreserved:true,preSubmitReviewWithoutDispatch:true,publicDirectoryAndMixedIsolation:true,unknownDescriptionsResolved:true,modelCalls:0,providerCalls:0});
});

it("uses the existing byte order for historical schema fingerprints, independent of host locale",()=>{
  const rows=[{name:"public.a"},{name:"public_A"},{name:"public.A"},{name:"public._function"}];
  expect(fingerprint({policies:rows})).toEqual({policies:{count:4,sha256:lineageHash(JSON.stringify([rows[2],rows[3],rows[0],rows[1]]))}});
});

it("canonicalizes schema row keys with the historical byte order",()=>{
  const row={a:1,A:2,_:3};
  expect(fingerprint({policies:[row]})).toEqual({policies:{count:1,sha256:lineageHash('[{"A":2,"_":3,"a":1}]')}});
});

it("reports only an allowlisted assertion source line without private messages, values or paths",()=>{
  const error=new AssertionError({actual:{privateFact:"SyntheticPrivateCanary"},expected:null,operator:"deepEqual"});
  error.stack="AssertionError: SyntheticPrivateCanary /parent-production-lineage-cases.ts:999:1\n    at rehearseParentProductionUpgrade (/private/SyntheticPrivateCanary/scripts/parent-production-lineage-cases.ts:113:18)";
  expect(nativeLineageAssertionLocation(error)).toBe("; assertion case line 113");
  error.stack="AssertionError: /parent-production-lineage-cases.ts:999:1\n    at other (/private/other.ts:7:8)";
  expect(nativeLineageAssertionLocation(error)).toBe("");
  const other=new Error("SyntheticPrivateCanary");other.stack="Error\n    at other (/private/parent-production-lineage-cases.ts:113:18)";
  expect(nativeLineageAssertionLocation(other)).toBe("");expect(nativeLineageAssertionLocation({code:"ERR_ASSERTION",stack:other.stack})).toBe("");
});

it("locates an actual shared-rehearsal assertion in the runtime source-mapped stack",async()=>{
  const db={query:vi.fn(async()=>({rows:[{value:null}]}))};
  try{await rehearseParentProductionUpgrade(db,{embedded:false});expect.fail("The absent synthetic Vault must fail before fixture writes");}
  catch(error){expect(error).toMatchObject({code:"ERR_ASSERTION"});expect(nativeLineageAssertionLocation(error)).toMatch(/^; assertion case line [1-9]\d*$/);}
  expect(db.query).toHaveBeenCalledTimes(1);
});

it.skipIf(!modulePath).each(["success","failed work","missing ADMIN"])("restores exact native fixture memberships after %s",async mode=>{
  const {PGlite}=await import(modulePath!),db=new PGlite(),operator="caselink_lineage_operator";
  const targets=["authenticated","parent_worker","parent_snap_finalizer"],definitions="create role parent_worker nologin noinherit nobypassrls;create role parent_snap_finalizer nologin noinherit;";
  try{
    await db.exec(`create role authenticated;create role native_authenticator nologin;create role ${operator} createrole noinherit;grant authenticated to native_authenticator with admin false,inherit false,set true;grant native_authenticator to ${operator} with admin false,inherit false,set true;`);
    if(mode==="missing ADMIN")await db.exec(`${definitions}grant parent_worker to ${operator} with admin false,inherit false,set false;grant parent_snap_finalizer to ${operator} with admin true,inherit false,set false;`);
    await db.exec(`set session authorization ${operator}`);
    if(mode!=="missing ADMIN"){await db.exec(definitions);await db.exec(`grant parent_worker to ${operator} with admin false,inherit true,set false`);}
    const memberships=async()=>(await db.query("select granted.rolname,grantor.rolname grantor,m.admin_option,m.inherit_option,m.set_option from pg_auth_members m join pg_roles granted on granted.oid=m.roleid join pg_roles grantor on grantor.oid=m.grantor where m.member=current_user::regrole and granted.rolname=any($1) order by granted.rolname,grantor.rolname",[targets])).rows;
    const roles=async()=>(await db.query("select rolname,rolsuper,rolcreaterole,rolinherit,rolcanlogin,rolbypassrls from pg_roles where rolname=any($1) order by rolname",[[...targets,operator]])).rows;
    const before=await memberships(),attributes=await roles();
    expect(attributes.find((role:{rolname:string})=>role.rolname===operator)).toMatchObject({rolsuper:false,rolcreaterole:true});
    for(const role of ["parent_worker","parent_snap_finalizer"])await expect(db.query(`set role ${role}`)).rejects.toMatchObject({code:"42501"});
    const work=vi.fn(async()=>{
      for(const role of targets){await db.query("begin");try{await db.query(`set local role ${role}`);expect((await db.query("select current_user name")).rows[0].name).toBe(role);}finally{await db.query("rollback");}}
      if(mode==="failed work")throw new Error("synthetic interrupted case");
      await db.exec("create role parent_new_lineage_fixture nologin noinherit");return "complete";
    });
    if(mode==="success")expect(await withNativeLineageRoleAccess(db,work)).toBe("complete");
    else await expect(withNativeLineageRoleAccess(db,work)).rejects.toThrow(mode==="failed work"?"synthetic interrupted case":"existing ADMIN membership");
    expect(work).toHaveBeenCalledTimes(mode==="missing ADMIN"?0:1);expect(await memberships()).toEqual(before);expect(await roles()).toEqual(attributes);
    for(const role of ["parent_worker","parent_snap_finalizer"])await expect(db.query(`set role ${role}`)).rejects.toMatchObject({code:"42501"});
  }finally{await db.close();}
});
