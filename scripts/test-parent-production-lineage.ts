import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { executeLineageSql, installObservedProductionSchema, lineageHash, loadProductionLineage, transactionalLineageSource } from "./parent-production-lineage";
import { rehearseParentProductionUpgrade } from "./parent-production-lineage-cases";

const port=58422;
export function assertNativeLineageTarget(value:string){
  const url=new URL(value);assert.equal(url.protocol,"postgresql:");assert.equal(url.hostname,"127.0.0.1");assert.equal(url.port,String(port));assert.equal(url.username,"postgres");assert.equal(url.password,"postgres");assert.equal(url.search+url.hash,"");assert.match(url.pathname,/^\/(?:postgres|caselink_parent_lineage_[a-f0-9]{32})$/);return value;
}
function canonical(value:unknown):unknown {if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));return value;}
const encode=(value:unknown)=>JSON.stringify(canonical(value));
type Inventory=Record<string,Record<string,unknown>[]>;
function fingerprint(snapshot:Inventory){return Object.fromEntries(Object.entries(snapshot).map(([key,rows])=>{const sorted=(rows??[]).map(canonical).sort((a,b)=>encode(a).localeCompare(encode(b)));return[key,{count:sorted.length,sha256:lineageHash(encode(sorted))}];}));}
export function schoolInventory(snapshot:Inventory):Inventory{return Object.fromEntries(Object.entries(snapshot).map(([key,rows])=>[key,(rows??[]).filter(row=>{const name=String(row.table??row.name??(row.schemaname&&row.tablename?`${row.schemaname}.${row.tablename}`:""));return !/^public\.parent_/.test(name);})]));}

