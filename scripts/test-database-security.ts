import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToBuffer } from "@react-pdf/renderer";
import { PlanPdfDocument } from "../src/features/families/plan-pdf-document";
import { finalizePlanPdf } from "../src/lib/domain/plan/finalize-plan-pdf";
import { mergeLeanRefineIntoBase } from "../src/lib/plan-generator/plan-refine-lean";
import { applyRefinementChanges, collectRefinementChanges, toRefinementDraft } from "../src/lib/domain/plan/refinement-review";
import { Client, Pool, type PoolClient } from "pg";
import { addCalendarDays, schoolDate } from "../src/lib/dates";
import { selectNextFamilyWork } from "../src/lib/domain/family-workspace/next-work";
import type { PlanWithSteps } from "../src/types/family";
import { updatePlanStepSchema, updatePlanStepActionItemSchema } from "../src/lib/validations/plans";
import { buildPlanningSnapshot } from "../src/lib/plan-generator/planning-brief";
import { sparseDetailsForPersistence } from "../src/lib/plan-generator/lean-plan-schema";
import { directoryCase } from "../tests/fixtures/directory-case";
import { generatedPlanStep } from "../tests/fixtures/plan-contract";

const databaseUrl = process.env.CASELINK_DB_SECURITY_TEST_URL
  ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const parsedUrl = new URL(databaseUrl);
if (
  !["127.0.0.1", "localhost"].includes(parsedUrl.hostname)
  && process.env.CASELINK_DB_SECURITY_TEST_ALLOW_REMOTE !== "1"
) {
  throw new Error("Refusing to run destructive security fixtures against a remote database.");
}

const pool = new Pool({ connectionString: databaseUrl, max: 20 });
const admin = new Client({ connectionString: databaseUrl });
const userA = randomUUID();
const userB = randomUUID();
const unprovisionedUser = randomUUID();
const sessionIds = new Map<string, string>([userA, userB, unprovisionedUser].map((id) => [id, randomUUID()]));
const familyA = randomUUID();
const familyB = randomUUID();
const planA = randomUUID();
const planB = randomUUID();
const stepA = randomUUID();
const stepB = randomUUID();
const actionA = randomUUID();
const actionB = randomUUID();
const resourceId = randomUUID();
const matchId = randomUUID();

async function checkPlatformRlsTriggerPrivileges() {
  const migration = readFileSync("supabase/migrations/20261014174244_restrict_platform_rls_trigger.sql", "utf8");
  await admin.query("begin");
  try {
    await admin.query(migration); // Also succeeds when the hosted helper does not exist locally.
    if (!(await admin.query("select to_regprocedure('public.rls_auto_enable()') as helper")).rows[0].helper) {
      await admin.query("create function public.rls_auto_enable() returns event_trigger language plpgsql security definer set search_path = '' as $$ begin return; end $$");
    }
    await admin.query("grant execute on function public.rls_auto_enable() to public, anon, authenticated");
    assert.equal((await admin.query("select has_function_privilege('anon','public.rls_auto_enable()','execute') allowed")).rows[0].allowed, true);
    await admin.query(migration);
    for (const role of ["anon", "authenticated"])
      assert.equal((await admin.query("select has_function_privilege($1,'public.rls_auto_enable()','execute') allowed", [role])).rows[0].allowed, false);
  } finally { await admin.query("rollback"); }
}