/** No URL/configuration input: this script can create and remove only its own disposable loopback cluster. */
export async function runNativeParentProductionLineage(args:string[]){
  const lineage=loadProductionLineage();
  if(args.length===0||args.length===1&&args[0]==="--dry")return{mode:"dry",baselineFiles:lineage.baselineSources.length,pendingFiles:lineage.pendingSources.length,observedFunctions:25,observedColumns:82,modelCalls:0,providerCalls:0};
  if(args.length!==1||args[0]!=="--synthetic-approval")throw new Error("Only --dry or --synthetic-approval is supported; a database URL cannot be supplied.");
  const project=`caselink-lineage-${randomUUID().replaceAll("-","").slice(0,16)}`,container=`supabase_db_${project}`,directory=mkdtempSync(join(tmpdir(),"caselink-parent-lineage-")),database=`caselink_parent_lineage_${randomUUID().replaceAll("-","")}`;
  const address=(name:string)=>assertNativeLineageTarget(`postgresql://postgres:postgres@127.0.0.1:${port}/${name}`),quote=(name:string)=>'"'+name.replaceAll('"','""')+'"';
  const admin=new Client({connectionString:address("postgres"),statement_timeout:60000}),client=new Client({connectionString:address(database),statement_timeout:60000}),peer=new Client({connectionString:address(database),statement_timeout:60000});
  const platform=(command:string[])=>{const configured=process.env.CASELINK_SUPABASE_CLI;if(configured)assert.ok(isAbsolute(configured));return execFileSync(configured??"npx",[...(configured?[]:["--yes","supabase@2.111.0"]),...command,"--workdir",directory],{encoding:"utf8",timeout:240000,maxBuffer:5000000,stdio:["ignore","pipe","pipe"],env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,NODE_ENV:"test",DO_NOT_TRACK:"1",SUPABASE_TELEMETRY_DISABLED:"1"}});};
  const docker=(command:string[],input?:string|Buffer)=>execFileSync("docker",["exec","-i",container,...command],{input,maxBuffer:30000000,stdio:["pipe","pipe","pipe"]});
  let started=false,created=false,stage="platform",evidence:Record<string,unknown>|undefined,failure:unknown;const cleanup:unknown[]=[];
  try{
    mkdirSync(join(directory,"supabase"));cpSync("supabase/email-templates",join(directory,"supabase/email-templates"),{recursive:true});
    const config=readFileSync("supabase/config.toml","utf8").replace(/^project_id = .*$/m,`project_id = "${project}"`).replace(/\b5432([0-9])\b/g,"5842$1")
      .replace("[db.seed]\n# If enabled, seeds the database after migrations during a db reset.\nenabled = true","[db.seed]\nenabled = false")
      .replace("[functions.invite-staff]\nenabled = true","[functions.invite-staff]\nenabled = false").replace("[edge_runtime]\nenabled = true","[edge_runtime]\nenabled = false");
    writeFileSync(join(directory,"supabase/config.toml"),config,{mode:0o600});started=true;platform(["start"]);
    assert.equal(JSON.parse(platform(["status","--output","json"])).DB_URL,address("postgres"));
    await admin.connect();assert.equal((await admin.query("select count(*)::int n from pg_roles where rolname like 'parent\\_%' escape '\\'")).rows[0].n,0);
    stage="native-schema-bootstrap";
    const dump=docker(["pg_dump","-U","supabase_admin","-d","postgres","--schema-only","--schema=auth","--schema=extensions","--schema=storage","--schema=vault","--no-publications","--no-subscriptions"]);
    await admin.query(`create database ${quote(database)} template template0`);created=true;
    docker(["psql","-X","-U","supabase_admin","-d",database,"-v","ON_ERROR_STOP=1"],dump);
    docker(["psql","-X","-U","supabase_admin","-d",database,"-v","ON_ERROR_STOP=1"],'create extension if not exists pgcrypto with schema extensions; create extension if not exists "uuid-ossp" with schema extensions; create schema if not exists vault; create extension if not exists supabase_vault with schema vault;');
    await client.connect();await peer.connect();await client.query("grant usage on schema public to anon,authenticated,service_role");
    await client.query(readFileSync("tests/fixtures/legacy-schema-2026-10-14.sql","utf8"));
    const inventory=async()=>{await client.query("set search_path=public");return(await client.query(readFileSync("scripts/legacy-schema-inventory.sql","utf8"))).rows[0].schema_snapshot as Inventory;};
    assert.deepEqual(fingerprint(await inventory()),JSON.parse(readFileSync("docs/verification/2026-10-14-legacy-schema-fingerprints.json","utf8")).sections,"Native platform must reproduce the observed school schema fixture");
    stage="observed-parent-lineage";
    for(const source of lineage.baselineSources)await executeLineageSql(client,transactionalLineageSource(source.name));
    await installObservedProductionSchema(client,lineage);
    await peer.query("set role parent_worker");
    const staff=randomUUID(),family=randomUUID();await client.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",[staff,`${staff}@example.invalid`]);
    await client.query("insert into public.app_users(id,email,role) values($1,$2,'case_manager')",[staff,`${staff}@example.invalid`]);await client.query("insert into public.families(id,name,created_by_id) values($1,'Synthetic lineage family',$2)",[family,staff]);
    const schoolBefore=fingerprint(schoolInventory(await inventory()));
    const rowsBefore=(await client.query("select to_jsonb(u) app_user,(select to_jsonb(f) from public.families f where f.id=$2) family from public.app_users u where u.id=$1",[staff,family])).rows[0];
    const roles=async()=> (await client.query("select rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil::text,rolconfig from pg_roles where rolname like 'parent\\_%' escape '\\' order by rolname")).rows;
    const oldRoles=await roles(),oldNames=oldRoles.map(role=>role.rolname);
    const memberships=async()=> (await client.query("select p.rolname parent,m.rolname member,g.rolname grantor,a.admin_option from pg_auth_members a join pg_roles p on p.oid=a.roleid join pg_roles m on m.oid=a.member join pg_roles g on g.oid=a.grantor where m.rolname=any($1) order by p.rolname,m.rolname,g.rolname",[oldNames])).rows;
    const oldMemberships=await memberships();
    // These are synthetic metadata records, never copied production statements or activation/login SQL.
    await client.query("create schema lineage_fixture; create table lineage_fixture.migration_history(version text primary key,name text not null)");
    for(const record of lineage.recordedMigrationHistory)await client.query("insert into lineage_fixture.migration_history values($1,$2)",[record.version,record.name]);
    stage="parent-upgrade-and-leased-flows";
    const cases=await rehearseParentProductionUpgrade(client,{embedded:false,peer});
    assert.deepEqual(fingerprint(schoolInventory(await inventory())),schoolBefore,"Pending parent upgrade preserves every existing school definition/grant/default");
    assert.deepEqual((await client.query("select to_jsonb(u) app_user,(select to_jsonb(f) from public.families f where f.id=$2) family from public.app_users u where u.id=$1",[staff,family])).rows[0],rowsBefore);
    const afterRoles=await roles();for(const role of oldRoles)assert.deepEqual(afterRoles.find(after=>after.rolname===role.rolname),role);assert.deepEqual(await memberships(),oldMemberships);
    assert.deepEqual((await client.query("select version,name from lineage_fixture.migration_history order by version")).rows,lineage.recordedMigrationHistory);
    evidence={syntheticOnly:true,localOnly:true,sourceBase:lineage.sourceBase,sourceHistoryRecords:100,productionOnlyRecords:5,baselineFiles:76,pendingFiles:35,observedFunctionDefinitions:25,observedCriticalColumns:82,
      oldSchoolRowsDefinitionsAndGrantsPreserved:true,oldRoleAttributesMembershipsPreserved:true,sourceHistoryPreserved:true,cases,
      limits:"Reconstructed schema lineage and synthetic records only; no production data/settings/passwords, actual migration-tool history mutation, hosted Auth, provider/model calls, family outcome or release approval."};
  }catch(error){failure=error;}
  finally{
    for(const connection of [peer,client])try{await connection.end();}catch(error){cleanup.push(error);}
    if(created)try{await admin.query(`drop database ${quote(database)} with (force)`);}catch(error){cleanup.push(error);}
    try{await admin.end();}catch(error){cleanup.push(error);}
    if(started)try{platform(["stop","--project-id",project,"--no-backup"]);assert.equal(execFileSync("docker",["ps","-aq","--filter",`label=com.supabase.cli.project=${project}`],{encoding:"utf8"}).trim(),"");}catch(error){cleanup.push(error);}
    try{rmSync(directory,{recursive:true,force:true});}catch(error){cleanup.push(error);}
  }
  if(failure||cleanup.length){const cause=failure&&typeof failure==="object"&&"code" in failure?String(failure.code):"unknown";throw new Error(`Parent lineage rehearsal failed at ${stage}; code ${/^[A-Z0-9_]{1,30}$/.test(cause)?cause:"unknown"}; cleanup failures ${cleanup.length}.`);}
  mkdirSync("tmp/parent-verification/production-lineage",{recursive:true});writeFileSync("tmp/parent-verification/production-lineage/latest.json",JSON.stringify({...evidence,cleanupPassed:true},null,2)+"\n");return{...evidence,cleanupPassed:true};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))void runNativeParentProductionLineage(process.argv.slice(2)).then(result=>process.stdout.write(JSON.stringify(result,null,2)+"\n")).catch(error=>{process.stderr.write(error instanceof Error?error.message+"\n":"Parent lineage rehearsal failed.\n");process.exitCode=1;});