async function checkExplicitApplicationPrivileges() {
  await admin.query("begin");
  try {
    // Recreate the removed function only inside this historical migration's test transaction.
    await admin.query("create function public.operator_revoke_mfa_sessions(uuid,text,text,text) returns void language plpgsql as $$ begin return; end $$");
    await admin.query("grant truncate on public.app_users to service_role");
    await admin.query("grant execute on function public.archive_family(uuid) to service_role");
    await admin.query("alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role");
    await admin.query("alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role");
    await admin.query(readFileSync("supabase/migrations/20261014203800_explicit_application_privileges.sql", "utf8"));
    await admin.query("drop function public.operator_revoke_mfa_sessions(uuid,text,text,text)");
    const unsafeTables = await admin.query(`select count(*)::int n from pg_class c
      join pg_namespace n on n.oid=c.relnamespace cross join unnest(array['anon','authenticated','service_role']) role_name
      where n.nspname='public' and c.relkind='r'
      and has_table_privilege(role_name,c.oid,'TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')`);
    assert.equal(unsafeTables.rows[0].n, 0, "application roles cannot bypass row policies with table maintenance privileges");
    assert.equal((await admin.query("select has_function_privilege('service_role','public.archive_family(uuid)','EXECUTE') allowed")).rows[0].allowed, false);
    assert.equal((await admin.query(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prokind='f' and has_function_privilege('anon',p.oid,'EXECUTE')`)).rows[0].n, 0);
    await admin.query("create table public.security_permission_probe(id integer)");
    await admin.query("create function public.security_permission_probe() returns integer language sql as 'select 1'");
    for (const role of ["anon", "authenticated", "service_role"]) {
      const access = (await admin.query(`select
        has_table_privilege($1,'public.security_permission_probe','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') as table_access,
        has_function_privilege($1,'public.security_permission_probe()','EXECUTE') as function_access`, [role])).rows[0];
      assert.deepEqual(access, { table_access: false, function_access: false }, "new application objects require explicit grants");
    }
    await admin.query("set local role service_role");
    await assert.rejects(admin.query("truncate public.app_users cascade"), { code: "42501" });
  } finally { await admin.query("rollback"); }
}

async function asUser<T>(
  userId: string,
  run: (client: PoolClient) => Promise<T>,
  aal: "aal1" | "aal2" = "aal1",
  authMethod = "password",
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await client.query("select set_config('request.jwt.claim.role', 'authenticated', true)");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated", aal, session_id: sessionIds.get(userId), amr: [{ method: authMethod }] }),
    ]);
    const result = await run(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function snapshotFor(userId: string, familyId: string) {
  return asUser(userId, async client => (await client.query("select public.get_family_plan_snapshot($1) snapshot", [familyId])).rows[0].snapshot);
}
async function revisionFor(userId: string, familyId: string): Promise<string> {
  return (await snapshotFor(userId, familyId)).plan.review_revision;
}
async function canExport(revision: string): Promise<boolean> {
  return asUser(userA, async client => (await client.query("select public.is_reviewed_plan_revision($1, $2, $3) allowed", [familyA, planA, revision])).rows[0].allowed);
}

async function checkDateConfirmation() {
  const family = randomUUID(), plan = randomUUID(), step = randomUUID(), action = randomUUID();
  try {
    await admin.query("insert into public.families(id,name,created_by_id) values($1,'Date confirmation case',$2)",[family,userA]);
    await admin.query("insert into public.plans(id,family_id,version,generation_source) values($1,$2,1,'manual')",[plan,family]);
    await admin.query(`insert into public.plan_steps(id,plan_id,phase,title,description,sort_order,details) values($1,$2,'30','Confirm options','Discuss options',0,'{"expected_outcome":"Options confirmed"}')`,[step,plan]);
    await admin.query("insert into public.plan_step_action_items(id,plan_step_id,title,week_index,sort_order) values($1,$2,'Discuss options',1,0)",[action,step]);
    const approve = async (confirmed = true) => asUser(userA,client=>client.query("select public.mark_plan_reviewed($1,$2,$3,$4)",[family,plan,currentRevision,confirmed]));
    let currentRevision = await revisionFor(userA,family);
    await expectDbError(()=>approve(),"open work with no date cannot be reviewed");
    await admin.query("update public.plan_step_action_items set target_date='2028-02-29' where id=$1",[action]);
    currentRevision = await revisionFor(userA,family);
    await expectDbError(()=>approve(false),"an exact date is still unconfirmed until the person approves it");
    await approve();
    const audit = (await admin.query("select details from public.activity_log where family_id=$1 and action='plan.reviewed'",[family])).rows[0].details;
    assert.equal(audit.dates_confirmed,true); assert.equal(audit.calendar_timezone,'America/New_York');
    assert.equal(audit.confirmed_on,schoolDate());
    await admin.query("update public.plan_step_action_items set status='completed',target_date=null where id=$1",[action]);
    currentRevision = await revisionFor(userA,family); await approve();
    await admin.query("update public.plan_step_action_items set status='blocked',target_date='2020-01-01',notes='Awaiting callback' where id=$1",[action]);
    currentRevision = await revisionFor(userA,family);
    await expectDbError(()=>approve(),"Waiting needs a follow-up date");
    await admin.query("update public.plan_step_action_items set follow_up_date='2020-01-03' where id=$1",[action]);
    currentRevision = await revisionFor(userA,family); await approve();
    const pastAudit = (await admin.query("select details from public.activity_log where family_id=$1 and action='plan.reviewed' order by created_at desc limit 1",[family])).rows[0].details;
    assert.equal(pastAudit.past_open_actions,1,"the confirmed historical date is recorded explicitly");
    const meeting = (date: string) => asUser(userA,async client=>{
      await client.query("set local timezone='Pacific/Auckland'");
      return client.query("select public.capture_case_progress_update($1,$2,$3,'Discussed dates',$4,'[]')",[family,plan,date,randomUUID()]);
    });
    await expectDbError(()=>meeting(addCalendarDays(schoolDate(),1)),"meeting dates use the school day even with a different database session timezone");
    await meeting(schoolDate());
  } finally {
    await admin.query("delete from public.families where id=$1",[family]);
  }
  console.log("Date confirmation: missing/explicit/manual/leap/completed/Waiting/past dates and school-day meetings passed.");
}

async function checkResourceAvailability() {
  const family = randomUUID(), resource = randomUUID(), plan = randomUUID(), step = randomUUID();
  try {
    await admin.query("insert into public.families(id,name,created_by_id) values($1,'Resource test case',$2)",[family,userA]);
    await admin.query("insert into public.plans(id,family_id,version,generation_source) values($1,$2,1,'manual')",[plan,family]);
    await admin.query("insert into public.plan_steps(id,plan_id,phase,title,description,sort_order) values($1,$2,'30','Review resource','Confirm current availability',0)",[step,plan]);
    await admin.query("insert into public.resources(id,slug,import_key,program_name,office_or_department) values($1,$2,$2,'Directory fixture','Synthetic office')",[resource,`fixture-${resource}`]);
    const add = () => asUser(userA, client => client.query("select public.add_manual_resource_match($1,$2) id",[family,resource]));
    const match = (await add()).rows[0].id;
    for (const state of [{active:false,is_demo:false},{active:true,is_demo:true}]) {
      await admin.query("update public.resources set active=$2,is_demo=$3 where id=$1",[resource,state.active,state.is_demo]);
      await expectDbError(add,"unavailable resources cannot be manually added");
      await expectDbError(() => asUser(userA, client => client.query("select public.replace_suggested_resource_matches($1,$2,1)",[family,JSON.stringify([{resource_id:resource,score:10,match_reason:'Synthetic match'}])])),"unavailable suggestions cannot replace matches");
      await expectDbError(() => asUser(userA, client => client.query("select public.update_resource_match($1,$2,'status','accepted',null)",[family,match])),"unavailable matches cannot be accepted");
      await expectDbError(() => asUser(userA, client => client.query("select public.update_resource_match($1,$2,'link',null,$3)",[family,match,step])),"unavailable matches cannot be linked");
      await asUser(userA, client => client.query("select public.update_resource_match($1,$2,'status','dismissed',null)",[family,match]));
      await asUser(userA, client => client.query("select public.update_resource_match($1,$2,'unlink',null,null)",[family,match]));
    }
    await admin.query("update public.resources set active=true,is_demo=false where id=$1",[resource]);
    assert.equal((await add()).rows[0].id,match,"available resources can be restored explicitly");
    await expectDbError(() => asUser(userB, client => client.query("select public.add_manual_resource_match($1,$2)",[family,resource])),"available resources do not bypass family authorization");
  } finally {
    await admin.query("delete from public.families where id=$1",[family]);
    await admin.query("delete from public.resources where id=$1",[resource]);
  }
  console.log("Resource availability: inactive/demo rejection, safe dismissal/unlink, restoration, and family authorization passed.");
}

async function checkRefinedActionPersistence() {
  const family = randomUUID(), plan = randomUUID(), stepId = randomUUID(), actionId = randomUUID();
  try {
    await admin.query("insert into public.families(id,name,created_by_id) values($1,'Refinement test case',$2)",[family,userA]);
    await admin.query("insert into public.plans(id,family_id,version,generation_source) values($1,$2,1,'manual')",[plan,family]);
    await admin.query(`insert into public.plan_steps(id,plan_id,phase,title,description,sort_order,details) values($1,$2,'30','Confirm intake options','Review the next appointment',0,'{"expected_outcome":"An appointment option is confirmed"}')`,[stepId,plan]);
    await admin.query("insert into public.plan_step_action_items(id,plan_step_id,title,week_index,sort_order,status,target_date,follow_up_date,notes) values($1,$2,'Call intake',1,0,'blocked','2020-01-01','2026-10-15','Waiting for a callback')",[actionId,stepId]);
    const original = (await snapshotFor(userA,family)).plan as PlanWithSteps;
    const step = original.steps[0], action = step.action_items![0];
    const proposed = mergeLeanRefineIntoBase(toRefinementDraft(step), {
      id: stepId, phase: '30', title: step.title, description: step.description, required_documents: null, resource_ids: null,
      expected_outcome: 'An appointment option is confirmed', timing_guidance: '', priority: null,
      action_items: [{ id: actionId, title: 'Follow up with intake', description: 'Ask whether an appointment is available.', week_index: 1, target_date: '2026-10-20' }],
    });
    const changes = collectRefinementChanges([step],[proposed]);
    assert.deepEqual(applyRefinementChanges([step],changes,[]),[step],"cancelling leaves dates and wording unchanged");
    const selected = applyRefinementChanges([step],changes,changes.map(change=>change.id))[0].action_items![0];
    const edits = [{ stepId,expectedUpdatedAt:step.updated_at,patch:{},actionItems:[{actionItemId:actionId,expectedUpdatedAt:action.updated_at,patch:{title:selected.title,description:selected.description,target_date:selected.target_date,follow_up_date:selected.follow_up_date}}] }];
    assert.equal((await asUser(userA,async client=>(await client.query("select public.save_plan_edits($1,$2,$3) saved",[family,plan,JSON.stringify(edits)])).rows[0].saved)).ok,true);
    const saved = (await snapshotFor(userA,family)).plan as PlanWithSteps;
    assert.equal(saved.steps[0].action_items![0].title,'Follow up with intake');
    assert.equal(saved.steps[0].action_items![0].description,'Ask whether an appointment is available.');
    assert.equal(saved.steps[0].action_items![0].target_date,'2026-10-20');
    assert.equal(saved.steps[0].action_items![0].follow_up_date,'2026-10-20');
    assert.equal(saved.steps[0].action_items![0].notes,'Waiting for a callback');
    await asUser(userA,client=>client.query("select public.mark_plan_reviewed($1,$2,$3,true)",[family,plan,saved.review_revision]));
    const reviewed = (await snapshotFor(userA,family)).plan as PlanWithSteps;
    const evidence = process.env.CASELINK_PDF_EVIDENCE_DIR;
    if (evidence) {
      mkdirSync(evidence,{recursive:true});
      const bytes = await finalizePlanPdf(await renderToBuffer(PlanPdfDocument({plan:reviewed,familyName:'Refinement test case',generatedDate:'Oct 13, 2026',barrierLabels:['Housing instability']})));
      writeFileSync(resolve(evidence,'refined-action.pdf'),bytes);
    }
  } finally {
    await admin.query("delete from public.families where id=$1",[family]);
  }
  console.log("Action refinement: selected wording/follow-up survives atomic save, reload, and exact-revision review.");
}

async function checkContactProvenance() {
  for (const signature of ['public.canonical_plan_contacts(uuid,jsonb)','public.plan_contacts_current(uuid,jsonb)']) {
    assert.equal((await admin.query("select has_function_privilege('anon',$1,'EXECUTE') allowed",[signature])).rows[0].allowed,false);
  }
  assert.equal((await admin.query("select has_function_privilege('authenticated','private.enforce_plan_contact_provenance()','EXECUTE') allowed")).rows[0].allowed,false);
  const family = randomUUID(), plan = randomUUID(), step = randomUUID(), resource = randomUUID();
  const source = async () => (await admin.query("select id as source_resource_id, to_jsonb(updated_at) #>> '{}' as source_updated_at from public.resources where id=$1",[resource])).rows[0];
  const save = async (contacts: unknown, actor = userA) => {
    const row = (await admin.query("select to_jsonb(s) as value from public.plan_steps s where id=$1",[step])).rows[0].value;
    return asUser(actor, client => client.query("select public.save_plan_edits($1,$2,$3)",[family,plan,JSON.stringify([{stepId:step,expectedUpdatedAt:row.updated_at,patch:{details:{...row.details,contacts}},actionItems:[]}])]));
  };
  const approve = async () => asUser(userA, client => client.query("select public.mark_plan_reviewed($1,$2,$3,true)",[family,plan,currentRevision]));
  const exportable = async (revision: string) => (await asUser(userA,client=>client.query("select public.is_reviewed_plan_revision($1,$2,$3) allowed",[family,plan,revision]))).rows[0].allowed;
  let currentRevision = "";
  try {
    await admin.query("insert into public.families(id,name,created_by_id) values($1,'Contact test case',$2)",[family,userA]);
    await admin.query("insert into public.plans(id,family_id,version,generation_source) values($1,$2,1,'manual')",[plan,family]);
    await admin.query(`insert into public.plan_steps(id,plan_id,phase,title,description,sort_order,details) values($1,$2,'30','Confirm intake options','Discuss next steps',0,'{"expected_outcome":"Intake options confirmed"}')`,[step,plan]);
    await admin.query("insert into public.plan_step_action_items(plan_step_id,title,week_index,sort_order,target_date) values($1,'Confirm intake availability',1,0,'2026-10-20')",[step]);
    await admin.query("insert into public.resources(id,slug,import_key,program_name,office_or_department,primary_contact_phone,primary_contact_email) values($1,$2,$2,'Directory intake program','Synthetic office','215-555-0148','intake@example.test')",[resource,`fixture-${resource}`]);
    await asUser(userA,client=>client.query("select public.add_manual_resource_match($1,$2)",[family,resource]));
    const reference = await source();
    await save([reference]);
    const before = await snapshotFor(userA,family);
    const contact = before.plan.steps[0].details.contacts[0];
    assert.equal(contact.name,'Directory intake program'); assert.equal(contact.phone,'215-555-0148'); assert.equal(contact.email,'intake@example.test');
    assert.equal(contact.source_updated_at,reference.source_updated_at); assert.equal(before.plan.resource_contacts_current,true);
    for (const invalid of [
      [{...contact,phone:'215-555-9999'}],[{...contact,email:'wrong@example.test'}],[{...contact,name:'Invented office'}],[{...contact,notes:'Guaranteed eligibility'}],
      [{...reference,source_resource_id:randomUUID()}],[{...reference,source_updated_at:'2020-01-01T00:00:00Z'}],
      [{source_resource_id:resource}],[{name:'Unverified contact'}],[{...reference,extra:'unsupported'}],[reference,reference],{wrong:'shape'},
    ]) await expectDbError(()=>save(invalid),'forged, unknown, duplicate, stale or malformed contacts cannot be saved');
    assert.deepEqual((await snapshotFor(userA,family)).plan.steps[0].details.contacts,[contact],'failed replacements preserve the original contact');
    await expectDbError(()=>save([reference],userB),'contact sources do not bypass family access');
    await expectDbError(()=>asUser(userA,client=>client.query("update public.plan_steps set details=jsonb_set(details,'{contacts}',$2) where id=$1",[step,JSON.stringify([{...reference,phone:'215-555-9999'}])])),'direct table writes cannot forge contact facts');
    currentRevision = before.plan.review_revision; await approve();
    const approved = (await snapshotFor(userA,family)).plan as PlanWithSteps;
    assert.equal(await exportable(approved.review_revision!),true);
    if (process.env.CASELINK_PDF_EVIDENCE_DIR) {
      const directory = resolve(process.env.CASELINK_PDF_EVIDENCE_DIR); mkdirSync(directory,{recursive:true});
      const rendered = await renderToBuffer(PlanPdfDocument({familyName:'Contact test case',plan:approved,generatedDate:schoolDate()}));
      writeFileSync(resolve(directory,'directory-contact.pdf'),await finalizePlanPdf(rendered));
    }
    await admin.query("update public.resources set primary_contact_phone='215-555-0188' where id=$1",[resource]);
    assert.equal(await exportable(approved.review_revision!),false,'source edits invalidate the reviewed PDF');
    currentRevision = await revisionFor(userA,family);
    assert.equal((await snapshotFor(userA,family)).plan.resource_contacts_current,false);
    await expectDbError(approve,'a freshly loaded but outdated contact still cannot be reviewed');
    await save([await source()]); currentRevision = await revisionFor(userA,family); await approve();
    const refreshedRevision = await revisionFor(userA,family); assert.equal(await exportable(refreshedRevision),true);
    await admin.query("update public.resource_matches set status='dismissed' where family_id=$1 and resource_id=$2",[family,resource]);
    assert.equal(await exportable(refreshedRevision),false,'dismissal invalidates a prepared export');
    await expectDbError(()=>save([reference]),'dismissed contacts cannot be reused');
    await admin.query("update public.resource_matches set status='accepted' where family_id=$1 and resource_id=$2",[family,resource]);
    for (const state of [{active:false,is_demo:false},{active:true,is_demo:true}]) {
      await admin.query("update public.resources set active=$2,is_demo=$3 where id=$1",[resource,state.active,state.is_demo]);
      await expectDbError(()=>save([reference]),'inactive and demo sources are not usable');
      assert.equal((await snapshotFor(userA,family)).plan.resource_contacts_current,false);
    }
    await admin.query("update public.resources set active=true,is_demo=false,primary_contact_phone=null,primary_contact_email=null where id=$1",[resource]);
    await save([await source()]);
    const missing = (await snapshotFor(userA,family)).plan.steps[0].details.contacts[0];
    assert.equal(missing.phone,undefined); assert.equal(missing.email,undefined);
    // Simulate a pre-migration record, then prove ordinary edits preserve it without approving its contacts.
    await admin.query("alter table public.plan_steps disable trigger plan_steps_contact_provenance");
    try { await admin.query(`update public.plan_steps set details=jsonb_set(details,'{contacts}','[{"name":"Historical office","phone":"215-555-0133"}]') where id=$1`,[step]); }
    finally { await admin.query("alter table public.plan_steps enable trigger plan_steps_contact_provenance"); }
    const historical = (await snapshotFor(userA,family)).plan.steps[0].details.contacts;
    await asUser(userA,client=>client.query("update public.plan_steps set description='Preserved human wording' where id=$1",[step]));
    assert.deepEqual((await snapshotFor(userA,family)).plan.steps[0].details.contacts,historical);
    currentRevision = await revisionFor(userA,family); await expectDbError(approve,'historical unverified contacts prevent approval');
    await save([]); currentRevision = await revisionFor(userA,family); await approve();
    assert.equal(await exportable(await revisionFor(userA,family)),true,'explicit removal permits a contact-free reviewed plan');

    await admin.query("update public.resources set primary_contact_phone='215-555-0148',primary_contact_email='intake@example.test' where id=$1",[resource]);
    const detail = directoryCase(); detail.id = family;
    detail.resourceMatches[0].resource = (await admin.query("select to_jsonb(r) value from public.resources r where id=$1",[resource])).rows[0].value;
    const snapshot = buildPlanningSnapshot(detail);
    const state = {v:1,status:'running',pending_phase:'30',input_snapshot:snapshot,phases_complete:{'30':false,'60':false,'90':false},models_used:[],stage_timings_ms:{},ai_mode:'fast'};
    assert.equal((await admin.query("select public.contains_direct_identifier($1) blocked",[JSON.stringify(state)])).rows[0].blocked,false,'generation state excludes directory identifiers');
    const started = (await asUser(userA,client=>client.query("select public.start_staged_plan_generation($1,$2) result",[family,JSON.stringify(state)]))).rows[0].result;
    const lease = randomUUID();
    assert.equal((await asUser(userA,client=>client.query("select public.claim_ai_job($1,'staged-plan-advance',$2,600) claimed",[family,lease]))).rows[0].claimed,true);
    const details = sparseDetailsForPersistence({...generatedPlanStep,resource_ids:[resource]},snapshot.resource_catalog);
    const rows = [{phase:'30',title:'Confirm intake options',description:'Discuss next steps',sort_order:0,priority:'medium',details,
      action_items:[{title:'Confirm intake availability',description:null,week_index:1,sort_order:0,target_date:'2026-10-20'}]}];
    const nextState = {...state,pending_phase:'60',phases_complete:{...state.phases_complete,'30':true}};
    await asUser(userA,client=>client.query("select public.append_staged_plan_phase($1,$2,'30',$3,$4,'gpt-test',25,$5)",[family,started.planId,JSON.stringify(rows),JSON.stringify(nextState),lease]));
    const generated = await snapshotFor(userA,family);
    assert.equal(generated.plan.id,started.planId);
    assert.deepEqual(generated.plan.steps[0].details.contacts,[{...details.contacts![0],phone:'215-555-0148',email:'intake@example.test'}],'staged generation resolves current source contacts without storing them in its snapshot');
    assert.deepEqual(generated.plan.generation_state.input_snapshot,snapshot);
    // Count actual repeated reads instead of using a machine-dependent timing threshold.
    const snapshotSql = (await admin.query("select prosrc from pg_proc where oid='public.get_family_plan_snapshot(uuid)'::regprocedure")).rows[0].prosrc.replaceAll('p_family_id', '$1');
    const execution = (await asUser(userA,client=>client.query(`explain (analyze,format json) ${snapshotSql}`,[family]))).rows[0]['QUERY PLAN'][0];
    type Scan = { 'Relation Name'?: string; 'Actual Loops': number; 'Actual Rows': number; Plans?: Scan[] };
    const pending: Scan[] = [execution.Plan];
    let actionRowsRead = 0;
    while (pending.length) {
      const scan = pending.pop()!;
      if (scan['Relation Name'] === 'plan_step_action_items') actionRowsRead += scan['Actual Loops'] * scan['Actual Rows'];
      pending.push(...(scan.Plans ?? []));
    }
    assert.equal(actionRowsRead,1,'one snapshot reads each saved action once, including revision hashes');
  } finally {
    await admin.query("delete from public.families where id=$1",[family]);
    await admin.query("delete from public.resources where id=$1",[resource]);
  }
  console.log("Contact provenance: canonical facts, forged/stale/unavailable denial, safe legacy edits, review/export invalidation and removal passed.");
}

async function checkLargeFamilyLists() {
  const ids = Array.from({ length: 100 }, () => randomUUID());
  try {
    await admin.query("insert into public.families(id,name,created_by_id) select id,'Synthetic scale case',$2 from unnest($1::uuid[]) id", [ids,userA]);
    await admin.query("insert into public.plans(family_id,version,generation_source) select id,version,'rules' from unnest($1::uuid[]) id cross join generate_series(1,12) version", [ids]);
    await admin.query(`insert into public.plan_steps(plan_id,phase,title,description,sort_order,due_date,details,workflow_data)
      select p.id,'30','Synthetic goal','Synthetic description',n,'2026-11-10','{"action_needed_now":"Review legacy goal"}','{"needs_escalation":true}'
      from public.plans p cross join generate_series(0,15) n where p.family_id=any($1::uuid[]) and p.version=12`,[ids]);
    await admin.query(`insert into public.plan_step_action_items(plan_step_id,title,week_index,sort_order,status,target_date,follow_up_date)
      select s.id,'Synthetic action ' || n,1,n,
        case when s.sort_order=0 and n=0 then 'completed' when n=0 then 'blocked' else 'pending' end,
        case when n=0 then date '2020-01-01' when s.sort_order=15 and n=2 then date '2026-11-03' else date '2026-11-20' end,
        case when n=0 then date '2026-11-30' else null end
      from public.plan_steps s join public.plans p on p.id=s.plan_id cross join generate_series(0,2) n
      where p.family_id=any($1::uuid[]) and p.version=12`,[ids]);
    await admin.query(`insert into public.plan_steps(plan_id,phase,title,description,sort_order,due_date)
      select p.id,'30','Obsolete version work','Historical description',0,'2020-01-01' from public.plans p where p.family_id=any($1::uuid[]) and p.version<12`,[ids]);
    const fixtureCounts = (await admin.query(`select (select count(*)::int from public.plans where family_id=any($1::uuid[])) plans,
      count(distinct s.id)::int goals,count(a.id)::int actions from public.plan_steps s join public.plans p on p.id=s.plan_id
      left join public.plan_step_action_items a on a.plan_step_id=s.id where p.family_id=any($1::uuid[])`,[ids])).rows[0];
    assert.ok(fixtureCounts.plans>1000 && fixtureCounts.goals>1000 && fixtureCounts.actions>1000);
    await admin.query("delete from public.plans where family_id=$1",[ids[0]]);
    await admin.query("delete from public.plan_step_action_items where plan_step_id in(select s.id from public.plan_steps s join public.plans p on p.id=s.plan_id where p.family_id=$1)",[ids[1]]);
    await admin.query("update public.plan_step_action_items set status='completed' where plan_step_id in(select s.id from public.plan_steps s join public.plans p on p.id=s.plan_id where p.family_id=$1)",[ids[2]]);
    await admin.query("update public.plan_step_action_items set target_date=null,follow_up_date=null where plan_step_id in(select s.id from public.plan_steps s join public.plans p on p.id=s.plan_id where p.family_id=$1)",[ids[3]]);
    const expected = new Map<string, ReturnType<typeof selectNextFamilyWork>>();
    for (const row of (await admin.query("select id,public.get_family_plan_snapshot(id) snapshot from unnest($1::uuid[]) id",[ids])).rows) {
      expected.set(row.id,selectNextFamilyWork(row.snapshot.plan?.steps ?? []));
    }
    assert.deepEqual(selectNextFamilyWork((await snapshotFor(userA,ids[99])).plan.steps),expected.get(ids[99]),"the full source agrees under staff authorization");
    const measurements = [];
    for (const count of [0,1,10,100]) {
      const start = performance.now();
      const result = await asUser(userA,client=>client.query("select * from public.get_family_next_work($1)",[ids.slice(0,count)]));
      measurements.push({families:count,rows:result.rowCount,bytes:Buffer.byteLength(JSON.stringify(result.rows)),milliseconds:Math.round(performance.now()-start)});
      assert.equal(result.rowCount,count);
      for (const row of result.rows) assert.deepEqual(row.current_step,expected.get(row.family_id),"bounded summary matches the complete authorized plan");
    }
    const concurrent = await Promise.all([asUser(userA,client=>client.query("select * from public.get_family_next_work($1)",[ids])),
      asUser(userB,client=>client.query("select * from public.get_family_next_work($1)",[[...ids.slice(0,99),familyB]]))]);
    assert.equal(concurrent[0].rowCount,100);
    assert.deepEqual(concurrent[1].rows.map(row=>row.family_id),[familyB],"concurrent staff only see their own families");
    await expectDbError(()=>asUser(userA,client=>client.query("select * from public.get_family_next_work($1)",[[...ids,familyA]])),"requests are bounded to a supported 100-family page");
    console.log("Next-work local scale evidence:",JSON.stringify({fixtureCounts,measurements}));
  } finally {
    await admin.query("delete from public.families where id=any($1::uuid[])",[ids]);
  }
}

async function checkAiBudgetJourneys() {
  const scopes = [`user:${userA}:%`, `user:${userB}:%`];
  const originalDaily = (await admin.query("select * from private.ai_rate_counters where scope_key='deployment:day'")).rows;
  const originalEnabled = (await admin.query("select ai_enabled from private.production_controls where singleton")).rows[0].ai_enabled;
  async function counters() {
    return (await admin.query("select scope_key,window_start,window_seconds,used from private.ai_rate_counters where scope_key like any($1::text[]) or scope_key='deployment:day' order by scope_key,window_start", [scopes])).rows;
  }
  async function clearCounters() {
    await admin.query("delete from private.ai_rate_counters where scope_key like any($1::text[]) or scope_key='deployment:day'",[scopes]);
  }
  async function consume(user: string, operation: string, weight: number) {
    return (await asUser(user, client => client.query("select public.consume_ai_budget($1,$2) budget", [operation,weight]))).rows[0].budget;
  }
  try {
    await clearCounters();
    await admin.query("update private.production_controls set ai_enabled=true where singleton");
    await Promise.all([userA,userB].map(async user => {
      for (let i=0;i<8;i++) assert.equal((await consume(user,"plan_phase",2)).allowed,true,"two full plans and two malformed-phase repairs fit the pilot allowance");
      for (let i=0;i<2;i++) assert.equal((await consume(user,"plan",2)).allowed,true,"ordinary refinements remain available after generation");
      assert.equal((await consume(user,"chat",1)).allowed,true);
    }));
    const beforeLocalDenial = await counters();
    const local = await consume(userA,"plan_phase",2);
    assert.equal(local.allowed,false); assert.equal(local.reason,"operation"); assert.ok(local.retryAfter>0 && local.retryAfter<=600);
    assert.deepEqual(await counters(),beforeLocalDenial,"rejected phase does not charge any counter");
    await admin.query("update private.ai_rate_counters set used=120 where scope_key=$1",[`user:${userA}:hour`]);
    const beforeHourlyDenial = await counters();
    assert.equal((await consume(userA,"chat",1)).reason,"user_hour");
    assert.deepEqual(await counters(),beforeHourlyDenial,"hourly denial rolls back the operation reservation");
    await admin.query("update private.ai_rate_counters set used=2000 where scope_key='deployment:day'");
    const beforeDailyDenial = await counters();
    assert.equal((await consume(userB,"chat",1)).reason,"deployment_day");
    assert.deepEqual(await counters(),beforeDailyDenial,"daily denial rolls back both user reservations");
    await admin.query("update private.production_controls set ai_enabled=false where singleton");
    assert.equal((await consume(userB,"chat",1)).reason,"disabled");
    assert.deepEqual(await counters(),beforeDailyDenial,"disabled AI does not consume limits");
    await clearCounters();
    await admin.query("update private.production_controls set ai_enabled=true where singleton");
    await admin.query("insert into private.ai_rate_counters(scope_key,window_start,window_seconds,used) values('deployment:day',date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC',86400,1996)");
    const race = await Promise.all(Array.from({length:20},(_,i)=>consume(i%2 ? userA:userB,"plan_phase",2)));
    assert.equal(race.filter(result=>result.allowed).length,2,"concurrent users cannot overspend the remaining daily budget");
    const lastCounters = await counters();
    assert.equal(lastCounters.find(row=>row.scope_key==='deployment:day').used,2000);
    assert.equal(lastCounters.filter(row=>row.scope_key.endsWith(':operation:plan_phase')).reduce((sum,row)=>sum+row.used,0),4,"losing requests do not consume operation quota");
    assert.equal(lastCounters.filter(row=>row.scope_key.endsWith(':hour')).reduce((sum,row)=>sum+row.used,0),4,"losing requests do not consume hourly quota");
  } finally {
    await clearCounters();
    for (const row of originalDaily) await admin.query("insert into private.ai_rate_counters(scope_key,window_start,window_seconds,used) values($1,$2,$3,$4)",[row.scope_key,row.window_start,row.window_seconds,row.used]);
    await admin.query("update private.production_controls set ai_enabled=$1 where singleton",[originalEnabled]);
  }
  console.log("AI budgets: complete journeys, repairs, accurate limits, and atomic concurrent reservations passed.");
}

async function checkAtomicPlanEdits() {
  const step2 = randomUUID();
  const action2 = randomUUID();
  const action3 = randomUUID();
  await admin.query("insert into public.plan_steps (id, plan_id, phase, title, description, sort_order, details) values ($1,$2,'60','Second goal','Second goal description',1,'{\"expected_outcome\":\"Support confirmed\"}')", [step2, planA]);
  await admin.query("insert into public.plan_step_action_items (id, plan_step_id, title, week_index, target_date, sort_order) values ($1,$2,'Second action',2,'2026-10-20',1),($3,$4,'Third action',3,'2026-10-22',0)", [action2, stepA, action3, step2]);
  async function state() {
    const plan = (await snapshotFor(userA, familyA)).plan as PlanWithSteps;
    const counts = await asUser(userA, client => client.query("select (select count(*)::int from public.activity_log where family_id=$1) events, (select count(*)::int from public.case_progress_updates where family_id=$1) notes", [familyA]));
    return { plan, ...counts.rows[0] } as { plan: PlanWithSteps; events: number; notes: number };
  }
  function edits(plan: PlanWithSteps) {
    return plan.steps.filter(s => s.id === stepA || s.id === step2).map((step,i) => ({ stepId: step.id, expectedUpdatedAt: step.updated_at,
      patch: { title: `Updated goal ${i}` }, actionItems: (step.action_items ?? []).map((a,j) => ({ actionItemId:a.id,expectedUpdatedAt:a.updated_at,patch:{title:`Updated action ${i} ${j}`} })) }));
  }
  async function save(changes: ReturnType<typeof edits>, actor = userA) {
    return asUser(actor, async client => (await client.query("select public.save_plan_edits($1,$2,$3) saved", [familyA,planA,JSON.stringify(changes)])).rows[0].saved);
  }
  const before = await state();
  for (const kind of ["second step", "second child"] as const) {
    const broken = edits(before.plan);
    if (kind === "second step") broken[1].patch.title = "";
    else broken[0].actionItems[1].patch.title = "";
    await expectDbError(() => save(broken), `a failure on the ${kind} rolls back all edits`);
    assert.deepEqual(await state(), before, "neither earlier writes nor audit records survive a failed batch");
  }
  const stale = edits(before.plan);
  stale[1].expectedUpdatedAt = "2000-01-01T00:00:00Z";
  assert.equal((await save(stale)).ok, false);
  assert.deepEqual(await state(), before, "revision conflicts happen before any writes");
  const foreign = edits(before.plan);
  foreign[0].actionItems[0].actionItemId = actionB;
  await expectDbError(() => save(foreign), "a child from another family cannot be written");
  await expectDbError(() => save(edits(before.plan), userB), "unrelated staff cannot execute the atomic edit");
  assert.deepEqual(await state(), before);
  await admin.query(`alter table public.activity_log add constraint test_reject_plan_edit check (entity_id <> '${action2}') not valid`);
  try {
    await expectDbError(() => save(edits(before.plan)), "audit failure rolls back the edited content");
    assert.deepEqual(await state(), before);
  } finally { await admin.query("alter table public.activity_log drop constraint test_reject_plan_edit"); }
  const changes = edits(before.plan);
  assert.equal((await save(changes)).ok, true);
  const after = await state();
  assert.equal(after.events - before.events, 5, "both goals and all three actions have one authoritative edit event");
  assert.equal(after.plan.steps[0].title, "Updated goal 0");
  assert.equal(after.plan.steps[1].title, "Updated goal 1");
  assert.equal((await save(changes)).ok, false, "replaying an old request cannot overwrite or duplicate events");
  assert.deepEqual(await state(), after);
  assert.equal((await save(edits(after.plan))).ok, true, "a fresh unchanged retry is a no-op");
  assert.deepEqual(await state(), after);

  await asUser(userA, client => client.query("select public.mark_plan_reviewed($1,$2,$3,true)", [familyA,planA,after.plan.review_revision]));
  const reviewed = await state();
  const action = reviewed.plan.steps.flatMap(s => s.action_items ?? []).find(a => a.id === actionA)!;
  const progress = { action_item_id: action.id, expected_updated_at: action.updated_at, status: "in_progress", target_date: action.target_date, follow_up_date: null, notes: "Intake contacted", outcome: null };
  const requestId = randomUUID();
  const saveMeeting = (summary = 'Discussed the next appointment', changes = [progress], id = requestId) => asUser(userA, client => client.query("select public.capture_case_progress_update($1,$2,'2026-08-03',$3,$4,$5) id", [familyA,planA,summary,id,JSON.stringify(changes)]));
  const note = await saveMeeting();
  assert.ok(note.rows[0].id);
  const withProgress = await state();
  assert.equal(withProgress.notes, reviewed.notes + 1, "the saved meeting note is readable with the staff role");
  assert.equal(withProgress.plan.material_revision, withProgress.plan.client_display?.reviewedRevision, "progress-only notes preserve material approval");
  assert.equal((await saveMeeting()).rows[0].id, requestId, "retry returns the existing record before testing stale child revisions");
  assert.deepEqual(await state(), withProgress, "retry does not duplicate narrative or action history");
  await expectDbError(() => saveMeeting("A changed meeting note"), "reused IDs cannot silently discard changed text");
  const hiddenNote = await asUser(userB, client => client.query("select id from public.case_progress_updates where id=$1", [note.rows[0].id]));
  assert.equal(hiddenNote.rowCount, 0, "unrelated staff cannot read the meeting note");
  const latest = withProgress.plan.steps.flatMap(s => s.action_items ?? []).find(a => a.id === actionA)!;
  const failedMeeting = [{ ...progress, expected_updated_at: latest.updated_at, notes: "Should roll back" }, { ...progress, action_item_id: actionB }];
  await expectDbError(() => asUser(userA, client => client.query("select public.capture_case_progress_update($1,$2,'2026-08-03','Failed meeting',$3,$4)", [familyA,planA,randomUUID(),JSON.stringify(failedMeeting)])), "meeting failure rolls back earlier action updates, narrative, and history");
  assert.deepEqual(await state(), withProgress);
  await expectDbError(() => asUser(userA, client => client.query("select public.capture_case_progress_update($1,$2,'2026-08-03','Email parent@example.test',$3,'[]')", [familyA,planA,randomUUID()])), "meeting RPC rejects direct identifiers independently of the UI");
  await expectDbError(() => asUser(userA, client => client.query("insert into public.case_progress_updates (family_id,author_id,occurred_on,summary) values ($1,$2,current_date,'Bypass attempt')", [familyA,userA])), "meeting records cannot bypass the audited operation");
  const noteOnlyId = randomUUID();
  const [firstNote, sameNote] = await Promise.all([saveMeeting("Meeting without action edits", [], noteOnlyId), saveMeeting("Meeting without action edits", [], noteOnlyId)]);
  assert.equal(firstNote.rows[0].id, sameNote.rows[0].id, "concurrent note-only retries return the same record");
  const noteOnly = await state();
  assert.equal(noteOnly.notes, withProgress.notes + 1);
  assert.equal(noteOnly.events, withProgress.events + 1);
  await expectDbError(() => asUser(userB, client => client.query("select public.capture_case_progress_update($1,$2,'2026-08-03','Meeting without action edits',$3,'[]')", [familyA,planA,noteOnlyId])), "retry IDs do not bypass family access");
  const failedRequestId = randomUUID();
  await admin.query(`alter table public.activity_log add constraint test_reject_meeting check (entity_id <> '${failedRequestId}') not valid`);
  try {
    await expectDbError(() => saveMeeting("Meeting audit must commit", [], failedRequestId), "meeting audit failure rolls back the note");
    assert.deepEqual(await state(), noteOnly);
  } finally { await admin.query("alter table public.activity_log drop constraint test_reject_meeting"); }
  assert.equal((await saveMeeting("Meeting audit must commit", [], failedRequestId)).rows[0].id, failedRequestId, "retry after rollback can commit the original request");
  console.info("Atomic plan edits and meeting progress: rollback, conflict, audit, permissions, and review checks passed.");
}

async function checkReviewRaces() {
  const seen = await revisionFor(userA, familyA);
  assert.match(seen, /^[a-f0-9]{64}$/);
  assert.equal(await canExport(seen), false, "an unreviewed snapshot cannot be exported");
  let releaseWrite!: () => void;
  const holdWrite = new Promise<void>(resolve => { releaseWrite = resolve; });
  let signalWritten!: () => void;
  const written = new Promise<void>(resolve => { signalWritten = resolve; });
  const writer = asUser(userA, async client => {
    await client.query("update public.plan_step_action_items set title = 'Changed in a second tab' where id = $1", [actionA]);
    signalWritten();
    await holdWrite;
  });
  await written;
  const staleReview = asUser(userA, async client => {
    await client.query("set local application_name = 'caselink-review-race'");
    return client.query("select public.mark_plan_reviewed($1, $2, $3, true)", [familyA, planA, seen]);
  });
  const rejected = assert.rejects(staleReview, { code: "40001" }, "a review waiting on an edit cannot approve the unseen revision");
  try {
    let locked = false;
    for (let i = 0; i < 60; i++) {
      const state = await admin.query("select 1 from pg_stat_activity where application_name = 'caselink-review-race' and wait_event_type = 'Lock'");
      if (state.rowCount) { locked = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(locked, true, "review serializes with child writes even before any approval exists");
  } finally { releaseWrite(); }
  await writer;
  await rejected;
  const current = await revisionFor(userA, familyA);
  assert.notEqual(current, seen);
  const events = await admin.query("select count(*)::int n from public.activity_log where family_id = $1 and action = 'plan.reviewed'", [familyA]);
  assert.equal(events.rows[0].n, 0, "stale approval adds no audit evidence");
  await expectDbError(() => asUser(userA, client => client.query("select public.mark_plan_reviewed($1, $2, $3, true)", [familyA, planA, seen])), "stale screen cannot approve after the edit either");
  let releaseReview!: () => void;
  const holdReview = new Promise<void>(resolve => { releaseReview = resolve; });
  let signalReviewed!: () => void;
  const didReview = new Promise<void>(resolve => { signalReviewed = resolve; });
  const reviewer = asUser(userA, async client => {
    await client.query("select public.mark_plan_reviewed($1, $2, $3, true)", [familyA, planA, current]);
    signalReviewed();
    await holdReview;
  });
  await didReview;
  const laterWriter = asUser(userA, async client => {
    await client.query("set local application_name = 'caselink-edit-race'");
    return client.query("update public.plan_step_action_items set title = 'Changed during review' where id = $1", [actionA]);
  });
  try {
    let locked = false;
    for (let i = 0; i < 60; i++) {
      const state = await admin.query("select 1 from pg_stat_activity where application_name = 'caselink-edit-race' and wait_event_type = 'Lock'");
      if (state.rowCount) { locked = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(locked, true, "child writes serialize with an in-flight approval");
  } finally { releaseReview(); }
  await reviewer;
  await laterWriter;
  assert.equal(await canExport(current), false, "an edit committed after approval invalidates that export");
  assert.equal((await snapshotFor(userA, familyA)).plan.client_display.reviewedAt, undefined);

}

async function expectDbError(run: () => Promise<unknown>, label: string) {
  await assert.rejects(run, label);
}


async function setup() {
  await admin.connect();
  await checkPlatformRlsTriggerPrivileges();
  await checkExplicitApplicationPrivileges();
  if (["127.0.0.1", "localhost"].includes(parsedUrl.hostname)) {
    await admin.query(
      `delete from public.families where created_by_id in (
         select id from auth.users where email like 'case-a-%@example.test'
            or email like 'case-b-%@example.test'
            or email like 'case-unprovisioned-%@example.test'
       )`,
    );
    await admin.query(
      `delete from auth.users where email like 'case-a-%@example.test'
         or email like 'case-b-%@example.test'
         or email like 'case-unprovisioned-%@example.test'`,
    );
    await admin.query("delete from public.resources where slug like 'security-%'");
    await admin.query("delete from private.ai_rate_counters");
  }
  await admin.query(
    `insert into auth.users (id, aud, role, email, created_at, updated_at)
     values ($1, 'authenticated', 'authenticated', $2, now(), now()),
            ($3, 'authenticated', 'authenticated', $4, now(), now()),
            ($5, 'authenticated', 'authenticated', $6, now(), now())`,
    [
      userA,
      `case-a-${userA}@example.test`,
      userB,
      `case-b-${userB}@example.test`,
      unprovisionedUser,
      `case-unprovisioned-${unprovisionedUser}@example.test`,
    ],
  );
  for (const [userId, sessionId] of sessionIds) {
    await admin.query("insert into auth.sessions (id, user_id) values ($1, $2)", [sessionId, userId]);
  }
  await admin.query(
    `insert into public.app_users (id, email, role)
     values ($1, $2, 'case_manager'), ($3, $4, 'case_manager')`,
    [userA, `case-a-${userA}@example.test`, userB, `case-b-${userB}@example.test`],
  );
  await admin.query(
    `insert into public.families (id, name, created_by_id)
     values ($1, 'Family Alpha', $2), ($3, 'Family Beta', $4)`,
    [familyA, userA, familyB, userB],
  );
  await admin.query(
    `insert into public.plans (id, family_id, version, generation_source)
     values ($1, $2, 1, 'rules'), ($3, $4, 1, 'rules')`,
    [planA, familyA, planB, familyB],
  );
  await admin.query(
    `insert into public.plan_steps (id, plan_id, phase, title, description, sort_order, details)
     values ($1, $2, '30', 'Alpha step', 'Alpha description', 0, '{"expected_outcome":"Alpha outcome"}'::jsonb),
            ($3, $4, '30', 'Beta step', 'Beta description', 0, '{"expected_outcome":"Beta outcome"}'::jsonb)`,
    [stepA, planA, stepB, planB],
  );
  await admin.query(
    `insert into public.plan_step_action_items (
       id, plan_step_id, title, week_index, target_date, sort_order
     ) values ($1, $2, 'Alpha action', 1, '2026-08-10', 0),
              ($3, $4, 'Beta action', 1, '2026-08-10', 0)`,
    [actionA, stepA, actionB, stepB],
  );
  await admin.query(
    `insert into public.resources (
       id, slug, import_key, office_or_department, program_name
     ) values ($1, $2, $3, 'Test office', 'Test resource')`,
    [resourceId, `security-${resourceId}`, `security-${resourceId}`],
  );
  await admin.query(
    `insert into public.resource_matches (
       id, family_id, resource_id, match_reason, score
     ) values ($1, $2, $3, 'Housing match', 10)`,
    [matchId, familyA, resourceId],
  );
}

async function run() {
  await setup();
  for (const value of ["Call 2155550184", "Call +12155550184", "Call (215)555-0184", "Call (215) 555 0184", "DOB: 2012-08-14", "parent name is jordan williams", "Name: maría garcía"]) {
    assert.equal((await admin.query("select public.contains_direct_identifier($1) detected",[value])).rows[0].detected,true,"database detects representative identifier variants");
    await expectDbError(() => asUser(userA,client=>client.query("select public.add_case_note($1,$2)",[familyA,value])),"an authenticated request cannot save identifier variants directly");
  }
  for (const value of ["The parent is awaiting confirmation.","Family 014","2026-10-20",randomUUID()]) {
    assert.equal((await admin.query("select public.contains_direct_identifier($1) detected",[value])).rows[0].detected,false,"ordinary context, dates, and opaque IDs remain valid");
  }
  await expectDbError(() => asUser(userA,client => client.query("select public.mark_plan_reviewed($1,$2,$3)",[familyA,planA,"ignored"])),"unconfirmed dates cannot be approved directly");
  await checkLargeFamilyLists();
  await checkDateConfirmation();
  await checkResourceAvailability();
  await checkContactProvenance();
  await checkRefinedActionPersistence();
  assert.equal(await snapshotFor(userA, familyB), null, "snapshot respects cross-family permissions");

  // PostgREST uses PostgreSQL's JSON timestamp representation, including microseconds and offsets.
  for (const [table, id, schema, idField] of [
    ["plan_steps", stepA, updatePlanStepSchema, "stepId"],
    ["plan_step_action_items", actionA, updatePlanStepActionItemSchema, "actionItemId"],
  ] as const) {
    const revision = await admin.query<{ value: string }>(
      `select to_jsonb(t)->>'updated_at' as value from public.${table} t where id = $1`, [id],
    );
    const value = revision.rows[0].value;
    assert.equal(schema.safeParse({ familyId: familyA, [idField]: id, expectedUpdatedAt: value }).success, true);
    const equivalent = value.replace(/\+00:00$/, "Z");
    const saved = await asUser(userA, (client) => client.query(
      `update public.${table} set title = title where id = $1 and updated_at = $2::timestamptz returning id`, [id, equivalent],
    ));
    assert.equal(saved.rowCount, 1, "equivalent timezone notation must match the same revision");
    const stale = await asUser(userA, (client) => client.query(
      `update public.${table} set title = title where id = $1 and updated_at = $2::timestamptz returning id`, [id, value],
    ));
    assert.equal(stale.rowCount, 0, "a stale revision cannot overwrite the saved row");
  }

  assert.deepEqual((await asUser(userA, client => client.query("select id from public.app_users where id=any($1::uuid[]) order by id",[[userA,userB,unprovisionedUser]]))).rows.map(row => row.id),[userA],"combined staff visibility policy still limits unrelated staff profiles");
  await admin.query("update auth.sessions set not_after = now() - interval '1 minute' where id = $1", [sessionIds.get(userA)]);
  assert.equal((await asUser(userA, (client) => client.query("select public.is_active_app_user() as allowed"))).rows[0].allowed, false, "expired sessions lose database access");
  await admin.query("update auth.sessions set not_after = null where id = $1", [sessionIds.get(userA)]);
  const actualSessionB = sessionIds.get(userB)!;
  sessionIds.set(userB, sessionIds.get(userA)!);
  assert.equal((await asUser(userB, (client) => client.query("select public.is_active_app_user() as allowed"))).rows[0].allowed, false, "session identity must match the authenticated account");
  sessionIds.set(userB, actualSessionB);
  assert.equal((await asUser(userA, (client) => client.query("select public.is_active_app_user() as allowed"), "aal1", "otp")).rows[0].allowed, false, "invitation sessions cannot skip password sign-in");
  assert.equal((await asUser(userA, (client) => client.query("select count(*)::int as count from public.families"), "aal1", "otp")).rows[0].count, 0);
  await expectDbError(() => asUser(userA, (client) => client.query("select public.consume_ai_budget('chat', 1)"), "aal1", "otp"), "password sign-in is required before AI work");
  await asUser(userA, (client) => client.query("select public.ensure_app_user()"));
  const contextRevision = (await admin.query("select to_json(updated_at) as revision from public.families where id = $1", [familyA])).rows[0].revision;
  await asUser(userA, (client) => client.query(
    "select public.save_family_planning_context($1, $2, $3::jsonb, $4::timestamptz)",
    [familyA, "Needs flexible meeting times.", JSON.stringify([{ label: "Housing", preset_key: "housing_instability" }]), contextRevision],
  ));
  const beforeBarrierChange = (await admin.query("select to_json(updated_at) as revision from public.families where id = $1", [familyA])).rows[0].revision;
  await asUser(userA, (client) => client.query(
    "select public.replace_family_barriers($1, '[{\"label\":\"Housing\"}]'::jsonb)", [familyA],
  ));
  await expectDbError(() => asUser(userA, (client) => client.query(
    "select public.save_family_planning_context($1, 'Stale barriers', '[{\"label\":\"Transportation\"}]'::jsonb, $2::timestamptz)", [familyA, beforeBarrierChange],
  )), "a barrier edit from the profile also invalidates an old planning form");
  const savedContext = await admin.query("select summary from public.families where id = $1", [familyA]);
  assert.equal(savedContext.rows[0].summary, "Needs flexible meeting times.");
  const currentContextRevision = (await admin.query("select to_json(updated_at) as revision from public.families where id = $1", [familyA])).rows[0].revision;
  await expectDbError(() => asUser(userA, (client) => client.query(
    "select public.save_family_planning_context($1, 'Stale input', '[{\"label\":\"Housing\"}]'::jsonb, $2::timestamptz)", [familyA, contextRevision],
  )), "a stale description cannot overwrite newer case details");
  await expectDbError(() => asUser(userA, (client) => client.query(
    "select public.save_family_planning_context($1, 'Invalid input', null, $2::timestamptz)", [familyA, currentContextRevision],
  )), "missing barriers cannot erase the saved barriers");
  const beforeBadContext = await admin.query("select count(*)::int as count from public.activity_log where family_id = $1", [familyA]);
  await expectDbError(() => asUser(userA, (client) => client.query(
    "select public.save_family_planning_context($1, 'This must roll back.', $2::jsonb, $3::timestamptz)",
    [familyA, JSON.stringify([{ label: "" }]), currentContextRevision],
  )), "a failed barrier write rolls back the description and audit evidence");
  const afterBadContext = await admin.query(
    `select summary,
       (select count(*)::int from public.activity_log where family_id = $1) as events,
       (select label from public.family_barriers where family_id = $1 limit 1) as barrier
     from public.families where id = $1`, [familyA],
  );
  assert.equal(afterBadContext.rows[0].summary, "Needs flexible meeting times.");
  assert.equal(afterBadContext.rows[0].barrier, "Housing");
  assert.equal(afterBadContext.rows[0].events, beforeBadContext.rows[0].count);
  await expectDbError(() => asUser(userB, (client) => client.query(
    "select public.save_family_planning_context($1, 'Unauthorized change', '[{\"label\":\"Housing\"}]'::jsonb, $2::timestamptz)", [familyA, currentContextRevision],
  )), "another staff member cannot save an inaccessible family's context");
  await expectDbError(
    () => asUser(unprovisionedUser, (client) => client.query("select public.ensure_app_user()")),
    "authenticated users cannot provision their own application role",
  );
  await expectDbError(
    () => asUser(unprovisionedUser, (client) => client.query(
      `select public.create_family_intake(
         'Unprovisioned family', null, 'medium', null,
         '[]'::jsonb, '[{"label":"Housing"}]'::jsonb, '[]'::jsonb, null
       )`,
    )),
    "unprovisioned auth accounts cannot create workspace data",
  );
  await expectDbError(
    () => asUser(unprovisionedUser, (client) => client.query(
      "select public.consume_ai_budget('chat', 1)",
    )),
    "unprovisioned auth accounts cannot consume the deployment AI budget",
  );

  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "update public.app_users set role = 'admin' where id = $1",
      [userA],
    )),
    "case managers cannot promote themselves",
  );
  await asUser(userA, (client) => client.query(
    "update public.app_users set display_name = 'Case Manager' where id = $1",
    [userA],
  ));
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "insert into public.app_users (id, email, role) values ($1, 'forged@example.test', 'admin')",
      [randomUUID()],
    )),
    "browser sessions cannot insert authorization profiles",
  );
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "select public.operator_set_user_role($1, 'admin', 'forged user', 'unauthorized role change', 'user.role_changed')",
      [userA],
    )),
    "browser sessions cannot execute operator role changes",
  );
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "select public.operator_set_family_assignment($1, $2, true, 'forged user', 'unauthorized assignment')",
      [familyB, userA],
    )),
    "browser sessions cannot execute operator assignments",
  );
  const operator = await pool.connect();
  try {
    await operator.query("begin");
    await operator.query("set local role service_role");
    await operator.query(
      "select public.operator_set_user_role($1, 'admin', 'security test', 'verify atomic role audit', 'user.role_changed')",
      [userB],
    );
    const assigned = await operator.query<{ operator_set_family_assignment: boolean }>(
      "select public.operator_set_family_assignment($1, $2, true, 'security test', 'verify atomic assignment audit')",
      [familyB, userA],
    );
    assert.equal(assigned.rows[0].operator_set_family_assignment, true);
    await operator.query("commit");
  } catch (error) {
    await operator.query("rollback");
    throw error;
  } finally {
    operator.release();
  }
  const passwordOnlyAdminAccess = await asUser(userB, (client) => client.query(
    "select count(*)::int as count from public.families where id = $1",
    [familyA],
  ));
  assert.equal(passwordOnlyAdminAccess.rows[0].count, 1, "password-only administrator can access school casework");
  assert.equal((await asUser(userB, (client) => client.query("select count(*)::int as count from public.families where id = $1", [familyB]))).rows[0].count, 1, "password-only administrator can access an owned case");
  assert.equal((await asUser(userB, (client) => client.query("select public.is_app_admin() as allowed"))).rows[0].allowed, true);
  for (const method of ["otp", "recovery", "invite"]) {
    assert.equal((await asUser(userB, (client) => client.query("select public.is_app_admin() as allowed"), "aal1", method)).rows[0].allowed, false, "a non-password session cannot use administrator authority");
    assert.equal((await asUser(userB, (client) => client.query("select count(*)::int as count from public.families"), "aal1", method)).rows[0].count, 0);
  }
  assert.equal((await admin.query("select to_regprocedure('public.has_required_mfa()') as removed")).rows[0].removed, null);
  assert.equal((await admin.query("select to_regprocedure('public.operator_revoke_mfa_sessions(uuid,text,text,text)') as removed")).rows[0].removed, null);

  await admin.query(
    "select public.operator_set_user_role($1, 'case_manager', 'security test', 'restore fixture role safely', 'user.role_changed')",
    [userB],
  );
  const roleAudit = await admin.query(
    `select count(*)::int as count from public.security_audit_log
     where target_user_id = $1 and action = 'user.role_changed'`,
    [userB],
  );
  assert.equal(roleAudit.rows[0].count, 2);
  const assignmentAudit = await admin.query(
    `select count(*)::int as count from public.security_audit_log
     where target_user_id = $1 and action = 'family.assignment_added'
       and details->>'family_id' = $2`,
    [userA, familyB],
  );
  assert.equal(assignmentAudit.rows[0].count, 1);
  const privilegedDirectDml = await admin.query(
    `select count(*)::int as count
     from information_schema.role_table_grants
     where grantee = 'service_role'
       and table_schema = 'public'
       and table_name in ('app_users', 'family_case_managers', 'activity_log', 'security_audit_log')
       and privilege_type in ('INSERT', 'UPDATE', 'DELETE')`,
  );
  assert.equal(privilegedDirectDml.rows[0].count, 0);
  const browserSchemaCreate = await admin.query<{ can_create: boolean }>(
    "select has_schema_privilege('authenticated', 'public', 'CREATE') as can_create",
  );
  assert.equal(browserSchemaCreate.rows[0].can_create, false);

  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "update public.families set created_by_id = $1 where id = $2",
      [userA, familyB],
    )),
    "ownership cannot be changed directly",
  );
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "insert into public.families (name, created_by_id) values ('Direct family', $1)",
      [userA],
    )),
    "family intake cannot bypass its transaction",
  );
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "update public.plan_steps set title = 'Contact student@example.test' where id = $1",
      [stepA],
    )),
    "direct step updates cannot bypass identifier DLP",
  );
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "update public.plan_step_action_items set description = 'Call 215-555-0100' where id = $1",
      [actionA],
    )),
    "direct action-item updates cannot bypass identifier DLP",
  );

  const created = await asUser(userA, (client) => client.query<{ create_family_intake: string }>(
    `select public.create_family_intake(
       'Family Gamma', null, 'medium', null,
       '[]'::jsonb, '[{"label":"Housing"}]'::jsonb, '[]'::jsonb, null
     )`,
  ));
  assert.match(created.rows[0].create_family_intake, /^[0-9a-f-]{36}$/);
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      `select public.create_family_intake(
         'Family Unsafe', 'email student@example.test', 'medium', null,
         '[]'::jsonb, '[{"label":"Housing"}]'::jsonb, '[]'::jsonb, null
       )`,
    )),
    "database DLP rejects obvious identifiers",
  );
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      `select public.create_family_intake(
         'Family Atomic', null, 'medium', null,
         $1::jsonb, '[{"label":"Housing"}]'::jsonb, '[]'::jsonb, null
       )`,
      [JSON.stringify([{ label: "Valid goal" }, { label: "x".repeat(201) }])],
    )),
    "invalid child rows roll back the full intake",
  );
  const partialIntake = await admin.query(
    "select count(*)::int as count from public.families where name = 'Family Atomic'",
  );
  assert.equal(partialIntake.rows[0].count, 0);

  await expectDbError(
    () => asUser(userA, (client) => client.query(
      `insert into public.activity_log (family_id, action)
       values ($1, 'plan.reviewed')`,
      [familyA],
    )),
    "activity rows cannot be fabricated",
  );
  await asUser(userA, (client) => client.query(
    "select public.record_activity_event($1, 'family.workflow_step_viewed', 'plan', $2)",
    [familyA, planA],
  ));
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "select public.record_activity_event($1, 'family.workflow_step_viewed', 'plan', $2, $3::jsonb)",
      [familyA, planA, JSON.stringify({ note: "Email student@example.test" })],
    )),
    "product timeline metadata cannot bypass identifier DLP",
  );
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "select public.record_activity_event($1, 'forged.action', 'plan', $2)",
      [familyA, planA],
    )),
    "activity taxonomy is allowlisted",
  );
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "select public.record_activity_event($1, 'step.refined', 'plan_step', $2)",
      [familyA, stepA],
    )),
    "retired product timeline actions cannot be fabricated",
  );
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "select public.record_activity_event($1, 'plan.reviewed', 'plan', $2)",
      [familyA, planA],
    )),
    "consequential database-owned events cannot be fabricated through the product timeline RPC",
  );

  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "select public.update_resource_match($1, $2, 'link', null::public.match_status, $3)",
      [familyA, matchId, stepB],
    )),
    "cross-family resource links fail",
  );
  const linked = await asUser(userA, (client) => client.query<{ update_resource_match: boolean }>(
    "select public.update_resource_match($1, $2, 'link', null::public.match_status, $3)",
    [familyA, matchId, stepA],
  ));
  assert.equal(linked.rows[0].update_resource_match, true);
  const accepted = await asUser(userA, (client) => client.query<{ update_resource_match: boolean }>(
    "select public.update_resource_match($1, $2, 'status', 'accepted', null)",
    [familyA, matchId],
  ));
  assert.equal(accepted.rows[0].update_resource_match, true);
  await asUser(userA, (client) => client.query(
    "select public.update_resource_match($1, $2, 'unlink', null::public.match_status, null)",
    [familyA, matchId],
  ));
  const matchEvents = await admin.query(
    `select count(*)::int as count from public.activity_log
     where family_id = $1 and entity_id = $2::text and source = 'database'
       and action in ('matching.linked_to_step', 'matching.accepted', 'matching.unlinked_from_step')`,
    [familyA, matchId],
  );
  assert.equal(matchEvents.rows[0].count, 3);
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "update public.resource_matches set status = 'dismissed' where id = $1",
      [matchId],
    )),
    "resource-match mutations cannot bypass their audited RPC",
  );
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "update public.resource_matches set family_id = $1 where id = $2",
      [familyB, matchId],
    )),
    "resource-match ownership remains immutable even when the user can access both families",
  );
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      `insert into public.resource_matches (family_id, resource_id, match_reason, score)
       values ($1, $2, 'Direct suggestion', 10)`,
      [familyB, resourceId],
    )),
    "resource suggestions cannot bypass their transactional RPC",
  );
  const suggestions = [{
    resource_id: resourceId,
    match_reason: "Verified housing suggestion",
    score: 20,
  }];
  const replaced = await asUser(userA, (client) => client.query<{
    replace_suggested_resource_matches: number;
  }>(
    "select public.replace_suggested_resource_matches($1, $2::jsonb, 1)",
    [familyB, JSON.stringify(suggestions)],
  ));
  assert.equal(replaced.rows[0].replace_suggested_resource_matches, 1);
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "select public.replace_suggested_resource_matches($1, $2::jsonb, 2)",
      [familyB, JSON.stringify([...suggestions, { ...suggestions[0], resource_id: randomUUID() }])],
    )),
    "an invalid resource suggestion rolls back replacement and its event",
  );
  const replacementEvidence = await admin.query(
    `select
       (select count(*)::int from public.resource_matches
        where family_id = $1 and resource_id = $2 and status = 'suggested') as matches,
       (select count(*)::int from public.activity_log
        where family_id = $1 and action = 'matching.run' and source = 'database') as events`,
    [familyB, resourceId],
  );
  assert.equal(replacementEvidence.rows[0].matches, 1);
  assert.equal(replacementEvidence.rows[0].events, 1);
  const manualMatch = await asUser(userA, (client) => client.query<{
    add_manual_resource_match: string;
  }>(
    "select public.add_manual_resource_match($1, $2)",
    [familyB, resourceId],
  ));
  assert.match(manualMatch.rows[0].add_manual_resource_match, /^[0-9a-f-]{36}$/);
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "delete from public.resource_matches where id = $1",
      [manualMatch.rows[0].add_manual_resource_match],
    )),
    "resource matches cannot be deleted outside a transactional operation",
  );
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      `insert into public.plan_step_activity (
         plan_step_id, family_id, actor_user_id, action
       ) values ($1, $2, $3, 'step.refined')`,
      [stepA, familyA, userA],
    )),
    "step activity cannot be inserted directly",
  );
  await checkReviewRaces();
  const reviewed = await asUser(userA, async (client) => client.query<{ mark_plan_reviewed: string }>(
    "select public.mark_plan_reviewed($1, $2, $3, true)",
    [familyA, planA, await revisionFor(userA, familyA)],
  ));
  assert.ok(Number.isFinite(new Date(String(reviewed.rows[0].mark_plan_reviewed)).getTime()));
  const approvedRevision = await revisionFor(userA, familyA);
  assert.equal(await canExport(approvedRevision), true, "exact approved content can be exported");
  await expectDbError(() => asUser(userA, client => client.query("update public.plans set client_display = client_display || jsonb_build_object('reviewedRevision', $2::text) where id = $1", [planA, 'f'.repeat(64)])), "review revisions cannot be forged");

  await asUser(userA, (client) => client.query(
    "update public.plans set summary = 'Revised plan summary' where id = $1",
    [planA],
  ));
  const reviewAfterPlanEdit = await admin.query(
    "select client_display ? 'reviewedAt' as reviewed from public.plans where id = $1",
    [planA],
  );
  assert.equal(reviewAfterPlanEdit.rows[0].reviewed, false);
  assert.equal(await canExport(approvedRevision), false, "an old preview is blocked after a material edit");
  await asUser(userA, async (client) => client.query(
    "select public.mark_plan_reviewed($1, $2, $3, true)",
    [familyA, planA, await revisionFor(userA, familyA)],
  ));
  await asUser(userA, (client) => client.query(
    "update public.plan_steps set workflow_data = '{\"documents_received\":true}'::jsonb where id = $1",
    [stepA],
  ));
  const reviewAfterProgress = await admin.query(
    "select client_display ? 'reviewedAt' as reviewed from public.plans where id = $1",
    [planA],
  );
  assert.equal(reviewAfterProgress.rows[0].reviewed, true);
  const progressSnapshot = (await snapshotFor(userA, familyA)).plan;
  assert.equal(progressSnapshot.material_revision, progressSnapshot.client_display.reviewedRevision);
  assert.equal(await canExport(progressSnapshot.review_revision), true, "current progress is exportable under the reviewed plan");
  await admin.query("update public.families set name = 'Family updated label' where id = $1", [familyA]);
  assert.equal(await canExport(progressSnapshot.review_revision), false, "a changed PDF family header invalidates the old preview");
  assert.equal(await canExport(await revisionFor(userA, familyA)), false, "reloading a changed family label requires a fresh plan review");

  await asUser(userA, (client) => client.query(
    "update public.plan_steps set title = 'Revised alpha step' where id = $1",
    [stepA],
  ));
  const reviewAfterMaterialEdit = await admin.query(
    "select client_display ? 'reviewedAt' as reviewed from public.plans where id = $1",
    [planA],
  );
  assert.equal(reviewAfterMaterialEdit.rows[0].reviewed, false);
  await expectDbError(
    () => asUser(userA, (client) => client.query(
      `insert into public.plan_steps (plan_id, phase, title, description, sort_order)
       values ($1, '30', 'Bypass step', '', 2)`,
      [planA],
    )),
    "manual plan steps cannot bypass their atomic RPC",
  );
  await checkAtomicPlanEdits();
  const manualStep = await asUser(userA, (client) => client.query<{ create_manual_plan_step: string }>(
    `select public.create_manual_plan_step(
       $1, $2, '30', 'Manual housing action', 'Contact the approved office',
       '2026-08-20'::date, '{"owner":"case_manager","stage_goal":"Housing stability"}'::jsonb
     )`,
    [familyA, planA],
  ));
  const manualStepId = manualStep.rows[0].create_manual_plan_step;
  const manualStepEvidence = await admin.query(
    `select
       (select count(*)::int from public.plan_step_action_items where plan_step_id = $1) as actions,
       (select count(*)::int from public.activity_log where entity_id = $1::text and action = 'step.added') as events`,
    [manualStepId],
  );
  assert.equal(manualStepEvidence.rows[0].actions, 1);
  assert.equal(manualStepEvidence.rows[0].events, 1);
  const manualDeleted = await asUser(userA, (client) => client.query<{ delete_plan_step: boolean }>(
    "select public.delete_plan_step($1, $2)",
    [familyA, manualStepId],
  ));
  assert.equal(manualDeleted.rows[0].delete_plan_step, true);
  const manualDeleteEvidence = await admin.query(
    "select count(*)::int as count from public.activity_log where entity_id = $1 and action = 'step.deleted'",
    [manualStepId],
  );
  assert.equal(manualDeleteEvidence.rows[0].count, 1);

  const unrelatedArchive = await asUser(userA, (client) =>
    client.query<{ archive_family: boolean }>("select public.archive_family($1)", [familyB]));
  assert.equal(unrelatedArchive.rows[0].archive_family, false);
  const archived = await asUser(userA, (client) => client.query<{ archive_family: boolean }>(
    "select public.archive_family($1)",
    [familyA],
  ));
  assert.equal(archived.rows[0].archive_family, true);

  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "insert into public.case_notes (family_id, author_id, body) values ($1, $2, 'Direct note')",
      [familyA, userA],
    )),
    "case notes are append-only through the audited RPC",
  );
  const note = await asUser(userA, (client) => client.query<{ add_case_note: string }>(
    "select public.add_case_note($1, 'Privacy-safe progress update')",
    [familyA],
  ));
  const noteAudit = await admin.query(
    `select count(*)::int as count from public.activity_log
     where family_id = $1 and action = 'note.added' and entity_id = $2`,
    [familyA, note.rows[0].add_case_note],
  );
  assert.equal(noteAudit.rows[0].count, 1);

  const invalidGeneratedStep = [{
    phase: "30",
    title: "Valid step",
    description: "Valid description",
    sort_order: 0,
    priority: "medium",
    details: { expected_outcome: "A safe outcome" },
    action_items: [{
      title: "",
      description: null,
      week_index: 1,
      target_date: "2026-08-10",
      sort_order: 0,
    }],
  }];
  await expectDbError(
    () => asUser(userB, (client) => client.query(
      "select public.create_plan_with_steps($1, 'rules', null, $2::jsonb)",
      [familyB, JSON.stringify(invalidGeneratedStep)],
    )),
    "invalid generated children roll back the plan and audit event",
  );
  const partialPlan = await admin.query(
    "select count(*)::int as count from public.plans where family_id = $1 and version = 2",
    [familyB],
  );
  assert.equal(partialPlan.rows[0].count, 0);

  await admin.query("update public.plan_steps set details=jsonb_build_object('expected_outcome','Housing options confirmed') where id=$1", [stepB]);
  const previousRevision = await revisionFor(userB, familyB);
  await asUser(userB, client => client.query("select public.mark_plan_reviewed($1,$2,$3,true)", [familyB,planB,previousRevision]));
  const generationLease = randomUUID();
  assert.equal((await asUser(userB, client => client.query("select public.claim_ai_job($1,'staged-plan-advance',$2,600) claimed", [familyB,generationLease]))).rows[0].claimed, true);
  const initialGenerationState = {
    v: 1,
    status: "running",
    pending_phase: "30",
    input_snapshot: {
      family_id: familyB, captured_at: "2026-10-13T12:00:00Z", revision: "a".repeat(64),
      brief: JSON.stringify({ instructions: "Do not contact the landlord.", summary: "Housing support and benefits navigation" }),
      resources: "None matched",
    },
    phases_complete: { "30": false, "60": false, "90": false },
    models_used: [],
    stage_timings_ms: {},
    ai_mode: "fast",
  };
  const stagedStarts = await Promise.all(
    Array.from({ length: 6 }, () => asUser(userB, async (client) => {
      const result = await client.query<{
        start_staged_plan_generation: { planId: string; existing: boolean };
      }>(
        "select public.start_staged_plan_generation($1, $2::jsonb)",
        [familyB, JSON.stringify(initialGenerationState)],
      );
      return result.rows[0].start_staged_plan_generation;
    })),
  );
  assert.equal(new Set(stagedStarts.map((result) => result.planId)).size, 1);
  assert.equal(stagedStarts.filter((result) => !result.existing).length, 1);
  const stagedPlanId = stagedStarts[0].planId;
  const previousPlan = (await asUser(userB, client => client.query("select public.get_previous_reviewed_plan($1) plan", [familyB]))).rows[0].plan;
  assert.equal(previousPlan.id,planB,"previous reviewed plan remains available while replacement is running");
  assert.equal(previousPlan.steps[0].action_items[0].id,actionB);
  assert.equal((await asUser(unprovisionedUser, client => client.query("select public.get_previous_reviewed_plan($1) plan",[familyB]))).rows[0].plan,null,"previous plans retain normal row-level access control");

  const nextGenerationState = {
    ...initialGenerationState,
    pending_phase: "60",
    phases_complete: { ...initialGenerationState.phases_complete, "30": true },
    models_used: ["gpt-test"],
    stage_timings_ms: { "30": 25 },
  };
  const invalidPhase = [{
    phase: "30",
    title: "Initial housing outreach",
    description: "Contact the approved program.",
    sort_order: 0,
    priority: "medium",
    details: { expected_outcome: "Outreach is completed." },
    action_items: [{
      title: "",
      description: null,
      week_index: 1,
      target_date: "2026-08-10",
      sort_order: 0,
    }],
  }];
  await expectDbError(
    () => asUser(userB, (client) => client.query(
      "select public.append_staged_plan_phase($1, $2, '30', $3::jsonb, $4::jsonb, 'gpt-test', 25, $5)",
      [familyB, stagedPlanId, JSON.stringify(invalidPhase), JSON.stringify(nextGenerationState), generationLease],
    )),
    "invalid staged children roll back the complete phase transition",
  );
  const rolledBackPhase = await admin.query(
    `select
       (select count(*)::int from public.plan_steps where plan_id = $1 and phase = '30') as steps,
       generation_state->>'pending_phase' as pending_phase
     from public.plans where id = $1`,
    [stagedPlanId],
  );
  assert.equal(rolledBackPhase.rows[0].steps, 0);
  assert.equal(rolledBackPhase.rows[0].pending_phase, "30");

  const validPhase = [{
    ...invalidPhase[0],
    action_items: [{ ...invalidPhase[0].action_items[0], title: "Call the housing program" }],
  }];
  const appended = await asUser(userB, (client) => client.query<{ append_staged_plan_phase: boolean }>(
    "select public.append_staged_plan_phase($1, $2, '30', $3::jsonb, $4::jsonb, 'gpt-test', 25, $5)",
    [familyB, stagedPlanId, JSON.stringify(validPhase), JSON.stringify(nextGenerationState), generationLease],
  ));
  assert.equal(appended.rows[0].append_staged_plan_phase, true);
  const savedGenerationSnapshot = await admin.query("select generation_state->'input_snapshot' as snapshot from public.plans where id = $1", [stagedPlanId]);
  assert.deepEqual(savedGenerationSnapshot.rows[0].snapshot, initialGenerationState.input_snapshot, "phase append preserves the exact saved planning snapshot");
  const committedPhase = await admin.query(
    `select
       (select count(*)::int from public.plan_steps where plan_id = $1 and phase = '30') as steps,
       (select count(*)::int from public.activity_log where family_id = $2 and entity_id = $1::text and action = 'plan.stage_generated') as events,
       generation_state->>'pending_phase' as pending_phase
     from public.plans where id = $1`,
    [stagedPlanId, familyB],
  );
  assert.equal(committedPhase.rows[0].steps, 1);
  assert.equal(committedPhase.rows[0].events, 1);
  assert.equal(committedPhase.rows[0].pending_phase, "60");
  await expectDbError(
    () => asUser(userB, (client) => client.query(
      "select public.update_staged_plan_state($1, $2, $3::jsonb, $4, 'gpt-test', 'plan.generation_finished', '{}'::jsonb)",
      [familyB, stagedPlanId, JSON.stringify(nextGenerationState), generationLease],
    )),
    "generation audit events must match the persisted state",
  );
  const failedGenerationState = {
    ...nextGenerationState,
    status: "failed",
    error: "Provider unavailable",
  };
  await expectDbError(
    () => asUser(userB, (client) => client.query(
      "select public.update_staged_plan_state($1, $2, $3::jsonb, $5, 'gpt-test', 'plan.generation_failed', $4::jsonb)",
      [
        familyB,
        stagedPlanId,
        JSON.stringify(failedGenerationState),
        JSON.stringify({ category: "Call 215-555-0100" }),
        generationLease,
      ],
    )),
    "generation event metadata cannot bypass identifier DLP",
  );
  const failedStateUpdated = await asUser(userB, (client) => client.query<{
    update_staged_plan_state: boolean;
  }>(
    "select public.update_staged_plan_state($1, $2, $3::jsonb, $4, 'gpt-test', 'plan.generation_failed', '{\"category\":\"provider\"}'::jsonb)",
    [familyB, stagedPlanId, JSON.stringify(failedGenerationState), generationLease],
  ));
  assert.equal(failedStateUpdated.rows[0].update_staged_plan_state, true);
  const failedStateEvidence = await admin.query(
    `select
       generation_state->>'status' as status,
       (select count(*)::int from public.activity_log
        where family_id = $2 and entity_id = $1::uuid::text and action = 'plan.generation_failed') as events
     from public.plans where id = $1::uuid`,
    [stagedPlanId, familyB],
  );
  assert.equal(failedStateEvidence.rows[0].status, "failed");
  assert.equal((await asUser(userB, client => client.query("select public.get_previous_reviewed_plan($1) plan",[familyB]))).rows[0].plan.id,planB,"previous plan remains available after replacement failure");
  await admin.query("update private.ai_job_claims set expires_at=clock_timestamp()-interval '1 second' where family_id=$1 and job_key='staged-plan-advance'",[familyB]);
  const nextLease = randomUUID();
  assert.equal((await asUser(userB, client => client.query("select public.claim_ai_job($1,'staged-plan-advance',$2,600) claimed",[familyB,nextLease]))).rows[0].claimed,true,"expired request can be resumed");
  await asUser(userB, client => client.query("select public.release_ai_job($1,'staged-plan-advance',$2)",[familyB,generationLease]));
  assert.equal((await admin.query("select lease_id from private.ai_job_claims where family_id=$1 and job_key='staged-plan-advance'",[familyB])).rows[0].lease_id,nextLease,"old request cannot release a newer lease held by the same user");
  await expectDbError(() => asUser(userB, client => client.query("select public.update_staged_plan_state($1,$2,$3::jsonb,$4)",[familyB,stagedPlanId,JSON.stringify(failedGenerationState),generationLease])),"expired request cannot overwrite the new request's state");
  await expectDbError(() => asUser(userB, client => client.query("select public.append_staged_plan_phase($1,$2,'30',$3::jsonb,$4::jsonb,'gpt-test',25,$5)",[familyB,stagedPlanId,JSON.stringify(validPhase),JSON.stringify(nextGenerationState),generationLease])),"expired request cannot append a phase");
  await asUser(userB, client => client.query("select public.release_ai_job($1,'staged-plan-advance',$2)",[familyB,nextLease]));
  assert.equal(failedStateEvidence.rows[0].events, 1);
  await expectDbError(
    () => asUser(userB, (client) => client.query(
      `update public.plans
       set client_display = '{"reviewedAt":"2026-08-04T00:00:00Z","reviewedById":"00000000-0000-0000-0000-000000000000"}'::jsonb
       where id = $1`,
      [stagedPlanId],
    )),
    "reviewed-plan evidence cannot be forged through direct plan updates",
  );
  await expectDbError(
    () => asUser(userB, (client) => client.query(
      "update public.plans set generation_state = '{\"status\":\"complete\"}'::jsonb where id = $1",
      [stagedPlanId],
    )),
    "generation state cannot be forged through direct plan updates",
  );
  const stagedChild = await admin.query<{ step_id: string; action_id: string }>(
    `select step.id as step_id, item.id as action_id
     from public.plan_steps step
     join public.plan_step_action_items item on item.plan_step_id = step.id
     where step.plan_id = $1 limit 1`,
    [stagedPlanId],
  );
  await expectDbError(
    () => asUser(userB, (client) => client.query(
      `update public.plan_steps
       set workflow_data = '{"outcome_notes":"Email student@example.test"}'::jsonb
       where id = $1`,
      [stagedChild.rows[0].step_id],
    )),
    "direct plan-step writes cannot bypass obvious-identifier DLP",
  );
  await expectDbError(
    () => asUser(userB, (client) => client.query(
      "update public.plan_step_action_items set notes = 'Call 215-555-0100' where id = $1",
      [stagedChild.rows[0].action_id],
    )),
    "direct action-item writes cannot bypass obvious-identifier DLP",
  );

  await checkAiBudgetJourneys();
  const budgetResults = await Promise.all(
    Array.from({ length: 10 }, () => asUser(userB, async (client) => {
      const result = await client.query<{ consume_ai_budget: { allowed: boolean } }>(
        "select public.consume_ai_budget('pdf_mapping', 1)",
      );
      return result.rows[0].consume_ai_budget.allowed;
    })),
  );
  assert.equal(budgetResults.filter(Boolean).length, 3);

  const claimResults = await Promise.all(
    Array.from({ length: 8 }, () => asUser(userB, async (client) => {
      const result = await client.query<{ claim_ai_job: boolean }>(
        "select public.claim_ai_job($1, 'security-concurrency', $2, 60)",
        [familyB, randomUUID()],
      );
      return result.rows[0].claim_ai_job;
    })),
  );
  assert.equal(claimResults.filter(Boolean).length, 1);

  await expectDbError(
    () => asUser(userA, (client) => client.query(
      "select * from public.security_audit_log",
    )),
    "operator security audit is not browser-readable",
  );

  const afterDowngrade = await asUser(userB, (client) => client.query("select public.is_app_admin() as allowed"), "aal2");
  assert.equal(afterDowngrade.rows[0].allowed, false, "role downgrade applies to retained AAL2 tokens");
  await expectDbError(() => asUser(userA, (client) => client.query(
    "select public.operator_offboard_user($1, $2, 'forged operator', 'Unauthorized removal')", [userB, userA],
  )), "browser roles cannot offboard staff");
  await admin.query("select public.operator_set_user_role($1, 'admin', 'security test', 'Verify inactive admin denial', 'user.role_changed')", [userA]);
  assert.equal((await asUser(userA, (client) => client.query("select public.is_app_admin() as allowed"), "aal2")).rows[0].allowed, true);
  await admin.query("alter table public.security_audit_log add constraint test_reject_offboarding check (action <> 'user.disabled') not valid");
  try {
    await expectDbError(() => admin.query("select public.operator_offboard_user($1, $2, 'security test', 'Audit failure must roll back')", [userA, userB]), "audit failure rolls back offboarding");
    assert.equal((await admin.query("select is_active from public.app_users where id = $1", [userA])).rows[0].is_active, true);
    assert.equal((await admin.query("select 1 from public.family_case_managers where family_id = $1 and user_id = $2", [familyA, userB])).rowCount, 0, "failed offboarding did not reassign cases");
  } finally {
    await admin.query("alter table public.security_audit_log drop constraint test_reject_offboarding");
  }
  await admin.query("select public.operator_offboard_user($1, $2, 'security test', 'Synthetic offboarding verification')", [userA, userB]);
  assert.equal((await asUser(userA, (client) => client.query("select public.is_app_admin() as allowed"), "aal2")).rows[0].allowed, false);
  for (const table of ["families", "plan_steps", "plan_step_action_items", "resources"]) {
    const denied = await asUser(userA, (client) => client.query(`select count(*)::int as count from public.${table}`), "aal2");
    assert.equal(denied.rows[0].count, 0, `inactive user cannot read ${table}`);
  }
  for (const rpc of ["select public.ensure_app_user()", "select public.consume_ai_budget('chat', 1)",
    `select public.archive_family('${familyA}')`,
    "select public.create_family_intake('Denied family', null, 'medium', null, '[]'::jsonb, '[{\"label\":\"Housing\"}]'::jsonb, '[]'::jsonb, null)"]) {
    await expectDbError(() => asUser(userA, (client) => client.query(rpc)), "inactive users cannot use privileged mutation functions");
  }
  await expectDbError(() => asUser(userA, (client) => client.query("update public.app_users set is_active = true where id = $1", [userA])), "offboarded staff cannot reactivate themselves");
  const preserved = await asUser(userB, (client) => client.query("select id from public.families where id = $1", [familyA]));
  assert.equal(preserved.rowCount, 1, "replacement staff can still access the preserved case");

  console.info("Database security integration checks passed.");
}

async function cleanup() {
  try {
    await admin.query("delete from private.ai_rate_counters where scope_key like $1", [`user:${userB}:%`]);
    await admin.query("delete from public.families where created_by_id = any($1::uuid[])", [[userA, userB]]);
    await admin.query("delete from public.resources where id = $1", [resourceId]);
    await admin.query(
      "delete from auth.users where id = any($1::uuid[])",
      [[userA, userB, unprovisionedUser]],
    );
  } finally {
    await pool.end();
    await admin.end();
  }
}

run()
  .finally(cleanup)
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
